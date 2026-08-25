<script lang="ts">
	import { openPickerOnClick } from '$lib/ui/actions/open-picker-on-click';

	interface Props {
		value?: string;
		min?: string;
		max?: string;
		error?: boolean;
		disabled?: boolean;
		required?: boolean;
		class?: string;
		id?: string;
		'aria-describedby'?: string;
	}

	let {
		value = $bindable(''),
		min,
		max,
		error = false,
		disabled = false,
		required = false,
		class: className = '',
		id,
		'aria-describedby': describedBy
	}: Props = $props();
</script>

<input
	{id}
	type="date"
	bind:value
	{min}
	{max}
	{disabled}
	{required}
	aria-invalid={error}
	aria-disabled={disabled}
	aria-describedby={describedBy}
	class="date-picker {className}"
	class:date-picker--error={error}
	use:openPickerOnClick
/>

<style>
	.date-picker {
		display: block;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 11px;
		background-color: var(--field);
		color: var(--text);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.date-picker::-webkit-calendar-picker-indicator {
		cursor: pointer;
	}

	.date-picker:hover:not(:disabled) {
		background-color: var(--field-active-bg);
	}

	/* :focus-visible, not just :focus: Chromium treats a click into this field
	   as focus-visible (unlike most non-text widgets), so leaving the global
	   accent ring unsuppressed here would draw it every time the picker opens
	   by pointer — the picker itself is already the "this is active" signal,
	   on any focus method (openPickerOnClick only fires from a pointer, but a
	   keyboard Tab-in still opens *something*: the field's own segments become
	   editable immediately). */
	.date-picker:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.date-picker:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.date-picker--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}
</style>
