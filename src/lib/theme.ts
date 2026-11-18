// A center's look lives in its folder next to its config: centers/<name>/theme.css
// and an optional favicon.svg. A center without its own theme.css or favicon.svg
// gets the default center's. They are bundled at build time.

export const DEFAULT_CENTER = 'default';

const folderOf = (path: string) => path.split('/').at(-2)!;

const stylesheets = import.meta.glob<string>('/centers/*/theme.css', {
	query: '?url',
	import: 'default',
	eager: true
});
const favicons = import.meta.glob<string>('/centers/*/favicon.svg', {
	query: '?url',
	import: 'default',
	eager: true
});

const byFolder = (files: Record<string, string>) =>
	Object.fromEntries(Object.entries(files).map(([path, url]) => [folderOf(path), url]));

const stylesheetUrls = byFolder(stylesheets);
const faviconUrls = byFolder(favicons);

export interface Theme {
	/** Center whose theme.css is used. */
	name: string;
	stylesheet: string;
	favicon: string;
}

/** The center's theme, with the default center's files for anything it doesn't have. */
export function resolveTheme(center: string): Theme {
	const chosen = stylesheetUrls[center] ? center : DEFAULT_CENTER;
	return {
		name: chosen,
		stylesheet: stylesheetUrls[chosen],
		favicon: faviconUrls[center] ?? faviconUrls[DEFAULT_CENTER]
	};
}
