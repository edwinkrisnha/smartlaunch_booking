// Customer-facing text in English, German and Danish. Pages translate with
// `translator(data.locale)`; server errors carry a message key and are
// translated when they are turned into a response, so API errors also come
// back in the visitor's language.

import { en, type Message } from './en.js';
import { de } from './de.js';
import { da } from './da.js';

export const LOCALES = ['en', 'de', 'da'] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const LOCALE_COOKIE = 'lang';

/** Each language's own name, for the language switcher. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', da: 'Dansk' };

/** Locales for Intl date formatting; en-GB for 24-hour times and day-before-month dates. */
export const INTL_LOCALES: Record<Locale, string> = { en: 'en-GB', de: 'de-DE', da: 'da-DK' };

const dictionaries: Record<Locale, Record<MessageKey, Message>> = { en, de, da };

export function isLocale(value: unknown): value is Locale {
	return LOCALES.includes(value as Locale);
}

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
	const message = dictionaries[locale][key] ?? en[key];
	const text = typeof message === 'string' ? message : params.n === 1 ? message.one : message.other;
	return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function translator(locale: Locale): Translate {
	return (key, params) => translate(locale, key, params);
}

/** Best supported language in an Accept-Language header, or null if none matches. */
export function fromAcceptLanguage(header: string | null): Locale | null {
	const ranked = (header ?? '')
		.split(',')
		.map((part) => {
			const [tag, ...rest] = part.trim().split(';');
			const q = rest.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
			return { lang: tag.split('-')[0].toLowerCase(), q: q === undefined ? 1 : Number(q) };
		})
		.filter((entry) => entry.q > 0)
		.sort((a, b) => b.q - a.q);
	const best = ranked.find((entry) => isLocale(entry.lang));
	return best ? (best.lang as Locale) : null;
}

/** An error whose message is safe to show a customer; translated where it becomes a response. */
export class LocalizedError extends Error {
	constructor(
		readonly key: MessageKey,
		readonly status = 400,
		readonly params: Params = {}
	) {
		super(translate('en', key, params));
	}
}
