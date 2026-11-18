// A center's settings: prices, booking rules, payment limits and how the site
// looks. Each center keeps them in one file, centers/<name>/config.jsonc, and the
// CENTER variable picks which one a deployment uses (see #lib/server/center.js).
//
// This module parses and checks that file and fills in defaults. It has no runtime
// imports, so `npm test` can load it as well as the site. Amounts in the file are
// in whole currency units (2.5 = EUR 2.50); here they become cents. Times of day
// ("17:00") become seconds after midnight, in the center's wall-clock time.

/** Weekday names in the file, Monday first; their position maps to Date#getUTCDay() through DAY_NUMBERS. */
const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY = 24 * 3600;

export interface TimeWindow {
	/** Date#getUTCDay() numbers, 0 = Sunday. */
	days: number[];
	/** Seconds after midnight; start inclusive, end exclusive. */
	from: number;
	to: number;
}

export interface RateRule {
	windows: TimeWindow[];
	/** Cents per hour. */
	rate: number;
}

/** An hourly rate that changes over the week: the first rule whose window matches wins, else `base`. */
export interface RateTable {
	/** Cents per hour. */
	base: number;
	rules: RateRule[];
}

export interface PlanConfig {
	id: string;
	/** As shown to customers, the same in every language. */
	name: string;
	/** Smartlaunch user group names (lower case) whose members get this plan. */
	groups: string[];
	rates: RateTable;
	/** Rates for stations in a zone, by zone id; a zone not listed uses `rates`. */
	zoneRates: Record<string, RateTable>;
}

/** A set of stations priced differently, e.g. VIP PCs or consoles. */
export interface ZoneConfig {
	id: string;
	/** As shown to customers. */
	name: string;
	/** Smartlaunch computer group names (lower case) whose PCs are in the zone. */
	groups: string[];
	/** PC names or IDs (lower case) in the zone, whatever their group. */
	pcs: string[];
}

export interface RoomConfig {
	id: string;
	name: string;
	capacity: number;
	/** Whole hours a room can be booked for. */
	hours: number[];
	/** Per seat; the room fee is capacity x this, whatever the guest count. */
	seatRates: RateTable;
	/** Cents per guest, once per booking, when catering is ordered. */
	cateringPerGuest: number;
}

export interface PricingConfig {
	/** Name of the price list, recorded with every booking it priced (e.g. "R7"). */
	version: string;
	currency: string;
	plans: PlanConfig[];
	/** In order: a PC in several zones belongs to the first. */
	zones: ZoneConfig[];
	/** Plan of customers whose group gives no plan. */
	defaultPlan: string;
	/** Plan that further stations in one booking are charged at; null charges them at the customer's own plan. */
	guestPlan: string | null;
	/**
	 * A customer gets their plan rate on one booking at a time: a booking that overlaps
	 * another of theirs is charged at the default plan.
	 */
	oneDiscountAtATime: boolean;
	rooms: RoomConfig[];
	/** Seconds after midnight where some rate may change, sorted; prices are split there. */
	boundaries: number[];
}

export interface BookingConfig {
	minMinutes: number;
	maxMinutes: number;
	/** Durations offered on the booking page, in hours. */
	durations: number[];
	/** Duration selected when the page opens, in hours; one of `durations`. */
	defaultDuration: number;
	/** Arrival times the time picker steps through, in minutes. */
	arrivalStepMinutes: number;
	/** Bookings open from the first multiple of this many minutes after now + leadMinutes. */
	startGridMinutes: number;
	leadMinutes: number;
	maxStationsPerBooking: number;
	/** Upcoming bookings one customer may have at once. */
	maxUpcomingBookings: number;
	/** Names or IDs of PCs customers can never book online, in lower case. */
	excludedPcs: string[];
}

export interface PaymentsConfig {
	/** Quick-pick top-up amounts, in whole currency units. */
	topupAmounts: number[];
	topupMin: number;
	topupMax: number;
	/** How long stations stay held while a customer pays for them. */
	holdMinutes: number;
	/** Bookings one customer may have waiting for payment at once. */
	maxOpenHolds: number;
	/** Holds one customer may let run out unpaid per hour. */
	maxUnpaidHoldsPerHour: number;
	/** Top-up checkouts one customer may start per hour. */
	topupsPerHour: number;
}

export interface SignupConfig {
	enabled: boolean;
	minAge: number;
}

