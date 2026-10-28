// Chooses the payment provider from PAYMENT_PROVIDER and its settings. To add a
// provider, implement PaymentProvider (see provider.ts and sumup.ts) and add a case below.

import {
	PAYMENT_CURRENCY,
	PAYMENT_PROVIDER,
	SUMUP_API_KEY,
	SUMUP_API_URL,
	SUMUP_MERCHANT_CODE,
	TOPUP_AMOUNTS,
	TOPUP_MAX,
	TOPUP_MIN
} from '$app/env/private';
import type { PaymentProvider } from './provider.js';
import { sumup } from './sumup.js';

export * from './provider.js';

function create(): PaymentProvider | null {
	switch (PAYMENT_PROVIDER) {
		case undefined:
			return null;
		case 'sumup':
			if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) {
				console.error('PAYMENT_PROVIDER is "sumup" but SUMUP_API_KEY or SUMUP_MERCHANT_CODE is missing; payments are off.');
				return null;
			}
			return sumup({ apiUrl: SUMUP_API_URL, apiKey: SUMUP_API_KEY, merchantCode: SUMUP_MERCHANT_CODE });
		default:
			console.error(`Unknown PAYMENT_PROVIDER "${PAYMENT_PROVIDER}"; payments are off.`);
			return null;
	}
}

const active = create();

/** The configured provider, or null when online payments are off. */
export function paymentProvider(): PaymentProvider | null {
	return active;
}

/** Looks up a provider by id, for webhooks and for orders paid through it. */
export function providerById(id: string): PaymentProvider | null {
	return active && active.id === id ? active : null;
}

export const paymentSettings = {
	currency: PAYMENT_CURRENCY,
	topupAmounts: TOPUP_AMOUNTS,
	topupMin: TOPUP_MIN,
	topupMax: TOPUP_MAX
};
