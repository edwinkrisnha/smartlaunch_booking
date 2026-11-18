// Center config checks. Every centers/*/config.jsonc must load, so a broken config
// fails `npm test` instead of a deployment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ConfigError, parseCenterConfig, parseJsonc } from '../src/lib/config.ts';
import { planForGroup, quoteStations, zoneOf } from '../src/lib/pricing.ts';

const centersDir = new URL('../centers/', import.meta.url);

for (const name of readdirSync(centersDir)) {
	test(`centers/${name}/config.jsonc is valid`, () => {
		const file = `centers/${name}/config.jsonc`;
		parseCenterConfig(readFileSync(new URL(`${name}/config.jsonc`, centersDir), 'utf8'), file);
	});
}

test('the commented pricing example in centers/default is valid', () => {
	const text = readFileSync(new URL('default/config.jsonc', centersDir), 'utf8');
	const example = /\/\*\s*Example:[^\n]*\n([\s\S]*?)\*\//.exec(text)?.[1];
	assert.ok(example, 'example block not found');
	const pricing = parseCenterConfig(`{ ${example.trim().replace(/,\s*$/, '')} }`, 'centers/default example').pricing!;
	assert.deepEqual(
		pricing.plans.map((p) => p.id),
		['standard', 'member']
	);
	assert.deepEqual(
		pricing.zones.map((z) => z.id),
		['vip', 'console']
	);
});

/** The problems parseCenterConfig reports for `config`. */
function problems(config: unknown): string[] {
	try {
		parseCenterConfig(JSON.stringify(config));
		return [];
	} catch (err) {
		assert.ok(err instanceof ConfigError);
		return err.problems;
	}
}

test('an empty config gets every default', () => {
	const c = parseCenterConfig('{}');
	assert.equal(c.center.name, 'Smartlaunch');
	assert.equal(c.center.timezone, null);
	assert.equal(c.center.currency, 'EUR');
	assert.equal(c.pricing, null);
	assert.deepEqual(c.booking.durations, [1, 2, 3, 4, 5, 6, 8, 10, 12]);
	assert.equal(c.booking.defaultDuration, 2);
	assert.equal(c.booking.minMinutes, 30);
	assert.equal(c.booking.maxMinutes, 1440);
	assert.equal(c.payments.holdMinutes, 15);
	assert.equal(c.signup.enabled, true);
});

test('JSONC: comments and trailing commas, strings untouched', () => {
	assert.deepEqual(parseJsonc('{ // note\n "a": "http://x/*y*/", /* block */ "b": [1, 2,], }'), { a: 'http://x/*y*/', b: [1, 2] });
	assert.deepEqual(parseJsonc('{ "a": "quote \\" // not a comment" }'), { a: 'quote " // not a comment' });
});

test('typos and bad values are reported with their path', () => {
	assert.deepEqual(problems({ booking: { maxMinute: 60 } }), [
		'booking.maxMinute: unknown setting (expected one of: minMinutes, maxMinutes, durations, defaultDuration, arrivalStepMinutes, startGridMinutes, leadMinutes, maxStationsPerBooking, maxUpcomingBookings, excludedPcs)'
	]);
	assert.match(problems({ center: { timezone: 'Mars/Olympus' } })[0], /^center\.timezone: /);
	assert.match(problems({ center: { currency: 'euro' } })[0], /^center\.currency: /);
	assert.match(problems({ booking: { durations: [1, 2], defaultDuration: 3 } })[0], /^booking\.defaultDuration: /);
	assert.match(problems({ booking: { durations: [48] } })[0], /^booking\.durations\[0\]: must be from minMinutes/);
	assert.match(problems({ booking: { startGridMinutes: 7 } })[0], /^booking\.startGridMinutes: /);
	assert.match(problems({ payments: { topupAmounts: [500] } })[0], /^payments\.topupAmounts\[0\]: /);
});

test('price rules are checked', () => {
	const plan = (extra: object) => ({ pricing: { plans: [{ id: 'std', rate: 5, ...extra }] } });
	assert.match(problems(plan({ rates: [{ period: 'peak', rate: 6 }] }))[0], /rates\[0\]\.period: unknown period/);
	assert.match(problems(plan({ rate: 2.555 }))[0], /\.rate: can have at most two decimals/);
	assert.match(problems(plan({ rates: [{ days: ['mon'], from: '22:00', to: '02:00', rate: 6 }] }))[0], /split a window that runs past midnight/);
	assert.match(problems(plan({ rates: [{ days: ['moon'], from: '10:00', to: '12:00', rate: 6 }] }))[0], /days\[0\]: must be a day/);
	assert.match(problems({ pricing: { plans: [] } })[0], /pricing\.plans: needs at least one plan/);
	assert.match(problems({ pricing: { plans: [{ id: 'a', rate: 1 }], guestPlan: 'b' } })[0], /pricing\.guestPlan: must be one of/);
	assert.match(
		problems({ pricing: { plans: [{ id: 'a', rate: 1, groups: ['VIP'] }, { id: 'b', rate: 1, groups: ['vip'] }] } })[0],
		/group "vip" already gives plan "a"/
	);
});

