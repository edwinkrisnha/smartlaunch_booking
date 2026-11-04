import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The adapter writes SvelteKit's Worker where wrangler.sveltekit.jsonc says; the deployed
			// Worker (wrangler.jsonc) wraps it. Dev bindings such as D1 come from wrangler.jsonc.
			adapter: adapter({
				config: 'wrangler.sveltekit.jsonc',
				platformProxy: { configPath: 'wrangler.jsonc' }
			}),
			// Content-Security-Policy: scripts only from this site (SvelteKit adds a nonce to
			// its own inline script) and Cloudflare Turnstile on sign-up. Styles may be inline
			// (Svelte style: directives) and load Google Fonts for themes that import them.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'https://challenges.cloudflare.com'],
					'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
					'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'frame-src': ['https://challenges.cloudflare.com'],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'object-src': ['none']
				}
			}
		})
	]
});
