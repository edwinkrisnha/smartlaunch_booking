import { endpoint } from '#lib/server/api.js';
import { getQuote } from '#lib/server/booking.js';
import type { RequestHandler } from './$types';

/**
 * GET ?start=YYYY-MM-DDTHH:mm&minutes=N&stations=N — the price of booking that
 * many stations for the logged-in customer: `{ quote }`, or `{ quote: null }`
 * when the center shows no prices. PCs and consoles cost the same.
 */
export const GET: RequestHandler = endpoint(async ({ url, locals }) => {
	const q = url.searchParams;
	const quote = await getQuote(locals.user!, q.get('start') ?? '', Number(q.get('minutes')), Number(q.get('stations')));
	return { quote };
});
