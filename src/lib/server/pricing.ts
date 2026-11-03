import { PLAN_GROUPS, PRICE_RULES } from '$app/env/private';
import { isPlan, type Plan } from '#lib/pricing.js';
import * as sl from './smartlaunch';

/** Prices are shown and recorded only when the center has chosen a rule set. */
export const pricingEnabled = PRICE_RULES === 'r6';

if (PRICE_RULES && !pricingEnabled) console.error(`PRICE_RULES="${PRICE_RULES}" is not a known rule set; prices are off.`);

const GROUP_CACHE_MS = 5 * 60_000;
let groupCache: { at: number; names: Map<string, string> } | null = null;

/** User group ID -> name. Groups rarely change, so keep them for a few minutes. */
async function groupNames(): Promise<Map<string, string>> {
	if (groupCache && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache.names;
	const groups = await sl.getUserGroups();
	const names = new Map(groups.map((g) => [String(g.UserGroupID), g.UserGroupName ?? '']));
	groupCache = { at: Date.now(), names };
	return names;
}

/**
 * The customer's price plan, from their Smartlaunch user group: PLAN_GROUPS
 * maps group names to plans, otherwise a group named like a plan gives that
 * plan. Everyone else, and anyone we can't look up, pays Rookie rates.
 */
export async function planFor(username: string): Promise<Plan> {
	const user = await sl.getUser(username);
	if (!user) return 'rookie';
	const group = ((await groupNames()).get(String(user.UserGroupID)) ?? '').trim().toLowerCase();
	const plan = PLAN_GROUPS.get(group) ?? group;
	return isPlan(plan) ? plan : 'rookie';
}
