// Thin client for the Smartlaunch server REST API
// (sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb).
// Runs only on the server: the API is protected by a shared Basic-auth
// credential that must never reach the browser.

import { SL_API_URL, SL_API_USERNAME, SL_API_PASSWORD, SL_LICENSE_EMAIL } from '$app/env/private';
import { LocalizedError, type MessageKey } from '#lib/i18n/index.js';

export class SmartlaunchError extends LocalizedError {
	constructor(key: MessageKey, status = 502) {
		super(key, status);
	}
}

// Raw data contracts, as serialized by WCF.
export interface RawUser {
	UserID: string;
	Username: string;
	UserGroupID: number;
	FirstName: string;
	LastName: string;
	Telephone: string;
	MobilePhone: string;
	Email: string;
	Deleted: boolean;
	Balance: number;
}

export interface RawUserCreate {
	UserName: string;
	/** Empty picks the "members" group (or the first group). */
	UsergroupName: string;
	Password: string;
	Avatar: string;
	FirstName: string;
	LastName: string;
	/** Wall-clock unix seconds, like booking times. */
	Birthday: number;
	Address: string;
	City: string;
	Zip: string;
	State: string;
	Country: string;
	Email: string;
	Telephone: string;
	MobilePhone: string;
	/** 0 = female, 1 = male; the API has no "unspecified". */
	Sex: number;
	PersonalNumber: string;
	Source: string;
}

export interface RawUserGroup {
	UserGroupID: string;
	UserGroupName: string;
}

export interface RawComputer {
	ComputerID: string;
	ComputerGroupID: string;
	Name: string;
	/**
	 * Lists.Consoles.Types name: "Disabled", "Dual" or "Laptop" for a PC, otherwise "Playstation",
	 * "XBox", "Nintendo", ... Older servers send the type number as one control character instead.
	 */
	ConsoleType: string;
}

export interface RawComputerGroup {
	ComputerGroupID: string;
	Name: string;
}

export interface RawLayoutGroup {
	LayoutGroupID: string;
	Name: string;
}

export interface RawComputerLayoutPosition {
	LayoutGroupID: string;
	ComputerID: string;
	PosX: number;
	PosY: number;
}

export interface RawBooking {
	BookingId: string;
	Description: string;
	StartDate: number;
	EndDate: number;
	Computers: string;
	CustomerName: string;
	CustomerPhone: string;
	Smoking: boolean;
	OrderCode: string;
	/**
	 * Payment state, which the admin program shows as Paid YES/NO: BOOKING_UNPAID or
	 * BOOKING_PAID_ONLINE. Left out, the server books it as paid (8) and an update keeps
	 * the current state. Servers from before this field ignore it.
	 */
	Paid?: number;
}

/** Smartlaunch Paymode "Later": not paid yet (an unpaid hold, or paid at the venue). */
export const BOOKING_UNPAID = 0;
/** Smartlaunch Paymode "WebInterface": paid online. */
export const BOOKING_PAID_ONLINE = 8;

/** Answer of POST /bookings/create and PUT /bookings/{id} (BookingStore on the server). */
export interface RawBookingResult {
	Success: boolean;
	BookingId: string;
	/** Computers taken by another booking or its turnover buffer, separated by ";". */
	ConflictingComputers: string;
	NotFound: boolean;
}

export type BookingFields = Omit<RawBooking, 'BookingId' | 'OrderCode'>;

const TIMEOUT_MS = 15_000;

