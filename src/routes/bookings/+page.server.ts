import { listBookings, listPcs, toHttpError } from '#lib/server/booking.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const [bookings, pcs] = await Promise.all([listBookings(locals.user!.username), listPcs()]);
		return { bookings, pcs, loadError: null };
	} catch (err) {
		return { bookings: [], pcs: [], loadError: toHttpError(err).message };
	}
};
