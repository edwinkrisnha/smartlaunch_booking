// Shapes shared by the server routes and the browser. Field names of the raw
// Smartlaunch contracts mirror ISmartlaunchRESTService.vb (PascalCase); the
// trimmed shapes we hand to the browser use camelCase.

/** Gender choices on the sign-up form. */
export const GENDERS = ['male', 'female', 'nonbinary'] as const;
export type Gender = (typeof GENDERS)[number];

export interface SessionUser {
	username: string;
	displayName: string;
	phone: string;
}

export interface Layout {
	id: string;
	name: string;
}

export interface Pc {
	id: string;
	name: string;
	groupId: string;
	/** Console type (e.g. "Playstation"), or null for a regular PC. */
	console: string | null;
}

export interface Seat {
	layoutId: string;
	computerId: string;
	x: number;
	y: number;
}

export interface Booking {
	bookingId: string;
	/** Center wall-clock time, `YYYY-MM-DDTHH:mm`. */
	start: string;
	/** Center wall-clock time, `YYYY-MM-DDTHH:mm`. */
	end: string;
	computerIds: string[];
	customerName: string;
}

/** A customer's top-up as shown on the top-up page. */
export interface TopupOrder {
	id: string;
	amountCents: number;
	currency: string;
	status: 'pending' | 'paid' | 'delivered' | 'failed' | 'expired';
	/** Unix seconds. */
	createdAt: number;
}

export interface BookingRequest {
	/** Center wall-clock time, `YYYY-MM-DDTHH:mm`. */
	start: string;
	minutes: number;
	computerIds: string[];
	/** Client-generated idempotency key; the server ignores a repeat with the same code. */
	orderCode?: string;
}
