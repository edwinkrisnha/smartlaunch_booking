import { orderIdForCheckout, recordPaymentEvent, syncOrder } from '#lib/server/orders.js';
import { providerById } from '#lib/server/payments/index.js';
import type { RequestHandler } from './$types';

/**
 * POST — status notifications from the payment provider (public, no session).
 * The body is only a hint: syncOrder re-reads the checkout from the provider's API,
 * so a forged notification can at most make us check an order early.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const provider = providerById(params.provider);
	if (!provider) return new Response(null, { status: 404 });

	const event = await provider.parseWebhook(request);
	if (!event) return new Response(null, { status: 204 });
	await recordPaymentEvent(provider.id, event.providerRef, event.eventType, event.payload);

	const orderId = await orderIdForCheckout(provider.id, event.providerRef);
	if (!orderId) return new Response(null, { status: 204 });

	try {
		await syncOrder(orderId);
	} catch (err) {
		// The provider retries on errors (SumUp: after 1 min, 5 min, 20 min and 2 h).
		console.error(`Webhook for order ${orderId} failed`, err);
		return new Response(null, { status: 500 });
	}
	return new Response(null, { status: 204 });
};
