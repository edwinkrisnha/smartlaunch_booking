<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { INTL_LOCALES, translator } from '#lib/i18n/index.js';
	import { formatMoney } from '#lib/money.js';
	import { describeLocal } from '#lib/time.js';
	import { UNPAID_ORDER_KEY } from '#lib/unpaid.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Back here from the payment page, so going on to the booking page isn't "came back without paying".
	$effect(() => {
		try {
			if (sessionStorage.getItem(UNPAID_ORDER_KEY) === data.order.id) sessionStorage.removeItem(UNPAID_ORDER_KEY);
		} catch {
			// Storage blocked: nothing was stored either.
		}
	});

	let cancelling = $state(false);
	let cancelError = $state('');

	async function cancel() {
		cancelling = true;
		cancelError = '';
		try {
			const res = await fetch(`/api/bookings/${encodeURIComponent(data.order.id)}/cancel`, { method: 'POST' });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				cancelError = body.error ?? t('book.failed');
			}
		} catch {
			cancelError = t('book.failed');
		} finally {
			await invalidateAll();
			cancelling = false;
		}
	}

	const t = $derived(translator(data.locale));
	const intlLocale = $derived(INTL_LOCALES[data.locale]);
	const amount = $derived(formatMoney(data.order.amountCents, data.order.currency, intlLocale));

	const view = $derived.by(() => {
		const { status } = data.order;
		if (status === 'delivered') return 'booked';
		if (status === 'paid') return 'confirming';
		if (status === 'needs_refund') return 'refund';
		if (data.order.cancelled) return 'cancelled';
		if (status === 'pending' && data.providerStatus !== 'failed') return 'pending';
		return 'failed';
	});

	const params = $derived({
		amount,
		pcs: data.order.computerNames.join(', '),
		when: describeLocal(data.order.start, intlLocale),
		end: data.order.end.slice(11),
		minutes: data.holdMinutes,
		id: data.order.id
	});

	// Keep checking while the outcome is open: every 3 s for about two minutes.
	let polls = 0;
	$effect(() => {
		if (view !== 'pending' && view !== 'confirming') return;
		if (polls >= 40) return;
		const timer = setTimeout(() => {
			polls++;
			invalidateAll();
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

<section class="result card {view}" aria-live="polite">
	<p class="eyebrow">
		{#if data.order.bookingId && view === 'booked'}{t('book.bookingNumber', { id: data.order.bookingId })} ·
		{/if}{t('book.order', { id: data.order.id })}
	</p>
	<h1>{t(`book.return.${view}.title`)}</h1>
	<p class="message">{t(`book.return.${view}`, params)}</p>
	{#if cancelError}<p class="message error" role="alert">{cancelError}</p>{/if}

	<div class="actions">
		{#if view === 'booked'}
			<a class="cta" href="/bookings">{t('book.viewBookings')}</a>
		{:else if view === 'failed' || view === 'cancelled'}
			<a class="cta" href="/">{t('book.return.again')}</a>
		{:else if view === 'pending'}
			<button type="button" disabled={cancelling} onclick={cancel}>{t('book.return.cancel')}</button>
		{:else if view === 'refund'}
			<a href="/">{t('book.return.again')}</a>
		{/if}
	</div>
</section>

<style>
	.result {
		display: grid;
		gap: 0.9rem;
		max-width: 560px;
		margin: 2rem auto 0;
		padding: 2rem;
		border-top: 4px solid var(--muted);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--panel-cut)), calc(100% - var(--panel-cut)) 100%, 0 100%);
	}

	.result.booked {
		border-top-color: var(--highlight);
	}

	.result.confirming,
	.result.pending {
		border-top-color: var(--accent);
	}

	.error {
		color: var(--danger);
	}

	.result.failed,
	.result.cancelled,
	.result.refund {
		border-top-color: var(--danger);
	}

	.eyebrow,
	.message,
	h1 {
		margin: 0;
	}

	h1 {
		font-size: clamp(1.8rem, 5vw, 2.6rem);
	}

	.message {
		font-size: 1.05rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.5rem;
		margin-top: 0.5rem;
	}
</style>
