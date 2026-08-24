<script lang="ts">
	/**
	 * A generic icon + label + value (+ optional trend) stat panel. The template's
	 * currency/locale formatting is dropped — that machinery had no counterpart
	 * here (this project has no money to format, only durations and counts, and
	 * those already go through `src/lib/viz/format.ts`), so `value` is a plain
	 * pre-formatted string the caller supplies.
	 *
	 * Note the actual `KPI_Row` on the statistics page is its own bespoke
	 * component (`modules/stats/components/KpiRow.svelte`) rather than a caller
	 * of this one — its caps-label-over-a-tabular-figure shape doesn't match this
	 * icon-led card. `StatCard` stays available for anywhere else a labelled
	 * figure is needed.
	 */
	import Icon from '../elements/Icon.svelte';
	import type { IconName } from '../elements/Icon.svelte';

	interface Props {
		icon: IconName;
		label: string;
		value: string;
		change?: { value: number; direction: 'up' | 'down' | 'neutral' };
		tone?: 'positive' | 'negative';
		class?: string;
	}

	let { icon, label, value, change, tone, class: className = '' }: Props = $props();
</script>

<div class="stat-card {className}">
	<div class="stat-card__icon">
		<Icon name={icon} size={20} />
	</div>
	<div class="stat-card__body">
		<p class="stat-card__label">{label}</p>
		<p
			class="stat-card__value tabular"
			class:stat-card__value--positive={tone === 'positive'}
			class:stat-card__value--negative={tone === 'negative'}
		>
			{value}
		</p>
		{#if change}
			<p class="stat-card__change stat-card__change--{change.direction}">
				{#if change.direction !== 'neutral'}
					<!-- No dedicated chevron-up glyph exists in the icon set (Icon.svelte's
					     IconName is the closed, artboard-derived list) — 'up' reuses
					     chevron-down rotated 180deg rather than inventing a new glyph. -->
					<Icon
						name="chevron-down"
						size={14}
						class={change.direction === 'up' ? 'stat-card__change-icon--up' : ''}
					/>
				{/if}
				{Math.abs(change.value)}%
			</p>
		{/if}
	</div>
</div>

<style>
	.stat-card {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 18px 20px;
		border-radius: var(--radius-14);
		background: var(--panel);
	}

	.stat-card__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: var(--radius-11);
		background: var(--chip);
		color: var(--accent);
	}

	.stat-card__body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.stat-card__label {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.stat-card__value {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: 22px;
		font-weight: 300;
		line-height: 1.2;
	}

	.stat-card__value--positive {
		color: var(--accent);
	}

	.stat-card__value--negative {
		color: var(--destructive);
	}

	.stat-card__change {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0;
		font-size: 12px;
		font-weight: 500;
	}

	.stat-card__change--up {
		color: var(--accent);
	}

	.stat-card__change--down {
		color: var(--destructive);
	}

	.stat-card__change--neutral {
		color: var(--text-faint);
	}

	.stat-card :global(.stat-card__change-icon--up) {
		transform: rotate(180deg);
	}
</style>