test('a custom price list prices from its config', () => {
	const c = parseCenterConfig(`{
		"center": { "currency": "DKK" },
		"pricing": {
			"version": "2026-1",
			"periods": { "evening": [{ "days": ["mon-fri"], "from": "18:00", "to": "24:00" }] },
			"plans": [
				{ "id": "standard", "name": "Standard", "rate": 40, "rates": [{ "period": "evening", "rate": 50 }] },
				{ "id": "member", "name": "Member", "groups": ["Members"], "rate": 25 }
			]
		}
	}`);
	const pricing = c.pricing!;
	assert.equal(pricing.currency, 'DKK');
	assert.equal(pricing.defaultPlan, 'standard');
	assert.equal(planForGroup(pricing, ' members '), 'member');
	assert.equal(planForGroup(pricing, 'Standard'), 'standard');
	assert.equal(planForGroup(pricing, 'Guests'), 'standard');

	// Monday 2 November 2026, 17:00-19:00: one hour at 40, one at 50.
	const monday17 = Date.UTC(2026, 10, 2, 17) / 1000;
	assert.equal(quoteStations(pricing, 'standard', monday17, monday17 + 2 * 3600, 1).total, 9000);
	// No guest plan: both stations at the member rate.
	const two = quoteStations(pricing, 'member', monday17, monday17 + 3600, 2);
	assert.deepEqual(
		two.lines.map((l) => [l.plan, l.stations, l.each]),
		[['member', 2, 2500]]
	);
	assert.equal(two.guestPlanName, null);
});

test('zones: PCs priced by group or name', () => {
	const pricing = parseCenterConfig(`{
		"pricing": {
			"zones": [
				{ "id": "vip", "name": "VIP", "groups": ["VIP Room"], "pcs": ["PC31"] },
				{ "id": "console", "name": "Console", "pcs": ["40"] }
			],
			"plans": [
				{ "id": "rookie", "name": "Rookie", "rate": 5, "zones": { "vip": { "rate": 8 }, "console": { "rate": 4 } } },
				{ "id": "pro", "name": "Pro", "rate": 3, "zones": { "vip": { "rate": 4 } } }
			],
			"guestPlan": "rookie"
		}
	}`).pricing!;

	const pc = (id: string, name: string, groupName: string) => zoneOf(pricing, { id, name, groupName })?.id ?? null;
	assert.equal(pc('1', 'PC01', 'Standard'), null);
	assert.equal(pc('2', 'PC02', 'vip room'), 'vip'); // by group, any case
	assert.equal(pc('31', 'PC31', 'Standard'), 'vip'); // by name
	assert.equal(pc('40', 'PS5', ''), 'console'); // by ID

	const monday = Date.UTC(2026, 10, 2, 12) / 1000;
	const hour = (stations: (string | null)[], plan = 'rookie') => quoteStations(pricing, plan, monday, monday + 3600, stations);

	// Zone rates; a plan without its own rate for a zone uses its normal rate (pro console = 3).
	assert.equal(hour(['vip']).total, 800);
	assert.equal(hour(['console']).total, 400);
	assert.equal(hour(['console'], 'pro').total, 300);

	// A Pro member with a normal PC and a VIP PC: their plan goes on the VIP PC (saves 4, not 2),
	// the friend pays Rookie on the normal PC.
	const q = hour([null, 'vip'], 'pro');
	assert.deepEqual(
		q.lines.map((l) => [l.plan, l.zoneName, l.stations, l.each]),
		[
			['pro', 'VIP', 1, 400],
			['rookie', null, 1, 500]
		]
	);
	assert.equal(q.total, 900);
	assert.equal(q.guestPlanName, 'Rookie');

	// Same plan, two zones: one line per zone.
	assert.deepEqual(
		hour([null, 'vip', null]).lines.map((l) => [l.zone, l.stations]),
		[
			[null, 2],
			['vip', 1]
		]
	);
});

test('ids, rates and room sizes are required', () => {
	assert.deepEqual(problems({ pricing: { plans: [{ rate: 1 }] } }), ['pricing.plans[0].id: is required']);
	assert.deepEqual(problems({ pricing: { plans: [{ id: 'a' }] } }), ['pricing.plans[0].rate: must be an amount of 0 or more, e.g. 2.5']);
	assert.deepEqual(problems({ pricing: { zones: [{ pcs: ['1'] }], plans: [{ id: 'a', rate: 1 }] } }), ['pricing.zones[0].id: is required']);
	assert.deepEqual(problems({ pricing: { plans: [{ id: 'a', rate: 1 }], rooms: [{ id: 'r', rate: 1 }] } }), [
		'pricing.rooms[0].hours: needs at least one duration',
		'pricing.rooms[0].capacity: is required'
	]);
});

test('zone mistakes are reported', () => {
	assert.match(problems({ pricing: { zones: [{ id: 'vip' }], plans: [{ id: 'a', rate: 1 }] } })[0], /zones\[0\]: needs "groups" or "pcs"/);
	assert.match(
		problems({ pricing: { zones: [{ id: 'vip', pcs: ['1'] }], plans: [{ id: 'a', rate: 1, zones: { vpi: { rate: 2 } } }] } })[0],
		/plans\[0\]\.zones\.vpi: unknown setting/
	);
});
