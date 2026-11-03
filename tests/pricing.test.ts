// Price engine checks against the R6 acceptance tables (P, E and R cases that are
// pure arithmetic). Run with `npm test`. These prove the rules, not a live booking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteRoom, quoteStations, ROOMS, type Plan, type RoomId } from '../src/lib/pricing.ts';

// A reference week: Monday 2 November 2026 to Sunday 8 November 2026.
const MONDAY = Date.UTC(2026, 10, 2) / 1000;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Wall-clock seconds for e.g. ('Fri', '17:30'); '24:00' is midnight at the end of that day. */
function at(day: string, time: string): number {
	const [h, m] = time.split(':').map(Number);
	return MONDAY + DAYS.indexOf(day) * 86400 + h * 3600 + m * 60;
}

const station = (plan: Plan, day: string, from: string, to: string, endDay = day) =>
	quoteStations(plan, at(day, from), at(endDay, to), 1).total;

const room = (id: RoomId, day: string, from: string, to: string, guests: number, catering: boolean) =>
	quoteRoom(id, at(day, from), at(day, to), guests, catering);

test('reference week starts on a Monday', () => {
	assert.equal(new Date(MONDAY * 1000).getUTCDay(), 1);
});

test('P01-P16 personal prices', () => {
	assert.equal(station('campus', 'Mon', '14:00', '16:00'), 200); // P01
	assert.equal(station('campus', 'Fri', '17:00', '19:00'), 300); // P02
	assert.equal(station('campus', 'Sat', '20:00', '22:00'), 400); // P03
	assert.equal(station('campus', 'Thu', '13:00', '14:00'), 100); // P04
	assert.equal(station('campus', 'Thu', '12:30', '13:30'), 150); // P05
	assert.equal(station('campus', 'Fri', '17:30', '18:30'), 150); // P06
	assert.equal(station('rookie', 'Fri', '17:00', '19:00'), 1000); // P07
	assert.equal(station('rookie', 'Sat', '23:30', '00:30', 'Sun'), 400); // P08
	assert.equal(station('pro', 'Fri', '20:00', '22:00'), 400); // P09
	assert.equal(station('alpha', 'Fri', '20:00', '22:00'), 200); // P10
	assert.equal(station('campus', 'Mon', '13:00', '13:06'), 10); // P11: not 12 from rounding per minute

	// P12: two Rookie stations.
	assert.equal(quoteStations('rookie', at('Fri', '20:00'), at('Fri', '22:00'), 2).total, 2000);
	// P13 / P16: the Alpha member's discount covers their own station; the friend pays Rookie.
	const p13 = quoteStations('alpha', at('Fri', '20:00'), at('Fri', '21:00'), 2);
	assert.equal(p13.total, 600);
	assert.deepEqual(
		p13.lines.map((l) => [l.plan, l.stations, l.each]),
		[
			['alpha', 1, 100],
			['rookie', 1, 500]
		]
	);
	// P14: TEAM private use, not Campus-verified.
	assert.equal(station('team', 'Mon', '14:00', '16:00'), 400);
});

test('no second concurrent discounted session (RATE-03)', () => {
	// Falls back to Rookie: EUR 5 in the Monday peak instead of the Campus EUR 1.
	assert.equal(quoteStations('campus', at('Mon', '17:00'), at('Mon', '18:00'), 1, true).total, 500);
});

test('R01-R16 peak boundaries and member protection', () => {
	assert.equal(station('rookie', 'Mon', '16:30', '17:30'), 450); // R01
	assert.equal(station('rookie', 'Tue', '19:30', '20:30'), 450); // R02
	assert.equal(station('rookie', 'Wed', '17:00', '20:00'), 1500); // R03
	assert.equal(station('rookie', 'Thu', '20:00', '21:00'), 400); // R04
	assert.equal(station('rookie', 'Fri', '16:30', '17:30'), 450); // R05
	assert.equal(station('rookie', 'Fri', '21:30', '22:30'), 450); // R06
	assert.equal(station('rookie', 'Fri', '22:00', '23:00'), 400); // R07
	assert.equal(station('rookie', 'Sat', '14:30', '15:30'), 450); // R08
	assert.equal(station('rookie', 'Sat', '21:30', '22:30'), 450); // R09
	assert.equal(station('rookie', 'Sun', '14:30', '15:30'), 450); // R10
	assert.equal(station('rookie', 'Sun', '21:30', '22:30'), 450); // R11
	assert.equal(station('rookie', 'Sun', '22:00', '23:00'), 400); // R12
	assert.equal(station('campus', 'Mon', '17:00', '18:00'), 100); // R13
	assert.equal(station('rookie', 'Mon', '17:00', '18:00'), 500); // R13
	assert.equal(station('campus', 'Fri', '17:00', '19:00'), 300); // R14
	assert.equal(station('pro', 'Sat', '15:00', '17:00'), 400); // R15
	assert.equal(station('alpha', 'Sat', '15:00', '17:00'), 200); // R15
	assert.equal(station('team', 'Sun', '15:00', '17:00'), 400); // R16
});

