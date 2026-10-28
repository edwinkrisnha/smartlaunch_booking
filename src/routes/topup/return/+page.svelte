<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { INTL_LOCALES, translator } from '#lib/i18n/index.js';
	import { formatMoney } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const t = $derived(translator(data.locale));
	const amount = $derived(formatMoney(data.order.amountCents, data.order.currency, INTL_LOCALES[data.locale]));

	// A checkout the provider reports as failed can still be retried on its page, so the
	// order stays pending for a while; to the customer it has failed.
	const view = $derived.by(() => {
		const { status } = data.order;
		if (status === 'delivered' || status === 'paid') return status;
		if (status === 'pending' && data.providerStatus !== 'failed') return 'pending';
		return 'failed';
	});

	// Keep checking while the outcome is open: every 3 s for about two minutes.
	let polls = 0;
	$effect(() => {
		if (view !== 'pending' && view !== 'paid') return;
		if (polls >= 40) return;
		const timer = setTimeout(() => {
			polls++;
			invalidateAll();
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

<section class="result card {view}" aria-live="polite">
	<p class="eyebrow">{t('topup.order', { id: data.order.id })}</p>
	<h1>{t(`topup.return.${view}.title`)}</h1>
	<p class="message">{t(`topup.return.${view}`, { amount })}</p>

	<div class="actions">
		{#if view === 'failed'}
			<a class="cta" href="/topup">{t('topup.return.again')}</a>
		{:else if view === 'delivered'}
			<a class="cta" href="/">{t('bookings.cta')}</a>
			<a href="/topup">{t('topup.return.back')}</a>
		{:else}
			<a href="/topup">{t('topup.return.back')}</a>
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

	.result.delivered {
		border-top-color: var(--highlight);
	}

	.result.paid,
	.result.pending {
		border-top-color: var(--accent);
	}

	.result.failed {
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
