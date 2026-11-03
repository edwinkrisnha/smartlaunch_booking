import { listLayouts, listPcs, listSeats, toHttpError } from '#lib/server/booking.js';
import { BOOKING_HOLD_MINUTES, paidBookingsEnabled } from '#lib/server/orders.js';
import { pricingEnabled } from '#lib/server/pricing.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const settings = { pricing: pricingEnabled, payOnline: paidBookingsEnabled(), holdMinutes: BOOKING_HOLD_MINUTES };
	try {
		const pcsRequest = listPcs();
		const [layouts, seats, pcs] = await Promise.all([listLayouts(), listSeats(pcsRequest), pcsRequest]);
		return { layouts, seats, pcs, ...settings, loadError: null };
	} catch (err) {
		return { layouts: [], seats: [], pcs: [], ...settings, loadError: toHttpError(err, locals.locale).message };
	}
};
