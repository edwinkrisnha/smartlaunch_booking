<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);
</script>

<section class="card">
	<h1>Log in</h1>
	<p class="muted">Use your center account to book a PC.</p>

	{#if form?.error}
		<p class="notice error" role="alert">{form.error}</p>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
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
	section {
		max-width: 380px;
		margin: 3rem auto;
	}

	form {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}
</style>
