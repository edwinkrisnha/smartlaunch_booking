<script lang="ts">
	import '../app.css';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="stylesheet" href={data.theme.stylesheet} />
	<link rel="icon" href={data.theme.favicon} />
	<title>Book a PC · {PUBLIC_CENTER_NAME}</title>
</svelte:head>

<header>
	{#if data.user}
		<form class="strip" method="POST" action="/logout">
			<span class="who">{data.user.displayName}</span>
			<button type="submit">Log out</button>
		</form>
	{/if}
	<div class="bar">
		<a class="brand" href="/"><span class="mark" aria-hidden="true"></span>{PUBLIC_CENTER_NAME}</a>
		{#if data.user}
			<nav>
				<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>Book</a>
				<a href="/bookings" aria-current={page.url.pathname === '/bookings' ? 'page' : undefined}>My bookings</a>
			</nav>
		{/if}
	</div>
</header>

<!-- The booking page lets its PC map use the full screen width and centres its other sections itself. -->
<main class:wide={page.url.pathname === '/'}>
	{@render children()}
</main>

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

	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2.5rem 1rem 4rem;
	}

	main.wide {
		max-width: none;
	}

	@media (max-width: 640px) {
		.bar {
			gap: 0.6rem 1.5rem;
		}

		nav {
			flex-basis: 100%;
			gap: 1.25rem;
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
