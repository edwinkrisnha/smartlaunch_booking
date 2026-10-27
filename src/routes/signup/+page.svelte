<script lang="ts">
	import { enhance } from '$app/forms';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);

	const values = $derived(form?.values);
	const errors = $derived((form?.errors ?? {}) as Record<string, string | undefined>);
	const today = new Date().toISOString().slice(0, 10);
</script>

<section class="signup">
	<div class="intro">
		<p class="eyebrow">{PUBLIC_CENTER_NAME}</p>
		<h1>Create<br /><span class="accent-text">an account</span></h1>
		<p class="muted">You’ll use this username and password to book online and to log in at the center.</p>
		<div class="hazard" aria-hidden="true"></div>
	</div>

	<form
		class="card"
		method="POST"
		novalidate
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		{#if errors.form}
			<p class="notice error" role="alert">{errors.form}</p>
		{/if}

		{#snippet field(
			name: string,
			label: string,
			attrs: Record<string, unknown>,
			hint?: string
		)}
			<label class:wide={attrs.wide}>
				{label}
				<input
					{name}
					value={(values as Record<string, string> | undefined)?.[name] ?? ''}
					aria-invalid={errors[name] ? 'true' : undefined}
					aria-describedby={errors[name] || hint ? `${name}-note` : undefined}
					{...Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'wide'))}
				/>
				{#if errors[name]}
					<span class="note error" id="{name}-note">{errors[name]}</span>
				{:else if hint}
					<span class="note" id="{name}-note">{hint}</span>
				{/if}
			</label>
		{/snippet}

		<div class="fields">
			{@render field(
				'username',
				'Username',
				{ autocomplete: 'username', required: true, maxlength: 20, wide: true },
				'3–20 characters: letters, numbers, dot, dash or underscore.'
			)}
			{@render field('password', 'Password', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 64 }, 'At least 6 characters.')}
			{@render field('confirm', 'Confirm password', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 64 })}
			{@render field('firstName', 'First name (optional)', { autocomplete: 'given-name', maxlength: 50 })}
			{@render field('lastName', 'Last name (optional)', { autocomplete: 'family-name', maxlength: 50 })}
			{@render field('email', 'Email', { type: 'email', autocomplete: 'email', required: true, maxlength: 100 })}
			{@render field('mobilePhone', 'Mobile phone', { type: 'tel', autocomplete: 'tel', required: true, maxlength: 20 })}
			{@render field('birthday', 'Date of birth', { type: 'date', autocomplete: 'bday', required: true, max: today })}
		</div>

		<button class="primary" type="submit" disabled={submitting}>
			{submitting ? 'Creating account…' : 'Create account'}
		</button>
		<p class="switch muted">Already have an account? <a href="/login">Log in</a></p>
	</form>
</section>

<style>
	.signup {
		display: grid;
		grid-template-columns: 1fr minmax(0, 560px);
		gap: 3rem;
		align-items: start;
		max-width: 1080px;
		margin: 3rem auto;
	}

	.intro {
		display: grid;
		gap: 0.8rem;
		position: sticky;
		top: 2rem;
	}

	.intro .muted {
		margin: 0;
		max-width: 32ch;
	}

	h1 {
		font-size: clamp(2.4rem, 6vw, 4rem);
	}

	form {
		display: grid;
		gap: 1.25rem;
		padding: 1.75rem;
		border-top: 4px solid var(--accent);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--panel-cut)), calc(100% - var(--panel-cut)) 100%, 0 100%);
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		/* Keep paired inputs level when only one of them has a hint or error below. */
		align-items: start;
		align-content: start;
	}

	.fields label {
		align-content: start;
	}

	.fields .wide {
		grid-column: 1 / -1;
	}

	.note {
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 500;
		letter-spacing: normal;
		text-transform: none;
		color: var(--muted);
	}

	.note.error {
		color: var(--danger);
		font-weight: 600;
	}

	input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	form button {
		justify-self: start;
	}

	.switch {
		margin: 0;
	}

	@media (max-width: 820px) {
		.signup {
			grid-template-columns: 1fr;
			gap: 1.75rem;
			margin: 1rem auto;
		}

		.intro {
			position: static;
		}
	}

	@media (max-width: 480px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
