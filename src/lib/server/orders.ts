// Paid orders (top-ups and bookings): created here, paid at the provider, then
// delivered to the Smartlaunch server. Status changes are conditional UPDATEs, so the
// webhook, the customer's return page and the scheduled sweep can all run at the same
// time without delivering twice:
//
//   pending ──paid at provider──> paid ──claim──> delivering ──delivered ok──> delivered
//      │                            ^                 │
//      └─> failed | expired         └───── fails ─────┘ (retried with backoff)
//
// Delivering a top-up credits the money (addmoney). A booking order first holds its
// stations in Smartlaunch, unpaid, before the customer is sent to pay; delivering it
// marks that booking paid. An unpaid hold is cancelled when it expires, so the stations
// are never sold twice. If a payment still arrives after that and someone else has
// taken the stations, the order becomes needs_refund for staff.

import type { BookingOrder, SessionUser, TopupOrder } from '#lib/types.js';
import { formatLocal } from '#lib/time.js';
import { PLAN_NAMES, type StationQuote } from '#lib/pricing.js';
import { db, nowSeconds } from './db.js';
import { throttle } from './limits.js';
import { BookingError, bookingFields, describeQuote, type PreparedBooking } from './booking.js';
import { pricingEnabled } from './pricing.js';
import { paymentProvider, paymentSettings, providerById, PaymentProviderError, type PaymentStatus } from './payments/index.js';
import * as sl from './smartlaunch.js';

