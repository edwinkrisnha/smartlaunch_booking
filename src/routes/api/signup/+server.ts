import { PUBLIC_ALLOW_SIGNUP } from '$app/env/public';
import { endpoint, readJson } from '#lib/server/api.js';
import { BookingError, signup } from '#lib/server/booking.js';
import { createSession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/**
 * POST { username, password, email, mobilePhone, firstName, lastName, address?, birthday }
 * — creates the account (POST /users/create) and starts a session.
 */
export const POST: RequestHandler = endpoint(async ({ request, cookies }) => {
	if (!PUBLIC_ALLOW_SIGNUP) throw new BookingError('Sign-up is turned off.', 404);

	const body = (await readJson(request)) as Record<string, unknown>;
	const text = (key: string) => String(body[key] ?? '').trim();
	const user = await signup({
		username: text('username'),
		password: String(body.password ?? ''),
		email: text('email'),
		mobilePhone: text('mobilePhone'),
		firstName: text('firstName'),
		lastName: text('lastName'),
		address: text('address'),
		birthday: text('birthday')
	});

	await createSession(cookies, user);
	return { user };
});
