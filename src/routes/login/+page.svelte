<script lang="ts">
	import { enhance } from '$app/forms';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);
</script>

<section class="login">
	<div class="intro">
		<p class="eyebrow">{PUBLIC_CENTER_NAME}</p>
		<h1>Log in<br /><span class="saffron">to book</span></h1>
		<p class="muted">Use the same username and password you use at the center.</p>
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
			Username
			<input name="username" autocomplete="username" required value={form?.username ?? ''} />
		</label>
		<label>
			Password
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		<button class="primary" type="submit" disabled={submitting}>
			{submitting ? 'Logging in…' : 'Log in'}
		</button>
	</form>
</section>

<style>
	.login {
		display: grid;
		grid-template-columns: 1fr minmax(0, 400px);
		gap: 3rem;
		align-items: center;
		max-width: 900px;
		margin: 3rem auto;
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
		border-top: 4px solid var(--fire);
		/* Angled lower-right corner, matching the site's cut panels. */
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%);
	}

	form button {
		justify-self: start;
	}

	@media (max-width: 720px) {
		.login {
			grid-template-columns: 1fr;
			gap: 1.75rem;
			margin: 1rem auto;
		}
	}
</style>
