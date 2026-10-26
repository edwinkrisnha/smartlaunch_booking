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
	<a class="brand" href="/">{PUBLIC_CENTER_NAME}</a>
	{#if data.user}
		<nav>
			<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>Book</a>
			<a href="/bookings" aria-current={page.url.pathname === '/bookings' ? 'page' : undefined}>My bookings</a>
		</nav>
		<form method="POST" action="/logout">
			<span class="who">{data.user.displayName}</span>
			<button type="submit">Log out</button>
		</form>
	{/if}
</header>

<main>
	{@render children()}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.brand {
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--text);
		text-decoration: none;
	}

	nav {
		display: flex;
		gap: 1rem;
		flex: 1;
	}

	nav a {
		color: var(--muted);
		text-decoration: none;
		padding: 0.25rem 0;
		border-bottom: 2px solid transparent;
	}

	nav a[aria-current='page'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}

	form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.who {
		color: var(--muted);
		font-size: 0.9rem;
	}

	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	@media (max-width: 560px) {
		.who {
			display: none;
		}
	}
</style>
