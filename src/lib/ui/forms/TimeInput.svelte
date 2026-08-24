<script lang="ts">
	/**
	 * Written from scratch for this project — no template counterpart (design.md task
	 * 1.3). A styled native `<input type="text">` rather than a segmented widget:
	 * simplicity beats cleverness here, since sveltekit-superforms binds to it as a
	 * plain text field elsewhere. Parsing and stepping both go through
	 * `parseTimeOfDay`/`formatTimeOfDay` in the server's time zone — never the
	 * device's — so a stepped value is always a real wall-clock time in that zone.
	 */
	import { tick } from 'svelte';
	import { parseTimeOfDay, formatTimeOfDay } from '$lib/viz/format';

	interface Props {
		/** The bound `HH:MM` text — a plain string, exactly what a form field binds to. */
		value?: string;
		/** The Logical_Day (`YYYY-MM-DD`) this time belongs to — required for parsing/stepping. */
		date: string;
		/** The server's IANA time zone. Never assumed, always passed in. */
		timeZone: string;
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
		date,
		timeZone,
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

	let inputEl: HTMLInputElement | undefined = $state();

	function tryParse(text: string): Date | null {
		try {
			return parseTimeOfDay(text, date, timeZone);
		} catch {
			return null;
		}
	}

	/** Formatting-on-blur: a valid value is canonicalised to zero-padded `HH:MM`. */
	function handleBlur(): void {
		const parsed = tryParse(value);
		if (parsed) {
			value = formatTimeOfDay(parsed, '', timeZone);
		}
	}

	function segmentAt(text: string, caret: number): 'hour' | 'minute' {
		const colon = text.indexOf(':');
		return colon === -1 || caret <= colon ? 'hour' : 'minute';
	}

	/** ArrowUp/ArrowDown step the segment the caret is in, wrapping through real dates. */
	async function handleKeydown(event: KeyboardEvent): Promise<void> {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		const el = event.currentTarget as HTMLInputElement;
		event.preventDefault();

		const parsed = tryParse(el.value) ?? tryParse('00:00');
		if (!parsed) return;

		const segment = segmentAt(el.value, el.selectionStart ?? el.value.length);
		const stepMs = segment === 'hour' ? 3_600_000 : 60_000;
		const stepped = new Date(parsed.getTime() + (event.key === 'ArrowUp' ? stepMs : -stepMs));
		value = formatTimeOfDay(stepped, '', timeZone);

		await tick();
		if (!inputEl) return;
		const caret = segment === 'hour' ? Math.min(2, value.length) : value.length;
		inputEl.setSelectionRange(caret, caret);
	}
</script>

<input
	bind:this={inputEl}
	{id}
	{name}
	{disabled}
	{required}
	type="text"
	inputmode="numeric"
	autocomplete="off"
	spellcheck="false"
	pattern={'[0-9]{1,2}:[0-9]{2}'}
	{placeholder}
	bind:value
	onblur={handleBlur}
	onkeydown={handleKeydown}
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
		cursor: text;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.time-input--mobile {
		min-height: 48px;
		font-size: 0.9375rem;
	}

	.time-input::placeholder {
		color: var(--text-faint);
	}

	.time-input:hover:not(:disabled) {
		background-color: var(--field-active-bg);
	}

	.time-input:focus-visible {
		background-color: var(--field-active-bg);
		box-shadow: var(--field-active-ring);
		outline: none;
	}

	.time-input:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.time-input--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}
</style>
