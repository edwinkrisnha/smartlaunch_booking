// Deployed entry point: SvelteKit's Worker (written by the adapter during `npm run build`)
// plus a scheduled handler. The adapter's Worker only handles requests, and the payment
// code lives inside the SvelteKit app, so the schedule calls the app's sweep endpoint.
import app from '../.svelte-kit/cloudflare/_worker.js';

/**
 * HMAC-SHA256 of "payment-sweep" with SESSION_SECRET, as hex; the sweep endpoint
 * checks the same value, so the login-signing secret itself is never sent.
 * @param {string} secret
 */
async function sweepKey(secret) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('payment-sweep')));
	return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @type {ExportedHandler<Env>} */
export default {
	fetch: app.fetch,

	async scheduled(_controller, env, ctx) {
		if (!env.SESSION_SECRET) {
			console.error('Payment sweep skipped: SESSION_SECRET is not set');
			return;
		}
		// JSON, because SvelteKit rejects body-less or form POSTs without a matching Origin as CSRF.
		const request = new Request('https://worker.internal/api/payments/sweep', {
			method: 'POST',
			headers: { 'x-sweep-key': await sweepKey(env.SESSION_SECRET), 'content-type': 'application/json' },
			body: '{}'
		});
		const response = await app.fetch(request, env, ctx);
		if (!response.ok) console.error(`Payment sweep failed: HTTP ${response.status}`, await response.text());
	}
};
