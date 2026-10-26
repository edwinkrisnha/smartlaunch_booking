import { endpoint } from '#lib/server/api.js';
import { listLayouts } from '#lib/server/booking.js';
import type { RequestHandler } from './$types';

/** GET — layout groups (GET /layoutgroups). */
export const GET: RequestHandler = endpoint(() => listLayouts());
