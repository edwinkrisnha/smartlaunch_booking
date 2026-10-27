<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { describeLocal } from '#lib/time.js';
	import { fitScale } from '#lib/seatmap.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Our API endpoints answer either the payload or `{ error }`. */
	type ApiResponse<T> = Partial<T> & { error?: string };

	const TILE = { width: 62, height: 44, gapX: 4, gapY: 8 };
	const PADDING = 16;
	/** Shrink a wide room to fit its card, but not so far that PC names become unreadable. */
	const MIN_ZOOM = 0.75;
	const HOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

	const pad = (n: number) => String(n).padStart(2, '0');
	const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	const now = new Date();
	const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
	const today = toDateValue(now);

	let date = $state(toDateValue(nextHour));
	let time = $state(`${pad(nextHour.getHours())}:00`);
	let hours = $state(2);
	let layoutId = $state('');

	const start = $derived(`${date}T${time}`);
	const minutes = $derived(hours * 60);
	const validInput = $derived(/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time));
	// `YYYY-MM-DDTHH:mm` without a zone parses as browser-local time, which is the center's time for its customers.
	const inPast = $derived(validInput && new Date(start).getTime() < Date.now());

	const pcNames = $derived(new Map(data.pcs.map((pc) => [pc.id, pc.name || `PC ${pc.id}`])));
	const nameOf = (id: string) => pcNames.get(id) ?? `PC ${id}`;

	const layouts = $derived(data.layouts.filter((l) => data.seats.some((s) => s.layoutId === l.id)));
	const activeLayoutId = $derived(layouts.some((l) => l.id === layoutId) ? layoutId : (layouts[0]?.id ?? ''));

	const map = $derived.by(() => {
		const raw = data.seats.filter((s) => s.layoutId === activeLayoutId);
		if (raw.length === 0) return { seats: [], width: 0, height: 0 };
		const minX = Math.min(...raw.map((s) => s.x));
		const minY = Math.min(...raw.map((s) => s.y));
		const { sx, sy } = fitScale(raw, TILE);
		const seats = raw.map((s) => ({
			id: s.computerId,
			left: Math.round((s.x - minX) * sx) + PADDING,
			top: Math.round((s.y - minY) * sy) + PADDING
		}));
		return {
			seats,
			width: Math.max(...seats.map((s) => s.left)) + TILE.width + PADDING,
			height: Math.max(...seats.map((s) => s.top)) + TILE.height + PADDING
		};
	});

	let floorWidth = $state(0);
	const zoom = $derived(
		floorWidth && map.width > floorWidth ? Math.max(MIN_ZOOM, floorWidth / map.width) : 1
	);

	const selected = new SvelteSet<string>();
	let unavailable = $state(new Set<string>());
	let checking = $state(false);
	let availabilityError = $state('');
	let refresh = $state(0);

	$effect(() => {
		const s = start;
		const m = minutes;
		void refresh;
		if (!validInput || inPast) {
			unavailable = new Set();
			checking = false;
			return;
		}

		const controller = new AbortController();
		checking = true;
		availabilityError = '';

		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/booking/getbooked?start=${encodeURIComponent(s)}&minutes=${m}`, {
					signal: controller.signal
				});
				const body = (await res.json()) as ApiResponse<{ computerIds: string[] }>;
				if (!res.ok || !body.computerIds) throw new Error(body.error ?? 'Could not check availability.');
				unavailable = new Set(body.computerIds);
				for (const id of selected) if (unavailable.has(id)) selected.delete(id);
			} catch (err) {
				if (!controller.signal.aborted) availabilityError = (err as Error).message;
			} finally {
				if (!controller.signal.aborted) checking = false;
			}
		}, 250);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	const selectedIds = $derived([...selected].sort((a, b) => Number(a) - Number(b)));
	const canBook = $derived(validInput && !inPast && !checking && !availabilityError && selected.size > 0);

	let submitting = $state(false);
	let result = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
	// Reusing the order code when the same booking is retried lets the server drop duplicates.
	let pendingKey = '';
	let orderCode = '';

	async function confirm() {
		const computerIds = selectedIds;
		const key = JSON.stringify([start, minutes, computerIds]);
		if (key !== pendingKey) {
			pendingKey = key;
			orderCode = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
		}

		submitting = true;
		result = null;
		try {
			const res = await fetch('/api/bookings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ start, minutes, computerIds, orderCode })
			});
			if (res.status === 401) {
				location.href = '/login';
				return;
			}
			const body = (await res.json().catch(() => ({}))) as ApiResponse<{ orderCode: string }>;
			if (!res.ok) throw new Error(body.error ?? 'Booking failed. Please try again.');

			result = {
				kind: 'success',
				text: `Booked ${computerIds.map(nameOf).join(', ')} on ${describeLocal(start)} for ${hours} h. Order ${body.orderCode}.`
			};
			pendingKey = '';
			selected.clear();
		} catch (err) {
			result = { kind: 'error', text: (err as Error).message };
		} finally {
			submitting = false;
			refresh++;
		}
	}

	const dateLabel = $derived(
		validInput
			? new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(
					new Date(`${date}T00:00`)
				)
			: '—'
	);
</script>

<section class="intro">
	<p class="eyebrow">Online booking</p>
	<h1>Book a PC</h1>
	<p class="muted">Choose when you're coming, then pick the PCs you want.</p>
	<div class="hazard" aria-hidden="true"></div>
</section>

{#if data.loadError}
	<p class="notice error" role="alert">{data.loadError}</p>
{:else}
	<div class="grid">
		<div class="main">
			<section class="card" aria-labelledby="when-title">
				<h2 id="when-title"><span class="step">1</span>When</h2>
				<div class="controls">
					<label>
						Date
						<input type="date" bind:value={date} min={today} required />
					</label>
					<label>
						Arrival time
						<input type="time" bind:value={time} step="900" required />
					</label>
					<label>
						Duration
						<select bind:value={hours}>
							{#each HOUR_OPTIONS as h (h)}
								<option value={h}>{h} {h === 1 ? 'hour' : 'hours'}</option>
							{/each}
						</select>
					</label>
				</div>
			</section>

			{#if inPast}
				<p class="notice error" role="alert">That time has already passed. Pick a later start.</p>
			{:else if availabilityError}
				<p class="notice error" role="alert">{availabilityError}</p>
			{/if}

			<section class="card" aria-labelledby="seats-title">
				<div class="map-head">
					<h2 id="seats-title"><span class="step">2</span>Pick your PCs</h2>
					<ul class="legend" aria-label="Legend">
						<li><span class="swatch free"></span>Available</li>
						<li><span class="swatch picked"></span>Selected</li>
						<li><span class="swatch taken"></span>Unavailable</li>
					</ul>
				</div>

				{#if layouts.length > 1}
					<div class="tabs" role="tablist" aria-label="Area">
						{#each layouts as layout (layout.id)}
							<button
								type="button"
								role="tab"
								aria-selected={layout.id === activeLayoutId}
								onclick={() => (layoutId = layout.id)}>{layout.name}</button
							>
						{/each}
					</div>
				{:else if layouts.length === 1}
					<p class="area">{layouts[0].name}</p>
				{/if}

				<div class="floor" aria-busy={checking} bind:clientWidth={floorWidth}>
					{#if map.seats.length > 0}
						<!-- Outer box takes the zoomed size so the floor scrolls exactly as far as needed. -->
						<div style:width="{map.width * zoom}px" style:height="{map.height * zoom}px">
							<div
								class="map"
								style:width="{map.width}px"
								style:height="{map.height}px"
								style:transform={zoom === 1 ? undefined : `scale(${zoom})`}
								style:--seat-w="{TILE.width}px"
								style:--seat-h="{TILE.height}px"
							>
								{#each map.seats as seat (seat.id)}
									{@render seatButton(seat.id, `left:${seat.left}px;top:${seat.top}px`)}
								{/each}
							</div>
						</div>
					{:else if data.pcs.length > 0}
						<div class="list">
							{#each data.pcs as pc (pc.id)}
								{@render seatButton(pc.id, '')}
							{/each}
						</div>
					{:else}
						<p class="empty">No PCs are set up for booking yet.</p>
					{/if}
				</div>
			</section>
		</div>

		<aside class="pass" aria-labelledby="pass-title">
			<div class="pass-head">
				<p class="eyebrow" id="pass-title"><span class="step">3</span>Booking pass</p>
				<p class="pass-time">{validInput ? time : '--:--'}</p>
				<p class="pass-date">{dateLabel}</p>
			</div>

			<div class="perforation" aria-hidden="true"></div>

			<div class="pass-body">
				<dl>
					<dt>Duration</dt>
					<dd>{hours} {hours === 1 ? 'hour' : 'hours'}</dd>
					<dt>PCs</dt>
					<dd>{selectedIds.length ? selectedIds.map(nameOf).join(', ') : 'None selected'}</dd>
					{#if selectedIds.length > 1}
						<dt>Total PC time</dt>
						<dd class="total">{selectedIds.length * hours} hours</dd>
					{/if}
				</dl>

				{#if result}
					<p class="notice {result.kind}" role={result.kind === 'error' ? 'alert' : 'status'}>
						{result.text}
						{#if result.kind === 'success'}<a href="/bookings">View my bookings</a>{/if}
					</p>
				{/if}

				<button class="primary" type="button" disabled={!canBook || submitting} onclick={confirm}>
					{submitting ? 'Booking…' : checking ? 'Checking…' : 'Confirm booking'}
				</button>
			</div>
		</aside>
	</div>
{/if}

{#snippet seatButton(id: string, style: string)}
	{@const taken = unavailable.has(id)}
	{@const picked = selected.has(id)}
	<button
		type="button"
		class="seat"
		class:taken
		class:picked
		{style}
		disabled={taken || inPast || !validInput}
		aria-pressed={picked}
		aria-label={taken ? `${nameOf(id)}, unavailable` : nameOf(id)}
		title={taken ? `${nameOf(id)} is not available` : nameOf(id)}
		onclick={() => toggle(id)}
	>
		<span class="screen" aria-hidden="true"></span>
		<span class="seat-name">{nameOf(id)}</span>
	</button>
{/snippet}

<style>
	.intro {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 2.25rem;
	}

	.intro .hazard {
		margin-top: 0.4rem;
	}

	.intro .muted {
		margin: 0;
		font-size: 1.05rem;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 1.5rem;
		align-items: start;
	}

	.main {
		display: grid;
		/* Let the seat map scroll inside its card instead of widening the page. */
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		min-width: 0;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* The three steps really are a sequence: when, which PCs, confirm. */
	.step {
		display: inline-grid;
		place-items: center;
		width: 1.9rem;
		height: 1.6rem;
		background: var(--fire);
		color: var(--weiss);
		font-size: 0.75rem;
		letter-spacing: 0;
		clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.map-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.swatch {
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 3px;
	}

	.swatch.free {
		border: 2px solid var(--free);
	}

	.swatch.picked {
		background: var(--fire);
	}

	.swatch.taken {
		background: repeating-linear-gradient(-45deg, var(--rosewood) 0 3px, transparent 3px 6px);
		border: 1px solid var(--rosewood);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 1rem;
		border-bottom: 1px solid var(--border);
	}

	.tabs button {
		background: none;
		border: none;
		border-bottom: 3px solid transparent;
		border-radius: 0;
		margin-bottom: -1px;
		font-family: var(--font-sub);
		font-size: 0.78rem;
		font-weight: 400;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.tabs button:hover {
		color: var(--text);
	}

	.tabs button[aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--fire);
	}

	.area {
		margin: 0.75rem 0 0;
		font-family: var(--font-sub);
		font-size: 0.78rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* The center floor: a dotted plan the PCs sit on. */
	.floor {
		margin-top: 1rem;
		overflow: auto;
		border-radius: var(--radius);
		background-color: var(--bg);
		background-image: radial-gradient(var(--grid-dot) 1.2px, transparent 1.2px);
		background-size: 18px 18px;
		transition: opacity 0.2s;
	}

	.floor[aria-busy='true'] {
		opacity: 0.55;
	}

	.map {
		position: relative;
		transform-origin: 0 0;
	}

	.map .seat {
		position: absolute;
		width: var(--seat-w);
		height: var(--seat-h);
		min-height: 0;
		padding: 0.2rem 0.15rem;
	}

	.map .seat-name {
		font-size: 0.68rem;
		letter-spacing: 0;
	}

	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 0.6rem;
		padding: 1rem;
	}

	.empty {
		margin: 0;
		padding: 2rem 1rem;
		color: var(--muted);
		text-align: center;
	}

	.seat {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 0.3rem;
		min-height: 52px;
		padding: 0.3rem;
		background: var(--surface);
		border: 2px solid var(--free);
		color: var(--text);
	}

	.screen {
		width: 60%;
		height: 3px;
		border-radius: 2px;
		background: var(--free);
	}

	.seat-name {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-sub);
		font-size: 0.7rem;
		font-weight: 400;
		letter-spacing: 0.03em;
	}

	.seat:not(:disabled):hover {
		background: var(--surface-2);
		transform: translateY(-1px);
	}

	.seat.picked {
		background: var(--fire);
		border-color: var(--fire);
		color: var(--weiss);
		box-shadow: 0 4px 14px rgb(207 37 40 / 0.4);
	}

	.seat.picked .screen {
		background: var(--saffron);
	}

	.seat.picked:not(:disabled):hover {
		background: var(--fire-hover);
	}

	.seat.taken {
		background:
			repeating-linear-gradient(-45deg, rgb(99 16 17 / 0.45) 0 4px, transparent 4px 9px),
			var(--surface);
		border-color: var(--rosewood);
		color: var(--muted);
		opacity: 1;
	}

	.seat.taken .screen {
		background: var(--rosewood);
	}

	.seat.taken .seat-name {
		text-decoration: line-through;
	}

	/* Booking pass: the ticket you are about to take. */
	.pass {
		--notch: 11px;
		position: sticky;
		top: 1.25rem;
		filter: drop-shadow(0 10px 24px rgb(0 0 0 / 0.25));
	}

	.pass-head {
		background: var(--rosewood);
		color: var(--weiss);
		padding: 1.25rem 1.25rem 1.1rem;
		border-radius: var(--radius) var(--radius) 0 0;
	}

	.pass-head .eyebrow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		color: var(--saffron);
	}

	.pass-time {
		margin: 0.6rem 0 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 2.6rem;
		line-height: 1;
		letter-spacing: -0.01em;
		text-shadow: 0.06em 0.06em 0 var(--verdigris);
	}

	.pass-date {
		margin: 0.35rem 0 0;
		font-weight: 600;
		opacity: 0.85;
	}

	/* Tear line with half-circle notches cut out of both edges. */
	.perforation {
		position: relative;
		height: calc(var(--notch) * 2);
		background:
			linear-gradient(var(--surface), var(--surface)) bottom / 100% 50% no-repeat,
			linear-gradient(var(--rosewood), var(--rosewood)) top / 100% 50% no-repeat;
		-webkit-mask:
			radial-gradient(circle var(--notch) at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat,
			radial-gradient(circle var(--notch) at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat;
		mask:
			radial-gradient(circle var(--notch) at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat,
			radial-gradient(circle var(--notch) at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat;
	}

	.perforation::after {
		content: '';
		position: absolute;
		left: calc(var(--notch) + 6px);
		right: calc(var(--notch) + 6px);
		top: 50%;
		border-top: 2px dashed var(--border);
	}

	.pass-body {
		display: grid;
		gap: 1rem;
		background: var(--surface);
		padding: 0.6rem 1.25rem 1.25rem;
		border-radius: 0 0 var(--radius) var(--radius);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.6rem 1rem;
		margin: 0;
	}

	dt {
		font-family: var(--font-sub);
		font-size: 0.7rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		padding-top: 0.15rem;
	}

	dd {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	dd.total {
		color: var(--highlight);
		font-weight: 700;
	}

	.pass-body .notice a {
		display: block;
		margin-top: 0.4rem;
	}

	@media (max-width: 920px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.pass {
			position: static;
		}
	}

	@media (max-width: 560px) {
		.controls {
			grid-template-columns: 1fr 1fr;
		}

		.controls label:last-child {
			grid-column: 1 / -1;
		}
	}
</style>
