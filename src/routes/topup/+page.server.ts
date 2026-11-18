import { error, fail, redirect } from '@sveltejs/kit';
import { translate } from '#lib/i18n/index.js';
import { parseAmount } from '#lib/money.js';
import { toHttpError } from '#lib/server/booking.js';
import { center } from '#lib/server/center.js';
import { createTopup, listTopups, syncOrder } from '#lib/server/orders.js';
import { paymentProvider, paymentSettings } from '#lib/server/payments/index.js';
import * as sl from '#lib/server/smartlaunch.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const provider = paymentProvider();
	if (!provider) error(404, 'Not found');
	const username = locals.user!.username;

	let orders = await listTopups(username).catch((err) => {
		console.error('Listing top-ups failed', err);
		return [];
	});
	// Finish anything still open (e.g. paid while the center was offline) now that the customer is looking.
	const open = orders.filter((o) => o.status === 'pending' || o.status === 'paid').slice(0, 3);
	if (open.length > 0) {
		await Promise.allSettled(open.map((o) => syncOrder(o.id)));
		orders = await listTopups(username).catch(() => orders);
	}

	// Read after syncing, so a just-delivered top-up shows in the balance.
	const user = await sl.getUser(username).catch(() => null);

	return {
		balance: user ? Math.round(user.Balance * 100) : null,
		orders,
		providerName: provider.name,
		currency: paymentSettings.currency,
		amounts: paymentSettings.topupAmounts,
		min: paymentSettings.topupMin,
		max: paymentSettings.topupMax,
		// Server and browser must format dates alike; the center's zone is what customers expect.
		timeZone: center.center.timezone ?? 'UTC'
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const choice = String(form.get('amount') ?? '');
		const raw = choice === 'other' ? String(form.get('other') ?? '') : choice;
		const { topupMin: min, topupMax: max } = paymentSettings;

		const cents = parseAmount(raw);
		if (cents === null) {
			return fail(400, { choice, other: String(form.get('other') ?? ''), error: translate(locals.locale, 'topup.error.amount', { min, max }) });
		}

		let paymentUrl: string;
		try {
			paymentUrl = await createTopup(locals.user!.username, cents, url.origin);
		} catch (err) {
			const { status, message } = toHttpError(err, locals.locale);
			return fail(status, { choice, other: String(form.get('other') ?? ''), error: message });
		}
		// The payment page is on the provider's site; its URL comes from the provider's API.
		redirect(303, paymentUrl, { external: true });
	}
};
