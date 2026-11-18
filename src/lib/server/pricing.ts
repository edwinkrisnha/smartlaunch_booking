import { planForGroup, zoneOf } from '#lib/pricing.js';
import { center } from './center';
import * as sl from './smartlaunch';

/** The center's price list, or null when it shows no prices (no "pricing" in its config). */
export const pricing = center.pricing;
export const pricingEnabled = pricing !== null;

const GROUP_CACHE_MS = 5 * 60_000;

/** ID -> name of some kind of group, kept for a few minutes because groups rarely change. */
function cachedNames(load: () => Promise<[string, string][]>): () => Promise<Map<string, string>> {
	let cache: { at: number; names: Map<string, string> } | null = null;
	return async () => {
		if (cache && Date.now() - cache.at < GROUP_CACHE_MS) return cache.names;
		const names = new Map(await load());
		cache = { at: Date.now(), names };
		return names;
	};
}

const groupNames = cachedNames(async () => (await sl.getUserGroups()).map((g) => [String(g.UserGroupID), g.UserGroupName ?? '']));
const computerGroupNames = cachedNames(async () => (await sl.getComputerGroups()).map((g) => [String(g.ComputerGroupID), g.Name ?? '']));

/**
 * The price zone (see pricing.zones) of each of `ids`, in the same order; null for
 * a PC in no zone. Reads computer groups from the server only when zones use them.
 */
export async function stationZones(ids: string[], computers: sl.RawComputer[]): Promise<(string | null)[]> {
	if (!pricing || pricing.zones.length === 0) return ids.map(() => null);
	const groups = pricing.zones.some((z) => z.groups.length > 0) ? await computerGroupNames() : new Map<string, string>();
	const byId = new Map(computers.map((c) => [String(c.ComputerID), c]));
	return ids.map((id) => {
		const c = byId.get(id);
		const groupName = c ? (groups.get(String(c.ComputerGroupID)) ?? '') : '';
		return zoneOf(pricing!, { id, name: c?.Name ?? '', groupName })?.id ?? null;
	});
}

/**
 * The customer's price plan, from their Smartlaunch user group (see the plans'
 * "groups" in the center config). Anyone else gets the default plan.
 */
export async function planOf(account: sl.RawUser): Promise<string> {
	if (!pricing) throw new Error('planOf: the center has no prices');
	return planForGroup(pricing, (await groupNames()).get(String(account.UserGroupID)) ?? '');
}
