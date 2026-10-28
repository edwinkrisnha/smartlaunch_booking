import { THEME } from '$app/env/private';
import { paymentProvider } from '#lib/server/payments/index.js';
import { availableThemes, resolveTheme } from '#lib/theme.js';
import type { LayoutServerLoad } from './$types';

let warned = false;

export const load: LayoutServerLoad = ({ locals }) => {
	const theme = resolveTheme(THEME);
	if (THEME && theme.name !== THEME && !warned) {
		warned = true;
		console.warn(
			`THEME "${THEME}" not found in src/themes (available: ${availableThemes.join(', ')}); using "${theme.name}".`
		);
	}
	return { user: locals.user, theme, locale: locals.locale, payments: paymentProvider() !== null };
};
