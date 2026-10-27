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
	THEME: {
		description:
			'Folder name under src/themes to style the site with, e.g. "esportsnord". Falls back to "default" if unset or missing.',
		schema: (value) => optional(value)?.trim()
	}
});
