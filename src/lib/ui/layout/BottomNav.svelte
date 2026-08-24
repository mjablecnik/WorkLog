<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from '../elements/Icon.svelte';

	/**
	 * Written from scratch — no template counterpart (design.md task 1.3). The mobile
	 * bottom bar: 68px tall (design.md gives "66–68"; 68 is the value taken, the same
	 * way the shell's own "84 on every page" settles `DayCollapsed`'s 88px drawing
	 * slip), a 1px top divider, four tabs each a 20px icon above a 10px label. The
	 * active tab is drawn in `--accent` — deliberately not full-strength text, which
	 * is the desktop nav's rule (design.md "Application Shell": "on the bottom bar
	 * there is no room for [weight + ink], and the accent is the only legible signal").
	 */
	interface NavTab {
		href: string;
		icon: IconName;
		label: string;
		current?: boolean;
	}

	interface Props {
		items: NavTab[];
		/** Accessible name for the `nav` landmark — no hardcoded UI text lives here. */
		ariaLabel?: string;
	}

	let { items, ariaLabel }: Props = $props();
</script>

<nav class="bottom-nav" aria-label={ariaLabel}>
	{#each items as item (item.href)}
		<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- item.href is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
		{@const resolvedHref = resolve(item.href as any)}
		<a
			href={resolvedHref}
			class="bottom-nav__tab"
			class:bottom-nav__tab--current={item.current}
			aria-current={item.current ? 'page' : undefined}
		>
			<Icon name={item.icon} size={20} />
			<span class="bottom-nav__label">{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.bottom-nav {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		align-items: stretch;
		height: 68px;
		padding-bottom: env(safe-area-inset-bottom);
		border-top: 1px solid var(--divider);
		background-color: var(--bg);
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 1;
	}

	.bottom-nav__tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: 44px;
		color: var(--text-faint);
		text-decoration: none;
		cursor: pointer;
		transition: color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.bottom-nav__tab:hover {
		color: var(--text-dim);
	}

	.bottom-nav__tab:focus-visible {
		box-shadow: 0 0 0 2px var(--focus-gap, var(--bg)), 0 0 0 4px var(--accent);
		outline: none;
		border-radius: 9px;
	}

	.bottom-nav__tab--current {
		color: var(--accent);
	}

	.bottom-nav__label {
		font-size: 10px;
		line-height: 1.35;
	}

	@media (min-width: 768px) {
		.bottom-nav {
			display: none;
		}
	}
</style>
