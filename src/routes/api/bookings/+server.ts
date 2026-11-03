import { endpoint, readJson } from '#lib/server/api.js';
import { createBooking, listBookings, parseBookingRequest, prepareBooking } from '#lib/server/booking.js';
import { paidBookingsEnabled, startBookingPayment } from '#lib/server/orders.js';
import type { RequestHandler } from './$types';

/**
 * GET — upcoming bookings (GET /bookings). Customers only see their own:
 * the raw list carries every customer's name and phone number.
 */
export const GET: RequestHandler = endpoint(({ locals }) => listBookings(locals.user!.username));

/**
 * POST { start, minutes, computerIds, orderCode? }. When bookings are paid online,
 * holds the stations and answers `{ paymentUrl }` for the browser to go to;
 * otherwise books right away and answers `{ orderCode, quote }`.
 */
export const POST: RequestHandler = endpoint(async ({ request, locals, url }) => {
	const req = parseBookingRequest(await readJson(request));
	if (paidBookingsEnabled()) {
		const booking = await prepareBooking(locals.user!, req);
		return { paymentUrl: await startBookingPayment(locals.user!, booking, url.origin) };
	}
	return createBooking(locals.user!, req);
});
