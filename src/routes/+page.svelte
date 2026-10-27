<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { describeLocal } from '#lib/time.js';
	import { placeSeats } from '#lib/seatmap.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Our API endpoints answer either the payload or `{ error }`. */
	type ApiResponse<T> = Partial<T> & { error?: string };

	// Tiles show the PC's ID (at most 3 digits), so they can stay small with large text.
	const TILE = { width: 46, height: 40, gapX: 4, gapY: 8 };
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
	const consoles = $derived(new Map(data.pcs.filter((pc) => pc.console).map((pc) => [pc.id, pc.console!])));
	/** Name plus console type, for tooltips and screen readers. */
	const describe = (id: string) => (consoles.has(id) ? `${nameOf(id)}, ${consoles.get(id)}` : nameOf(id));

	const layouts = $derived(data.layouts.filter((l) => data.seats.some((s) => s.layoutId === l.id)));
	const activeLayoutId = $derived(layouts.some((l) => l.id === layoutId) ? layoutId : (layouts[0]?.id ?? ''));

	const map = $derived.by(() => {
		const raw = data.seats.filter((s) => s.layoutId === activeLayoutId);
		if (raw.length === 0) return { seats: [], width: 0, height: 0 };
		const placed = placeSeats(raw, TILE);
		const minX = Math.min(...placed.map((p) => p.x));
		const minY = Math.min(...placed.map((p) => p.y));
		const seats = raw.map((s, i) => ({
			id: s.computerId,
			left: Math.round(placed[i].x - minX) + PADDING,
			top: Math.round(placed[i].y - minY) + PADDING
		}));
		return {
			seats,
			width: Math.max(...seats.map((s) => s.left)) + TILE.width + PADDING,
			height: Math.max(...seats.map((s) => s.top)) + TILE.height + PADDING
		};
	});

	let floorWidth = $state(0);
	/** Height of the docked booking bar; the page reserves that much space below the map. */
	let barHeight = $state(0);
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

	const formatDate = (style: 'long' | 'short') =>
		validInput
			? new Intl.DateTimeFormat(undefined, { weekday: style, day: 'numeric', month: style }).format(
					new Date(`${date}T00:00`)
				)
			: '—';
	const dateLabel = $derived(formatDate('long'));
	const dateLabelShort = $derived(formatDate('short'));
</script>

<section class="intro">
	<p class="eyebrow">Online booking</p>
	<h1>Book a PC</h1>
	<p class="muted">Choose when you're coming, then pick the PCs you want.</p>
	<div class="hazard" aria-hidden="true"></div>
</section>

