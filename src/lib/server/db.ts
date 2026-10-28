// The D1 database bound as DB in wrangler.jsonc (tables in migrations/).
import { env } from 'cloudflare:workers';

export function db(): D1Database {
	if (!env.DB) {
		// In `npm run dev` the bindings are read once at startup and kept across Vite's automatic restarts.
		throw new Error(
			'The D1 database binding DB is missing; see wrangler.jsonc. If you just changed wrangler.jsonc or vite.config.ts, stop and restart `npm run dev`.'
		);
	}
	return env.DB;
}

/** Current time in Unix seconds, as stored in the database. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);
