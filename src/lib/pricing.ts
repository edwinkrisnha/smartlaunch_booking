// eSports Nord HUB booking prices, revision R6 (31 October 2026). This is the one
// source for every price the site shows or records; change the rules here and
// bump PRICING_VERSION so stored bookings say which rules priced them.
//
// Times are center wall-clock seconds, the same scale as #lib/time.js
// (Europe/Berlin at the HUB). All amounts are gross EUR cents.
//
// Arithmetic (spec PRC-02): split at every day and tariff boundary, add up
// seconds x rate exactly, and round each line once, half up, to cents.

export const PRICING_VERSION = 'R6';
export const PRICING_CURRENCY = 'EUR';

export const PLANS = ['rookie', 'campus', 'pro', 'alpha', 'team'] as const;
export type Plan = (typeof PLANS)[number];

/** Plan names as the HUB publishes them; the same in every language. */
export const PLAN_NAMES: Record<Plan, string> = {
	rookie: 'Rookie',
	campus: 'Campus',
	pro: 'Pro',
	alpha: 'Alpha',
	team: 'TEAM'
};

export function isPlan(value: unknown): value is Plan {
	return PLANS.includes(value as Plan);
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Rookie (and whole-room) peak windows per weekday, 0 = Sunday. Start inclusive, end exclusive. */
const PEAK: Record<number, [number, number]> = {
	0: [15, 22],
	1: [17, 20],
	2: [17, 20],
	3: [17, 20],
	4: [17, 20],
	5: [17, 22],
	6: [15, 22]
};

/** Campus low-rate window, Monday to Friday. */
const CAMPUS_WINDOW: [number, number] = [13, 18];

/** Hours of the day where some rate can change; segments never cross one. */
const BOUNDARY_HOURS = [...new Set([...Object.values(PEAK).flat(), ...CAMPUS_WINDOW])].sort((a, b) => a - b);

const inWindow = (hour: number, [from, to]: [number, number]) => hour >= from && hour < to;

/** Hourly rate in cents for one station at `at`, which must not fall inside a segment boundary. */
export function stationRate(plan: Plan, at: number): number {
	const day = new Date(at * 1000).getUTCDay();
	const hour = (at % DAY) / HOUR;
	switch (plan) {
		case 'rookie':
			return inWindow(hour, PEAK[day]) ? 500 : 400;
		case 'campus':
			// Campus never takes the peak surcharge; its own window wins (R13, R14).
			return day >= 1 && day <= 5 && inWindow(hour, CAMPUS_WINDOW) ? 100 : 200;
		case 'pro':
			return 200;
		case 'alpha':
			return 100;
		case 'team':
			// Private use outside agreed training. Included training is scheduled by staff, not booked here.
			return 200;
	}
}

export interface Segment {
	/** Wall-clock seconds. */
	from: number;
	to: number;
	/** Cents per hour. */
	rate: number;
}

/** [from, to) split wherever the rate may change, with neighbouring equal-rate pieces merged. */
export function segments(from: number, to: number, rateAt: (at: number) => number): Segment[] {
	const out: Segment[] = [];
	let cursor = from;
	while (cursor < to) {
		const dayStart = Math.floor(cursor / DAY) * DAY;
		const next = [...BOUNDARY_HOURS.map((h) => dayStart + h * HOUR), dayStart + DAY].find((b) => b > cursor)!;
		const end = Math.min(next, to);
		const rate = rateAt(cursor);
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

export interface StationLine {
	plan: Plan;
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
}

/**
 * Price of `stations` individual PC or console stations booked by one customer
 * on `plan`. A plan discount covers the customer's own station only (RATE-03):
 * every further station is a guest at the Rookie rate. `discountInUse` means the
 * customer already has a discounted session at that time, so none applies here.
 */
export function quoteStations(plan: Plan, from: number, to: number, stations: number, discountInUse = false): StationQuote {
	const own: Plan = discountInUse ? 'rookie' : plan;
	const counts = new Map<Plan, number>();
	if (stations > 0) {
		counts.set(own, 1);
		if (stations > 1) counts.set('rookie', (counts.get('rookie') ?? 0) + stations - 1);
	}

	const lines = [...counts].map(([linePlan, n]) => {
		const parts = segments(from, to, (at) => stationRate(linePlan, at));
		const each = lineAmount(parts);
		return { plan: linePlan, stations: n, segments: parts, each, amount: each * n };
	});
	return { version: PRICING_VERSION, currency: PRICING_CURRENCY, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

// Whole-room bookings. Not offered on the site yet, but priced by the same rules.

export const ROOMS = {
	ROOM_PC10: { name: 'MIXED ZONE 10', capacity: 10 },
	ROOM_PC12: { name: 'BATTLE ARENA 12', capacity: 12 },
	ROOM_CZ6: { name: 'CONSOLE ZONE 6', capacity: 6 },
	ROOM_CON4: { name: 'CINEMA LOUNGE 4', capacity: 4 }
} as const;
export type RoomId = keyof typeof ROOMS;

export const ROOM_HOURS = [2, 3, 4, 5, 6] as const;
/** One catering pack per booked guest, once per booking (3 drinks + 2 snacks). */
export const CATERING_PER_GUEST = 1000;

export interface RoomQuote {
	version: string;
	currency: string;
	room: RoomId;
	/** Room fee segments; `rate` is the whole room's hourly rate. */
	segments: Segment[];
	roomFee: number;
	catering: number;
	total: number;
}

export class PricingError extends Error {}

/**
 * Room fee = capacity x Rookie rate over each segment, whatever the guest count;
 * the guest count only validates capacity and sizes the optional catering.
 * Turnover buffers are availability only and never charged.
 */
export function quoteRoom(room: RoomId, from: number, to: number, guests: number, catering: boolean): RoomQuote {
	const spec = ROOMS[room];
	if (!spec) throw new PricingError('Unknown room');
	const hours = (to - from) / HOUR;
	if (!(ROOM_HOURS as readonly number[]).includes(hours)) throw new PricingError('Rooms are booked for 2, 3, 4, 5 or 6 whole hours');
	if (!Number.isInteger(guests) || guests < 1 || guests > spec.capacity) {
		throw new PricingError(`Guests must be a whole number from 1 to ${spec.capacity}`);
	}

	const parts = segments(from, to, (at) => stationRate('rookie', at) * spec.capacity);
	const roomFee = lineAmount(parts);
	const cateringFee = catering ? guests * CATERING_PER_GUEST : 0;
	return {
		version: PRICING_VERSION,
		currency: PRICING_CURRENCY,
		room,
		segments: parts,
		roomFee,
		catering: cateringFee,
		total: roomFee + cateringFee
	};
}
