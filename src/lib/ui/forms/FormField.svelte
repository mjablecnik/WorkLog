<script lang="ts">
	import type { Snippet } from 'svelte';

	interface SlotProps {
		id: string;
		describedBy: string | undefined;
	}

	interface Props {
		label: string;
		error?: string | string[];
		hint?: string;
		required?: boolean;
		children: Snippet<[SlotProps]>;
	}

	let { label, error, hint, required = false, children }: Props = $props();

	const uid = $props.id();
	const inputId = `field-${uid}`;
	const errorId = `field-${uid}-error`;
	const hintId = `field-${uid}-hint`;

	const errors = $derived(error ? (Array.isArray(error) ? error : [error]) : []);
	const describedBy = $derived(errors.length > 0 ? errorId : hint ? hintId : undefined);
</script>

<div class="form-field">
	<label class="form-field__label" for={inputId}>
		{label}
		{#if required}
			<span class="form-field__required" aria-hidden="true">*</span>
		{/if}
	</label>

	{@render children({ id: inputId, describedBy })}

	{#if errors.length > 0}
		{#if errors.length === 1}
			<p class="form-field__error" id={errorId}>{errors[0]}</p>
		{:else}
			<ul class="form-field__error form-field__error--list" id={errorId}>
				{#each errors as message, index (index)}
					<li>{message}</li>
				{/each}
			</ul>
		{/if}
	{:else if hint}
		<p class="form-field__hint" id={hintId}>{hint}</p>
	{/if}
</div>

<style>
	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-field__label {
		font-size: 0.875rem;
		font-weight: 400;
		color: var(--text);
	}

	.form-field__required {
		color: var(--destructive);
	}

	.form-field__error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--destructive);
	}

	.form-field__error--list {
		padding-left: 1.25rem;
	}

	.form-field__hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--text-dim);
	}
</style>
