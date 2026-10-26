<script lang="ts">
	import { describeLocal, parseLocal } from '#lib/time.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const pcNames = $derived(new Map(data.pcs.map((pc) => [pc.id, pc.name || `PC ${pc.id}`])));

	function duration(start: string, end: string): string {
		const minutes = ((parseLocal(end) ?? 0) - (parseLocal(start) ?? 0)) / 60;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '—';
	}
</script>

<h1>My bookings</h1>
<p class="muted">Upcoming bookings on your account.</p>

{#if data.loadError}
	<p class="notice error" role="alert">{data.loadError}</p>
{:else if data.bookings.length === 0}
	<section class="card empty">
		<p>You have no upcoming bookings.</p>
		<a href="/">Book a PC</a>
	</section>
{:else}
	<ul class="bookings">
		{#each data.bookings as booking (booking.bookingId)}
			<li class="card">
				<div class="when">{describeLocal(booking.start)}</div>
				<div class="meta">
					<span>{duration(booking.start, booking.end)}</span>
					<span>{booking.computerIds.map((id) => pcNames.get(id) ?? `PC ${id}`).join(', ')}</span>
				</div>
				<div class="id muted">Booking #{booking.bookingId}</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.bookings {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
		display: grid;
		gap: 0.75rem;
	}

	.when {
		font-weight: 600;
		font-size: 1.05rem;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.5rem;
		margin-top: 0.25rem;
	}

	.id {
		margin-top: 0.4rem;
		font-size: 0.85rem;
	}

	.empty {
		margin-top: 1rem;
	}
</style>
