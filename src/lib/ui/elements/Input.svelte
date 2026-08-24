<script lang="ts">
	interface Props {
		type?: 'text' | 'email' | 'password' | 'number';
		name?: string;
		value?: string;
		placeholder?: string;
		error?: boolean;
		disabled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		id?: string;
		autocomplete?: HTMLInputElement['autocomplete'];
		'aria-describedby'?: string;
		onfocus?: (e: FocusEvent) => void;
		onblur?: (e: FocusEvent) => void;
	}

	let {
		type = 'text',
		name,
		value = $bindable(''),
		placeholder,
		error = false,
		disabled = false,
		size = 'md',
		class: className = '',
		id,
		autocomplete,
		'aria-describedby': describedBy,
		onfocus,
		onblur
	}: Props = $props();
</script>

<input
	{id}
	{name}
	{type}
	bind:value
	{placeholder}
	{disabled}
	{autocomplete}
	aria-invalid={error}
	aria-describedby={describedBy}
	class="input input--{size} {className}"
	class:input--error={error}
	{onfocus}
	{onblur}
/>

<style>
	.input {
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.875rem;
		border: 1px solid transparent;
		border-radius: 11px;
		background-color: var(--field);
		color: var(--text);
		font: inherit;
		font-size: 0.875rem;
		transition:
			border-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.input::placeholder {
		color: var(--text-faint);
	}

	.input:hover:not(:disabled):not(:focus-visible) {
		background-color: rgb(from var(--field) r g b / calc(alpha + 0.03));
	}

	.input:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	.input:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.input--error {
		border-color: var(--destructive);
	}

	.input--sm {
		min-height: 36px;
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
	}

	.input--lg {
		min-height: 52px;
		padding: 0.625rem 0.875rem;
		font-size: 1rem;
	}
</style>
