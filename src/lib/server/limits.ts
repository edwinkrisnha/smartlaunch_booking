// Rate limits and per-customer locks, kept in D1 (tables in migrations/0003_limits.sql)
// so they hold across all of Cloudflare's Worker instances.

import { LocalizedError, type MessageKey } from '#lib/i18n/index.js';
import { db, nowSeconds } from './db.js';

/**
 * Count one request against `key` and return how many there have been in the
 * current window of `windowSeconds`, this one included.
 */
export async function hit(key: string, windowSeconds: number): Promise<number> {
	const now = nowSeconds();
	const row = await db()
		.prepare(
			`INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
			 ON CONFLICT (key) DO UPDATE SET
			   count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
			   reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
			 RETURNING count`
		)
		.bind(key, now + windowSeconds, now)
		.first<{ count: number }>();
	return row?.count ?? 1;
}

/** Count a request and throw 429 once there have been more than `max` in `windowSeconds`. */
export async function throttle(
	key: string,
	max: number,
	windowSeconds: number,
	message: MessageKey = 'error.tooMany'
): Promise<void> {
	if ((await hit(key, windowSeconds)) > max) throw new LocalizedError(message, 429);
}

/** Whether `key` has already reached `max` in its current window, without counting anything. */
export async function reached(key: string, max: number): Promise<boolean> {
	const row = await db()
		.prepare('SELECT count FROM rate_limits WHERE key = ? AND reset_at > ?')
		.bind(key, nowSeconds())
		.first<{ count: number }>();
	return (row?.count ?? 0) >= max;
}

export async function resetLimit(key: string): Promise<void> {
	await db().prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}

/**
 * Run `fn` while holding the lock `key`; throws 409 if someone else holds it.
 * The lock lapses after `seconds` in case the Worker dies before releasing it.
 */
export async function withLock<T>(key: string, seconds: number, fn: () => Promise<T>): Promise<T> {
	const now = nowSeconds();
	const taken = await db()
		.prepare(
			`INSERT INTO locks (key, until) VALUES (?1, ?2)
			 ON CONFLICT (key) DO UPDATE SET until = ?2 WHERE locks.until <= ?3`
		)
		.bind(key, now + seconds, now)
		.run();
	if (taken.meta.changes !== 1) throw new LocalizedError('error.busy', 409);
	try {
		return await fn();
	} finally {
		await db()
			.prepare('DELETE FROM locks WHERE key = ?')
			.bind(key)
			.run()
			.catch((err) => console.error(`Releasing lock ${key} failed`, err));
	}
}

/** Drop finished windows and lapsed locks; run by the scheduled sweep. */
export async function pruneLimits(): Promise<void> {
	const now = nowSeconds();
	await db().batch([
		db().prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(now),
		db().prepare('DELETE FROM locks WHERE until <= ?').bind(now)
	]);
}
