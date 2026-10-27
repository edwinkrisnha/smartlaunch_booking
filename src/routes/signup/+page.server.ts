import { error, fail, redirect } from '@sveltejs/kit';
import { PUBLIC_ALLOW_SIGNUP } from '$app/env/public';
import { signup, toHttpError, validateSignup, type SignupInput } from '#lib/server/booking.js';
import { createSession } from '#lib/server/session.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!PUBLIC_ALLOW_SIGNUP) error(404, 'Not found');
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (!PUBLIC_ALLOW_SIGNUP) error(404, 'Not found');

		const form = await request.formData();
		const field = (name: string) => String(form.get(name) ?? '').trim();
		const input: SignupInput = {
			username: field('username'),
			password: String(form.get('password') ?? ''),
			email: field('email'),
			mobilePhone: field('mobilePhone'),
			firstName: field('firstName'),
			lastName: field('lastName'),
			birthday: field('birthday')
		};
		// Echo everything back except the passwords.
		const values = { ...input, password: '' };

		const errors: Record<string, string> = { ...validateSignup(input) };
		if (input.password !== String(form.get('confirm') ?? '')) errors.confirm = 'The passwords don’t match.';
		if (Object.keys(errors).length > 0) return fail(400, { values, errors });

		let user;
		try {
			user = await signup(input);
		} catch (err) {
			const { status, message } = toHttpError(err);
			return fail(status, { values, errors: status === 409 ? { username: message } : { form: message } });
		}

		await createSession(cookies, user);
		redirect(303, '/');
	}
};
