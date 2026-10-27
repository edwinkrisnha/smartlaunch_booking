import { fail, redirect } from '@sveltejs/kit';
import { translate } from '#lib/i18n/index.js';
import { safeNext } from '#lib/server/api.js';
import { login, toHttpError } from '#lib/server/booking.js';
import { createSession } from '#lib/server/session.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url, locals }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!username || !password) {
			return fail(400, { username, error: translate(locals.locale, 'login.missing') });
		}

		let user;
		try {
			user = await login(username, password);
		} catch (err) {
			return fail(502, { username, error: toHttpError(err, locals.locale).message });
		}
		if (!user) return fail(401, { username, error: translate(locals.locale, 'login.incorrect') });

		await createSession(cookies, user);
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
