import { endpoint } from '#lib/server/api.js';
import { getUnavailable, getUnavailableRaw } from '#lib/server/booking.js';
import { throttle } from '#lib/server/limits.js';
import type { RequestHandler } from './$types';

/**
 * GET ?startdate=yyyyMMddHHmm&enddate=yyyyMMddHHmm (same as the server), or
 * GET ?start=YYYY-MM-DDTHH:mm&minutes=N. Returns the IDs of PCs that cannot be
 * booked in that window (at most 24 hours).
 */
export const GET: RequestHandler = endpoint(async ({ url, locals }) => {
	await throttle(`read:${locals.user!.username.toLowerCase()}`, 120, 60);
	const q = url.searchParams;
	const computerIds = q.has('startdate')
		? await getUnavailableRaw(q.get('startdate') ?? '', q.get('enddate') ?? '')
		: await getUnavailable(q.get('start') ?? '', Number(q.get('minutes')));
	return { computerIds };
});
