<script lang="ts">
	import Icon from '../elements/Icon.svelte';

	interface Props {
		value?: string;
		debounce?: number;
		/** Accessible name for the field. Falls back to `placeholder` when not the same wording is wanted. */
		label: string;
		placeholder?: string;
		/** Accessible name for the icon-only clear button — no hardcoded UI text lives in this component. */
		clearLabel: string;
	}

	let { value = $bindable(''), debounce = 300, label, placeholder, clearLabel }: Props = $props();

	let inputEl: HTMLInputElement | undefined = $state();
	let draft = $derived(value);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	function handleInput(event: Event): void {
		draft = (event.currentTarget as HTMLInputElement).value;
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			value = draft;
		}, debounce);
	}

	function handleClear(): void {
		clearTimeout(timeoutId);
		draft = '';
		value = '';
		inputEl?.focus();
	}
</script>

<div class="search-input">
	<Icon name="search" size={18} class="search-input__icon" />
	<input
		bind:this={inputEl}
		type="text"
		class="search-input__field"
		value={draft}
		oninput={handleInput}
		placeholder={placeholder ?? label}
		aria-label={label}
	/>
	{#if draft}
		<button type="button" class="search-input__clear" onclick={handleClear} aria-label={clearLabel}>
			<Icon name="close" size={16} />
		</button>
	{/if}
</div>

<style>
	.search-input {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.search-input :global(.search-input__icon) {
		position: absolute;
		left: 0.75rem;
		color: var(--text-faint);
		pointer-events: none;
	}

	.search-input__field {
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 2.5rem 0.5rem 2.25rem;
		border: none;
		border-radius: 11px;
		background-color: var(--field);
		color: var(--text);
		font-size: 0.875rem;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.search-input__field::placeholder {
		color: var(--text-faint);
	}

	/* No local :focus-visible override — falls through to theme.css's global
	   accent ring, same as any other focusable element. */

	.search-input__clear {
		position: absolute;
		right: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: none;
		background: transparent;
		color: var(--text-faint);
		border-radius: 9px;
		cursor: pointer;
	}

	.search-input__clear:hover {
		background-color: var(--panel);
		color: var(--text-dim);
	}

	.search-input__clear:active {
		transform: none;
	}

	.search-input__clear:focus-visible {
		box-shadow: 0 0 0 2px var(--focus-gap, var(--bg)), 0 0 0 4px var(--accent);
		outline: none;
	}
</style>
