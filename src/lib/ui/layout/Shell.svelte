<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Rewritten, not just token-ported (design.md "Application Shell"): the template's
	 * Shell composes a fixed Sidebar and Topbar. Worklog has no sidebar — the frame is
	 * a top bar, the page content, and (mobile-only) a bottom nav with an optional FAB
	 * floating above it. Kept generic on purpose: `header`/`bottomNav`/`fab` are
	 * snippets so a page can pass `<Topbar>`/`<BottomNav>`/`<Fab>` (or omit them — the
	 * timer pages have no `Running_Indicator`, the day page's FAB opens a two-item
	 * sheet, other pages' FABs act directly) without Shell knowing their contents.
	 * Root-layout wiring itself is task 1.10.
	 */
	interface Props {
		header: Snippet;
		children: Snippet;
		bottomNav?: Snippet;
		fab?: Snippet;
	}

	let { header, children, bottomNav, fab }: Props = $props();
</script>

<div class="shell" class:shell--with-bottom-nav={!!bottomNav}>
	{@render header()}

	<main class="shell__content">
		{@render children()}
	</main>

	{#if fab}
		<div class="shell__fab">
			{@render fab()}
		</div>
	{/if}

	{#if bottomNav}
		<div class="shell__bottom-nav">
			{@render bottomNav()}
		</div>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background-color: var(--bg);
		color: var(--text);
	}

	.shell__content {
		flex: 1;
		min-height: 0;
	}

	.shell__fab {
		display: none;
	}

	.shell__bottom-nav {
		display: none;
	}

	@media (max-width: 767px) {
		.shell--with-bottom-nav .shell__content {
			/* Clears BottomNav's fixed 68px bar plus its safe-area inset. */
			padding-bottom: calc(68px + env(safe-area-inset-bottom));
		}

		.shell__fab {
			display: contents;
		}

		.shell__bottom-nav {
			display: block;
		}
	}

	@media (min-width: 768px) {
		.shell__fab {
			display: none;
		}
	}
</style>
