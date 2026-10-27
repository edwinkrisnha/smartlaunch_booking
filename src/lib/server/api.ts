import { json, type RequestEvent } from '@sveltejs/kit';
import { BookingError, toHttpError } from './booking';

/** Only follow same-site relative paths when redirecting back after a form post. */
export function safeNext(value: string | null | undefined): string {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

/** Wrap a JSON endpoint so thrown booking/API errors become `{ error }` responses. */
export function endpoint<E extends RequestEvent>(handler: (event: E) => Promise<unknown>) {
	return async (event: E) => {
		try {
			return json(await handler(event));
		} catch (err) {
			const { status, message } = toHttpError(err, event.locals.locale);
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