export interface CenterConfig {
	center: {
		name: string;
		/** IANA zone; null skips the "earliest arrival" check on the server. */
		timezone: string | null;
		currency: string;
		defaultLanguage: string;
		/** Folder under src/themes. */
		theme: string;
	};
	booking: BookingConfig;
	/** null: the site shows no prices and takes no booking payments. */
	pricing: PricingConfig | null;
	payments: PaymentsConfig;
	signup: SignupConfig;
}

export class ConfigError extends Error {
	readonly file: string;
	readonly problems: string[];

	// No constructor parameter properties: Node's type stripping (npm test) can't run them.
	constructor(file: string, problems: string[]) {
		super(`${file} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:\n  - ${problems.join('\n  - ')}`);
		this.name = 'ConfigError';
		this.file = file;
		this.problems = problems;
	}
}

/**
 * JSON with // and /* *\/ comments and trailing commas, like wrangler.jsonc.
 * Strings are copied untouched, so "http://..." keeps its slashes.
 */
export function parseJsonc(text: string): unknown {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			const start = i++;
			while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
			out += text.slice(start, ++i);
		} else if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end === -1 ? text.length : end + 2;
		} else if (c === ',') {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j])) j++;
			if (text[j] !== '}' && text[j] !== ']') out += c;
			i++;
		} else {
			out += c;
			i++;
		}
	}
	return JSON.parse(out);
}

// --- Reading with defaults; every problem is collected with its path. ---------

type Obj = Record<string, unknown>;

class Reader {
	problems: string[] = [];

	fail(path: string, message: string): undefined {
		this.problems.push(`${path}: ${message}`);
		return undefined;
	}

	/** An object with only the given keys; unknown keys are reported, since they are usually typos. */
	object(value: unknown, path: string, keys: readonly string[]): Obj | undefined {
		if (value === undefined) return {};
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return this.fail(path, 'must be an object');
		for (const key of Object.keys(value)) {
			if (!keys.includes(key) && !key.startsWith('$')) this.fail(`${path}.${key}`, `unknown setting (expected one of: ${keys.join(', ')})`);
		}
		return value as Obj;
	}

	string(value: unknown, path: string, fallback: string, { allowEmpty = false } = {}): string {
		if (value === undefined) return fallback;
		if (typeof value !== 'string' || (!allowEmpty && !value.trim())) return this.fail(path, 'must be a non-empty text') ?? fallback;
		return value.trim();
	}

	/** A setting that must be given. */
	required(value: unknown, path: string): boolean {
		if (value !== undefined) return true;
		this.fail(path, 'is required');
		return false;
	}

	boolean(value: unknown, path: string, fallback: boolean): boolean {
		if (value === undefined) return fallback;
		if (typeof value !== 'boolean') return this.fail(path, 'must be true or false') ?? fallback;
		return value;
	}

	number(value: unknown, path: string, fallback: number, { min = 0, integer = false, max = Infinity } = {}): number {
		if (value === undefined) return fallback;
		if (typeof value !== 'number' || !Number.isFinite(value)) return this.fail(path, 'must be a number') ?? fallback;
		if (integer && !Number.isInteger(value)) return this.fail(path, 'must be a whole number') ?? fallback;
		if (value < min || value > max) {
			return this.fail(path, max === Infinity ? `must be at least ${min}` : `must be from ${min} to ${max}`) ?? fallback;
		}
		return value;
	}