interface OrderRow {
	id: string;
	username: string;
	kind: 'topup' | 'booking';
	amount_cents: number;
	currency: string;
	status: 'pending' | 'paid' | 'delivering' | 'delivered' | 'failed' | 'expired' | 'needs_refund';
	provider: string;
	provider_ref: string | null;
	/** The provider's code for the payment (on the receipt and in its dashboard), once paid. */
	provider_txn: string | null;
	attempts: number;
	next_attempt_at: number | null;
	lease_until: number | null;
	last_error: string | null;
	booking_id: string | null;
	/** JSON BookingDetails, for booking orders. */
	details: string | null;
	hold_until: number | null;
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

/** How long stations stay held for a customer who is paying for them. */
export const BOOKING_HOLD_MINUTES = 15;
/** Extra time after the hold before releasing it, for a payment completed at the last second. */
const HOLD_GRACE_SECONDS = 2 * 60;
/** After a hold is released, its checkout is still checked this long for a payment that slipped through. */
const LATE_PAYMENT_SECONDS = 60 * 60;
/** Bookings one customer may have waiting for payment at once. */
const MAX_OPEN_HOLDS = 2;
/** Holds a customer may let run out unpaid per hour before they have to wait. */
const MAX_UNPAID_HOLDS_PER_HOUR = 4;
/** Top-up checkouts one customer may start per hour. */
const TOPUPS_PER_HOUR = 10;

const ORDER_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Prefix + 14 random letters/digits: valid as a Smartlaunch OrderCode and a provider reference. */
function newOrderId(prefix: 'TU' | 'BK'): string {
	const bytes = crypto.getRandomValues(new Uint8Array(14));
	return prefix + Array.from(bytes, (b) => ORDER_ID_ALPHABET[b % ORDER_ID_ALPHABET.length]).join('');
}

/** What a booking order remembers about its booking. */
interface BookingDetails {
	/** The booking as it is written once paid. */
	fields: sl.BookingFields;
	computerNames: string[];
	/** Center wall-clock time, `YYYY-MM-DDTHH:mm`. */
	start: string;
	end: string;
}

function toTopupOrder(row: OrderRow): TopupOrder {
	const status = row.status === 'delivering' ? 'paid' : row.status === 'needs_refund' ? 'failed' : row.status;
	return { id: row.id, amountCents: row.amount_cents, currency: row.currency, status, createdAt: row.created_at };
}

function toBookingOrder(row: OrderRow): BookingOrder {
	const details = JSON.parse(row.details ?? '{}') as Partial<BookingDetails>;
	return {
		id: row.id,
		amountCents: row.amount_cents,
		currency: row.currency,
		status: row.status === 'delivering' ? 'paid' : row.status,
		cancelled: row.status === 'expired' && row.last_error === CANCELLED_BY_CUSTOMER,
		bookingId: row.booking_id,
		start: details.start ?? '',
		end: details.end ?? '',
		computerNames: details.computerNames ?? []
	};
}

async function markFailed(id: string, reason: unknown): Promise<void> {
	await db()
		.prepare(`UPDATE orders SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
		.bind(String((reason as Error)?.message ?? reason).slice(0, 500), nowSeconds(), id)
		.run();
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

	await throttle(`topup:${username.toLowerCase()}`, TOPUPS_PER_HOUR, 60 * 60);
	const account = await sl.getUser(username);
	if (!account || account.Deleted) throw new BookingError('error.accountGone', 401);

	const id = newOrderId('TU');
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
			description: `Top-up ${username}, order ${id}`,
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

/** Bookings are paid online when a payment provider is set up and prices are on. */
export function paidBookingsEnabled(): boolean {
	return paymentProvider() !== null && pricingEnabled;
}

/**
 * Hold the stations of a prepared booking in Smartlaunch, unpaid, and start its
 * checkout. Returns the payment page URL. The hold is released if the customer
 * doesn't pay within BOOKING_HOLD_MINUTES.
 */
export async function startBookingPayment(
	user: SessionUser,
	booking: PreparedBooking,
	origin: string
): Promise<{ orderId: string; paymentUrl: string }> {
	const provider = paymentProvider();
	const quote = booking.quote;
	if (!provider || !quote) throw new BookingError('topup.error.off', 404);
	if (quote.currency !== paymentSettings.currency) {
		console.error(`Prices are in ${quote.currency} but PAYMENT_CURRENCY is ${paymentSettings.currency}; bookings can't be paid.`);
		throw new BookingError('topup.error.start', 500);
	}
	if (quote.total <= 0) throw new BookingError('topup.error.start', 500);

	// Holding stations costs nothing until paid, so cap how many a customer can tie up.
	const now = nowSeconds();
	const recent = await db()
		.prepare(
			`SELECT
			   COALESCE(SUM(status = 'pending' AND hold_until + ? > ?), 0) AS open,
			   COALESCE(SUM(status IN ('expired', 'failed') AND booking_id IS NOT NULL AND paid_at IS NULL), 0) AS unpaid
			 FROM orders WHERE username = ? AND kind = 'booking' AND created_at > ?`
		)
		.bind(HOLD_GRACE_SECONDS, now, user.username, now - 60 * 60)
		.first<{ open: number; unpaid: number }>();
	if ((recent?.open ?? 0) >= MAX_OPEN_HOLDS) {
		throw new BookingError('error.tooManyHolds', 409, { count: recent!.open, minutes: BOOKING_HOLD_MINUTES });
	}
	if ((recent?.unpaid ?? 0) >= MAX_UNPAID_HOLDS_PER_HOUR) throw new BookingError('error.tooManyUnpaid', 429);

	const id = newOrderId('BK');
	const holdUntil = now + BOOKING_HOLD_MINUTES * 60;
	const details: BookingDetails = {
		fields: bookingFields(user, booking, `Paid online, order ${id}. ${describeQuote(quote)}`),
		computerNames: booking.computerNames,
		start: formatLocal(booking.from),
		end: formatLocal(booking.to)
	};

	await db()
		.prepare(
			`INSERT INTO orders (id, username, kind, amount_cents, currency, status, provider, details, hold_until, created_at, updated_at)
			 VALUES (?, ?, 'booking', ?, ?, 'pending', ?, ?, ?, ?, ?)`
		)
		.bind(id, user.username, quote.total, quote.currency, provider.id, JSON.stringify(details), holdUntil, now, now)
		.run();

	// Hold the stations first, so nobody else can take them while the customer pays.
	let hold: sl.RawBookingResult;
	try {
		hold = await sl.createBookingWithId(
			{
				...bookingFields(user, booking, `Awaiting online payment, order ${id}; cancelled if unpaid.`),
				// Shown as Paid NO in the admin program until the payment comes in.
				Paid: sl.BOOKING_UNPAID
			},
			id
		);
	} catch (err) {
		await markFailed(id, err);
		throw err;
	}
	if (!hold.Success || !hold.BookingId) {
		const taken = (hold.ConflictingComputers ?? '').split(';').filter(Boolean);
		await markFailed(id, taken.length ? `Taken: ${taken.join(', ')}` : 'Smartlaunch refused the booking');
		throw taken.length
			? new BookingError('error.taken', 409, { ids: taken.join(', ') })
			: new BookingError('error.justBooked', 409);
	}
	await db().prepare('UPDATE orders SET booking_id = ?, updated_at = ? WHERE id = ?').bind(hold.BookingId, nowSeconds(), id).run();

	try {
		const checkout = await provider.createCheckout({
			reference: id,
			amountCents: quote.total,
			currency: quote.currency,
			// Shown on SumUp's payment page and in its dashboard: the Smartlaunch booking number
			// and our order number let staff find the booking from the payment.
			description: checkoutDescription(hold.BookingId, id, details.start, booking.computerIds.length, quote),
			redirectUrl: `${origin}/book/return?order=${id}`,
			webhookUrl: origin.startsWith('https://') ? `${origin}/api/payments/webhook/${provider.id}` : undefined,
			expiresAt: holdUntil
		});
		await db()
			.prepare('UPDATE orders SET provider_ref = ?, updated_at = ? WHERE id = ?')
			.bind(checkout.providerRef, nowSeconds(), id)
			.run();
		return { orderId: id, paymentUrl: checkout.paymentUrl };
	} catch (err) {
		console.error(`Booking order ${id}: creating the checkout failed`, err);
		await sl.deleteBooking(hold.BookingId).catch((e) => console.error(`Booking order ${id}: releasing the hold failed`, e));
		await markFailed(id, err);
		throw new BookingError('topup.error.start', 502);
	}
}

/** Cancel the unpaid hold of a booking order. Throws if the center can't be reached, so it is retried. */
async function releaseHold(row: OrderRow): Promise<void> {
	if (row.kind === 'booking' && row.booking_id) await sl.deleteBooking(row.booking_id);
}

/** last_error of a booking order the customer cancelled before paying. */
const CANCELLED_BY_CUSTOMER = 'Cancelled by the customer';

/**
 * The customer gave up on paying: close the checkout so it can't be paid any more and
 * release the stations right away instead of when the hold runs out. Does nothing if
 * the order is no longer waiting for payment. A payment that went through anyway is kept.
 */
export async function cancelBookingOrder(id: string): Promise<void> {
	const row = await getOrder(id);
	// Without a checkout yet, it is still being started; the hold then simply runs out.
	if (!row || row.kind !== 'booking' || row.status !== 'pending' || !row.provider_ref) return;
	const provider = providerById(row.provider);
	if (!provider) throw new PaymentProviderError(`Order ${id} was paid through "${row.provider}", which is not configured`);

	try {
		await provider.cancelCheckout(row.provider_ref);
	} catch (err) {
		// Usually it was paid or closed meanwhile; what the provider reports now decides.
		console.error(`Booking order ${id}: closing the checkout failed`, err);
	}
	const state = await provider.getCheckout(row.provider_ref);
	if (state.status === 'paid') {
		await syncOrder(id);
		return;
	}
	if (state.status === 'pending') throw new BookingError('book.cancel.busy', 409);

	await releaseHold(row);
	await db()
		.prepare(`UPDATE orders SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
		.bind(CANCELLED_BY_CUSTOMER, nowSeconds(), id)
		.run();
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

	if (
		row.status === 'pending' &&
		!row.provider_ref &&
		row.kind === 'booking' &&
		nowSeconds() > (row.hold_until ?? 0) + HOLD_GRACE_SECONDS
	) {
		// The checkout was never created (the request died half-way); let the stations go.
		await releaseHold(row);
		await db()
			.prepare(`UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`)
			.bind(nowSeconds(), id)
			.run();
		row = (await getOrder(id))!;
	}

	// A booking whose hold was released is still checked for a while, in case its payment completed at the last moment.
	const lateWindow =
		row.kind === 'booking' && row.status === 'expired' && nowSeconds() < (row.hold_until ?? 0) + LATE_PAYMENT_SECONDS;

	if ((row.status === 'pending' || lateWindow) && row.provider_ref) {
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
					.prepare(
						`UPDATE orders SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'expired')`
					)
					.bind(detail, now, id)
					.run();
			} else {
				// From expired: paid after the hold was released; delivery books the stations again if it can.
				await db()
					.prepare(
						`UPDATE orders SET status = 'paid', paid_at = ?, provider_txn = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'expired')`
					)
					.bind(now, state.transactionCode ?? null, now, id)
					.run();
			}
		} else if (
			row.status === 'pending' &&
			(row.kind === 'booking'
				? // Stations are only held for a while, so a booking isn't kept open for a retry.
					state.status === 'expired' ||
					state.status === 'failed' ||
					now > (row.hold_until ?? 0) + HOLD_GRACE_SECONDS
				: state.status === 'expired' ||
					(state.status === 'failed' && age > FAILED_FINAL_AFTER) ||
					age > PENDING_EXPIRES_AFTER)
		) {
			const final = state.status === 'failed' ? 'failed' : 'expired';
			await releaseHold(row);
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

/**
 * e.g. "Booking #1234, 2026-11-05 17:00, 2 stations, Pro, order BKX7K2M9QP4RT8WZ3N":
 * what the payment is for, as SumUp shows it to the customer and to staff.
 */
function checkoutDescription(bookingId: string, orderId: string, start: string, stations: number, quote: StationQuote): string {
	const plan = quote.lines[0] ? `, ${PLAN_NAMES[quote.lines[0].plan]}` : '';
	const count = stations === 1 ? '1 station' : `${stations} stations`;
	return `Booking #${bookingId}, ${start.replace('T', ' ')}, ${count}${plan}, order ${orderId}`;
}