test('E01 every room and duration at one rate matches section 04', () => {
	const expected: Record<RoomId, number[]> = {
		ROOM_PC10: [80, 120, 160, 200, 240],
		ROOM_PC12: [96, 144, 192, 240, 288],
		ROOM_CZ6: [48, 72, 96, 120, 144],
		ROOM_CON4: [32, 48, 64, 80, 96]
	};
	for (const [id, standard] of Object.entries(expected) as [RoomId, number[]][]) {
		standard.forEach((eur, i) => {
			const hours = i + 2;
			// Mon from 08:00 stays before the 17:00 peak for up to 6 h; Sat 15:00-21:00 is all peak.
			assert.equal(quoteRoom(id, at('Mon', '08:00'), at('Mon', '08:00') + hours * 3600, 1, false).roomFee, eur * 100);
			assert.equal(quoteRoom(id, at('Sat', '15:00'), at('Sat', '15:00') + hours * 3600, 1, false).roomFee, eur * 125);
		});
	}
});

test('E02 room durations other than 2-6 whole hours are rejected', () => {
	for (const minutes of [60, 119, 150, 420]) {
		assert.throws(() => quoteRoom('ROOM_PC10', at('Mon', '12:00'), at('Mon', '12:00') + minutes * 60, 2, false));
	}
});

test('E03-E17 rooms and catering', () => {
	assert.equal(room('ROOM_PC12', 'Mon', '12:00', '14:00', 2, false).total, 9600); // E03
	assert.equal(room('ROOM_PC12', 'Mon', '12:00', '14:00', 2, true).total, 11600); // E04
	assert.equal(room('ROOM_PC12', 'Mon', '12:00', '14:00', 12, true).total, 21600); // E05
	assert.equal(room('ROOM_PC10', 'Mon', '12:00', '15:00', 6, true).total, 18000); // E06
	assert.equal(room('ROOM_PC10', 'Fri', '17:00', '20:00', 10, true).total, 25000); // E07
	assert.equal(room('ROOM_PC12', 'Sat', '15:00', '18:00', 12, true).total, 30000); // E08
	assert.equal(room('ROOM_CZ6', 'Mon', '12:00', '15:00', 6, true).total, 13200); // E09 normal
	assert.equal(room('ROOM_CZ6', 'Sat', '15:00', '18:00', 6, true).total, 15000); // E09 peak
	assert.equal(room('ROOM_CON4', 'Mon', '12:00', '15:00', 4, true).total, 8800); // E10 normal
	assert.equal(room('ROOM_CON4', 'Sat', '15:00', '18:00', 4, true).total, 10000); // E10 peak
	assert.equal(room('ROOM_PC10', 'Mon', '12:00', '16:00', 10, true).total, 26000); // E11
	assert.equal(room('ROOM_PC10', 'Sat', '18:00', '24:00', 10, true).total, 38000); // E12
	assert.equal(room('ROOM_CZ6', 'Sat', '18:00', '24:00', 6, true).total, 22800); // E13
	for (let h = 2; h <= 6; h++) {
		// E14: catering stays EUR 10 per guest whatever the duration.
		assert.equal(quoteRoom('ROOM_PC10', at('Mon', '12:00'), at('Mon', '12:00') + h * 3600, 5, true).catering, 5000);
	}
	assert.throws(() => room('ROOM_PC10', 'Fri', '17:30', '19:30', 11, false)); // E17: over capacity
	assert.throws(() => room('ROOM_PC10', 'Fri', '17:30', '19:30', 0, false)); // E17
	assert.throws(() => room('ROOM_PC10', 'Fri', '17:30', '19:30', 2.5, false)); // E17
	assert.equal(room('ROOM_PC10', 'Fri', '17:30', '19:30', 4, false).total, 10000); // E17 valid
	assert.equal(room('ROOM_CZ6', 'Thu', '13:00', '16:00', 4, true).total, 11200); // EVT-02
});

test('R17-R22 room regressions', () => {
	const r17 = room('ROOM_CZ6', 'Thu', '13:00', '16:00', 4, true);
	assert.equal(r17.roomFee, 7200); // R17
	assert.equal(r17.total, 11200);
	const r18 = room('ROOM_CZ6', 'Sat', '14:00', '17:00', 4, true);
	assert.equal(r18.roomFee, 8400); // R18
	assert.equal(r18.total, 12400);
	assert.equal(room('ROOM_PC10', 'Fri', '16:00', '19:00', 10, true).total, 24000); // R19
	assert.equal(room('ROOM_PC12', 'Sun', '14:00', '17:00', 12, true).total, 28800); // R20
	assert.equal(room('ROOM_CON4', 'Thu', '19:00', '21:00', 4, true).total, 7600); // R21
	assert.equal(room('ROOM_PC10', 'Thu', '17:00', '20:00', 10, false).roomFee, 15000); // R22: buffer not charged
});

test('room capacities', () => {
	assert.deepEqual(
		Object.values(ROOMS).map((r) => r.capacity),
		[10, 12, 6, 4]
	);
});