	/** An amount in whole currency units with at most two decimals, as cents. */
	money(value: unknown, path: string, fallback?: number): number {
		if (value === undefined && fallback !== undefined) return fallback;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
			return this.fail(path, 'must be an amount of 0 or more, e.g. 2.5') ?? 0;
		}
		const cents = Math.round(value * 100);
		if (Math.abs(cents - value * 100) > 1e-6) return this.fail(path, 'can have at most two decimals') ?? 0;
		return cents;
	}

	array(value: unknown, path: string): unknown[] | undefined {
		if (!Array.isArray(value)) return this.fail(path, 'must be a list [ ... ]');
		return value;
	}

	/** "HH:MM" as seconds after midnight; "24:00" (end of day) only when `endOfDay`. */
	time(value: unknown, path: string, endOfDay: boolean): number | undefined {
		const m = typeof value === 'string' ? /^(\d{2}):(\d{2})$/.exec(value) : null;
		const seconds = m ? (Number(m[1]) * 60 + Number(m[2])) * 60 : NaN;
		if (!m || Number(m[2]) > 59 || seconds > DAY || (seconds === DAY && !endOfDay)) {
			return this.fail(path, `must be a time like "17:00"${endOfDay ? ' (or "24:00" for midnight)' : ''}`);
		}
		return seconds;
	}

	/** ["mon", "tue"] or ranges such as ["mon-fri"]; omitted means every day. */
	days(value: unknown, path: string): number[] {
		if (value === undefined) return ALL_DAYS;
		const list = this.array(value, path);
		if (!list) return ALL_DAYS;
		const days = new Set<number>();
		for (const [i, entry] of list.entries()) {
			const [first, last = first] = typeof entry === 'string' ? entry.trim().toLowerCase().split('-') : [];
			const a = DAY_NAMES.indexOf(first as (typeof DAY_NAMES)[number]);
			const b = DAY_NAMES.indexOf(last as (typeof DAY_NAMES)[number]);
			if (a === -1 || b === -1 || b < a) {
				this.fail(`${path}[${i}]`, `must be a day (${DAY_NAMES.join(', ')}) or a range such as "mon-fri"`);
				continue;
			}
			for (let d = a; d <= b; d++) days.add(DAY_NUMBERS[d]);
		}
		return [...days].sort();
	}

	window(value: unknown, path: string): TimeWindow | undefined {
		const o = this.object(value, path, ['days', 'from', 'to']);
		if (!o) return undefined;
		const from = this.time(o.from, `${path}.from`, false);
		const to = this.time(o.to, `${path}.to`, true);
		const days = this.days(o.days, `${path}.days`);
		if (from === undefined || to === undefined) return undefined;
		if (to <= from) return this.fail(path, '"to" must be after "from"; split a window that runs past midnight in two');
		return { days, from, to };
	}

	/** `rate` plus optional `rates`: [{ "period": "peak", "rate": 6 }, { "days": [...], "from": ..., "to": ..., "rate": 4 }]. */
	rateTable(o: Obj, path: string, periods: Map<string, TimeWindow[]>): RateTable {
		const base = this.money(o.rate, `${path}.rate`);
		const rules: RateRule[] = [];
		if (o.rates !== undefined) {
			for (const [i, raw] of (this.array(o.rates, `${path}.rates`) ?? []).entries()) {
				const rulePath = `${path}.rates[${i}]`;
				const r = this.object(raw, rulePath, ['period', 'days', 'from', 'to', 'rate']);
				if (!r) continue;
				const rate = this.money(r.rate, `${rulePath}.rate`);
				if (r.period !== undefined) {
					if (r.days !== undefined || r.from !== undefined || r.to !== undefined) {
						this.fail(rulePath, 'give either "period" or "days"/"from"/"to", not both');
						continue;
					}
					const windows = typeof r.period === 'string' ? periods.get(r.period) : undefined;
					if (!windows) {
						this.fail(`${rulePath}.period`, `unknown period (defined: ${[...periods.keys()].join(', ') || 'none'})`);
						continue;
					}
					rules.push({ windows, rate });
				} else {
					const w = this.window({ days: r.days, from: r.from, to: r.to }, rulePath);
					if (w) rules.push({ windows: [w], rate });
				}
			}
		}
		return { base, rules };
	}
}

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function readPricing(r: Reader, value: unknown, currency: string): PricingConfig | null {
	if (value === undefined || value === null) return null;
	const o = r.object(value, 'pricing', ['version', 'periods', 'zones', 'plans', 'defaultPlan', 'guestPlan', 'oneDiscountAtATime', 'rooms']);
	if (!o) return null;

	const periods = new Map<string, TimeWindow[]>();
	const periodsObj = r.object(o.periods, 'pricing.periods', Object.keys((o.periods as Obj) ?? {}));
	for (const [name, list] of Object.entries(periodsObj ?? {})) {
		const path = `pricing.periods.${name}`;
		const windows = (r.array(list, path) ?? []).map((w, i) => r.window(w, `${path}[${i}]`)).filter((w) => w !== undefined);
		periods.set(name, windows);
	}

	const names = (list: unknown, path: string, what: string) =>
		(list === undefined ? [] : (r.array(list, path) ?? []))
			.map((v, j) =>
				(typeof v === 'string' && v.trim()) || typeof v === 'number' ? String(v).trim().toLowerCase() : r.fail(`${path}[${j}]`, `must be ${what}`)
			)
			.filter((v): v is string => v !== undefined);

	const zones: ZoneConfig[] = [];
	for (const [i, raw] of (o.zones === undefined ? [] : (r.array(o.zones, 'pricing.zones') ?? [])).entries()) {
		const path = `pricing.zones[${i}]`;
		const z = r.object(raw, path, ['id', 'name', 'groups', 'pcs']);
		if (!z) continue;
		r.required(z.id, `${path}.id`);
		const id = r.string(z.id, `${path}.id`, '');
		if (id && !ID_RE.test(id)) r.fail(`${path}.id`, 'use letters, digits, "-" and "_" only');
		if (zones.some((q) => q.id === id)) r.fail(`${path}.id`, `"${id}" is used by another zone`);
		const zone = {
			id,
			name: r.string(z.name, `${path}.name`, id),
			groups: names(z.groups, `${path}.groups`, 'a PC group name'),
			pcs: names(z.pcs, `${path}.pcs`, 'a PC name or ID')
		};
		if (zone.groups.length === 0 && zone.pcs.length === 0) r.fail(path, 'needs "groups" or "pcs" to say which PCs are in it');
		zones.push(zone);
	}
	const zoneIds = zones.map((z) => z.id);

	const plans: PlanConfig[] = [];
	const groupOwner = new Map<string, string>();
	for (const [i, raw] of (r.array(o.plans, 'pricing.plans') ?? []).entries()) {
		const path = `pricing.plans[${i}]`;
		const p = r.object(raw, path, ['id', 'name', 'groups', 'rate', 'rates', 'zones']);
		if (!p) continue;
		r.required(p.id, `${path}.id`);
		const id = r.string(p.id, `${path}.id`, '');
		if (id && !ID_RE.test(id)) r.fail(`${path}.id`, 'use letters, digits, "-" and "_" only');
		if (plans.some((q) => q.id === id)) r.fail(`${path}.id`, `"${id}" is used by another plan`);
		const name = r.string(p.name, `${path}.name`, id);
		// By default a group named like the plan's id or name gives the plan.
		const groups = (p.groups === undefined ? [id, name].filter(Boolean) : (r.array(p.groups, `${path}.groups`) ?? []))
			.map((g, j) => (typeof g === 'string' && g.trim() ? g.trim().toLowerCase() : r.fail(`${path}.groups[${j}]`, 'must be a group name')))
			.filter((g): g is string => g !== undefined);
		for (const g of new Set(groups)) {
			const other = groupOwner.get(g);
			if (other && other !== id) r.fail(`${path}.groups`, `group "${g}" already gives plan "${other}"`);
			groupOwner.set(g, id);
		}
		const zoneRates: Record<string, RateTable> = {};
		const zonesObj = r.object(p.zones, `${path}.zones`, zoneIds);
		for (const [zoneId, zr] of Object.entries(zonesObj ?? {})) {
			if (!zoneIds.includes(zoneId)) continue; // reported by object() as an unknown setting
			const zonePath = `${path}.zones.${zoneId}`;
			const zo = r.object(zr, zonePath, ['rate', 'rates']);
			if (zo) zoneRates[zoneId] = r.rateTable(zo, zonePath, periods);
		}
		plans.push({ id, name, groups: [...new Set(groups)], rates: r.rateTable(p, path, periods), zoneRates });
	}
	if (plans.length === 0) r.fail('pricing.plans', 'needs at least one plan');

	const planIds = plans.map((p) => p.id);
	const planRef = (v: unknown, path: string): string | undefined => {
		if (typeof v === 'string' && planIds.includes(v)) return v;
		return r.fail(path, `must be one of the plan ids: ${planIds.join(', ')}`);
	};
	const defaultPlan = (o.defaultPlan === undefined ? planIds[0] : planRef(o.defaultPlan, 'pricing.defaultPlan')) ?? '';
	const guestPlan = o.guestPlan === undefined || o.guestPlan === null ? null : (planRef(o.guestPlan, 'pricing.guestPlan') ?? null);

	const rooms: RoomConfig[] = [];
	for (const [i, raw] of (o.rooms === undefined ? [] : (r.array(o.rooms, 'pricing.rooms') ?? [])).entries()) {
		const path = `pricing.rooms[${i}]`;
		const m = r.object(raw, path, ['id', 'name', 'capacity', 'hours', 'rate', 'rates', 'cateringPerGuest']);
		if (!m) continue;
		r.required(m.id, `${path}.id`);
		const id = r.string(m.id, `${path}.id`, '');
		if (rooms.some((q) => q.id === id)) r.fail(`${path}.id`, `"${id}" is used by another room`);
		const hours = (m.hours === undefined ? [] : (r.array(m.hours, `${path}.hours`) ?? [])).map((h, j) => r.number(h, `${path}.hours[${j}]`, 1, { min: 1, integer: true }));
		if (hours.length === 0) r.fail(`${path}.hours`, 'needs at least one duration');
		rooms.push({
			id,
			name: r.string(m.name, `${path}.name`, id),
			capacity: r.required(m.capacity, `${path}.capacity`) ? r.number(m.capacity, `${path}.capacity`, 1, { min: 1, integer: true }) : 1,
			hours,
			seatRates: r.rateTable(m, path, periods),
			cateringPerGuest: r.money(m.cateringPerGuest, `${path}.cateringPerGuest`, 0)
		});
	}

	const windows = [...periods.values()].flat();
	for (const table of [...plans.flatMap((p) => [p.rates, ...Object.values(p.zoneRates)]), ...rooms.map((m) => m.seatRates)]) {
		for (const rule of table.rules) windows.push(...rule.windows);
	}
	const boundaries = [...new Set(windows.flatMap((w) => [w.from, w.to]).filter((s) => s > 0 && s < DAY))].sort((a, b) => a - b);

	return {
		version: r.string(o.version, 'pricing.version', '', { allowEmpty: true }),
		currency,
		plans,
		zones,
		defaultPlan,
		guestPlan,
		oneDiscountAtATime: r.boolean(o.oneDiscountAtATime, 'pricing.oneDiscountAtATime', false),
		rooms,
		boundaries
	};
}

