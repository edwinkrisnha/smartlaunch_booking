<script lang="ts">
	import { enhance } from '$app/forms';
	import { translator } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let submitting = $state(false);

	const t = $derived(translator(data.locale));
</script>

<section class="login">
	<div class="intro">
		<p class="eyebrow">{data.centerName}</p>
		<h1>{t('login.title')}<br /><span class="accent-text">{t('login.titleAccent')}</span></h1>
		<p class="muted">{t('login.intro')}</p>
		<div class="hazard" aria-hidden="true"></div>
	</div>

	<form
		class="card"
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		{#if form?.error}
			<p class="notice error" role="alert">{form.error}</p>
		{/if}

		<label>
			{t('field.username')}
			<input name="username" autocomplete="username" required value={form?.username ?? ''} />
		</label>
		<label>
			{t('field.password')}
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		<button class="primary" type="submit" disabled={submitting}>
			{submitting ? t('login.submitting') : t('login.submit')}
		</button>
		{#if data.signupEnabled}
			<p class="switch muted">{t('login.noAccount')} <a href="/signup">{t('login.createAccount')}</a></p>
		{/if}
	</form>
</section>

<style>
	.login {
		display: grid;
		grid-template-columns: 1fr minmax(0, 400px);
		gap: 3rem;
		align-items: center;
		width: 100%;
		max-width: 900px;
		margin: 0 auto;
	}

	.intro {
		display: grid;
		gap: 0.8rem;
	}

	.intro .muted {
		margin: 0;
		max-width: 30ch;
	}

	h1 {
		font-size: clamp(2.4rem, 6vw, 4rem);
	}

	form {
		display: grid;
		gap: 1.1rem;
		padding: 1.75rem;
		border-top: 4px solid var(--accent);
		/* Angled lower-right corner, matching the site's cut panels. */
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--panel-cut)), calc(100% - var(--panel-cut)) 100%, 0 100%);
	}

	form button {
		justify-self: start;
	}

	.switch {
		margin: 0;
	}

	@media (max-width: 720px) {
		.login {
			grid-template-columns: 1fr;
			gap: 1.75rem;
			margin: 0 auto;
		}
	}
</style>
