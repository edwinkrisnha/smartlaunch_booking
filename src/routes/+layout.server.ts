import { paymentProvider } from '#lib/server/payments/index.js';
import { center, centerName } from '#lib/server/center.js';
import { resolveTheme } from '#lib/theme.js';
import type { LayoutServerLoad } from './$types';

const theme = resolveTheme(centerName);

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
