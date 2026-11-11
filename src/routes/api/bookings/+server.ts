import { endpoint, readJson } from '#lib/server/api.js';
import { createBooking, listBookings, parseBookingRequest, prepareBooking } from '#lib/server/booking.js';
import { throttle, withLock } from '#lib/server/limits.js';
import { paidBookingsEnabled, startBookingPayment } from '#lib/server/orders.js';
import type { RequestHandler } from './$types';

/** Booking attempts per customer per hour. */
const BOOKINGS_PER_HOUR = 20;

/**
 * GET — upcoming bookings (GET /bookings). Customers only see their own:
 * the raw list carries every customer's name and phone number.
 */
export const GET: RequestHandler = endpoint(async ({ locals }) => {
	await throttle(`read:${locals.user!.username.toLowerCase()}`, 120, 60);
	return listBookings(locals.user!);
});

/**
 * POST { start, minutes, computerIds, orderCode? }. When bookings are paid online,
 * holds the stations and answers `{ orderId, paymentUrl }` for the browser to go to;
 * otherwise books right away and answers `{ orderCode, quote }`.
 */
export const POST: RequestHandler = endpoint(async ({ request, locals, url }) => {
	const user = locals.user!;
	const req = parseBookingRequest(await readJson(request));
	const key = user.username.toLowerCase();
	await throttle(`book:${key}`, BOOKINGS_PER_HOUR, 60 * 60);

	// One booking at a time per customer: the member discount and the booking limits
	// look at the customer's existing bookings, so two requests at once must not both
	// see the same list.
	return withLock(`book:${key}`, 60, async () => {
		if (paidBookingsEnabled()) {
			const booking = await prepareBooking(user, req);
			return startBookingPayment(user, booking, url.origin);
		}
		return createBooking(user, req);
	});
});
