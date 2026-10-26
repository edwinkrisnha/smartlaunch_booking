// The Smartlaunch server stores bookings as center-local wall-clock times and
// converts them with `New DateTime(1970,1,1).AddSeconds(ts)`, with no time zone
// involved. So a "unix timestamp" from the API is really wall-clock seconds,
// and we do all arithmetic in UTC to avoid the runtime's own zone leaking in.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Parse `YYYY-MM-DDTHH:mm` into wall-clock epoch seconds, or `null` if malformed. */
export function parseLocal(value: string): number | null {
	const m = LOCAL_RE.exec(value);
	if (!m) return null;
	const [, y, mo, d, h, mi] = m.map(Number);
	const ms = Date.UTC(y, mo - 1, d, h, mi);
	const back = new Date(ms);
	// Reject rollovers such as 2026-02-31.
	if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null;
	return ms / 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock epoch seconds to `YYYY-MM-DDTHH:mm`. */
export function formatLocal(seconds: number): string {
	const d = new Date(seconds * 1000);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Wall-clock epoch seconds to the `yyyyMMddHHmm` format `/booking/getbooked` expects. */
export function toCompact(seconds: number): string {
	return formatLocal(seconds).replace(/[-T:]/g, '');
}

/** Current wall-clock time in an IANA zone, as epoch seconds on the same scale as `parseLocal`. */
export function nowInZone(timeZone: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		})
			.formatToParts(new Date())
			.map((p) => [p.type, p.value])
	);
	return parseLocal(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`)!;
}

/** Human-readable label for a `YYYY-MM-DDTHH:mm` value, without any zone conversion. */
export function describeLocal(value: string, locale?: string): string {
	const seconds = parseLocal(value);
	if (seconds === null) return value;
	return new Intl.DateTimeFormat(locale, {
		timeZone: 'UTC',
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(seconds * 1000));
}