/**
 * The paid booking's fields with the provider's transaction code after the order
 * number ("order BK…, SumUp TEENSK4W2K."), so staff can find the payment from the
 * booking. Left as they are if the code is unknown or the text would get too long.
 */
function withTransactionCode(fields: sl.BookingFields, row: OrderRow): sl.BookingFields {
	if (!row.provider_txn) return fields;
	const provider = providerById(row.provider)?.name ?? row.provider;
	const marker = `order ${row.id}.`;
	// The code is letters and digits only (checked when it was read), so it needs no SQL escaping.
	const description = fields.Description.replace(marker, `order ${row.id}, ${provider} ${row.provider_txn}.`);
	return description.length <= 250 ? { ...fields, Description: description } : fields;
}

/** Make a paid booking order's booking final: the hold becomes the paid booking, or it is booked again. */
async function confirmBooking(row: OrderRow): Promise<{ bookingId: string } | 'needs_refund'> {
	const stored = JSON.parse(row.details ?? 'null') as BookingDetails | null;
	if (!stored) throw new Error('Booking order has no details');
	// Marked paid, so the admin program shows Paid YES; this also covers booking it again.
	const details = { ...stored, fields: { ...withTransactionCode(stored.fields, row), Paid: sl.BOOKING_PAID_ONLINE } };

	if (row.booking_id) {
		const updated = await sl.updateBooking(row.booking_id, details.fields);
		if (updated.Success) return { bookingId: row.booking_id };
		if (!updated.NotFound) {
			if (updated.ConflictingComputers) {
				// The hold still stands; only its description could not be changed.
				console.error(
					`Booking order ${row.id}: paid, but booking ${row.booking_id} could not be marked paid (conflicts ${updated.ConflictingComputers})`
				);
				return { bookingId: row.booking_id };
			}
			throw new Error(`Marking booking ${row.booking_id} paid was refused`);
		}
	}

	// The hold was released before the payment came in: book the same stations again if they are still free.
	const again = await sl.createBookingWithId(details.fields, row.id + 'R');
	if (again.Success && again.BookingId) return { bookingId: again.BookingId };
	if (again.ConflictingComputers) return 'needs_refund';
	throw new Error('Booking the paid stations again was refused');
}

