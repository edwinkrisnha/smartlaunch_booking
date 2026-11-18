import { error, fail, redirect } from '@sveltejs/kit';
import { translator } from '#lib/i18n/index.js';
import { guardSignup, signup, toHttpError, validateSignup, type SignupInput } from '#lib/server/booking.js';
import { center } from '#lib/server/center.js';
import { createSession } from '#lib/server/session.js';
import { turnstileSiteKey } from '#lib/server/turnstile.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!center.signup.enabled) error(404, 'Not found');
	if (locals.user) redirect(303, '/');
	return { turnstileSiteKey };
};

export const actions: Actions = {
	default: async ({ request, cookies, locals, getClientAddress }) => {
		if (!center.signup.enabled) error(404, 'Not found');

		const form = await request.formData();
		const field = (name: string) => String(form.get(name) ?? '').trim();
		const input: SignupInput = {
			username: field('username'),
			password: String(form.get('password') ?? ''),
			email: field('email'),
			mobilePhone: field('mobilePhone'),
			firstName: field('firstName'),
			lastName: field('lastName'),
			address: field('address'),
			zip: field('zip'),
			city: field('city'),
			gender: field('gender'),
			birthday: field('birthday')
		};
		// Echo everything back except the passwords.
		const values = { ...input, password: '' };

		const t = translator(locals.locale);
		const errors: Record<string, string> = Object.fromEntries(
			Object.entries(validateSignup(input)).map(([name, err]) => [name, t(err.key, err.params)])
		);
		if (input.password !== String(form.get('confirm') ?? '')) errors.confirm = t('signup.error.confirm');
		if (Object.keys(errors).length > 0) return fail(400, { values, errors });

		let user;
		try {
			await guardSignup(getClientAddress(), String(form.get('cf-turnstile-response') ?? ''));
			user = await signup(input);
		} catch (err) {
			const { status, message } = toHttpError(err, locals.locale);
			return fail(status, { values, errors: status === 409 ? { username: message } : { form: message } });
		}

		await createSession(cookies, user);
		redirect(303, '/');
	}
};
