<script lang="ts">
	import { INTL_LOCALES, translator } from '#lib/i18n/index.js';
	import { parseLocal } from '#lib/time.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const t = $derived(translator(data.locale));
	const pcNames = $derived(new Map(data.pcs.map((pc) => [pc.id, pc.name || `PC ${pc.id}`])));

	const dateFormat = $derived(
		new Intl.DateTimeFormat(INTL_LOCALES[data.locale], {
			timeZone: 'UTC',
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		})
	);

	/** Booking times are center wall-clock values, so format them in UTC to avoid any shift. */
	function dateOf(value: string): string {
		const seconds = parseLocal(value);
		return seconds === null ? value : dateFormat.format(new Date(seconds * 1000));
	}

	function duration(start: string, end: string): string {
		const minutes = ((parseLocal(end) ?? 0) - (parseLocal(start) ?? 0)) / 60;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '—';
	}
</script>

<section class="intro">
	<p class="eyebrow">{t('bookings.eyebrow')}</p>
	<h1>{t('bookings.title')}</h1>
	<div class="hazard" aria-hidden="true"></div>
</section>

{#if data.loadError}
	<p class="notice error" role="alert">{data.loadError}</p>
{:else if data.bookings.length === 0}
	<section class="card empty">
		<p>{t('bookings.empty')}</p>
		<a class="cta" href="/">{t('bookings.cta')}</a>
	</section>
{:else}
	<ul class="bookings">
		{#each data.bookings as booking (booking.bookingId)}
			<li>
				<div class="stub">
					<span class="time">{booking.start.slice(11)}</span>
					<span class="date">{dateOf(booking.start)}</span>
				</div>
				<dl>
					<dt>{t('bookings.duration')}</dt>
					<dd>{t('bookings.until', { duration: duration(booking.start, booking.end), time: booking.end.slice(11) })}</dd>
					<dt>{t('bookings.pcs')}</dt>
					<dd>{booking.computerIds.map((id) => pcNames.get(id) ?? `PC ${id}`).join(', ')}</dd>
					<dt>{t('bookings.booking')}</dt>
					<dd class="muted">#{booking.bookingId}</dd>
				</dl>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 2.25rem;
	}

	.intro .hazard {
		margin-top: 0.4rem;
	}

	.bookings {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
		gap: 1rem;
	}

	li {
		display: grid;
		grid-template-columns: 9.5rem 1fr;
		background: var(--surface);
		border-radius: var(--radius);
		overflow: hidden;
		border: var(--card-border);
		box-shadow: var(--card-shadow);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--pass-cut) * 1.6), calc(100% - var(--pass-cut) * 1.6) 100%, 0 100%);
	}

	/* Ticket stub with a dashed tear edge, matching the booking pass. */
	.stub {
		display: grid;
		align-content: center;
		gap: 0.35rem;
		padding: 1.1rem;
		background: var(--pass-bg);
		color: var(--pass-fg);
		border-right: 2px dashed var(--pass-tear);
	}

	.time {
		font-family: var(--font-display);
		font-weight: var(--display-weight);
		font-size: 1.9rem;
		line-height: 1;
		text-shadow: var(--headline-shadow);
	}

	.date {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--pass-accent);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
		padding: 1.1rem 1.25rem;
		align-content: center;
	}

	dt {
		font-family: var(--font-sub);
		font-size: 0.7rem;
		letter-spacing: var(--sub-spacing);
		text-transform: var(--sub-case);
		font-weight: var(--sub-weight);
		color: var(--muted);
		padding-top: 0.15rem;
	}

	dd {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.empty {
		display: grid;
		justify-items: start;
		gap: 1rem;
		padding: 2rem;
	}

	.empty p {
		margin: 0;
		font-size: 1.05rem;
	}

	@media (max-width: 480px) {
		li {
			grid-template-columns: 1fr;
		}

		.stub {
			border-right: none;
			border-bottom: 2px dashed var(--pass-tear);
			grid-auto-flow: column;
			justify-content: space-between;
			align-items: baseline;
		}
	}
</style>
