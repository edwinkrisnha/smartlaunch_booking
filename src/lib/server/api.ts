import { json, type RequestEvent } from '@sveltejs/kit';
import { BookingError, toHttpError } from './booking';
import { destroySession } from './session';

const BASE = 'https://site.invalid';

/**
 * Only follow paths on this site when redirecting back after a form post. The
 * value is resolved the way a browser would, so `/\evil.com` or `/<tab>/evil.com`
 * (which browsers read as `//evil.com`) fall back to the home page.
 */
export function safeNext(value: string | null | undefined): string {
	if (!value || !value.startsWith('/')) return '/';
	try {
		const url = new URL(value, BASE);
		if (url.origin !== BASE) return '/';
		return url.pathname + url.search + url.hash;
	} catch {
		return '/';
	}
}

/** Wrap a JSON endpoint so thrown booking/API errors become `{ error }` responses. */
export function endpoint<E extends RequestEvent>(handler: (event: E) => Promise<unknown>) {
	return async (event: E) => {
		try {
			return json(await handler(event));
		} catch (err) {
			const { status, message } = toHttpError(err, event.locals.locale);
			// The account was deleted while logged in: end the session so the next page asks to log in.
			if (status === 401) destroySession(event.cookies);
			return json({ error: message }, { status });
		}
	};
}

/**
 * Read a JSON request body. Requiring the JSON content type also means a
 * cross-site HTML form cannot reach these endpoints.
 */
export async function readJson(request: Request): Promise<unknown> {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new BookingError('error.json', 415);
	}
	try {
		return await request.json();
	} catch {
		throw new BookingError('error.malformedJson');
	}
}
