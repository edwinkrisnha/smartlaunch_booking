import { error } from '@sveltejs/kit';
import { getTopup, orderBelongsTo, syncOrder } from '#lib/server/orders.js';
import { paymentSettings } from '#lib/server/payments/index.js';
import type { PageServerLoad } from './$types';

/** Where the payment provider sends the customer back: `?order=<id>`. */
export const load: PageServerLoad = async ({ url, locals }) => {
	const id = url.searchParams.get('order') ?? '';
	if (!/^TU[A-Z0-9]{14}$/.test(id) || !(await orderBelongsTo(id, locals.user!.username))) {
		error(404, 'Not found');
	}

	try {
		const synced = await syncOrder(id);
		if (synced) return { ...synced, currency: paymentSettings.currency };
	} catch (err) {
		// The provider or the center server is unreachable; show what we know and keep polling.
		console.error(`Return page: order ${id} could not be synced`, err);
	}
	return { order: (await getTopup(id))!, providerStatus: null, currency: paymentSettings.currency };
};
