// Stateless sessions: the cookie carries the user payload plus an HMAC-SHA256
// signature, so no KV or database is needed on Cloudflare's free tier.

import type { Cookies } from '@sveltejs/kit';
import { SESSION_SECRET } from '$app/env/private';
import type { SessionUser } from '#lib/types.js';

export const SESSION_COOKIE = 'sl_session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

interface Payload extends SessionUser {
	exp: number;
}

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | undefined;

function getKey(): Promise<CryptoKey> {
	if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
		throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
	}
	keyPromise ??= crypto.subtle.importKey(
		'raw',
		encoder.encode(SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
	return keyPromise;
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function createSession(cookies: Cookies, user: SessionUser): Promise<void> {
	const payload: Payload = { ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
	const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await getKey(), encoder.encode(body)));

	cookies.set(SESSION_COOKIE, `${body}.${toBase64Url(signature)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE_SECONDS
	});
}

export async function readSession(cookies: Cookies): Promise<SessionUser | null> {
	const value = cookies.get(SESSION_COOKIE);
	if (!value) return null;

	const [body, signature] = value.split('.');
	if (!body || !signature) return null;

	try {
		const valid = await crypto.subtle.verify(
			'HMAC',
			await getKey(),
			fromBase64Url(signature),
			encoder.encode(body)
		);
		if (!valid) return null;

		const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Payload;
		if (payload.exp < Date.now() / 1000) return null;

		return { username: payload.username, displayName: payload.displayName, phone: payload.phone };
	} catch {
		return null;
	}
}

export function destroySession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
