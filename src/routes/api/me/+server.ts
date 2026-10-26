import { endpoint } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = endpoint(async ({ locals }) => ({ user: locals.user }));
