import { paymentProvider } from '#lib/server/payments/index.js';
import { center } from '#lib/server/center.js';
import { resolveTheme } from '#lib/theme.js';
import type { LayoutServerLoad } from './$types';

// center.ts already warned at startup if the configured theme doesn't exist.
const theme = resolveTheme(center.center.theme);

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user,
		theme,
		locale: locals.locale,
		payments: paymentProvider() !== null,
		centerName: center.center.name,
		signupEnabled: center.signup.enabled
	};
};
