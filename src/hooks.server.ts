import { json, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { readSession } from '#lib/server/session.js';

const PUBLIC_PATHS = new Set(['/login', '/api/login', '/signup', '/api/signup']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await readSession(event.cookies);

	const { pathname } = event.url;
	if (!event.locals.user && !PUBLIC_PATHS.has(pathname)) {
		if (pathname.startsWith('/api/')) {
			return json({ error: 'Not logged in.' }, { status: 401 });
		}
		const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + event.url.search)}`;
		redirect(303, `/login${next}`);
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
