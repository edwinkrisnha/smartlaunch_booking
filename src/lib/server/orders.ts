// Paid orders: created here, paid at the provider, then delivered to the Smartlaunch
// server. Status changes are conditional UPDATEs, so the webhook, the customer's return
// page and the scheduled sweep can all run at the same time without crediting twice:
//
//   pending ──paid at provider──> paid ──claim──> delivering ──addmoney ok──> delivered
//      │                            ^                 │
//      └─> failed | expired         └──addmoney fails──┘ (retried with backoff)

import type { TopupOrder } from '#lib/types.js';
import { db, nowSeconds } from './db.js';
import { BookingError } from './booking.js';
import { paymentProvider, paymentSettings, providerById, PaymentProviderError, type PaymentStatus } from './payments/index.js';
import * as sl from './smartlaunch.js';

interface OrderRow {
	id: string;
	username: string;
	kind: 'topup';
	amount_cents: number;
	currency: string;
	status: 'pending' | 'paid' | 'delivering' | 'delivered' | 'failed' | 'expired';
	provider: string;
	provider_ref: string | null;
	attempts: number;
	next_attempt_at: number | null;
	lease_until: number | null;
	last_error: string | null;
	created_at: number;
	updated_at: number;
	paid_at: number | null;
	delivered_at: number | null;
}

/** How long one delivery attempt may hold an order before another worker may take over. */
const LEASE_SECONDS = 120;
/** A checkout reported as failed can still be retried on the payment page for a while. */
const FAILED_FINAL_AFTER = 60 * 60;
/** Checkouts that never complete are given up after this long. */
const PENDING_EXPIRES_AFTER = 24 * 60 * 60;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

const ORDER_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** "TU" + 14 random letters/digits: valid as a Smartlaunch OrderCode and a provider reference. */
function newOrderId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(14));
	return 'TU' + Array.from(bytes, (b) => ORDER_ID_ALPHABET[b % ORDER_ID_ALPHABET.length]).join('');
}

function toTopupOrder(row: OrderRow): TopupOrder {
	return {
		id: row.id,
		amountCents: row.amount_cents,
		currency: row.currency,
		status: row.status === 'delivering' ? 'paid' : row.status,
		createdAt: row.created_at
	};
}

async function getOrder(id: string): Promise<OrderRow | null> {
	return db().prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<OrderRow>();
}

/**
 * Create a top-up order and its checkout. Returns the payment page URL.
 * `origin` is the site's own origin, for the return and webhook URLs.
 */
export async function createTopup(username: string, amountCents: number, origin: string): Promise<string> {
	const provider = paymentProvider();
	if (!provider) throw new BookingError('topup.error.off', 404);

	const { currency, topupMin, topupMax } = paymentSettings;
	if (!Number.isInteger(amountCents) || amountCents < topupMin * 100 || amountCents > topupMax * 100) {
		throw new BookingError('topup.error.amount', 400, { min: topupMin, max: topupMax });
	}

	const id = newOrderId();
	const now = nowSeconds();
	await db()
		.prepare(
			`INSERT INTO orders (id, username, kind, amount_cents, currency, status, provider, created_at, updated_at)
			 VALUES (?, ?, 'topup', ?, ?, 'pending', ?, ?, ?)`
		)
		.bind(id, username, amountCents, currency, provider.id, now, now)
		.run();

	try {
		const checkout = await provider.createCheckout({
			reference: id,
			amountCents,
			currency,
			description: `Top-up ${username}`,
			redirectUrl: `${origin}/topup/return?order=${id}`,
			// Providers can't reach plain-http or localhost sites; the return page and the sweep cover those.
			webhookUrl: origin.startsWith('https://') ? `${origin}/api/payments/webhook/${provider.id}` : undefined
		});
		await db()
			.prepare('UPDATE orders SET provider_ref = ?, updated_at = ? WHERE id = ?')
			.bind(checkout.providerRef, nowSeconds(), id)
			.run();
		return checkout.paymentUrl;
	} catch (err) {
		console.error(`Top-up ${id}: creating the checkout failed`, err);
		await db()
			.prepare(`UPDATE orders SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`)
			.bind(String((err as Error).message ?? err).slice(0, 500), nowSeconds(), id)
			.run();
		throw new BookingError('topup.error.start', 502);
	}
}

/**
 * Bring an order up to date: ask the provider about a pending checkout, then deliver
 * it if it is paid. Safe to call any number of times, from anywhere.
 * Returns the order plus what the provider currently reports (for the return page).
 */
