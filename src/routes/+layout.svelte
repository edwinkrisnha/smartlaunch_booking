<script lang="ts">
	import '../app.css';
	import { enhance } from '$app/forms';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import { page } from '$app/state';
	import { LANGUAGE_NAMES, LOCALES, translator, type Locale } from '#lib/i18n/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const t = $derived(translator(data.locale));

	// The server sets <html lang> on first load; keep it right after switching language in the browser.
	$effect(() => {
		document.documentElement.lang = data.locale;
	});
</script>

<svelte:head>
	<link rel="stylesheet" href={data.theme.stylesheet} />
	<link rel="icon" href={data.theme.favicon} />
	<title>{t('meta.title', { center: PUBLIC_CENTER_NAME })}</title>
</svelte:head>

<div class="app">
<header>
	{#if data.user}
		<form class="strip" method="POST" action="/logout">
			<span class="who">{data.user.displayName}</span>
			<button type="submit">{t('nav.logout')}</button>
		</form>
	{/if}
	<div class="bar">
		<a class="brand" href="/"><span class="mark" aria-hidden="true"></span>{PUBLIC_CENTER_NAME}</a>
		{#if data.user}
			<nav>
				<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>{t('nav.book')}</a>
				<a href="/bookings" aria-current={page.url.pathname === '/bookings' ? 'page' : undefined}
					>{t('nav.bookings')}</a
				>
			</nav>
		{/if}
		<form class="langs" method="POST" action="/lang" use:enhance aria-label={t('nav.language')}>
			<input type="hidden" name="next" value={page.url.pathname + page.url.search} />
			{#each LOCALES as code (code)}
				<button
					type="submit"
					name="lang"
					value={code}
					class="flag"
					lang={code}
					title={LANGUAGE_NAMES[code]}
					aria-label={LANGUAGE_NAMES[code]}
					aria-current={code === data.locale ? 'true' : undefined}
				>
					{@render flag(code)}
				</button>
			{/each}
		</form>
	</div>
</header>

<!-- The booking page lets its PC map use the full screen width and centres its other sections itself;
     the login and sign-up pages are centred vertically in the space below the header. -->
<main
	class:wide={page.url.pathname === '/'}
	class:centered={page.url.pathname === '/login' || page.url.pathname === '/signup'}
>
	{@render children()}
</main>
</div>

<!-- Flags drawn in 3:2 boxes; wider flags are cropped at the sides. -->
{#snippet flag(code: Locale)}
	{#if code === 'en'}
		<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
			<clipPath id="flag-gb-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
			<rect width="60" height="30" fill="#012169" />
			<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6" />
			<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#flag-gb-t)" stroke="#c8102e" stroke-width="4" />
			<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10" />
			<path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6" />
		</svg>
	{:else if code === 'de'}
		<svg viewBox="0 0 5 3" preserveAspectRatio="none" aria-hidden="true">
			<rect width="5" height="1" fill="#000" />
			<rect y="1" width="5" height="1" fill="#dd0000" />
			<rect y="2" width="5" height="1" fill="#ffce00" />
		</svg>
	{:else}
		<svg viewBox="0 0 37 28" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
			<rect width="37" height="28" fill="#c8102e" />
			<rect x="12" width="4" height="28" fill="#fff" />
			<rect y="12" width="37" height="4" fill="#fff" />
		</svg>
	{/if}
{/snippet}

<style>
	/* Header band; --header-cut gives it an angled lower edge. */
	header {
		position: relative;
		background: var(--header-bg);
		color: var(--header-fg);
		border-bottom: var(--header-border);
		clip-path: polygon(
			0 0,
			100% 0,
			100% calc(100% - var(--header-cut)),
			70% calc(100% - var(--header-cut)),
			calc(70% - var(--header-cut)) 100%,
			0 100%
		);
		padding-bottom: var(--header-cut);
	}

	/* Account strip at the top right; --strip-cut slants its leading edge. */
	.strip {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 1rem;
		width: fit-content;
		margin-left: auto;
		padding: 0.2rem 1.25rem 0.2rem calc(1.25rem + var(--strip-cut));
		background: var(--strip-bg);
		color: var(--strip-fg);
		clip-path: polygon(0 0, 100% 0, 100% 100%, var(--strip-cut) 100%);
	}

	.who {
		font-family: var(--brand-font);
		font-weight: 700;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-transform: var(--brand-case);
	}

	.strip button {
		min-height: 1.9rem;
		padding: 0.15rem 0.7rem;
		background: transparent;
		border: 1.5px solid currentColor;
		color: inherit;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.strip button:hover {
		background: var(--strip-hover-bg);
		color: var(--strip-hover-fg);
		border-color: var(--strip-hover-bg);
	}

	.bar {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 2.5rem;
		flex-wrap: wrap;
		padding: 0.8rem 1rem 0.9rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--brand-font);
		font-weight: var(--brand-weight);
		font-size: 1.15rem;
		letter-spacing: 0.02em;
		text-transform: var(--brand-case);
		color: inherit;
		text-decoration: none;
	}

	.mark {
		width: 0.85rem;
		height: 1.35rem;
		background: var(--mark-bg);
		border-radius: var(--mark-radius);
		transform: skewX(var(--mark-skew));
	}

	nav {
		display: flex;
		gap: 1.75rem;
	}

	nav a {
		font-family: var(--nav-font);
		font-weight: var(--nav-weight);
		font-size: var(--nav-size);
		letter-spacing: 0.02em;
		text-transform: var(--nav-case);
		color: inherit;
		text-decoration: none;
		text-shadow: var(--nav-shadow);
		padding: 0.2rem 0;
		border-bottom: 2px solid transparent;
	}

	nav a:hover {
		color: var(--nav-hover);
	}

	nav a[aria-current='page'] {
		color: var(--nav-active);
		border-bottom-color: var(--nav-underline);
	}

	/* Language switcher: the current language's flag is lit and outlined, the others dimmed. */
	.langs {
		display: flex;
		gap: 0.35rem;
		margin-left: auto;
	}

	.flag {
		display: grid;
		place-items: center;
		min-height: 0;
		padding: 3px;
		background: none;
		border: 1.5px solid transparent;
		border-radius: 3px;
		color: inherit;
		line-height: 0;
		opacity: 0.55;
		transition: opacity 0.15s;
	}

	.flag svg {
		width: 24px;
		height: 16px;
		border-radius: 1px;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
	}

	.flag:hover {
		opacity: 1;
	}

	.flag[aria-current='true'] {
		opacity: 1;
		border-color: currentColor;
	}

	/* Header on top, main filling the rest of the screen. */
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
	}

	main {
		flex: 1 0 auto;
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
		padding: 2.5rem 1rem 4rem;
	}

	main.wide {
		max-width: none;
	}

	main.centered {
		display: grid;
		align-content: center;
		padding-block: 2.5rem;
	}

	@media (max-width: 640px) {
		.bar {
			gap: 0.6rem 1.5rem;
		}

		nav {
			flex-basis: 100%;
			gap: 1.25rem;
			order: 1;
		}

		nav a {
			font-size: 0.85rem;
		}

		.who {
			max-width: 40vw;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
