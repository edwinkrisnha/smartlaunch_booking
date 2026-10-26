import { endpoint } from '#lib/server/api.js';
import { destroySession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = endpoint(async ({ cookies }) => {
	destroySession(cookies);
	return { ok: true };
});
