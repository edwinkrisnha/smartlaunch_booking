<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { INTL_LOCALES, translator } from '#lib/i18n/index.js';
	import { formatMoney, parseAmount } from '#lib/money.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const t = $derived(translator(data.locale));
	const intlLocale = $derived(INTL_LOCALES[data.locale]);
	const money = (cents: number) => formatMoney(cents, data.currency, intlLocale);

	// Starting values only; afterwards the inputs own them. The middle quick-pick is the
	// usual choice; "other" opens a free amount field.
	let choice = $state(
		untrack(() => form?.choice ?? String(data.amounts[Math.floor(data.amounts.length / 2)] ?? 'other'))
	);
	let other = $state(untrack(() => form?.other ?? ''));
	let submitting = $state(false);

	const cents = $derived.by(() => {
		const value = parseAmount(choice === 'other' ? other : choice);
		return value !== null && value >= data.min * 100 && value <= data.max * 100 ? value : null;
	});

	const dateFormat = $derived(
		new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timeZone })
	);
</script>

<section class="intro">
	<p class="eyebrow">{t('topup.eyebrow')}</p>
	<h1>{t('topup.title')}</h1>
	<p class="muted">{t('topup.intro')}</p>
	<div class="hazard" aria-hidden="true"></div>
</section>

<div class="topup">
	<form
		class="card"
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ result, update }) => {
				// The payment page is on another site, so leave the app instead of navigating inside it.
				if (result.type === 'redirect') {
					location.href = result.location;
					return;
				}
				submitting = false;
				await update({ reset: false });
			};
		}}
	>
		{#if form?.error}
			<p class="notice error" role="alert">{form.error}</p>
		{/if}

		<fieldset>
			<legend>{t('topup.amount')}</legend>
			<div class="choices">
				{#each data.amounts as amount (amount)}
					<label>
						<input type="radio" name="amount" value={String(amount)} bind:group={choice} />
						<span>{money(Math.round(amount * 100))}</span>
					</label>
				{/each}
				<label>
					<input type="radio" name="amount" value="other" bind:group={choice} />
					<span>{t('topup.other')}</span>
				</label>
			</div>
		</fieldset>

		{#if choice === 'other'}
			<label>
				{t('topup.otherAmount')}
				<input name="other" inputmode="decimal" autocomplete="off" maxlength="9" bind:value={other} />
				<span class="note">{t('topup.limits', { min: money(data.min * 100), max: money(data.max * 100) })}</span>
			</label>
		{/if}

		<button class="primary" type="submit" disabled={cents === null || submitting}>
			{submitting ? t('topup.redirecting') : cents !== null ? t('topup.pay', { amount: money(cents) }) : t('topup.choose')}
		</button>
		<p class="muted secure">{t('topup.secure', { provider: data.providerName })}</p>
	</form>

	<aside class="balance" aria-label={t('topup.balance')}>
		<p class="eyebrow">{t('topup.balance')}</p>
		<p class="value">{data.balance === null ? '—' : money(data.balance)}</p>
	</aside>
</div>

{#if data.orders.length > 0}
	<section class="card history" aria-labelledby="history-title">
		<h2 id="history-title">{t('topup.history')}</h2>
		<ul>
			{#each data.orders as order (order.id)}
				<li>
					<span class="when">{dateFormat.format(new Date(order.createdAt * 1000))}</span>
					<span class="amount">{formatMoney(order.amountCents, order.currency, intlLocale)}</span>
					<span class="status {order.status}">{t(`topup.status.${order.status}`)}</span>
				</li>
			{/each}
		</ul>
	</section>
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

	.intro .muted {
		margin: 0;
		font-size: 1.05rem;
	}

	.topup {
		display: grid;
		grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}

	form {
		display: grid;
		gap: 1.25rem;
		padding: 1.75rem;
		border-top: 4px solid var(--accent);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--panel-cut)), calc(100% - var(--panel-cut)) 100%, 0 100%);
	}

	.choices {
		flex-wrap: wrap;
	}

	.choices label {
		flex-basis: 5.5rem;
	}

	.choices span {
		min-height: 3rem;
		font-size: 1rem;
	}

	.note {
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 500;
		letter-spacing: normal;
		text-transform: none;
	}

	form button {
		justify-self: start;
	}

	.secure {
		margin: 0;
		font-size: 0.85rem;
	}

	/* Balance as a ticket stub, like the booking pass. */
	.balance {
		display: grid;
		gap: 0.4rem;
		padding: 1.4rem 1.6rem;
		background: var(--pass-bg);
		color: var(--pass-fg);
		border-radius: var(--radius);
		border-left: 2px dashed var(--pass-tear);
		clip-path: polygon(0 0, 100% 0, 100% 100%, var(--pass-cut) 100%, 0 calc(100% - var(--pass-cut)));
	}

	.balance .eyebrow {
		margin: 0;
		color: var(--pass-accent);
	}

	.balance .value {
		margin: 0;
		font-family: var(--font-display);
		font-weight: var(--display-weight);
		font-size: clamp(2rem, 5vw, 2.8rem);
		line-height: 1;
		letter-spacing: var(--display-spacing);
		text-shadow: var(--headline-shadow);
	}

	.history {
		margin-top: 1.25rem;
		max-width: 560px;
	}

	.history ul {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
		display: grid;
	}

	.history li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0;
		border-top: 1px solid var(--border);
	}

	.when {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.amount {
		font-weight: 700;
		text-align: right;
	}

	.status {
		font-size: 0.78rem;
		font-weight: 700;
		padding: 0.2rem 0.55rem;
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--muted);
		white-space: nowrap;
	}

	.status.delivered {
		color: var(--highlight);
	}

	.status.failed,
	.status.expired {
		color: var(--danger);
	}

	@media (max-width: 760px) {
		.topup {
			grid-template-columns: minmax(0, 1fr);
		}

		/* Balance first on phones: it's what people look for. */
		.balance {
			order: -1;
		}
	}

	@media (max-width: 480px) {
		.history li {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.status {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
</style>
