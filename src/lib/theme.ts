// Themes live in src/themes/<name>/ with a theme.css and an optional
// favicon.svg. They are bundled at build time; THEME picks one at runtime and
// falls back to "default" when that folder does not exist.

export const DEFAULT_THEME = 'default';

const folderOf = (path: string) => path.split('/').at(-2)!;

const stylesheets = import.meta.glob<string>('/src/themes/*/theme.css', {
	query: '?url',
	import: 'default',
	eager: true
});
const favicons = import.meta.glob<string>('/src/themes/*/favicon.svg', {
	query: '?url',
	import: 'default',
	eager: true
});

const byFolder = (files: Record<string, string>) =>
	Object.fromEntries(Object.entries(files).map(([path, url]) => [folderOf(path), url]));

const stylesheetUrls = byFolder(stylesheets);
const faviconUrls = byFolder(favicons);

/** Names of the themes that exist (folders with a theme.css). */
export const availableThemes = Object.keys(stylesheetUrls).sort();

export interface Theme {
	name: string;
	stylesheet: string;
	favicon: string;
}

/** The named theme, or the default theme if it does not exist. */
export function resolveTheme(name: string | undefined): Theme {
	const chosen = name && stylesheetUrls[name] ? name : DEFAULT_THEME;
	return {
		name: chosen,
		stylesheet: stylesheetUrls[chosen],
		favicon: faviconUrls[chosen] ?? faviconUrls[DEFAULT_THEME]
	};
}