/** Deliver a paid order to the Smartlaunch server, holding a lease so only one worker does it. */
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
		let bookingId = row.booking_id;
		if (row.kind === 'booking') {
			const outcome = await confirmBooking(row);
			if (outcome === 'needs_refund') {
				console.error(
					`Booking order ${row.id}: PAID AFTER ITS HOLD ENDED and the stations are taken. Refund ${row.amount_cents / 100} ${row.currency} to ${row.username}.`
				);
				await db()
					.prepare(
						`UPDATE orders SET status = 'needs_refund', lease_until = NULL, last_error = ?, updated_at = ?
						 WHERE id = ? AND status = 'delivering'`
					)
					.bind('Paid after the hold ended and the stations were taken. Refund the customer.', nowSeconds(), row.id)
					.run();
				return;
			}
			bookingId = outcome.bookingId;
		} else if (!(await sl.addMoney(row.username, row.amount_cents / 100, row.id))) {
			throw new Error(`addmoney returned false (does user "${row.username}" exist?)`);
		}
		await db()
			.prepare(
				`UPDATE orders SET status = 'delivered', booking_id = ?, delivered_at = ?, lease_until = NULL, last_error = NULL, updated_at = ?
				 WHERE id = ? AND status = 'delivering'`
			)
			.bind(bookingId, nowSeconds(), nowSeconds(), row.id)
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

/** A booking order as stored, without asking the provider; null if unknown or not a booking. */
export async function getBookingOrder(id: string): Promise<BookingOrder | null> {
	const row = await getOrder(id);
	return row && row.kind === 'booking' ? toBookingOrder(row) : null;
}

/** One order as stored, without asking the provider; null if unknown. */
export async function getTopup(id: string): Promise<TopupOrder | null> {
	const row = await getOrder(id);
	return row ? toTopupOrder(row) : null;
}

/** The customer's recent top-ups, newest first. */
export async function listTopups(username: string, limit = 10): Promise<TopupOrder[]> {
	const { results } = await db()
		.prepare(`SELECT * FROM orders WHERE username = ? AND kind = 'topup' AND provider_ref IS NOT NULL ORDER BY created_at DESC LIMIT ?`)
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
			    OR (status = 'pending' AND kind = 'booking' AND hold_until < ?)
			    OR (status = 'expired' AND kind = 'booking' AND provider_ref IS NOT NULL AND hold_until > ?)
			 ORDER BY status = 'expired', updated_at
			 LIMIT ?`
		)
		// Leave fresh checkouts alone; the customer is probably still on the payment page.
		// Booking holds are checked once they have run out, to release the stations, and
		// released ones for a while longer, in case a payment slipped through.
		.bind(now, now, now - 5 * 60, now - HOLD_GRACE_SECONDS, now - LATE_PAYMENT_SECONDS, limit)
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
