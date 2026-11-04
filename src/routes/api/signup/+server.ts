import { PUBLIC_ALLOW_SIGNUP } from '$app/env/public';
import { endpoint, readJson } from '#lib/server/api.js';
import { BookingError, guardSignup, signup } from '#lib/server/booking.js';
import { createSession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/**
 * POST { username, password, email, mobilePhone?, firstName, lastName, address, zip, city, gender, birthday, turnstileToken? }
 * (gender: "male", "female" or "nonbinary"; turnstileToken is required when Turnstile is set up)
 * — creates the account (POST /users/create) and starts a session.
 */
export const POST: RequestHandler = endpoint(async ({ request, cookies, getClientAddress }) => {
	if (!PUBLIC_ALLOW_SIGNUP) throw new BookingError('signup.error.disabled', 404);

	const body = (await readJson(request)) as Record<string, unknown>;
	const text = (key: string) => String(body[key] ?? '').trim();
	await guardSignup(getClientAddress(), text('turnstileToken'));
	const user = await signup({
		username: text('username'),
		password: String(body.password ?? ''),
		email: text('email'),
		mobilePhone: text('mobilePhone'),
		firstName: text('firstName'),
		lastName: text('lastName'),
		address: text('address'),
		zip: text('zip'),
		city: text('city'),
		gender: text('gender'),
		birthday: text('birthday')
	});

	await createSession(cookies, user);
	return { user };
});
