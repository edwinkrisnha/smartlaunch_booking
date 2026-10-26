import { endpoint } from '#lib/server/api.js';
import { listPcs } from '#lib/server/booking.js';
import type { RequestHandler } from './$types';

/** GET — PCs (GET /computers), trimmed to id, name and group. */
export const GET: RequestHandler = endpoint(() => listPcs());
