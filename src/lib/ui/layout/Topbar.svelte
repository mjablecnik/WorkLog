<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	/**
	 * Rewritten, not just token-ported (design.md "Application Shell"): the template's
	 * Topbar assumes a Sidebar, a hamburger and a user/language menu, none of which
	 * exist here. This is the desktop bar from `Main`/`DayCollapsed`/`Stats` —
	 * `grid-template-columns: 1fr auto 1fr`, height 84, brand left / nav centred /
	 * right cluster right — collapsing to the 56–60px mobile bar (brand + right
	 * cluster only, no nav — that lives in `BottomNav`) below the 768px breakpoint.
	 *
	 * Deliberately generic: navigation is a plain item list (never a radiogroup — a
	 * page is a place you navigate to, not a mode you select), and the right cluster
	 * — the `Running_Indicator` and the `Settings_Menu` chip — is a slot, because
	 * which page shows the indicator and what the chip actually renders belong to
	 * the caller (root layout wiring is task 1.10; `SettingsMenu` itself is task 1.8).
	 */
	interface NavItem {
		href: string;
		label: string;
		current?: boolean;
	}

	interface Props {
		brand: string;
		brandHref?: string;
		navItems?: NavItem[];
		/** The right-cluster content — Running_Indicator, then the settings chip. */
		right?: Snippet;
	}

	let { brand, brandHref, navItems = [], right }: Props = $props();
</script>

<header class="topbar">
	<div class="topbar__left">
		{#if brandHref}
			<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- brandHref is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
			{@const resolvedBrandHref = resolve(brandHref as any)}
			<a href={resolvedBrandHref} class="topbar__brand">{brand}</a>
		{:else}
			<span class="topbar__brand">{brand}</span>
		{/if}
	</div>

	{#if navItems.length > 0}
		<nav class="topbar__nav" aria-label={brand}>
			<ul class="topbar__nav-list">
				{#each navItems as item (item.href)}
					<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- item.href is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
					{@const resolvedItemHref = resolve(item.href as any)}
					<li>
						<a
							href={resolvedItemHref}
							class="topbar__nav-item"
							class:topbar__nav-item--current={item.current}
							aria-current={item.current ? 'page' : undefined}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{:else}
		<div></div>
	{/if}

	<div class="topbar__right">
		{#if right}
			{@render right()}
		{/if}
	</div>
</header>

<style>
	.topbar {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 1rem;
		height: 58px;
		padding: 0 1rem;
		background-color: var(--bg);
		position: sticky;
		top: 0;
		z-index: 1;
	}

	.topbar__left {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.topbar__brand {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text);
		text-decoration: none;
		white-space: nowrap;
	}

	.topbar__nav {
		display: none;
	}

	.topbar__right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.875rem;
		min-width: 0;
	}

	@media (min-width: 768px) {
		.topbar {
			grid-template-columns: 1fr auto 1fr;
			height: 84px;
			padding: 0 48px;
		}

		.topbar__nav {
			display: flex;
			justify-content: center;
		}

		.topbar__nav-list {
			display: flex;
			align-items: center;
			gap: 30px;
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.topbar__nav-item {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			font-size: 0.875rem;
			font-weight: 400;
			line-height: 1.4;
			color: var(--text-faint);
			text-decoration: none;
			cursor: pointer;
			transition: color var(--dur-hover, 200ms) var(--ease-standard, ease);
		}

		.topbar__nav-item:hover {
			color: var(--text-dim);
		}

		.topbar__nav-item:focus-visible {
			box-shadow: 0 0 0 2px var(--focus-gap, var(--bg)), 0 0 0 4px var(--accent);
			outline: none;
			border-radius: 4px;
		}

		.topbar__nav-item--current {
			font-weight: 500;
			color: var(--text);
		}
	}
</style>
