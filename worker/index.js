// Deployed entry point: SvelteKit's Worker (written by the adapter during `npm run build`)
// plus a scheduled handler. The adapter's Worker only handles requests, and the payment
// code lives inside the SvelteKit app, so the schedule calls the app's sweep endpoint.
import app from '../.svelte-kit/cloudflare/_worker.js';

/** @type {ExportedHandler<Env>} */
export default {
	fetch: app.fetch,

	async scheduled(_controller, env, ctx) {
		// JSON, because SvelteKit rejects body-less or form POSTs without a matching Origin as CSRF.
		const request = new Request('https://worker.internal/api/payments/sweep', {
			method: 'POST',
			headers: { 'x-sweep-key': env.SESSION_SECRET, 'content-type': 'application/json' },
			body: '{}'
		});
		const response = await app.fetch(request, env, ctx);
		if (!response.ok) console.error(`Payment sweep failed: HTTP ${response.status}`, await response.text());
	}
};
