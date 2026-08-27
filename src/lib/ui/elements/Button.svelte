<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Spinner from './Spinner.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		loading?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		href?: string;
		icon?: IconName;
		class?: string;
		title?: string;
		children: Snippet;
		onclick?: (e: MouseEvent) => void;
		/** Force a full page load instead of SvelteKit's client-side navigation — needed for
		 * links that resolve to a +server.ts-only endpoint (e.g. a file download), since the
		 * client router otherwise matches them against a sibling dynamic page route. */
		reload?: boolean;
	}

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		disabled = false,
		type = 'button',
		href,
		icon,
		class: className = '',
		title,
		children,
		onclick,
		reload = false
	}: Props = $props();

	function handleClick(e: MouseEvent) {
		if (disabled || loading) return;
		onclick?.(e);
	}
</script>

{#if href}
	<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- href is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
	{@const resolvedHref = resolve(href as any)}
	<a
		href={resolvedHref}
		class="button button--{variant} button--{size} {className}"
		aria-disabled={disabled || loading}
		{title}
		data-sveltekit-reload={reload ? '' : undefined}
		onclick={handleClick}
	>
		{#if loading}
			<Spinner size={size === 'sm' ? 14 : 16} class="button__spinner" />
		{:else if icon}
			<Icon name={icon} size={size === 'sm' ? 14 : 16} />
		{/if}
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class="button button--{variant} button--{size} {className}"
		disabled={disabled || loading}
		aria-busy={loading}
		{title}
		onclick={handleClick}
	>
		{#if loading}
			<Spinner size={size === 'sm' ? 14 : 16} class="button__spinner" />
		{:else if icon}
			<Icon name={icon} size={size === 'sm' ? 14 : 16} />
		{/if}
		{@render children()}
	</button>
{/if}

<style>
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 44px;
		min-width: 44px;
		border: 1px solid transparent;
		border-radius: 9999px;
		font: inherit;
		font-weight: 500;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	a.button[aria-disabled='true'] {
		pointer-events: none;
		cursor: not-allowed;
		opacity: 0.4;
	}

	.button:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	.button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.button--sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.button--md {
		padding: 0.5rem 1.125rem;
		font-size: 0.84375rem;
	}

	.button--lg {
		min-height: 50px;
		padding: 0.625rem 1.5rem;
		font-size: 0.9375rem;
	}

	.button--primary {
		background-color: var(--accent);
		color: var(--ink-on-accent);
		font-weight: 600;
	}

	.button--primary:not(:disabled):hover {
		background-color: var(--accent-hover);
	}

	.button--primary:not(:disabled):active {
		background-color: var(--accent-hover);
		transform: none;
	}

	.button--secondary {
		background-color: var(--chip);
		color: var(--text-dim);
	}

	.button--secondary:not(:disabled):hover {
		background-color: var(--chip-hover);
		color: var(--text);
	}

	.button--secondary:not(:disabled):active {
		background-color: var(--chip-active);
		color: var(--text);
		transform: none;
	}

	.button--destructive {
		background-color: var(--destructive);
		color: var(--ink-on-accent);
	}

	/* No filled destructive control is drawn in any artboard to measure a hover token
	 * from, so this darkens the fill by a fixed amount instead of swapping to a named
	 * hover token — the same direction reads as "pressed" in both themes, unlike accent's
	 * hover (which lightens in the dark theme and darkens in the light one). */
	.button--destructive:not(:disabled):hover {
		background-color: color-mix(in srgb, var(--destructive) 90%, black 10%);
	}

	.button--destructive:not(:disabled):active {
		background-color: color-mix(in srgb, var(--destructive) 82%, black 18%);
		transform: none;
	}

	.button--ghost {
		background-color: transparent;
		color: var(--text-dim);
	}

	.button--ghost:not(:disabled):hover {
		background-color: var(--panel);
		color: var(--text);
	}

	.button--ghost:not(:disabled):active {
		background-color: var(--chip);
		color: var(--text);
		transform: none;
	}

	.button :global(.button__spinner) {
		flex-shrink: 0;
	}
</style>