const divides = (minutes: number, of: number) => minutes > 0 && of % minutes === 0;

function readBooking(r: Reader, value: unknown): BookingConfig {
	const o = r.object(value, 'booking', [
		'minMinutes',
		'maxMinutes',
		'durations',
		'defaultDuration',
		'arrivalStepMinutes',
		'startGridMinutes',
		'leadMinutes',
		'maxStationsPerBooking',
		'maxUpcomingBookings',
		'excludedPcs'
	]) ?? {};
	const minMinutes = r.number(o.minMinutes, 'booking.minMinutes', 30, { min: 1, integer: true });
	const maxMinutes = r.number(o.maxMinutes, 'booking.maxMinutes', 24 * 60, { min: 1, integer: true });
	if (maxMinutes < minMinutes) r.fail('booking.maxMinutes', 'must not be less than minMinutes');

	const durations =
		o.durations === undefined
			? [1, 2, 3, 4, 5, 6, 8, 10, 12].filter((h) => h * 60 >= minMinutes && h * 60 <= maxMinutes)
			: (r.array(o.durations, 'booking.durations') ?? []).map((h, i) => {
					const hours = r.number(h, `booking.durations[${i}]`, 1, { min: 0.01 });
					const minutes = hours * 60;
					if (!Number.isInteger(Math.round(minutes * 1e6) / 1e6)) r.fail(`booking.durations[${i}]`, 'must be whole minutes, e.g. 1.5 or 0.25');
					else if (minutes < minMinutes || minutes > maxMinutes) {
						r.fail(`booking.durations[${i}]`, `must be from minMinutes to maxMinutes (${minMinutes}-${maxMinutes} minutes)`);
					}
					return hours;
				});
	if (durations.length === 0) r.fail('booking.durations', 'needs at least one duration');
	const defaultDuration = r.number(o.defaultDuration, 'booking.defaultDuration', durations.includes(2) ? 2 : (durations[0] ?? 1), { min: 0.01 });
	if (durations.length > 0 && !durations.includes(defaultDuration)) r.fail('booking.defaultDuration', 'must be one of booking.durations');

	const arrivalStepMinutes = r.number(o.arrivalStepMinutes, 'booking.arrivalStepMinutes', 15, { min: 1, integer: true });
	if (!divides(arrivalStepMinutes, 24 * 60)) r.fail('booking.arrivalStepMinutes', 'must divide a day evenly (e.g. 5, 15, 30, 60)');
	const startGridMinutes = r.number(o.startGridMinutes, 'booking.startGridMinutes', 60, { min: 1, integer: true });
	if (!divides(startGridMinutes, 24 * 60)) r.fail('booking.startGridMinutes', 'must divide a day evenly (e.g. 15, 30, 60)');

	const excludedPcs = (o.excludedPcs === undefined ? [] : (r.array(o.excludedPcs, 'booking.excludedPcs') ?? []))
		.map((v, i) =>
			typeof v === 'string' || typeof v === 'number'
				? String(v).trim().toLowerCase()
				: r.fail(`booking.excludedPcs[${i}]`, 'must be a PC name or ID')
		)
		.filter((v): v is string => !!v);

	return {
		minMinutes,
		maxMinutes,
		durations,
		defaultDuration,
		arrivalStepMinutes,
		startGridMinutes,
		leadMinutes: r.number(o.leadMinutes, 'booking.leadMinutes', 0, { integer: true }),
		maxStationsPerBooking: r.number(o.maxStationsPerBooking, 'booking.maxStationsPerBooking', 50, { min: 1, integer: true }),
		maxUpcomingBookings: r.number(o.maxUpcomingBookings, 'booking.maxUpcomingBookings', 10, { min: 1, integer: true }),
		excludedPcs
	};
}

