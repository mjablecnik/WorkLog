<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Ported from the template with a token rewrite. The title takes the caps-label
	 * treatment (design.md Typography: `.lbl`, 11px / 0.16em / uppercase / --text-faint)
	 * to match how the day and statistics panels ("souhrn dne", "tvar dne") head their
	 * own `--panel` boxes — this component is the generic building block behind them.
	 */
	interface Props {
		title: string;
		description?: string;
		collapsible?: boolean;
		children: Snippet;
	}

	let { title, description, collapsible = false, children }: Props = $props();
</script>

{#if collapsible}
	<details class="section" open>
		<summary class="section__header">
			<div class="section__heading">
				<h2 class="section__title">{title}</h2>
				{#if description}
					<p class="section__description">{description}</p>
				{/if}
			</div>
		</summary>
		<div class="section__content">
			{@render children()}
		</div>
	</details>
{:else}
	<section class="section">
		<div class="section__header">
			<div class="section__heading">
				<h2 class="section__title">{title}</h2>
				{#if description}
					<p class="section__description">{description}</p>
				{/if}
			</div>
		</div>
		<div class="section__content">
			{@render children()}
		</div>
	</section>
{/if}

<style>
	.section {
		--focus-gap: var(--panel);
		border-radius: 14px;
		background-color: var(--panel);
		color: var(--text);
	}

	.section__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.125rem 1.25rem 0;
	}

	details.section > .section__header {
		cursor: pointer;
		list-style: none;
	}

	details.section > .section__header::-webkit-details-marker {
		display: none;
	}

	details.section > .section__header:focus-visible {
		box-shadow: 0 0 0 2px var(--focus-gap, var(--panel)), 0 0 0 4px var(--accent);
		outline: none;
	}

	.section__heading {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.section__title {
		margin: 0;
		font-size: 0.625rem;
		line-height: 1.35;
		font-weight: 400;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.section__description {
		margin: 0;
		font-size: 0.78125rem;
		line-height: 1.55;
		color: var(--text-faint);
	}

	.section__content {
		padding: 0.75rem 1.25rem 1.125rem;
	}

	.section > .section__header + .section__content {
		padding-top: 0;
	}

	@media (min-width: 768px) {
		.section__title {
			font-size: 0.6875rem;
		}
	}
</style>
