import { CENTER_TIMEZONE } from '$app/env/private';
import { LocalizedError, translate, type Locale, type MessageKey, type Params } from '#lib/i18n/index.js';
import { formatLocal, nowInZone, parseLocal, toCompact } from '#lib/time.js';
import { GENDERS, type Booking, type BookingRequest, type Gender, type Layout, type Pc, type Seat, type SessionUser } from '#lib/types.js';
import { quoteStations, type StationQuote } from '#lib/pricing.js';
import { reached, resetLimit, throttle } from './limits';
import { planOf, pricingEnabled } from './pricing';
import * as sl from './smartlaunch';
import { verifyTurnstile } from './turnstile';

export const MIN_MINUTES = 30;
export const MAX_MINUTES = 24 * 60;
const MAX_PCS_PER_BOOKING = 50;
/** Upcoming bookings one customer may have at once, held or paid. */
export const MAX_UPCOMING_BOOKINGS = 10;

/** Failed logins per username, and attempts per IP address, within LOGIN_WINDOW. */
const LOGIN_FAILURES_PER_USER = 10;
const LOGIN_ATTEMPTS_PER_IP = 30;
const LOGIN_WINDOW = 15 * 60;
/** Accounts created per IP address per hour. */
const SIGNUPS_PER_IP = 5;

/**
 * The server builds the INSERT for /bookings by string concatenation
 * (APIParser.BookingAdd), so every string field we send must have its quotes
 * doubled, the same way the MVC web client does it.
 */
