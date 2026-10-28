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
			})
		})
	]
});
