<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Ported from the template with a token rewrite. `breadcrumbs` is dropped along
	 * with `Breadcrumbs.svelte` — Worklog's shell has no breadcrumb trail (design.md
	 * "Application Shell").
	 */
	interface Props {
		title: string;
		subtitle?: string;
		actions?: Snippet;
	}

	let { title, subtitle, actions }: Props = $props();
</script>

<div class="page-header">
	<div class="page-header__main">
		<h1 class="page-header__title">{title}</h1>
		{#if subtitle}
			<p class="page-header__subtitle">{subtitle}</p>
		{/if}
	</div>
	{#if actions}
		<div class="page-header__actions">
			{@render actions()}
		</div>
	{/if}
</div>

<style>
	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.page-header__main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.page-header__title {
		font-size: 1.25rem;
		font-weight: 500;
		line-height: 1.3;
		color: var(--text);
		margin: 0;
	}

	.page-header__subtitle {
		font-size: 0.8125rem;
		line-height: 1.35;
		color: var(--text-faint);
		margin: 0;
	}

	.page-header__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	@media (max-width: 767px) {
		.page-header__title {
			font-size: 0.9375rem;
		}
	}
</style>