export function sqlText(value: string, maxLength: number): string {
	return value.replace(/[\u0000-\u001f]/g, ' ').slice(0, maxLength).replace(/'/g, "''");
}

export async function login(username: string, password: string): Promise<SessionUser | null> {
	username = username.trim();
	if (!username || !password) return null;
	// The name becomes a URL path segment: "." and ".." would point at other API paths.
	if (username === '.' || username === '..' || username.length > 64 || /[\u0000-\u001f]/.test(username)) return null;
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

/**
 * login() with brute-force protection: at most LOGIN_ATTEMPTS_PER_IP tries per
 * address and LOGIN_FAILURES_PER_USER wrong passwords per username every 15
 * minutes. Throws 429 when either is used up.
 */
export async function attemptLogin(username: string, password: string, ip: string): Promise<SessionUser | null> {
	const userKey = `login-user:${username.trim().toLowerCase()}`;
	await throttle(`login-ip:${ip}`, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW, 'error.tooManyAttempts');
	if (await reached(userKey, LOGIN_FAILURES_PER_USER)) throw new BookingError('error.tooManyAttempts', 429);

	const user = await login(username, password);
	if (user) await resetLimit(userKey);
	else await throttle(userKey, LOGIN_FAILURES_PER_USER, LOGIN_WINDOW, 'error.tooManyAttempts').catch(() => {});
	return user;
}

/** Checks before an account is created: the Turnstile challenge (if set up) and SIGNUPS_PER_IP. */
export async function guardSignup(ip: string, turnstileToken: string): Promise<void> {
	if (!(await verifyTurnstile(turnstileToken, ip))) throw new BookingError('signup.error.captcha', 400);
	await throttle(`signup-ip:${ip}`, SIGNUPS_PER_IP, 60 * 60, 'signup.error.tooMany');
}

export interface SignupInput {
	username: string;
	password: string;
	email: string;
	/** Optional; empty when not given. */
	mobilePhone: string;
	firstName: string;
	lastName: string;
	/** Street and house number; Smartlaunch's Address field. */
	address: string;
	zip: string;
	city: string;
	/** One of GENDERS. */
	gender: string;
	/** `YYYY-MM-DD` */
	birthday: string;
}

/** Field name -> error, for showing messages next to the inputs. */
export type SignupErrors = Partial<Record<keyof SignupInput, BookingError>>;

// The username is also written into SQL unescaped (Users.CreateUser and the
// follow-up UPDATE), so only allow a strict alphabet.
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
// Apostrophes are valid before the @ (o'neil@...); quotes are escaped before they reach the server.
const EMAIL_RE = /^[^\s@"]+@[^\s@"']+\.[^\s@"']+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;
// Covers German (12345), Danish (1234) and most other postcodes.
const ZIP_RE = /^[A-Za-z0-9 -]{3,10}$/;
const MIN_AGE = 5;

/**
 * Smartlaunch keeps gender in Users.InfoSex: 0 = female, 1 = male. It has no
 * value for non-binary, so we store 2; the server saves it as given, but the
 * admin program shows anything other than 1 as female.
 */
const SEX_CODES: Record<Gender, number> = { female: 0, male: 1, nonbinary: 2 };

export function validateSignup(input: SignupInput): SignupErrors {
	const errors: SignupErrors = {};
	const fail = (field: keyof SignupInput, key: MessageKey, params?: Params) => {
		errors[field] = new BookingError(key, 400, params);
	};

	if (!USERNAME_RE.test(input.username)) fail('username', 'signup.usernameHint');
	if (input.password.length < 6 || input.password.length > 64) fail('password', 'signup.error.password');
	if (!EMAIL_RE.test(input.email) || input.email.length > 100) fail('email', 'signup.error.email');
	if (input.mobilePhone && !PHONE_RE.test(input.mobilePhone)) fail('mobilePhone', 'signup.error.mobilePhone');
	if (!input.firstName.trim()) fail('firstName', 'signup.error.firstName');
	else if (input.firstName.length > 50) fail('firstName', 'signup.error.tooLong', { max: 50 });
	if (!input.lastName.trim()) fail('lastName', 'signup.error.lastName');
	else if (input.lastName.length > 50) fail('lastName', 'signup.error.tooLong', { max: 50 });
	if (!input.address.trim()) fail('address', 'signup.error.address');
	else if (input.address.length > 100) fail('address', 'signup.error.tooLong', { max: 100 });
	if (!ZIP_RE.test(input.zip)) fail('zip', 'signup.error.zip');
	if (!input.city.trim()) fail('city', 'signup.error.city');
	else if (input.city.length > 50) fail('city', 'signup.error.tooLong', { max: 50 });
	if (!GENDERS.includes(input.gender as Gender)) fail('gender', 'signup.error.gender');

	const born = parseLocal(`${input.birthday}T00:00`);
	const now = new Date();
	const youngest = Date.UTC(now.getUTCFullYear() - MIN_AGE, now.getUTCMonth(), now.getUTCDate()) / 1000;
	const oldest = Date.UTC(now.getUTCFullYear() - 110, 0, 1) / 1000;
	if (born === null || born > youngest || born < oldest) {
		fail('birthday', 'signup.error.birthday');
	}
	return errors;
}

/**
 * Creates the account via POST /users/create, then logs it in. Throws
 * BookingError with a customer-facing message on failure.
 */
export async function signup(input: SignupInput): Promise<SessionUser> {
	const errors = validateSignup(input);
	const first = Object.values(errors)[0];
	if (first) throw first;

	if (await sl.getUser(input.username)) {
		throw new BookingError('signup.error.taken', 409);
	}

	const created = await sl.createUser({
		UserName: input.username,
		UsergroupName: '',
		Password: input.password,
		Avatar: '',
		FirstName: sqlText(input.firstName.trim(), 50),
		LastName: sqlText(input.lastName.trim(), 50),
		Birthday: parseLocal(`${input.birthday}T00:00`)!,
		Address: sqlText(input.address.trim(), 100),
		City: sqlText(input.city.trim(), 50),
		Zip: sqlText(input.zip.trim(), 10),
		State: '',
		Country: '',
		Email: sqlText(input.email.trim(), 100),
		Telephone: '',
		MobilePhone: sqlText(input.mobilePhone.trim(), 20),
		Sex: SEX_CODES[input.gender as Gender],
		PersonalNumber: '',
		Source: 'Online booking'
	});
	if (!created) {
		throw new BookingError('signup.error.rejected', 409);
	}

	const user = await login(input.username, input.password);
	if (!user) throw new BookingError('signup.error.loginFailed', 500);
	return user;
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

export class BookingError extends LocalizedError {}

function timeWindow(start: string, minutes: number): { from: number; to: number } {
	const from = parseLocal(start);
	if (from === null) throw new BookingError('error.start');
	if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
		throw new BookingError('error.duration', 400, { min: MIN_MINUTES, max: MAX_MINUTES });
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
		throw new BookingError('error.compactDates');
	}
	if (enddate < startdate) throw new BookingError('error.endBeforeStart');
	const compactToLocal = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(8, 10)}:${c.slice(10, 12)}`;
	const from = parseLocal(compactToLocal(startdate));
	const to = parseLocal(compactToLocal(enddate));
	if (from === null || to === null) throw new BookingError('error.compactDates');
	// Same longest window as a booking, so one request can't make the center scan months of bookings.
	if (to - from > MAX_MINUTES * 60) throw new BookingError('error.duration', 400, { min: MIN_MINUTES, max: MAX_MINUTES });
	return sl.getBookedComputerIds(startdate, enddate);
}

/**
 * Whether a booking is this customer's. The name alone isn't enough: staff can
 * type any name on a booking, e.g. a walk-in called "anna". So the booking must
 * also have been made on this site by them, or carry their phone number.
 */
function isOwnBooking(row: sl.RawBooking, user: SessionUser): boolean {
	if (row.CustomerName?.toLowerCase() !== user.username.toLowerCase()) return false;
	if ((row.Description ?? '').startsWith(`Online booking by ${user.username}:`)) return true;
	const digits = (phone: string | undefined) => (phone ?? '').replace(/\D/g, '');
	return digits(user.phone).length >= 6 && digits(row.CustomerPhone) === digits(user.phone);
}

/** Upcoming bookings, grouped back into one entry per booking (the API returns one row per PC). */
export async function listBookings(owner?: SessionUser): Promise<Booking[]> {
	const rows = await sl.getBookings();
	const byId = new Map<string, Booking>();

	for (const row of rows) {
		if (owner && !isOwnBooking(row, owner)) continue;
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

/**
 * Price of booking `stations` stations for this customer, or null when the
 * center shows no prices. Their plan rate covers one station; it is not given
 * again while they already have a booking at that time (one discounted session
 * per member), and further stations are charged at the Rookie rate.
 */
async function quoteFor(
	account: sl.RawUser,
	existing: Booking[],
	from: number,
	to: number,
	stations: number
): Promise<StationQuote | null> {
	if (!pricingEnabled) return null;
	const plan = await planOf(account);
	const overlapping = existing.some((b) => {
		const bFrom = parseLocal(b.start);
		const bTo = parseLocal(b.end);
		return bFrom !== null && bTo !== null && bFrom < to && bTo > from;
	});
	return quoteStations(plan, from, to, stations, overlapping && plan !== 'rookie');
}

export async function getQuote(user: SessionUser, start: string, minutes: number, stations: number): Promise<StationQuote | null> {
	const { from, to } = timeWindow(start, minutes);
	if (!Number.isInteger(stations) || stations < 1 || stations > MAX_PCS_PER_BOOKING) {
		throw new BookingError('error.tooManyPcs', 400, { max: MAX_PCS_PER_BOOKING });
	}
	if (!pricingEnabled) return null;
	const [account, existing] = await Promise.all([activeAccount(user), listBookings(user)]);
	return quoteFor(account, existing, from, to, stations);
}

/** The customer's Smartlaunch account; 401 if it was deleted after they logged in. */
export async function activeAccount(user: SessionUser): Promise<sl.RawUser> {
	const account = await sl.getUser(user.username);
	if (!account || account.Deleted) throw new BookingError('error.accountGone', 401);
	return account;
}

/**
 * The order code sent to Smartlaunch. The browser's code makes a retried request
 * land on the same booking; hashing it with the username keeps one customer's code
 * from ever matching another customer's booking.
 */
async function serverOrderCode(username: string, clientCode: string | undefined): Promise<string> {
	if (!clientCode || !/^[A-Z0-9]{8,32}$/.test(clientCode)) {
		return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
	}
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${username.toLowerCase()}:${clientCode}`))
	);
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	return Array.from(digest.slice(0, 12), (b) => alphabet[b % alphabet.length]).join('');
}

