// Cloudflare Turnstile on sign-up, so accounts can't be created by a script.
// Off unless both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

import { TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } from '$app/env/private';

const enabled = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
if (Boolean(TURNSTILE_SITE_KEY) !== Boolean(TURNSTILE_SECRET_KEY)) {
	console.error('Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to turn on the sign-up challenge; it is off.');
}

/** The site key for the sign-up page's widget, or null when the challenge is off. */
export const turnstileSiteKey: string | null = enabled ? TURNSTILE_SITE_KEY! : null;

/** Whether the visitor passed the challenge. Always true when it is off. */
export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
	if (!enabled) return true;
	if (!token || token.length > 2048) return false;

	const body = new FormData();
	body.append('secret', TURNSTILE_SECRET_KEY!);
	body.append('response', token);
	if (ip) body.append('remoteip', ip);
	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body,
			signal: AbortSignal.timeout(10_000)
		});
		const result = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
		if (!result.success) console.warn('Turnstile rejected a sign-up', result['error-codes']);
		return result.success === true;
	} catch (err) {
		console.error('Turnstile verification failed', err);
		return false;
	}
}
