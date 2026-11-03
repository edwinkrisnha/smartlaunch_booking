import { error } from '@sveltejs/kit';
import { getBookingOrder, orderBelongsTo, syncOrder, BOOKING_HOLD_MINUTES } from '#lib/server/orders.js';
import type { PageServerLoad } from './$types';

/** Where the payment provider sends the customer back after paying for a booking: `?order=<id>`. */
export const load: PageServerLoad = async ({ url, locals }) => {
	const id = url.searchParams.get('order') ?? '';
	if (!/^BK[A-Z0-9]{14}$/.test(id) || !(await orderBelongsTo(id, locals.user!.username))) {
		error(404, 'Not found');
	}

	let providerStatus: string | null = null;
	try {
		providerStatus = (await syncOrder(id))?.providerStatus ?? null;
	} catch (err) {
		// The provider or the center server is unreachable; show what we know and keep polling.
		console.error(`Booking return page: order ${id} could not be synced`, err);
	}
	const order = await getBookingOrder(id);
	if (!order) error(404, 'Not found');
	return { order, providerStatus, holdMinutes: BOOKING_HOLD_MINUTES };
};
