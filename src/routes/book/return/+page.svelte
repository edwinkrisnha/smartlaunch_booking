<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { INTL_LOCALES, translator } from '#lib/i18n/index.js';
	import { formatMoney } from '#lib/money.js';
	import { describeLocal } from '#lib/time.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const t = $derived(translator(data.locale));
	const intlLocale = $derived(INTL_LOCALES[data.locale]);
	const amount = $derived(formatMoney(data.order.amountCents, data.order.currency, intlLocale));

	const view = $derived.by(() => {
		const { status } = data.order;
		if (status === 'delivered') return 'booked';
		if (status === 'paid') return 'confirming';
		if (status === 'needs_refund') return 'refund';
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
	<p class="eyebrow">{t('book.order', { id: data.order.id })}</p>
	<h1>{t(`book.return.${view}.title`)}</h1>
	<p class="message">{t(`book.return.${view}`, params)}</p>

	<div class="actions">
		{#if view === 'booked'}
			<a class="cta" href="/bookings">{t('book.viewBookings')}</a>
		{:else if view === 'failed'}
			<a class="cta" href="/">{t('book.return.again')}</a>
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

	.result.failed,
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
