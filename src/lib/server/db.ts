// The D1 database bound as DB in wrangler.jsonc (tables in migrations/).
import { env } from 'cloudflare:workers';

export function db(): D1Database {
	if (!env.DB) throw new Error('The D1 database binding DB is missing; see wrangler.jsonc.');
	return env.DB;
}

/** Current time in Unix seconds, as stored in the database. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);
