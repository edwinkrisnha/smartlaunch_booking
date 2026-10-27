// Thin client for the Smartlaunch server REST API
// (sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb).
// Runs only on the server: the API is protected by a shared Basic-auth
// credential that must never reach the browser.

import { SL_API_URL, SL_API_USERNAME, SL_API_PASSWORD, SL_LICENSE_EMAIL } from '$app/env/private';

export class SmartlaunchError extends Error {
	constructor(
		message: string,
		readonly status = 502
	) {
		super(message);
	}
}

// Raw data contracts, as serialized by WCF.
export interface RawUser {
	UserID: string;
	Username: string;
	FirstName: string;
	LastName: string;
	Telephone: string;
	MobilePhone: string;
	Email: string;
	Deleted: boolean;
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

export interface RawComputer {
	ComputerID: string;
	ComputerGroupID: string;
	Name: string;
	/** Lists.Consoles.Types name: "Disabled" for a PC, otherwise "Playstation", "XBox", "Nintendo", ... */
	ConsoleType: string;
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
}

const TIMEOUT_MS = 15_000;

function authHeader(): string {
	const bytes = new TextEncoder().encode(`${SL_API_USERNAME ?? ''}:${SL_API_PASSWORD ?? ''}`);
	return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

function buildUrl(path: string, query: Record<string, string> = {}): string {
	if (!SL_API_URL) throw new SmartlaunchError('SL_API_URL is not configured', 500);
	const url = new URL(SL_API_URL + path);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
	if (SL_LICENSE_EMAIL) url.searchParams.set('licenseemail', SL_LICENSE_EMAIL);
	return url.toString();
}

async function request<T>(
	method: 'GET' | 'POST',
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
		throw new SmartlaunchError('The center server could not be reached. Please try again later.');
	}

	if (res.status === 401 || res.status === 403) {
		console.error(`Smartlaunch ${method} ${path}: API credentials rejected (${res.status})`);
		throw new SmartlaunchError('The booking service is misconfigured. Please contact the center.');
	}

	const text = await res.text();
	if (res.status === 404 && notFoundAsNull) return null as T;
	if (!res.ok) {
		console.error(`Smartlaunch ${method} ${path}: HTTP ${res.status}`, text.slice(0, 500));
		throw new SmartlaunchError('The center server returned an error. Please try again later.');
	}

	try {
		return (text ? JSON.parse(text) : null) as T;
	} catch {
		console.error(`Smartlaunch ${method} ${path}: non-JSON response`, text.slice(0, 500));
		throw new SmartlaunchError('The center server returned an unexpected response.');
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
