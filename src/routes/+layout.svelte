<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
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
	/* Red band with an angled lower edge, like the landing page header. */
	header {
		position: relative;
		background: linear-gradient(180deg, var(--fire), #b51f22);
		color: var(--weiss);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), 70% calc(100% - 10px), calc(70% - 10px) 100%, 0 100%);
		padding-bottom: 10px;
	}

	/* Saffron strip slanting in from the top, carrying the account controls. */
	.strip {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 1rem;
		width: fit-content;
		margin-left: auto;
		padding: 0.2rem 1.25rem 0.2rem 2.25rem;
		background: var(--saffron);
		color: var(--jet);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 18px 100%);
	}

	.who {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.strip button {
		min-height: 1.9rem;
		padding: 0.15rem 0.7rem;
		background: transparent;
		border: 1.5px solid var(--jet);
		color: var(--jet);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.strip button:hover {
		background: var(--jet);
		color: var(--saffron);
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
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 1.15rem;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--weiss);
		text-decoration: none;
	}

	.mark {
		width: 0.85rem;
		height: 1.35rem;
		background: var(--weiss);
		transform: skewX(-14deg);
	}

	nav {
		display: flex;
		gap: 1.75rem;
	}

	nav a {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1rem;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--weiss);
		text-decoration: none;
		text-shadow: 0 2px 0 rgb(0 0 0 / 0.25);
	}

	nav a:hover {
		color: #ffe7a3;
	}

	nav a[aria-current='page'] {
		color: var(--saffron);
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