export async function syncOrder(id: string): Promise<{ order: TopupOrder; providerStatus: PaymentStatus | null } | null> {
	let row = await getOrder(id);
	if (!row) return null;
	let providerStatus: PaymentStatus | null = null;

	if (row.status === 'pending' && row.provider_ref) {
		const provider = providerById(row.provider);
		if (!provider) throw new PaymentProviderError(`Order ${id} was paid through "${row.provider}", which is not configured`);
		const state = await provider.getCheckout(row.provider_ref);
		providerStatus = state.status;
		const now = nowSeconds();
		const age = now - row.created_at;

		if (state.status === 'paid') {
			if (state.amountCents !== row.amount_cents || state.currency !== row.currency || state.reference !== row.id) {
				// Never deliver something other than what the customer was charged for; staff must look at it.
				const detail = `Paid checkout does not match the order: ${state.amountCents} ${state.currency} ref ${state.reference}`;
				console.error(`Order ${id}: ${detail}`);
				await db()
					.prepare(`UPDATE orders SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
					.bind(detail, now, id)
					.run();
			} else {
				await db()
					.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
					.bind(now, now, id)
					.run();
			}
		} else if (
			state.status === 'expired' ||
			(state.status === 'failed' && age > FAILED_FINAL_AFTER) ||
			age > PENDING_EXPIRES_AFTER
		) {
			const final = state.status === 'failed' ? 'failed' : 'expired';
			await db()
				.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
				.bind(final, now, id)
				.run();
		}
		row = (await getOrder(id))!;
	}

	if (row.status === 'paid' || row.status === 'delivering') {
		await deliver(row);
		row = (await getOrder(id))!;
	}

	return { order: toTopupOrder(row), providerStatus };
}

/** Credit a paid order on the Smartlaunch server, holding a lease so only one worker does it. */
async function deliver(row: OrderRow): Promise<void> {
	const now = nowSeconds();
	const claim = await db()
		.prepare(
			`UPDATE orders SET status = 'delivering', lease_until = ?, attempts = attempts + 1, updated_at = ?
			 WHERE id = ?
			   AND (status = 'paid' OR (status = 'delivering' AND lease_until < ?))
			   AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`
		)
		.bind(now + LEASE_SECONDS, now, row.id, now, now)
		.run();
	if (claim.meta.changes !== 1) return;

	try {
		if (!(await sl.addMoney(row.username, row.amount_cents / 100, row.id))) {
			throw new Error(`addmoney returned false (does user "${row.username}" exist?)`);
		}
		await db()
			.prepare(
				`UPDATE orders SET status = 'delivered', delivered_at = ?, lease_until = NULL, last_error = NULL, updated_at = ?
				 WHERE id = ? AND status = 'delivering'`
			)
			.bind(nowSeconds(), nowSeconds(), row.id)
			.run();
	} catch (err) {
		const backoff = Math.min(60 * 2 ** row.attempts, MAX_BACKOFF_SECONDS);
		console.error(`Order ${row.id}: delivery attempt ${row.attempts + 1} failed; retrying in ${backoff}s`, err);
		await db()
			.prepare(
				`UPDATE orders SET status = 'paid', lease_until = NULL, last_error = ?, next_attempt_at = ?, updated_at = ?
				 WHERE id = ? AND status = 'delivering'`
			)
			.bind(String((err as Error).message ?? err).slice(0, 500), nowSeconds() + backoff, nowSeconds(), row.id)
			.run();
	}
}

/** One order as stored, without asking the provider; null if unknown. */
export async function getTopup(id: string): Promise<TopupOrder | null> {
	const row = await getOrder(id);
	return row ? toTopupOrder(row) : null;
}

/** The customer's recent top-ups, newest first. */
export async function listTopups(username: string, limit = 10): Promise<TopupOrder[]> {
	const { results } = await db()
		.prepare(`SELECT * FROM orders WHERE username = ? AND provider_ref IS NOT NULL ORDER BY created_at DESC LIMIT ?`)
		.bind(username, limit)
		.all<OrderRow>();
	return results.map(toTopupOrder);
}

/** Whether the order belongs to `username`, for checking access to the return page. */
export async function orderBelongsTo(id: string, username: string): Promise<boolean> {
	const row = await getOrder(id);
	return row !== null && row.username.toLowerCase() === username.toLowerCase();
}

/** Find the order for a provider's checkout id (from a webhook). */
export async function orderIdForCheckout(provider: string, providerRef: string): Promise<string | null> {
	const row = await db()
		.prepare('SELECT id FROM orders WHERE provider = ? AND provider_ref = ?')
		.bind(provider, providerRef)
		.first<{ id: string }>();
	return row?.id ?? null;
}

export async function recordPaymentEvent(provider: string, providerRef: string | null, eventType: string | null, payload: string) {
	await db()
		.prepare('INSERT INTO payment_events (provider, provider_ref, event_type, payload, received_at) VALUES (?, ?, ?, ?, ?)')
		.bind(provider, providerRef, eventType, payload.slice(0, 4000), nowSeconds())
		.run();
}

/**
 * Scheduled job: finish orders nobody is looking at any more, e.g. paid while the
 * center server was offline, or abandoned on the payment page.
 */
export async function sweepOrders(limit = 50): Promise<{ checked: number; failed: number }> {
	const now = nowSeconds();
	const { results } = await db()
		.prepare(
			`SELECT id FROM orders
			 WHERE (status = 'paid' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
			    OR (status = 'delivering' AND lease_until < ?)
			    OR (status = 'pending' AND provider_ref IS NOT NULL AND created_at < ?)
			 ORDER BY updated_at
			 LIMIT ?`
		)
		// Leave fresh checkouts alone; the customer is probably still on the payment page.
		.bind(now, now, now - 5 * 60, limit)
		.all<{ id: string }>();

	let failed = 0;
	for (const { id } of results) {
		try {
			await syncOrder(id);
		} catch (err) {
			failed++;
			console.error(`Sweep: order ${id} could not be synced`, err);
		}
	}
	return { checked: results.length, failed };
}
