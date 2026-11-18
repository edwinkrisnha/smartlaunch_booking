import { defineEnvVars } from '@sveltejs/kit/env';

/** Treat unset and empty values the same, so a missing variable is reported where it is used instead of failing the build. */
const optional = (value: string | undefined) => (value ? value : undefined);

export const variables = defineEnvVars({
	SL_API_URL: {
		description:
			'Base URL of the Smartlaunch server REST API, e.g. https://booking-api.example.com (no trailing slash).',
		schema: (value) => optional(value)?.replace(/\/+$/, '')
	},
	SL_API_USERNAME: {
		description:
			'REST API Basic-auth username (Server Settings: RESTBasicUsername, or an employee login when RESTUseEmployeeLoginAsSecurity is on).',
		schema: optional
	},
	SL_API_PASSWORD: {
		description: 'REST API Basic-auth password. Store it as a Cloudflare secret.',
		schema: optional
	},
	SL_LICENSE_EMAIL: {
		description:
			'Optional. Appended as ?licenseemail= on every request, for servers reached through a relay that routes by license.',
		schema: optional
	},
	CENTER: {
		description:
			'Which center this deployment serves: the folder under centers/ whose config.jsonc holds its prices, booking rules and look. Defaults to "default".',
		schema: (value) => optional(value)?.trim()
	},
	SESSION_SECRET: {
		description: 'Random string (32+ characters) used to sign the login cookie. Store it as a Cloudflare secret.',
		schema: optional
	},
	PAYMENT_PROVIDER: {
		description:
			'Payment provider for online top-ups and paid bookings: "sumup". Leave empty to turn online payments off.',
		schema: (value) => optional(value)?.trim().toLowerCase()
	},
	SUMUP_API_KEY: {
		description: 'SumUp secret API key (SumUp Dashboard > Developers). Store it as a Cloudflare secret.',
		schema: optional
	},
	SUMUP_MERCHANT_CODE: {
		description: 'SumUp merchant code that receives the payments, e.g. MH4H92C7.',
		schema: (value) => optional(value)?.trim()
	},
	SUMUP_API_URL: {
		description: 'Optional. SumUp API base URL; only change it for testing against a mock. Defaults to https://api.sumup.com.',
		schema: (value) => (optional(value) ?? 'https://api.sumup.com').replace(/\/+$/, '')
	},
	TURNSTILE_SITE_KEY: {
		description:
			'Optional. Cloudflare Turnstile site key; with TURNSTILE_SECRET_KEY it adds a "not a robot" check to sign-up.',
		schema: (value) => optional(value)?.trim()
	},
	TURNSTILE_SECRET_KEY: {
		description: 'Optional. Cloudflare Turnstile secret key. Store it as a Cloudflare secret.',
		schema: (value) => optional(value)?.trim()
	},

	// Moved into centers/<CENTER>/config.jsonc. Declared only so a leftover value can be reported.
	CENTER_TIMEZONE: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	PUBLIC_CENTER_NAME: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	PUBLIC_ALLOW_SIGNUP: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	DEFAULT_LANGUAGE: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	EXCLUDED_PCS: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	PAYMENT_CURRENCY: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	TOPUP_AMOUNTS: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	TOPUP_MIN: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	TOPUP_MAX: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	PRICE_RULES: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	PLAN_GROUPS: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional },
	THEME: { description: 'No longer read: set it in centers/<CENTER>/config.jsonc instead.', schema: optional }
});
