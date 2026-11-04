import { json } from '@sveltejs/kit';
import { SESSION_SECRET } from '$app/env/private';
import { pruneLimits } from '#lib/server/limits.js';
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
 * The sweep key: HMAC-SHA256 of "payment-sweep" with SESSION_SECRET, as hex. A key of
 * its own, so the secret that signs logins never travels in a request header.
 * worker/index.js computes the same value.
 */
async function sweepKey(): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('payment-sweep')));
	return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST — finishes stuck orders. Called every 10 minutes by the scheduled handler in worker/index.js. */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('x-sweep-key') ?? '';
	if (!SESSION_SECRET || SESSION_SECRET.length < 32 || !sameKey(key, await sweepKey())) {
		return new Response(null, { status: 404 });
	}
	await pruneLimits().catch((err) => console.error('Pruning rate limits failed', err));
	return json(await sweepOrders());
};
