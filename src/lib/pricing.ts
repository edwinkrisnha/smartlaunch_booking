// Booking price engine. The rules themselves (plans, rates, peak times, rooms) come
// from the center's config file (see #lib/config.js); this file only does the sums.
//
// Times are center wall-clock seconds, the same scale as #lib/time.js. All amounts
// are gross cents.
//
// Arithmetic: split at every day and rate boundary, add up seconds x rate exactly,
// and round each line once, half up, to cents.

import type { PricingConfig, RateTable, ZoneConfig } from './config.js';

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Cents per hour of `table` at `at`: the first rule whose window contains it, else the base rate. */
export function rateAt(table: RateTable, at: number): number {
	const day = new Date(at * 1000).getUTCDay();
	const second = ((at % DAY) + DAY) % DAY;
	for (const rule of table.rules) {
		if (rule.windows.some((w) => w.days.includes(day) && second >= w.from && second < w.to)) return rule.rate;
	}
	return table.base;
}

export interface Segment {
	/** Wall-clock seconds. */
	from: number;
	to: number;
	/** Cents per hour. */
	rate: number;
}

/**
 * [from, to) split at midnight and at every boundary (seconds after midnight) where
 * the rate may change, with neighbouring equal-rate pieces merged.
 */
export function segments(from: number, to: number, boundaries: number[], rateOf: (at: number) => number): Segment[] {
	const out: Segment[] = [];
	let cursor = from;
	while (cursor < to) {
		const dayStart = Math.floor(cursor / DAY) * DAY;
		const next = [...boundaries.map((s) => dayStart + s), dayStart + DAY].find((b) => b > cursor)!;
		const end = Math.min(next, to);
		const rate = rateOf(cursor);
		const last = out.at(-1);
		if (last && last.rate === rate && last.to === cursor) last.to = end;
		else out.push({ from: cursor, to: end, rate });
		cursor = end;
	}
	return out;
}

/** Sum of seconds x cents-per-hour over segments, rounded once to cents, half up. */
export function lineAmount(parts: Segment[], multiplier = 1): number {
	const exact = parts.reduce((sum, s) => sum + (s.to - s.from) * s.rate * multiplier, 0);
	return Math.floor((exact + HOUR / 2) / HOUR);
}

export class PricingError extends Error {}

/**
 * The plan a Smartlaunch user group gives: the plan listing that group, else the
 * default plan. Group names are compared without case.
 */
export function planForGroup(pricing: PricingConfig, groupName: string): string {
	const group = groupName.trim().toLowerCase();
	return pricing.plans.find((p) => p.groups.includes(group))?.id ?? pricing.defaultPlan;
}

function plan(pricing: PricingConfig, id: string) {
	const found = pricing.plans.find((p) => p.id === id);
	if (!found) throw new PricingError(`Unknown plan "${id}"`);
	return found;
}

/**
 * The zone a station is in: the first zone listing its name or ID, or else its
 * Smartlaunch computer group. null when it is in no zone (the plan's normal rate).
 */
export function zoneOf(pricing: PricingConfig, pc: { id: string; name: string; groupName: string }): ZoneConfig | null {
	const id = pc.id.trim().toLowerCase();
	const name = pc.name.trim().toLowerCase();
	const group = pc.groupName.trim().toLowerCase();
	return (
		pricing.zones.find((z) => z.pcs.includes(id) || (name !== '' && z.pcs.includes(name))) ??
		pricing.zones.find((z) => group !== '' && z.groups.includes(group)) ??
		null
	);
}

export interface StationLine {
	plan: string;
	/** The plan's name as customers see it. */
	planName: string;
	/** Zone of these stations, or null for stations in no zone. */
	zone: string | null;
	zoneName: string | null;
	/** Stations charged at this plan. */
	stations: number;
	segments: Segment[];
	/** Price for one station, in cents. */
	each: number;
	/** each x stations. */
	amount: number;
}

export interface StationQuote {
	version: string;
	currency: string;
	lines: StationLine[];
	total: number;
	/** Name of the plan further stations were charged at, when that differs from the customer's (for the explanation). */
	guestPlanName: string | null;
}

/**
 * Price of individual PC or console stations booked by one customer on `planId`.
 * `stations` is the zone id of each station (null for no zone), or just how many
 * stations when the center has no zones. With a guest plan, the customer's plan
 * covers their own station only and every further station is charged at the guest
 * plan; the customer's own station is taken to be the one where their plan saves
 * the most. `discountInUse` means the customer already has a booking at that time and
 * the center gives the plan rate on one booking at a time, so their own station is
 * charged at the default plan.
 */
