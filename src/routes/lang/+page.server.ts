import { redirect } from '@sveltejs/kit';
import { isLocale, LOCALE_COOKIE } from '#lib/i18n/index.js';
import { safeNext } from '#lib/server/api.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	/** The language switcher posts { lang, next }; remember the choice for a year and go back. */
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const lang = form.get('lang');
		if (isLocale(lang)) {
			cookies.set(LOCALE_COOKIE, lang, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
		}
		redirect(303, safeNext(String(form.get('next') ?? '')));
	}
};