function authHeader(): string {
	const bytes = new TextEncoder().encode(`${SL_API_USERNAME ?? ''}:${SL_API_PASSWORD ?? ''}`);
	return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

function buildUrl(path: string, query: Record<string, string> = {}): string {
	if (!SL_API_URL) {
		console.error('SL_API_URL is not configured');
		throw new SmartlaunchError('error.notConfigured', 500);
	}
	const url = new URL(SL_API_URL + path);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
	if (SL_LICENSE_EMAIL) url.searchParams.set('licenseemail', SL_LICENSE_EMAIL);
	return url.toString();
}

async function request<T>(
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	path: string,
	{ query, body, notFoundAsNull }: { query?: Record<string, string>; body?: unknown; notFoundAsNull?: boolean } = {}
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(buildUrl(path, query), {
			method,
			headers: {
				Authorization: authHeader(),
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		if (err instanceof SmartlaunchError) throw err;
		console.error(`Smartlaunch ${method} ${path} failed`, err);
		throw new SmartlaunchError('error.unreachable');
	}

	const text = await res.text();

	if (res.status === 401 || res.status === 403) {
		// Cloudflare itself answers 403 "error code: 1003" when a Worker fetches a bare IP address.
		const reason = /error code:\s*1003/i.test(text)
			? 'SL_API_URL is an IP address, which Cloudflare blocks (error 1003). Use a hostname, e.g. a Cloudflare Tunnel.'
			: `API credentials rejected (${res.status}); check SL_API_USERNAME / SL_API_PASSWORD.`;
		console.error(`Smartlaunch ${method} ${path}: ${reason}`);
		throw new SmartlaunchError('error.misconfigured');
	}

	if (res.status === 404 && notFoundAsNull) return null as T;
	if (!res.ok) {
		console.error(`Smartlaunch ${method} ${path}: HTTP ${res.status}`, text.slice(0, 500));
		throw new SmartlaunchError('error.serverError');
	}

	try {
		return (text ? JSON.parse(text) : null) as T;
	} catch {
		console.error(`Smartlaunch ${method} ${path}: non-JSON response`, text.slice(0, 500));
		throw new SmartlaunchError('error.unexpected');
	}
}

const seg = encodeURIComponent;

/** GET /users/{username}/check?password= — verifies a customer's password. */
export async function checkPassword(username: string, password: string): Promise<boolean> {
	return (await request<boolean>('GET', `/users/${seg(username)}/check`, { query: { password } })) === true;
}

/** GET /users/{username} — null when no such user (the server answers 404). */
export async function getUser(username: string): Promise<RawUser | null> {
	return request<RawUser | null>('GET', `/users/${seg(username)}`, { notFoundAsNull: true });
}

/**
 * POST /users/create (UserCreateFull). True when the account was created; false
 * when the username is taken or rejected by the server's profanity filter.
 * The server writes the profile fields into SQL unescaped, so callers must
 * pass them through the same quoting as bookings.
 */
export async function createUser(uc: RawUserCreate): Promise<boolean> {
	return (await request<boolean>('POST', '/users/create', { body: { uc } })) === true;
}

/**
 * POST /users/{username}/addmoney (APIParser.UserAddMoney). True when the money was
 * added, or when this OrderCode was added before: the server records used codes and
 * skips repeats, so retrying a delivery never credits twice. False when the user
 * doesn't exist or the deposit failed. The server writes the code into SQL unescaped.
 */
export async function addMoney(username: string, amount: number, orderCode: string): Promise<boolean> {
	if (!/^[A-Z0-9]+$/.test(orderCode)) throw new Error('addMoney: order code must be letters and digits');
	const body = { uam: { Amount: amount, OrderCode: orderCode } };
	return (await request<boolean>('POST', `/users/${seg(username)}/addmoney`, { body })) === true;
}

/** GET /usergroups */
export async function getUserGroups(): Promise<RawUserGroup[]> {
	return (await request<RawUserGroup[] | null>('GET', '/usergroups')) ?? [];
}

/** GET /computergroups */
export async function getComputerGroups(): Promise<RawComputerGroup[]> {
	return (await request<RawComputerGroup[] | null>('GET', '/computergroups')) ?? [];
}

/** GET /layoutgroups */
export async function getLayoutGroups(): Promise<RawLayoutGroup[]> {
	return (await request<RawLayoutGroup[] | null>('GET', '/layoutgroups')) ?? [];
}

/** GET /computerlayoutpositions — positions for every layout group in one call. */
export async function getComputerLayoutPositions(): Promise<RawComputerLayoutPosition[]> {
	return (await request<RawComputerLayoutPosition[] | null>('GET', '/computerlayoutpositions')) ?? [];
}

/** GET /computers */
export async function getComputers(): Promise<RawComputer[]> {
	return (await request<RawComputer[] | null>('GET', '/computers')) ?? [];
}

/**
 * GET /booking/getbooked?startdate=&enddate= (both `yyyyMMddHHmm`).
 * Returns IDs of PCs that are booked in the window, plus PCs that are reserved,
 * out of order, or (when the window starts today) currently in use.
 */
export async function getBookedComputerIds(startdate: string, enddate: string): Promise<string[]> {
	const raw = await request<string | null>('GET', '/booking/getbooked', { query: { startdate, enddate } });
	return (raw ?? '')
		.split(';')
		.map((id) => id.trim())
		.filter(Boolean);
}

/** GET /bookings — every booking that starts in the future, one row per PC. */
export async function getBookings(): Promise<RawBooking[]> {
	return (await request<RawBooking[] | null>('GET', '/bookings')) ?? [];
}

/**
 * POST /bookings. The server answers the string "True" or "False"; "False"
 * means one of the PCs already has a booking covering the start time.
 */
export async function addBooking(booking: Omit<RawBooking, 'BookingId'>): Promise<boolean> {
	const result = await request<string>('POST', '/bookings', { body: { BookingAdd: booking } });
	return String(result).toLowerCase() === 'true';
}

/**
 * POST /bookings/create. Unlike POST /bookings it returns the new BookingID, or
 * which computers are taken. A repeated OrderCode returns the first booking.
 * Text fields must already be SQL-escaped. Needs a server with BookingStore.
 */
export async function createBookingWithId(booking: BookingFields, orderCode: string): Promise<RawBookingResult> {
	return request<RawBookingResult>('POST', '/bookings/create', { body: { BookingAdd: { ...booking, OrderCode: orderCode } } });
}

/** PUT /bookings/{id}: replaces the booking in one step; the original stays if the change clashes. */
export async function updateBooking(bookingId: string, booking: BookingFields): Promise<RawBookingResult> {
	return request<RawBookingResult>('PUT', `/bookings/${seg(bookingId)}`, { body: { BookingAdd: { ...booking, OrderCode: '' } } });
}

/** DELETE /bookings/{id}. False when there is no such booking (already cancelled). */
export async function deleteBooking(bookingId: string): Promise<boolean> {
	return (await request<boolean>('DELETE', `/bookings/${seg(bookingId)}`)) === true;
}
