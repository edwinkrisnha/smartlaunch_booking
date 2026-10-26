import { listLayouts, listPcs, listSeats, toHttpError } from '#lib/server/booking.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const [layouts, seats, pcs] = await Promise.all([listLayouts(), listSeats(), listPcs()]);
		return { layouts, seats, pcs, loadError: null };
	} catch (err) {
		return { layouts: [], seats: [], pcs: [], loadError: toHttpError(err).message };
	}
};
