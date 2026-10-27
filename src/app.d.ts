// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties
		}

		// interface Error {}
		interface Locals {
			user: import('#lib/types.js').SessionUser | null;
			locale: import('#lib/i18n/index.js').Locale;
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
