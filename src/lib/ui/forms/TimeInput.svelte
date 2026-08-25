<script lang="ts">
	/**
	 * A native `<input type="time">` — the same picker affordance `DatePicker` gives
	 * dates: click anywhere in the field (`openPickerOnClick`) to open the browser's
	 * own time picker, or type digits directly. superforms still binds to it as a
	 * plain `HH:MM` string either way, since that is exactly what a native time
	 * input's own `.value` always is. Stepping with the arrow keys is the browser's
	 * native per-segment behaviour now, not a hand-rolled one — a manual "nudge this
	 * clock reading" has no DST to be aware of, unlike an actual instant.
	 */
	import { openPickerOnClick } from '$lib/ui/actions/open-picker-on-click';

	interface Props {
		/** The bound `HH:MM` text — a plain string, exactly what a form field binds to. */
		value?: string;
		density?: 'desktop' | 'mobile';
		error?: boolean;
		disabled?: boolean;
		required?: boolean;
		id?: string;
		name?: string;
		placeholder?: string;
		class?: string;
		'aria-describedby'?: string;
	}

	let {
		value = $bindable(''),
		density = 'desktop',
		error = false,
		disabled = false,
		required = false,
		id,
		name,
		placeholder,
		class: className = '',
		'aria-describedby': describedBy
	}: Props = $props();
</script>

<input
	{id}
	{name}
	{disabled}
	{required}
	type="time"
	{placeholder}
	bind:value
	use:openPickerOnClick
	aria-invalid={error}
	aria-disabled={disabled}
	aria-describedby={describedBy}
	class="time-input time-input--{density} {className}"
	class:time-input--error={error}
/>

<style>
	.time-input {
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

	.time-input::-webkit-calendar-picker-indicator {
		cursor: pointer;
	}

	.time-input--mobile {
		min-height: 48px;
		font-size: 0.9375rem;
	}

	.time-input:hover:not(:disabled) {
		background-color: var(--field-active-bg);
	}

	/* See DatePicker.svelte's identical note. */
	.time-input:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.time-input:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.time-input--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}
</style>
