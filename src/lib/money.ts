/** Parse "12", "12.5" or "12,50" into cents; null if it isn't a positive amount with at most 2 decimals. */
export function parseAmount(value: string): number | null {
	const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(value);
	if (!m) return null;
	const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
	return cents > 0 ? cents : null;
}

/** Format an amount in cents for display, e.g. 2050 EUR -> "€20.50" (en) or "20,50 €" (de). */
export function formatMoney(cents: number, currency: string, locale: string): string {
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency,
		// Whole amounts read better without ",00" on quick-pick buttons.
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2
	}).format(cents / 100);
}
