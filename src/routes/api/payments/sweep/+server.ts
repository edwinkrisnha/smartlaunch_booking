import { json } from '@sveltejs/kit';
import { SESSION_SECRET } from '$app/env/private';
import { sweepOrders } from '#lib/server/orders.js';
import type { RequestHandler } from './$types';

/** Compare without stopping at the first difference, so the key can't be guessed by timing. */
function sameKey(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * POST — finishes stuck orders. Called every 10 minutes by the scheduled handler in
 * worker/index.js, which proves itself with SESSION_SECRET in x-sweep-key.
 */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('x-sweep-key') ?? '';
	if (!SESSION_SECRET || !sameKey(key, SESSION_SECRET)) return new Response(null, { status: 404 });
	return json(await sweepOrders());
};
