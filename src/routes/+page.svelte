<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { describeLocal } from '#lib/time.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Our API endpoints answer either the payload or `{ error }`. */
	type ApiResponse<T> = Partial<T> & { error?: string };

	// Same spacing the MVC web client applies to the admin layout coordinates.
	const SCALE_X = 1.1;
	const SCALE_Y = 1.35;
	const SEAT_W = 76;
	const SEAT_H = 52;
	const PADDING = 16;
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
		const seats = raw.map((s) => ({
			id: s.computerId,
			left: Math.round((s.x - minX) * SCALE_X) + PADDING,
			top: Math.round((s.y - minY) * SCALE_Y) + PADDING
		}));
		return {
			seats,
			width: Math.max(...seats.map((s) => s.left)) + SEAT_W + PADDING,
			height: Math.max(...seats.map((s) => s.top)) + SEAT_H + PADDING
		};
	});

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
</script>

<h1>Book a PC</h1>

{#if data.loadError}
	<p class="notice error" role="alert">{data.loadError}</p>
{:else}
	<div class="grid">
		<div class="main">
			<section class="card controls" aria-label="When">
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
			</section>

			{#if inPast}
				<p class="notice error" role="alert">That time has already passed. Pick a later start.</p>
			{:else if availabilityError}
				<p class="notice error" role="alert">{availabilityError}</p>
			{/if}

			<section class="card" aria-label="Choose PCs">
				<div class="map-head">
					{#if layouts.length > 1}
						<div class="tabs" role="tablist">
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
						<h2>{layouts[0].name}</h2>
					{:else}
						<h2>PCs</h2>
					{/if}
					<ul class="legend" aria-label="Legend">
						<li><span class="swatch free"></span>Available</li>
						<li><span class="swatch picked"></span>Selected</li>
						<li><span class="swatch taken"></span>Unavailable</li>
					</ul>
				</div>

				<div class="map-scroll" aria-busy={checking}>
					{#if map.seats.length > 0}
						<div class="map" style:width="{map.width}px" style:height="{map.height}px">
							{#each map.seats as seat (seat.id)}
								{@render seatButton(seat.id, `left:${seat.left}px;top:${seat.top}px`)}
							{/each}
						</div>
					{:else if data.pcs.length > 0}
						<div class="list">
							{#each data.pcs as pc (pc.id)}
								{@render seatButton(pc.id, '')}
							{/each}
						</div>
					{:else}
						<p class="muted">No PCs are set up for booking yet.</p>
					{/if}
				</div>
			</section>
		</div>

		<aside class="card summary" aria-label="Summary">
			<h2>Your booking</h2>
			<dl>
				<dt>Arrival</dt>
				<dd>{validInput ? describeLocal(start) : '—'}</dd>
				<dt>Duration</dt>
				<dd>{hours} {hours === 1 ? 'hour' : 'hours'}</dd>
				<dt>PCs</dt>
				<dd>{selectedIds.length ? selectedIds.map(nameOf).join(', ') : 'None selected'}</dd>
				{#if selectedIds.length > 1}
					<dt>Total PC time</dt>
					<dd>{selectedIds.length * hours} hours</dd>
				{/if}
			</dl>

			{#if result}
				<p class="notice {result.kind}" role={result.kind === 'error' ? 'alert' : 'status'}>
					{result.text}
					{#if result.kind === 'success'}<a href="/bookings">View my bookings</a>{/if}
				</p>
			{/if}

			<button class="primary" type="button" disabled={!canBook || submitting} onclick={confirm}>
				{submitting ? 'Booking…' : checking ? 'Checking availability…' : 'Confirm booking'}
			</button>
		</aside>
	</div>
{/if}

{#snippet seatButton(id: string, style: string)}
	{@const taken = unavailable.has(id)}
	<button
		type="button"
		class="seat"
		class:taken
		class:picked={selected.has(id)}
		{style}
		disabled={taken || inPast || !validInput}
		aria-pressed={selected.has(id)}
		title={taken ? `${nameOf(id)} is not available` : nameOf(id)}
		onclick={() => toggle(id)}
	>
		{nameOf(id)}
	</button>
{/snippet}

<style>
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 1.25rem;
		align-items: start;
	}

	.main {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.map-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.map-head h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.tabs button[aria-selected='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.legend {
		display: flex;
		gap: 1rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 3px;
		border: 1px solid var(--border);
	}

	.swatch.free {
		background: var(--seat-free);
	}

	.swatch.picked {
		background: var(--accent);
	}

	.swatch.taken {
		background: var(--seat-taken);
	}

	.map-scroll {
		overflow: auto;
		border-radius: 8px;
		background: var(--bg);
		transition: opacity 0.15s;
	}

	.map-scroll[aria-busy='true'] {
		opacity: 0.6;
	}

	.map {
		position: relative;
	}

	.map .seat {
		position: absolute;
		width: 76px;
		height: 52px;
	}

	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		gap: 0.5rem;
		padding: 1rem;
	}

	.seat {
		background: var(--seat-free);
		border-color: var(--border);
		font-size: 0.8rem;
		padding: 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-height: 52px;
	}

	.seat:not(:disabled):hover {
		border-color: var(--accent);
	}

	.seat.picked {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}

	.seat.taken {
		background: var(--seat-taken);
		color: var(--muted);
		text-decoration: line-through;
		opacity: 1;
	}

	.summary {
		position: sticky;
		top: 1rem;
		display: grid;
		gap: 0.75rem;
	}

	.summary h2 {
		font-size: 1.05rem;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.4rem 1rem;
		margin: 0;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.summary .notice {
		margin: 0;
	}

	.summary .notice a {
		display: block;
		margin-top: 0.4rem;
	}

	@media (max-width: 900px) {
		.grid {
			grid-template-columns: 1fr;
		}

		.summary {
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
