import { error } from '@sveltejs/kit';
import { endpoint } from '#lib/server/api.js';
import { throttle } from '#lib/server/limits.js';
import { cancelBookingOrder, getBookingOrder, orderBelongsTo } from '#lib/server/orders.js';
import type { RequestHandler } from './$types';

/**
 * POST — the customer gave up on paying for a booking order: release its stations now
 * instead of when the hold runs out. Answers the order as it is afterwards.
 */
export const POST: RequestHandler = endpoint(async ({ params, locals }) => {
	const username = locals.user!.username;
	await throttle(`cancel:${username.toLowerCase()}`, 30, 60 * 60);
	const id = params.order;
	if (!/^BK[A-Z0-9]{14}$/.test(id) || !(await orderBelongsTo(id, username))) error(404, 'Not found');
	await cancelBookingOrder(id);
	return getBookingOrder(id);
});