function readPayments(r: Reader, value: unknown): PaymentsConfig {
	const o = r.object(value, 'payments', [
		'topupAmounts',
		'topupMin',
		'topupMax',
		'holdMinutes',
		'maxOpenHolds',
		'maxUnpaidHoldsPerHour',
		'topupsPerHour'
	]) ?? {};
	const topupMin = r.number(o.topupMin, 'payments.topupMin', 5, { min: 0.01 });
	const topupMax = r.number(o.topupMax, 'payments.topupMax', 200, { min: 0.01 });
	if (topupMax < topupMin) r.fail('payments.topupMax', 'must not be less than topupMin');
	const topupAmounts = (o.topupAmounts === undefined ? [10, 20, 50] : (r.array(o.topupAmounts, 'payments.topupAmounts') ?? [])).map((a, i) => {
		const amount = r.number(a, `payments.topupAmounts[${i}]`, topupMin, { min: 0.01 });
		if (amount < topupMin || amount > topupMax) r.fail(`payments.topupAmounts[${i}]`, 'must be from topupMin to topupMax');
		return amount;
	});
	return {
		topupAmounts,
		topupMin,
		topupMax,
		holdMinutes: r.number(o.holdMinutes, 'payments.holdMinutes', 15, { min: 1, integer: true }),
		maxOpenHolds: r.number(o.maxOpenHolds, 'payments.maxOpenHolds', 2, { min: 1, integer: true }),
		maxUnpaidHoldsPerHour: r.number(o.maxUnpaidHoldsPerHour, 'payments.maxUnpaidHoldsPerHour', 4, { min: 1, integer: true }),
		topupsPerHour: r.number(o.topupsPerHour, 'payments.topupsPerHour', 10, { min: 1, integer: true })
	};
}

