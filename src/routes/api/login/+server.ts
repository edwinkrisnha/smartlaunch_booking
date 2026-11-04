import { attemptLogin, BookingError } from '#lib/server/booking.js';
import { endpoint, readJson } from '#lib/server/api.js';
import { createSession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/** POST { username, password } — checks the password via GET /users/{username}/check and starts a session. */
export const POST: RequestHandler = endpoint(async ({ request, cookies, getClientAddress }) => {
	const body = (await readJson(request)) as { username?: unknown; password?: unknown };
	const user = await attemptLogin(String(body.username ?? ''), String(body.password ?? ''), getClientAddress());
	if (!user) throw new BookingError('login.incorrect', 401);

	await createSession(cookies, user);
	return { user };
});
