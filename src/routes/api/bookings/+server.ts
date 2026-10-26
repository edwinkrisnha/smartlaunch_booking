import { endpoint, readJson } from '#lib/server/api.js';
import { createBooking, listBookings, parseBookingRequest } from '#lib/server/booking.js';
import type { RequestHandler } from './$types';

/**
 * GET — upcoming bookings (GET /bookings). Customers only see their own:
 * the raw list carries every customer's name and phone number.
 */
export const GET: RequestHandler = endpoint(({ locals }) => listBookings(locals.user!.username));

/** POST { start, minutes, computerIds, orderCode? } — finalizes a booking (POST /bookings). */
export const POST: RequestHandler = endpoint(async ({ request, locals }) => {
	const req = parseBookingRequest(await readJson(request));
	return createBooking(locals.user!, req);
});
