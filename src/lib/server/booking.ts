import { CENTER_TIMEZONE } from '$app/env/private';
import { formatLocal, nowInZone, parseLocal, toCompact } from '#lib/time.js';
import type { Booking, BookingRequest, Layout, Pc, Seat, SessionUser } from '#lib/types.js';
import * as sl from './smartlaunch';
import { SmartlaunchError } from './smartlaunch';

export const MIN_MINUTES = 30;
export const MAX_MINUTES = 24 * 60;
const MAX_PCS_PER_BOOKING = 50;

/**
 * The server builds the INSERT for /bookings by string concatenation
 * (APIParser.BookingAdd), so every string field we send must have its quotes
 * doubled, the same way the MVC web client does it.
 */
function sqlText(value: string, maxLength: number): string {
	return value.replace(/[\u0000-\u001f]/g, ' ').slice(0, maxLength).replace(/'/g, "''");
}

export async function login(username: string, password: string): Promise<SessionUser | null> {
	username = username.trim();
	if (!username || !password) return null;
	if (!(await sl.checkPassword(username, password))) return null;

	const user = await sl.getUser(username);
	if (!user || user.Deleted) return null;

	const fullName = [user.FirstName, user.LastName].filter(Boolean).join(' ').trim();
	return {
		username: user.Username || username,
		displayName: fullName || user.Username || username,
		phone: user.MobilePhone || user.Telephone || ''
	};
}

export async function listLayouts(): Promise<Layout[]> {
	const groups = await sl.getLayoutGroups();
	return groups.map((g) => ({ id: String(g.LayoutGroupID), name: g.Name }));
}

/** Only the fields a customer needs; the raw contract also exposes who is logged in where. */
export async function listPcs(): Promise<Pc[]> {
	const computers = await sl.getComputers();
	return computers.map((c) => ({
		id: String(c.ComputerID),
		name: c.Name,
		groupId: String(c.ComputerGroupID),
		console: c.ConsoleType && c.ConsoleType !== 'Disabled' ? c.ConsoleType : null
	}));
}

/**
 * Layout positions of the given PCs. `/computerlayoutpositions` returns every
 * row of the ComputerLayoutPositions table, including leftovers for computer
 * IDs beyond the licensed client count (unlike `/computerpositions/{id}`, which
 * filters on NumberOfClient), so keep only PCs that `/computers` knows about.
 */
export async function listSeats(pcs: Pc[] | Promise<Pc[]> = listPcs()): Promise<Seat[]> {
	const [positions, known] = await Promise.all([sl.getComputerLayoutPositions(), pcs]);
	const ids = new Set(known.map((pc) => pc.id));
	return positions
		.filter((p) => ids.has(String(p.ComputerID)))
		.map((p) => ({
			layoutId: String(p.LayoutGroupID),
			computerId: String(p.ComputerID),
			x: p.PosX,
			y: p.PosY
		}));
}

export class BookingError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

function timeWindow(start: string, minutes: number): { from: number; to: number } {
	const from = parseLocal(start);
	if (from === null) throw new BookingError('Start must be a valid date and time (YYYY-MM-DDTHH:mm).');
	if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
		throw new BookingError(`Duration must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
	}
	return { from, to: from + minutes * 60 };
}

export async function getUnavailable(start: string, minutes: number): Promise<string[]> {
	const { from, to } = timeWindow(start, minutes);
	return sl.getBookedComputerIds(toCompact(from), toCompact(to));
}

/** Raw `startdate`/`enddate` passthrough for the REST-shaped endpoint. */
export async function getUnavailableRaw(startdate: string, enddate: string): Promise<string[]> {
	if (!/^\d{12}$/.test(startdate) || !/^\d{12}$/.test(enddate)) {
		throw new BookingError('startdate and enddate must be in yyyyMMddHHmm format.');
	}
	if (enddate < startdate) throw new BookingError('enddate must not be before startdate.');
	return sl.getBookedComputerIds(startdate, enddate);
}

/** Upcoming bookings, grouped back into one entry per booking (the API returns one row per PC). */
export async function listBookings(filterUsername?: string): Promise<Booking[]> {
	const rows = await sl.getBookings();
	const wanted = filterUsername?.toLowerCase();
	const byId = new Map<string, Booking>();

	for (const row of rows) {
		if (wanted !== undefined && row.CustomerName?.toLowerCase() !== wanted) continue;
		const existing = byId.get(row.BookingId);
		if (existing) {
			existing.computerIds.push(...row.Computers.split(';').filter(Boolean));
			continue;
		}
		byId.set(row.BookingId, {
			bookingId: row.BookingId,
			start: formatLocal(row.StartDate),
			end: formatLocal(row.EndDate),
			computerIds: row.Computers.split(';').filter(Boolean),
			customerName: row.CustomerName
		});
	}

	return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export function parseBookingRequest(input: unknown): BookingRequest {
	const body = (input ?? {}) as Record<string, unknown>;
	const computerIds = Array.isArray(body.computerIds) ? body.computerIds.map(String) : [];
	return {
		start: typeof body.start === 'string' ? body.start : '',
		minutes: Number(body.minutes),
		computerIds,
		orderCode: typeof body.orderCode === 'string' ? body.orderCode : undefined
	};
}

export async function createBooking(user: SessionUser, req: BookingRequest): Promise<{ orderCode: string }> {
	const { from, to } = timeWindow(req.start, req.minutes);

	// Bookings open from the next full hour in the center's time: at 14:20 the earliest start is 15:00.
	if (CENTER_TIMEZONE) {
		const earliest = Math.floor(nowInZone(CENTER_TIMEZONE) / 3600) * 3600 + 3600;
		if (from < earliest) {
			throw new BookingError(`The earliest arrival is ${formatLocal(earliest).slice(11)}. Please pick that time or later.`);
		}
	}

	const ids = [...new Set(req.computerIds.map((id) => id.trim()))];
	if (ids.length === 0) throw new BookingError('Select at least one PC.');
	if (ids.length > MAX_PCS_PER_BOOKING) throw new BookingError(`At most ${MAX_PCS_PER_BOOKING} PCs per booking.`);
	if (!ids.every((id) => /^\d+$/.test(id))) throw new BookingError('Invalid PC selection.');

	// The order code doubles as the server's idempotency key and is interpolated
	// into SQL without escaping, so only accept a strict alphabet.
	const orderCode =
		req.orderCode && /^[A-Z0-9]{8,32}$/.test(req.orderCode)
			? req.orderCode
			: crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();

	const [known, unavailable] = await Promise.all([
		sl.getComputers(),
		sl.getBookedComputerIds(toCompact(from), toCompact(to))
	]);

	const knownIds = new Set(known.map((c) => String(c.ComputerID)));
	if (!ids.every((id) => knownIds.has(id))) throw new BookingError('One of the selected PCs does not exist.');

	// APIParser.BookingAdd only rejects a PC whose existing booking covers our
	// *start* time, so check the full window here first, like the MVC client does.
	const taken = ids.filter((id) => unavailable.includes(id));
	if (taken.length > 0) {
		throw new BookingError(`Not available for that time: PC ${taken.join(', ')}.`, 409);
	}

	const hours = req.minutes / 60;
	const ok = await sl.addBooking({
		Description: sqlText(
			`Online booking by ${user.username}: ${ids.length} PC(s) for ${Number.isInteger(hours) ? hours + ' h' : req.minutes + ' min'}. Order ${orderCode}.`,
			250
		),
		StartDate: from,
		EndDate: to,
		Computers: ids.join(';'),
		CustomerName: sqlText(user.username, 100),
		CustomerPhone: sqlText(user.phone, 50),
		Smoking: false,
		OrderCode: orderCode
	});

	if (!ok) throw new BookingError('Someone just booked one of those PCs. Please pick again.', 409);
	return { orderCode };
}

/** Map any error to a status and a message that is safe to show a customer. */
export function toHttpError(err: unknown): { status: number; message: string } {
	if (err instanceof BookingError || err instanceof SmartlaunchError) {
		return { status: err.status, message: err.message };
	}
	console.error(err);
	return { status: 500, message: 'Something went wrong. Please try again.' };
}
