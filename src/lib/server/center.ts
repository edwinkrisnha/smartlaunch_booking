// The settings of the center this deployment serves: centers/<CENTER>/config.jsonc,
// bundled at build time and checked when the Worker starts. A bad or missing config
// stops the site with a message naming every problem, rather than taking bookings
// at the wrong prices.

import * as env from '$app/env/private';
import { parseCenterConfig, type CenterConfig } from '#lib/config.js';
import { isLocale, LOCALES } from '#lib/i18n/index.js';
import { availableThemes } from '#lib/theme.js';

const files = import.meta.glob<string>('/centers/*/config.jsonc', { query: '?raw', import: 'default', eager: true });
const byName = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split('/').at(-2)!, text]));

/** Names of the centers that have a config (folders under centers/). */
export const availableCenters = Object.keys(byName).sort();

/**
 * Settings that used to be environment variables and now live in the config file.
 * Still set on a deployment, they would be silently ignored, so say where they went.
 */
const MOVED: Record<string, string> = {
	PUBLIC_CENTER_NAME: 'center.name',
	CENTER_TIMEZONE: 'center.timezone',
	DEFAULT_LANGUAGE: 'center.defaultLanguage',
	THEME: 'center.theme',
	PAYMENT_CURRENCY: 'center.currency',
	PUBLIC_ALLOW_SIGNUP: 'signup.enabled',
	EXCLUDED_PCS: 'booking.excludedPcs',
	PRICE_RULES: 'pricing',
	PLAN_GROUPS: 'pricing.plans[].groups',
	TOPUP_AMOUNTS: 'payments.topupAmounts',
	TOPUP_MIN: 'payments.topupMin',
	TOPUP_MAX: 'payments.topupMax'
};

function load(): CenterConfig {
	const name = env.CENTER ?? 'default';
	const file = `centers/${name}/config.jsonc`;
	const text = byName[name];
	if (text === undefined) {
		throw new Error(`CENTER is "${name}" but there is no ${file} (available: ${availableCenters.join(', ')}).`);
	}

	const config = parseCenterConfig(text, file);
	if (!isLocale(config.center.defaultLanguage)) {
		throw new Error(`${file}: center.defaultLanguage must be one of ${LOCALES.join(', ')}.`);
	}
	if (!availableThemes.includes(config.center.theme)) {
		console.warn(`${file}: theme "${config.center.theme}" not found in src/themes (available: ${availableThemes.join(', ')}); using "default".`);
	}

	const leftover = Object.keys(MOVED).filter((key) => (env as Record<string, unknown>)[key] !== undefined);
	for (const key of leftover) {
		console.error(`${key} is set but no longer read; put it in ${file} as ${MOVED[key]} and remove the variable.`);
	}
	return config;
}

export const center = load();
