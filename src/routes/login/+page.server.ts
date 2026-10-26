import { fail, redirect } from '@sveltejs/kit';
import { login, toHttpError } from '#lib/server/booking.js';
import { createSession } from '#lib/server/session.js';
import type { Actions, PageServerLoad } from './$types';

/** Only follow same-site relative paths after login. */
function safeNext(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!username || !password) {
			return fail(400, { username, error: 'Enter your username and password.' });
		}

		let user;
		try {
			user = await login(username, password);
		} catch (err) {
			return fail(502, { username, error: toHttpError(err).message });
		}
		if (!user) return fail(401, { username, error: 'Incorrect username or password.' });

		await createSession(cookies, user);
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