{#if data.loadError}
	<p class="notice error page-error" role="alert">{data.loadError}</p>
{:else}
	<div class="steps" style:padding-bottom="{barHeight + 24}px">
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

		<section class="card picker" aria-labelledby="seats-title">
			<div class="map-head">
				<h2 id="seats-title"><span class="step">2</span>Pick your PCs</h2>
				<ul class="legend" aria-label="Legend">
					<li><span class="swatch free"></span>Available</li>
					<li><span class="swatch picked"></span>Selected</li>
					<li><span class="swatch taken"></span>Unavailable</li>
					{#if consoles.size > 0}
						<li class="kind"><span class="screen" aria-hidden="true"></span>PC</li>
						<li class="kind">{@render gamepad()}Console</li>
					{/if}
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

	<!-- Booking pass, docked to the bottom of the screen so it stays in reach while picking PCs. -->
	<section class="pass-bar" aria-labelledby="pass-title" bind:clientHeight={barHeight}>
		<div class="pass-inner">
			{#if result}
				<p class="notice {result.kind}" role={result.kind === 'error' ? 'alert' : 'status'}>
					{result.text}
					{#if result.kind === 'success'}<a href="/bookings">View my bookings</a>{/if}
				</p>
			{/if}

			<div class="pass-row">
				<div class="stub">
					<p class="eyebrow" id="pass-title"><span class="step">3</span>Booking pass</p>
					<p class="stub-when">
						<span class="pass-time">{validInput ? time : '--:--'}</span>
						<span class="pass-date long">{dateLabel}</span>
						<span class="pass-date short">{dateLabelShort}</span>
					</p>
				</div>

				<dl class="facts">
					<div>
						<dt>Duration</dt>
						<dd>{hours} {hours === 1 ? 'hour' : 'hours'}</dd>
					</div>
					<div class="pcs">
						<dt>PCs</dt>
						<dd title={selectedIds.map(nameOf).join(', ')}>
							{selectedIds.length ? selectedIds.map(nameOf).join(', ') : 'None selected'}
						</dd>
					</div>
					{#if selectedIds.length > 1}
						<div>
							<dt>Total PC time</dt>
							<dd class="total">{selectedIds.length * hours} hours</dd>
						</div>
					{/if}
				</dl>

				<button class="primary" type="button" disabled={!canBook || submitting} onclick={confirm}>
					{submitting ? 'Booking…' : checking ? 'Checking…' : 'Confirm booking'}
				</button>
			</div>
		</div>
	</section>
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
		aria-label={taken ? `${describe(id)}, unavailable` : describe(id)}
		title={taken ? `${describe(id)} is not available` : describe(id)}
		onclick={() => toggle(id)}
	>
		{#if consoles.has(id)}
			{@render gamepad()}
		{:else}
			<span class="screen" aria-hidden="true"></span>
		{/if}
		<span class="seat-name">{id}</span>
	</button>
{/snippet}

<!-- Consoles get a gamepad where PCs show a monitor bar; both take the tile's status colour. -->
{#snippet gamepad()}
	<svg class="pad" viewBox="0 0 24 16" aria-hidden="true">
		<path
			fill-rule="evenodd"
			d="M7 2h10a6 6 0 0 1 5.8 7.5l-.9 3.6a2.5 2.5 0 0 1-4.3 1.1L15 11.5H9l-2.6 2.7a2.5 2.5 0 0 1-4.3-1.1l-.9-3.6A6 6 0 0 1 7 2zM6 5.5h1.5V7H9v1.5H7.5V10H6V8.5H4.5V7H6zm10.5.7a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2.3 2.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
		/>
	</svg>
{/snippet}

<style>
	/* The page spans the screen; everything except the PC picker keeps the site's 1200px column. */
	.intro,
	.page-error,
	.steps > :not(.picker) {
		width: 100%;
		max-width: 1168px;
		margin-inline: auto;
	}

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

	.steps {
		display: grid;
		/* Let the seat map scroll inside its card instead of widening the page. */
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
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
		max-width: 760px;
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
		font-size: 0.9rem;
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

	.pad {
		width: 16px;
		height: 11px;
		fill: var(--free);
		flex: none;
	}

	.legend .kind .screen {
		width: 0.95rem;
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

	.seat.picked .pad {
		fill: var(--saffron);
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

	.seat.taken .pad {
		fill: var(--rosewood);
	}

	.seat.taken .seat-name {
		text-decoration: line-through;
	}

	/* Booking pass, docked to the bottom of the viewport. */
	.pass-bar {
		position: fixed;
		inset: auto 0 0;
		z-index: 10;
		background: var(--jet);
		border-top: 3px solid var(--fire);
		box-shadow: 0 -12px 32px rgb(0 0 0 / 0.45);
	}

	.pass-inner {
		display: grid;
		gap: 0.75rem;
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
	}

	.pass-inner .notice a {
		margin-left: 0.5rem;
	}

	.pass-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.5rem;
	}

	/* Ticket stub with a dashed tear line on its trailing edge. */
	.stub {
		display: grid;
		gap: 0.35rem;
		padding: 0.6rem 1.4rem 0.6rem 0.9rem;
		margin: -0.15rem 0;
		background: var(--rosewood);
		color: var(--weiss);
		border-right: 2px dashed rgb(255 255 255 / 0.4);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px));
	}

	.stub .eyebrow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.68rem;
	}

	.stub .step {
		width: 1.6rem;
		height: 1.3rem;
		font-size: 0.65rem;
	}

	.stub-when {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin: 0;
	}

	.pass-time {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 1.9rem;
		line-height: 1;
		letter-spacing: -0.01em;
		text-shadow: 0.06em 0.06em 0 var(--verdigris);
	}

	.pass-date {
		font-weight: 600;
		font-size: 0.9rem;
		opacity: 0.85;
		white-space: nowrap;
	}

	.pass-date.short {
		display: none;
	}

	.facts {
		display: flex;
		gap: 0.5rem 2rem;
		margin: 0;
		min-width: 0;
	}

	.facts > div {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	.facts .pcs {
		flex: 1;
	}

	dt {
		font-family: var(--font-sub);
		font-size: 0.66rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}

	dd {
		margin: 0;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	dd.total {
		color: var(--highlight);
		font-weight: 700;
	}

	.pass-row .primary {
		min-width: 15rem;
	}

	@media (max-width: 860px) {
		.pass-row {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.75rem 1rem;
		}

		.facts {
			grid-column: 1 / -1;
			grid-row: 2;
			gap: 0.25rem 1.25rem;
		}

		.pass-row .primary {
			min-width: 0;
		}
	}

	@media (max-width: 560px) {
		.controls {
			grid-template-columns: 1fr 1fr;
		}

		.controls label:last-child {
			grid-column: 1 / -1;
		}

		.stub {
			padding-right: 1rem;
		}

		.stub .eyebrow {
			display: none;
		}

		.stub-when {
			flex-direction: column;
			gap: 0.25rem;
		}

		.pass-time {
			font-size: 1.5rem;
		}

		.pass-date {
			font-size: 0.78rem;
		}

		.pass-date.long {
			display: none;
		}

		.pass-date.short {
			display: inline;
		}

		.pass-row .primary {
			padding-left: 1rem;
			font-size: 0.75rem;
		}

		.facts dt {
			font-size: 0.6rem;
		}

		.facts dd {
			font-size: 0.85rem;
		}
	}
</style>
