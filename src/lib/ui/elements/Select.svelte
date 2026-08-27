<script lang="ts">
	interface SelectOption {
		value: string;
		label: string;
	}

	interface Props {
		options: SelectOption[];
		value?: string;
		name?: string;
		placeholder?: string;
		error?: boolean;
		disabled?: boolean;
		class?: string;
	}

	let {
		options,
		value = $bindable(''),
		name,
		placeholder,
		error = false,
		disabled = false,
		class: className = ''
	}: Props = $props();
</script>

<select
	bind:value
	{name}
	{disabled}
	aria-invalid={error}
	class="select {className}"
	class:select--error={error}
>
	{#if placeholder}
		<option value="" disabled selected={!value}>{placeholder}</option>
	{/if}
	{#each options as option (option.value)}
		<option value={option.value}>{option.label}</option>
	{/each}
</select>

<style>
	.select {
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 2rem 0.5rem 0.875rem;
		border: 1px solid transparent;
		border-radius: 11px;
		background-color: var(--field);
		color: var(--text);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
		transition:
			border-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.select:hover:not(:disabled):not(:focus-visible) {
		background-color: var(--field-hover);
	}

	.select:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	.select:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.select--error {
		border-color: var(--destructive);
	}
</style>
