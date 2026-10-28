<script lang="ts">
	import { enhance } from '$app/forms';
	import { PUBLIC_CENTER_NAME } from '$app/env/public';
	import { translator } from '#lib/i18n/index.js';
	import { GENDERS } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let submitting = $state(false);

	const t = $derived(translator(data.locale));

	const values = $derived(form?.values);
	const errors = $derived((form?.errors ?? {}) as Record<string, string | undefined>);
	const today = new Date().toISOString().slice(0, 10);
</script>

<section class="signup">
	<div class="intro">
		<p class="eyebrow">{PUBLIC_CENTER_NAME}</p>
		<h1>{t('signup.title')}<br /><span class="accent-text">{t('signup.titleAccent')}</span></h1>
		<p class="muted">{t('signup.intro')}</p>
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
				t('field.username'),
				{ autocomplete: 'username', required: true, maxlength: 20, wide: true },
				t('signup.usernameHint')
			)}
			{@render field(
				'password',
				t('field.password'),
				{ type: 'password', autocomplete: 'new-password', required: true, maxlength: 64 },
				t('signup.passwordHint')
			)}
			{@render field('confirm', t('signup.confirm'), { type: 'password', autocomplete: 'new-password', required: true, maxlength: 64 })}
			{@render field('firstName', t('signup.firstName'), { autocomplete: 'given-name', required: true, maxlength: 50 })}
			{@render field('lastName', t('signup.lastName'), { autocomplete: 'family-name', required: true, maxlength: 50 })}
			{@render field('email', t('signup.email'), { type: 'email', autocomplete: 'email', required: true, maxlength: 100 })}
			{@render field('mobilePhone', t('signup.mobilePhone'), { type: 'tel', autocomplete: 'tel', maxlength: 20 })}
			{@render field('birthday', t('signup.birthday'), { type: 'date', autocomplete: 'bday', required: true, max: today })}
			<fieldset class="gender" aria-describedby={errors.gender ? 'gender-note' : undefined}>
				<legend>{t('signup.gender')}</legend>
				<div class="choices" class:invalid={errors.gender}>
					{#each GENDERS as gender (gender)}
						<label>
							<input
								type="radio"
								name="gender"
								value={gender}
								checked={values?.gender === gender}
								required
							/>
							<span>{t(`signup.gender.${gender}`)}</span>
						</label>
					{/each}
				</div>
				{#if errors.gender}
					<span class="note error" id="gender-note">{errors.gender}</span>
				{/if}
			</fieldset>
			{@render field('address', t('signup.address'), { autocomplete: 'street-address', required: true, maxlength: 100, wide: true })}
		</div>

		<button class="primary" type="submit" disabled={submitting}>
			{submitting ? t('signup.submitting') : t('signup.submit')}
		</button>
		<p class="switch muted">{t('signup.haveAccount')} <a href="/login">{t('signup.login')}</a></p>
	</form>
</section>

<style>
	.signup {
		display: grid;
		grid-template-columns: 1fr minmax(0, 560px);
		gap: 3rem;
		align-items: center;
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
	}

	.intro {
		display: grid;
		gap: 0.8rem;
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

	/* Gender: radio buttons drawn as a row of toggle buttons, styled like the other inputs. */
	.gender {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.gender legend {
		padding: 0;
		margin-bottom: 0.35rem;
		font-family: var(--font-sub);
		font-weight: var(--sub-weight);
		font-size: 0.72rem;
		letter-spacing: var(--sub-spacing);
		text-transform: var(--sub-case);
		color: var(--muted);
	}

	.choices {
		display: flex;
		gap: 0.35rem;
	}

	.choices label {
		position: relative;
		flex: 1 1 0;
		min-width: 0;
	}

	.choices input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.choices span {
		display: grid;
		place-items: center;
		min-height: 2.75rem;
		padding: 0.3rem 0.4rem;
		background: var(--input-bg);
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: var(--radius);
		color: var(--text);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 0.85rem;
		letter-spacing: normal;
		text-transform: none;
		text-align: center;
		line-height: 1.15;
	}

	.choices input:checked + span {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	.choices input:focus-visible + span {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.choices.invalid span {
		border-color: var(--danger);
	}

	.gender .note {
		display: block;
		margin-top: 0.35rem;
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
		}
	}

	@media (max-width: 480px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
