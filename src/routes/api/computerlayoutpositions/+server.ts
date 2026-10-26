import { endpoint } from '#lib/server/api.js';
import { listSeats } from '#lib/server/booking.js';
import type { RequestHandler } from './$types';

/** GET — PC positions for every layout group (GET /computerlayoutpositions). */
export const GET: RequestHandler = endpoint(() => listSeats());
