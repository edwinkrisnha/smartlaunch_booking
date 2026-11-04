// SumUp Hosted Checkout: https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
// We create a checkout, send the customer to SumUp's payment page, and read the
// checkout's status afterwards. SumUp's webhooks are unsigned and only say "checkout X
// changed", so the status always comes from GET /v0.1/checkouts/{id}.

import {
	PaymentProviderError,
	type Checkout,
	type CheckoutRequest,
	type CheckoutState,
	type PaymentProvider,
	type PaymentStatus,
	type WebhookEvent
} from './provider.js';

interface SumUpConfig {
	apiUrl: string;
	apiKey: string;
	merchantCode: string;
}

interface SumUpCheckout {
	id: string;
	checkout_reference: string;
	amount: number;
	currency: string;
	status: string;
	hosted_checkout_url?: string;
	/** Set once paid: the code shown on the receipt and in the SumUp dashboard. */
	transaction_code?: string;
	transactions?: { transaction_code?: string; status?: string }[];
}

const TIMEOUT_MS = 15_000;

const STATUSES: Record<string, PaymentStatus> = {
	PENDING: 'pending',
	PAID: 'paid',
	FAILED: 'failed',
	EXPIRED: 'expired'
};

export function sumup(config: SumUpConfig): PaymentProvider {
	async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		let res: Response;
		try {
			res = await fetch(config.apiUrl + path, {
				method,
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					Accept: 'application/json',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (err) {
			throw new PaymentProviderError(`SumUp ${method} ${path} failed: ${(err as Error).message}`);
		}
		const text = await res.text();
		if (!res.ok) throw new PaymentProviderError(`SumUp ${method} ${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
		return JSON.parse(text) as T;
	}

	return {
		id: 'sumup',
		name: 'SumUp',

		async createCheckout(req: CheckoutRequest): Promise<Checkout> {
			const checkout = await call<SumUpCheckout>('POST', '/v0.1/checkouts', {
				checkout_reference: req.reference,
				amount: req.amountCents / 100,
				currency: req.currency,
				merchant_code: config.merchantCode,
				description: req.description,
				redirect_url: req.redirectUrl,
				...(req.webhookUrl ? { return_url: req.webhookUrl } : {}),
				...(req.expiresAt ? { valid_until: new Date(req.expiresAt * 1000).toISOString() } : {}),
				hosted_checkout: { enabled: true }
			});
			if (!checkout.id || !checkout.hosted_checkout_url) {
				throw new PaymentProviderError('SumUp checkout response has no id or hosted_checkout_url');
			}
			return { providerRef: checkout.id, paymentUrl: checkout.hosted_checkout_url };
		},

		async getCheckout(providerRef: string): Promise<CheckoutState> {
			const checkout = await call<SumUpCheckout>('GET', `/v0.1/checkouts/${encodeURIComponent(providerRef)}`);
			const status = STATUSES[checkout.status];
			if (!status) throw new PaymentProviderError(`SumUp checkout ${providerRef} has unknown status ${checkout.status}`);
			const code =
				checkout.transaction_code ?? checkout.transactions?.find((t) => t.status === 'SUCCESSFUL')?.transaction_code;
			return {
				status,
				amountCents: Math.round(checkout.amount * 100),
				currency: checkout.currency,
				reference: checkout.checkout_reference,
				// It ends up in Smartlaunch's booking text, so only plain codes are taken.
				transactionCode: status === 'paid' && code && /^[A-Za-z0-9-]{1,40}$/.test(code) ? code : undefined
			};
		},

		async parseWebhook(request: Request): Promise<WebhookEvent | null> {
			const payload = await request.text();
			let body: { event_type?: unknown; id?: unknown };
			try {
				body = JSON.parse(payload);
			} catch {
				return null;
			}
			// SumUp may add event types without notice; only status changes matter here.
			if (body.event_type !== 'CHECKOUT_STATUS_CHANGED' || typeof body.id !== 'string') return null;
			return { providerRef: body.id, eventType: body.event_type, payload };
		}
	};
}
