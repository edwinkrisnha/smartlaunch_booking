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
	SESSION_SECRET: {
		description: 'Random string (32+ characters) used to sign the login cookie. Store it as a Cloudflare secret.',
		schema: optional
	},
	CENTER_TIMEZONE: {
		description:
			'Optional IANA time zone of the center, e.g. Asia/Jakarta. When set, bookings that start in the past are rejected server-side.',
		schema: optional
	},
	PUBLIC_CENTER_NAME: {
		public: true,
		description: 'Name shown in the page header.',
		schema: (value) => optional(value) ?? 'Smartlaunch'
	},
	PUBLIC_ALLOW_SIGNUP: {
		public: true,
		description: 'Whether visitors can create an account on the site. "false" turns sign-up off; on by default.',
		schema: (value) => optional(value)?.trim().toLowerCase() !== 'false'
	},
	DEFAULT_LANGUAGE: {
		description:
			'Language for visitors whose browser asks for none of the supported ones: en, de or da. Defaults to en.',
		schema: (value) => optional(value)?.trim().toLowerCase()
	},
	PAYMENT_PROVIDER: {
		description:
			'Payment provider for online top-ups: "sumup". Leave empty to turn online payments off.',
		schema: (value) => optional(value)?.trim().toLowerCase()
	},
	PAYMENT_CURRENCY: {
		description: 'ISO currency code for payments, e.g. EUR or DKK. Defaults to EUR.',
		schema: (value) => optional(value)?.trim().toUpperCase() ?? 'EUR'
	},
	TOPUP_AMOUNTS: {
		description: 'Comma-separated quick-pick top-up amounts, e.g. "10,20,50". Defaults to 10,20,50.',
		schema: (value) =>
			(optional(value) ?? '10,20,50')
				.split(',')
				.map((a) => Number(a.trim()))
				.filter((a) => Number.isFinite(a) && a > 0)
	},
	TOPUP_MIN: {
		description: 'Smallest top-up amount a customer can enter. Defaults to 5.',
		schema: (value) => Number(optional(value) ?? 5)
	},
	TOPUP_MAX: {
		description: 'Largest top-up amount a customer can enter. Defaults to 200.',
		schema: (value) => Number(optional(value) ?? 200)
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
	PRICE_RULES: {
		description:
			'Booking price rules to show and record with each booking: "r6" (eSports Nord HUB, revision R6). Leave empty to show no prices.',
		schema: (value) => optional(value)?.trim().toLowerCase()
	},
	PLAN_GROUPS: {
		description:
			'Optional. Which Smartlaunch user group gives which price plan, e.g. "campus=Campus Members,pro=Pro,alpha=Alpha,team=TEAM". By default a group named like the plan (campus, pro, alpha, team) gives that plan; anyone else pays Rookie rates.',
		schema: (value) => {
			const map = new Map<string, string>();
			for (const pair of (optional(value) ?? '').split(',')) {
				const [plan, group] = pair.split('=').map((s) => s?.trim() ?? '');
				if (plan && group) map.set(group.toLowerCase(), plan.toLowerCase());
			}
			return map;
		}
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
	THEME: {
		description:
			'Folder name under src/themes to style the site with, e.g. "esportsnord". Falls back to "default" if unset or missing.',
		schema: (value) => optional(value)?.trim()
	}
});
