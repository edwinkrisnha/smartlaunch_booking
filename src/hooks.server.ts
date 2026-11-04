import { json, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { DEFAULT_LANGUAGE } from '$app/env/private';
import { fromAcceptLanguage, isLocale, LOCALE_COOKIE, translate } from '#lib/i18n/index.js';
import { readSession } from '#lib/server/session.js';

const PUBLIC_PATHS = new Set(['/login', '/api/login', '/signup', '/api/signup', '/lang']);
const FALLBACK_LOCALE = isLocale(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : 'en';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await readSession(event.cookies);

	// The visitor's pick from the language switcher, else their browser's language.
	const chosen = event.cookies.get(LOCALE_COOKIE);
	const locale = isLocale(chosen)
		? chosen
		: (fromAcceptLanguage(event.request.headers.get('accept-language')) ?? FALLBACK_LOCALE);
	event.locals.locale = locale;

	const { pathname } = event.url;
	// Payment webhooks and the scheduled sweep come from servers, not logged-in customers.
	const isServerCall = pathname.startsWith('/api/payments/webhook/') || pathname === '/api/payments/sweep';
	if (!event.locals.user && !PUBLIC_PATHS.has(pathname) && !isServerCall) {
		if (pathname.startsWith('/api/')) {
			return json({ error: translate(locale, 'error.notLoggedIn') }, { status: 401 });
		}
		const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + event.url.search)}`;
		redirect(303, `/login${next}`);
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	// Browsers only accept HSTS over https; this keeps them from ever trying plain http again.
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	}
	return response;
};