/** Parse and check a center's config.jsonc. Throws ConfigError listing every problem found. */
export function parseCenterConfig(text: string, file = 'config.jsonc'): CenterConfig {
	let raw: unknown;
	try {
		raw = parseJsonc(text);
	} catch (err) {
		throw new ConfigError(file, [`not valid JSON: ${(err as Error).message}`]);
	}

	const r = new Reader();
	const root = r.object(raw, '(top level)', ['center', 'booking', 'pricing', 'payments', 'signup']) ?? {};
	const c = r.object(root.center, 'center', ['name', 'timezone', 'currency', 'defaultLanguage', 'theme']) ?? {};

	const timezone = c.timezone === undefined || c.timezone === null ? null : r.string(c.timezone, 'center.timezone', '');
	if (timezone) {
		try {
			new Intl.DateTimeFormat('en', { timeZone: timezone });
		} catch {
			r.fail('center.timezone', `"${timezone}" is not a known time zone; use an IANA name such as "Europe/Berlin"`);
		}
	}
	const currency = r.string(c.currency, 'center.currency', 'EUR').toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) r.fail('center.currency', 'must be a three-letter ISO code such as EUR or DKK');

	const s = r.object(root.signup, 'signup', ['enabled', 'minAge']) ?? {};

	const config: CenterConfig = {
		center: {
			name: r.string(c.name, 'center.name', 'Smartlaunch'),
			timezone: timezone || null,
			currency,
			defaultLanguage: r.string(c.defaultLanguage, 'center.defaultLanguage', 'en').toLowerCase(),
			theme: r.string(c.theme, 'center.theme', 'default')
		},
		booking: readBooking(r, root.booking),
		pricing: readPricing(r, root.pricing, currency),
		payments: readPayments(r, root.payments),
		signup: {
			enabled: r.boolean(s.enabled, 'signup.enabled', true),
			minAge: r.number(s.minAge, 'signup.minAge', 5, { integer: true, max: 100 })
		}
	};

	if (r.problems.length > 0) throw new ConfigError(file, r.problems);
	return config;
}
