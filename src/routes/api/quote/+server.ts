import { endpoint } from '#lib/server/api.js';
import { getQuote } from '#lib/server/booking.js';
import { throttle } from '#lib/server/limits.js';
import type { RequestHandler } from './$types';

/**
 * GET ?start=YYYY-MM-DDTHH:mm&minutes=N&stations=N — the price of booking that
 * many stations for the logged-in customer: `{ quote }`, or `{ quote: null }`
 * when the center shows no prices. PCs and consoles cost the same.
 */
export const GET: RequestHandler = endpoint(async ({ url, locals }) => {
	// Each quote reads the center's bookings, so keep one customer from flooding it.
	await throttle(`read:${locals.user!.username.toLowerCase()}`, 120, 60);
	const q = url.searchParams;
	const quote = await getQuote(locals.user!, q.get('start') ?? '', Number(q.get('minutes')), Number(q.get('stations')));
	return { quote };
});