export function quoteStations(
	pricing: PricingConfig,
	planId: string,
	from: number,
	to: number,
	stations: number | (string | null)[],
	discountInUse = false
): StationQuote {
	const zones = typeof stations === 'number' ? new Array<string | null>(stations).fill(null) : stations;
	const own = discountInUse ? pricing.defaultPlan : plan(pricing, planId).id;
	const guest = pricing.guestPlan ?? own;

	const priced = new Map<string, { parts: Segment[]; each: number }>();
	const price = (planOfLine: string, zone: string | null) => {
		const key = `${planOfLine}\u0000${zone ?? ''}`;
		let hit = priced.get(key);
		if (!hit) {
			const p = plan(pricing, planOfLine);
			const table = (zone !== null && p.zoneRates[zone]) || p.rates;
			const parts = segments(from, to, pricing.boundaries, (at) => rateAt(table, at));
			hit = { parts, each: lineAmount(parts) };
			priced.set(key, hit);
		}
		return hit;
	};

	// Which station gets the customer's own plan: where it saves the most (the first on a tie).
	let ownIndex = 0;
	if (guest !== own) {
		let best = -Infinity;
		zones.forEach((zone, i) => {
			const saving = price(guest, zone).each - price(own, zone).each;
			if (saving > best) [best, ownIndex] = [saving, i];
		});
	}

	const counts = new Map<string, { plan: string; zone: string | null; n: number }>();
	zones.forEach((zone, i) => {
		const linePlan = i === ownIndex ? own : guest;
		const key = `${linePlan}\u0000${zone ?? ''}`;
		const entry = counts.get(key) ?? { plan: linePlan, zone, n: 0 };
		entry.n++;
		counts.set(key, entry);
	});
	// The customer's own line first, then the rest in the order the stations came.
	const ordered = [...counts.values()].sort((a, b) => Number(b.plan === own) - Number(a.plan === own));

	const zoneName = (id: string | null) => (id === null ? null : (pricing.zones.find((z) => z.id === id)?.name ?? id));
	const lines = ordered.map(({ plan: id, zone, n }) => {
		const { parts, each } = price(id, zone);
		return {
			plan: id,
			planName: plan(pricing, id).name,
			zone,
			zoneName: zoneName(zone),
			stations: n,
			segments: parts,
			each,
			amount: each * n
		};
	});
	return {
		version: pricing.version,
		currency: pricing.currency,
		lines,
		total: lines.reduce((s, l) => s + l.amount, 0),
		guestPlanName: guest !== own && zones.length > 1 ? plan(pricing, guest).name : null
	};
}

// Whole-room bookings. Not offered on the site yet, but priced from the same config.

export interface RoomQuote {
	version: string;
	currency: string;
	room: string;
	/** Room fee segments; `rate` is the whole room's hourly rate. */
	segments: Segment[];
	roomFee: number;
	catering: number;
	total: number;
}

/**
 * Room fee = capacity x the room's seat rate over each segment, whatever the guest
 * count; the guest count only validates capacity and sizes the optional catering.
 * Turnover buffers are availability only and never charged.
 */
export function quoteRoom(pricing: PricingConfig, roomId: string, from: number, to: number, guests: number, catering: boolean): RoomQuote {
	const spec = pricing.rooms.find((r) => r.id === roomId);
	if (!spec) throw new PricingError('Unknown room');
	const hours = (to - from) / HOUR;
	if (!spec.hours.includes(hours)) throw new PricingError(`Rooms are booked for ${spec.hours.join(', ')} whole hours`);
	if (!Number.isInteger(guests) || guests < 1 || guests > spec.capacity) {
		throw new PricingError(`Guests must be a whole number from 1 to ${spec.capacity}`);
	}

	const parts = segments(from, to, pricing.boundaries, (at) => rateAt(spec.seatRates, at) * spec.capacity);
	const roomFee = lineAmount(parts);
	const cateringFee = catering ? guests * spec.cateringPerGuest : 0;
	return {
		version: pricing.version,
		currency: pricing.currency,
		room: spec.id,
		segments: parts,
		roomFee,
		catering: cateringFee,
		total: roomFee + cateringFee
	};
}
