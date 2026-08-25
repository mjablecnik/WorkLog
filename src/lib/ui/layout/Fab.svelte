<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from '../elements/Icon.svelte';

	/**
	 * Written from scratch — no template counterpart (design.md task 1.3). The mobile
	 * create action: a 54px round accent button fixed 18px from the right and 12px
	 * above `BottomNav`'s 68px bar. Its halo is fixed — `0 0 0 10px rgba(accent,0.09)`
	 * — never the Timer_Control's ratio-based one. There is no literal per-theme hex
	 * for that halo in design.md (unlike the tokens that were measured off an
	 * artboard), so it is expressed as `color-mix()` against `--accent` itself rather
	 * than duplicated as a hand-computed literal per theme — the formula design.md
	 * gives, evaluated live instead of baked twice.
	 */
	interface Props {
		icon: IconName;
		/** Accessible name — the button is icon-only. */
		label: string;
		href?: string;
		onclick?: () => void;
		disabled?: boolean;
		/** The button variant only — a FAB that opens a sheet/menu (the day
		 * page's two-item create sheet) rather than acting directly. Mirrors
		 * `SettingsMenu`'s own trigger chip attributes. */
		ariaHaspopup?: 'dialog' | 'menu' | 'true';
		ariaExpanded?: boolean;
		ariaControls?: string;
	}

	let {
		icon,
		label,
		href,
		onclick,
		disabled = false,
		ariaHaspopup,
		ariaExpanded,
		ariaControls
	}: Props = $props();
</script>

{#if href}
	<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- href is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
	{@const resolvedHref = resolve(href as any)}
	<a href={resolvedHref} class="fab" aria-label={label} aria-disabled={disabled}>
		<Icon name={icon} size={22} />
	</a>
{:else}
	<button
		type="button"
		class="fab"
		aria-label={label}
		{disabled}
		aria-disabled={disabled}
		aria-haspopup={ariaHaspopup}
		aria-expanded={ariaHaspopup ? ariaExpanded : undefined}
		aria-controls={ariaControls}
		{onclick}
	>
		<Icon name={icon} size={22} />
	</button>
{/if}

<style>
	.fab {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 54px;
		height: 54px;
		border: none;
		border-radius: 9999px;
		background-color: var(--accent);
		color: var(--ink-on-accent);
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 9%, transparent);
		cursor: pointer;
		text-decoration: none;
		position: fixed;
		right: 18px;
		bottom: calc(68px + 12px + env(safe-area-inset-bottom));
		z-index: 1;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.fab:hover {
		background-color: var(--accent-hover);
	}

	.fab:active {
		background-color: var(--accent-hover);
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 6%, transparent);
		transform: none;
	}

	.fab:focus-visible {
		box-shadow:
			0 0 0 10px color-mix(in srgb, var(--accent) 9%, transparent),
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
		outline: none;
	}

	.fab[aria-disabled='true'] {
		opacity: 0.4;
		pointer-events: none;
		box-shadow: none;
	}

	@media (min-width: 768px) {
		.fab {
			display: none;
		}
	}
</style>