/** e.g. "Price EUR 9.50 (R7: 1 x campus EUR 3.50, 1 x rookie EUR 6.00)." for the booking description. */
export function describeQuote(quote: StationQuote): string {
	const eur = (cents: number) => `${quote.currency} ${(cents / 100).toFixed(2)}`;
	const lines = quote.lines.map((l) => `${l.stations} x ${l.plan} ${eur(l.each)}`).join(', ');
	return `Price ${eur(quote.total)} (${quote.version}: ${lines}).`;
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

/** A booking request that passed every check, priced and ready to write. */
export interface PreparedBooking {
	/** Wall-clock seconds. */
	from: number;
	to: number;
	computerIds: string[];
	/** Names of the computers, for confirmations. */
	computerNames: string[];
	/** The client's idempotency key, or a fresh one. */
	orderCode: string;
	quote: StationQuote | null;
	/** "Online booking by anna: 2 PC(s) for 2 h." */
	summary: string;
}

/** Validate a booking request, check availability and price it. Throws BookingError. */
export async function prepareBooking(user: SessionUser, req: BookingRequest): Promise<PreparedBooking> {
	const { from, to } = timeWindow(req.start, req.minutes);

	// Bookings open from the next full hour in the center's time: at 14:20 the earliest start is 15:00.
	if (CENTER_TIMEZONE) {
		const earliest = Math.floor(nowInZone(CENTER_TIMEZONE) / 3600) * 3600 + 3600;
		if (from < earliest) {
			throw new BookingError('error.tooEarly', 400, { time: formatLocal(earliest).slice(11) });
		}
	}

	const ids = [...new Set(req.computerIds.map((id) => id.trim()))];
	if (ids.length === 0) throw new BookingError('error.noPcs');
	if (ids.length > MAX_PCS_PER_BOOKING) throw new BookingError('error.tooManyPcs', 400, { max: MAX_PCS_PER_BOOKING });
	if (!ids.every((id) => /^\d+$/.test(id))) throw new BookingError('error.invalidPcs');

	const orderCode = await serverOrderCode(user.username, req.orderCode);

	const [account, existing, known, unavailable] = await Promise.all([
		activeAccount(user),
		listBookings(user),
		sl.getComputers(),
		sl.getBookedComputerIds(toCompact(from), toCompact(to))
	]);

	if (existing.length >= MAX_UPCOMING_BOOKINGS) {
		throw new BookingError('error.tooManyBookings', 409, { max: MAX_UPCOMING_BOOKINGS });
	}

	const names = new Map(known.map((c) => [String(c.ComputerID), c.Name || `PC ${c.ComputerID}`]));
	if (!ids.every((id) => names.has(id))) throw new BookingError('error.unknownPc');

	// Older servers only reject a PC whose existing booking covers our *start*
	// time, so check the full window here first, like the MVC client does.
	const taken = ids.filter((id) => unavailable.includes(id));
	if (taken.length > 0) {
		throw new BookingError('error.taken', 409, { ids: taken.join(', ') });
	}

	// Priced on the server from the rules, never from an amount the browser sends.
	const quote = await quoteFor(account, existing, from, to, ids.length);

	const hours = req.minutes / 60;
	const summary = `Online booking by ${user.username}: ${ids.length} PC(s) for ${Number.isInteger(hours) ? hours + ' h' : req.minutes + ' min'}.`;
	return { from, to, computerIds: ids, computerNames: ids.map((id) => names.get(id)!), orderCode, quote, summary };
}

/** The Smartlaunch booking for a prepared request, with `note` appended to its description. */
export function bookingFields(user: SessionUser, booking: PreparedBooking, note: string): sl.BookingFields {
	return {
		Description: sqlText(`${booking.summary} ${note}`.trim(), 250),
		StartDate: booking.from,
		EndDate: booking.to,
		Computers: booking.computerIds.join(';'),
		CustomerName: sqlText(user.username, 100),
		CustomerPhone: sqlText(user.phone, 50),
		Smoking: false
	};
}

/** Book without online payment (payments or prices turned off). */
export async function createBooking(
	user: SessionUser,
	req: BookingRequest
): Promise<{ orderCode: string; quote: StationQuote | null }> {
	const booking = await prepareBooking(user, req);
	const { orderCode, quote } = booking;
	const note = `Order ${orderCode}.` + (quote ? ' ' + describeQuote(quote) : '');
	// Nothing was paid online; staff collect at the venue, so the admin program shows Paid NO.
	const ok = await sl.addBooking({ ...bookingFields(user, booking, note), OrderCode: orderCode, Paid: sl.BOOKING_UNPAID });

	if (!ok) throw new BookingError('error.justBooked', 409);
	return { orderCode, quote };
}

/** Map any error to a status and a message, in the customer's language, that is safe to show them. */
export function toHttpError(err: unknown, locale: Locale): { status: number; message: string } {
	if (err instanceof LocalizedError) {
		return { status: err.status, message: translate(locale, err.key, err.params) };
	}
	console.error(err);
	return { status: 500, message: translate(locale, 'error.generic') };
}
