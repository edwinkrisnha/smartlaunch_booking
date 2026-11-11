// What every payment provider (SumUp, and later Adyen, Stripe, ...) must offer.
// Orders (orders.ts) only talk to this interface, so adding a provider means
// writing one file like sumup.ts and registering it in index.ts.

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface CheckoutRequest {
	/** Our order id; providers store it as their own reference. Letters and digits only. */
	reference: string;
	amountCents: number;
	/** ISO 4217, e.g. EUR. */
	currency: string;
	description: string;
	/** Where the customer's browser comes back to after paying. */
	redirectUrl: string;
	/** Where the provider sends status notifications; absent when the site isn't reachable over https (local dev). */
	webhookUrl?: string;
	/** Unix seconds after which the checkout must no longer accept payment (a booking hold ending). */
	expiresAt?: number;
}

export interface Checkout {
	/** The provider's id for this checkout; used to look it up again. */
	providerRef: string;
	/** Hosted payment page to send the customer to. */
	paymentUrl: string;
}

/** A checkout as the provider reports it right now. */
export interface CheckoutState {
	status: PaymentStatus;
	amountCents: number;
	currency: string;
	reference: string;
	/**
	 * The provider's code for the successful payment, as on the customer's receipt
	 * and in the provider's dashboard (letters and digits). Only set once paid.
	 */
	transactionCode?: string;
}

export interface WebhookEvent {
	providerRef: string;
	eventType: string;
	/** Raw body, stored for auditing. */
	payload: string;
}

export interface PaymentProvider {
	/** Short lowercase name used in settings and webhook URLs, e.g. "sumup". */
	readonly id: string;
	/** Name shown to customers, e.g. "SumUp". */
	readonly name: string;
	createCheckout(request: CheckoutRequest): Promise<Checkout>;
	getCheckout(providerRef: string): Promise<CheckoutState>;
	/**
	 * Stop the checkout accepting payment (the customer cancelled). Throws if the provider
	 * refuses, e.g. because it was paid meanwhile; callers re-read it with getCheckout.
	 */
	cancelCheckout(providerRef: string): Promise<void>;
	/**
	 * Read a webhook request. Webhooks are never trusted as proof of payment: the
	 * caller always re-reads the checkout with getCheckout. Returns null to ignore it.
	 */
	parseWebhook(request: Request): Promise<WebhookEvent | null>;
}

/** A provider call failed; the message is for logs only. */
export class PaymentProviderError extends Error {}
