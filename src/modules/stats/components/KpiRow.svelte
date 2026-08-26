<script lang="ts">
	/**
	 * The four `KPI_Row` panels (Requirement 12.2; design.md's `Statistics` section and
	 * `tasks.md` 8.2): the range's total `Tracked_Time`, total `Covered_Time`, the
	 * described share as a percentage over a `CoverageMeter`, and the total `Overtime`
	 * with its share of `Tracked_Time` beneath it. The artboard's fourth card carried
	 * the `Evening_Hour` figure — that number moved to `RhythmPanel` (a sibling task),
	 * and this card's shape is unchanged.
	 *
	 * Takes `KpiFigures` verbatim — the exact shape `aggregate.ts`'s `computeKpiFigures`
	 * produces and `+page.server.ts` hands the page as `data.kpi` — rather than four
	 * loose number props, so a later page-assembly task wires this up with no
	 * reshaping. Reads summary fields only, so it renders identically whether or not
	 * `intervalsIncluded` is true — nothing here depends on interval data.
	 */
	import type { KpiFigures } from '$modules/stats/aggregate';
	import * as m from '$lib/paraglide/messages';
	import { formatDuration } from '$lib/viz/format';
	import CoverageMeter from './CoverageMeter.svelte';

	interface Props {
		kpi: KpiFigures;
		class?: string;
	}

	let { kpi, class: className = '' }: Props = $props();

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}
</script>

<div class="kpi-row {className}">
	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_worked()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.trackedSeconds)}</p>
	</div>

	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_covered()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.coveredSeconds)}</p>
	</div>

	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_share()}</p>
		<p class="kpi-figure tabular">{Math.round(kpi.describedSharePercent)} %</p>
		<CoverageMeter percent={kpi.describedSharePercent} class="kpi-panel__meter" />
	</div>

	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_overtime()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.overtimeSeconds)}</p>
		<p class="kpi-overtime-share tabular">
			{m.stats_kpi_overtime_share({ percent: Math.round(kpi.overtimeSharePercent) })}
		</p>
	</div>

	<!-- Requirement 11.1: paid/unpaid/relax as individually visible figures. -->
	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_paid()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.paidSeconds)}</p>
	</div>

	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_unpaid()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.unpaidSeconds)}</p>
	</div>

	<div class="kpi-panel">
		<p class="lbl">{m.stats_kpi_relax()}</p>
		<p class="kpi-figure tabular">{fmtDuration(kpi.relaxSeconds)}</p>
	</div>
</div>

<style>
	.kpi-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}

	.kpi-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		border-radius: var(--radius-14);
		background: var(--panel);
	}

	.kpi-figure {
		margin: 0;
		font-size: 22px;
		font-weight: 300;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.kpi-overtime-share {
		margin: 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.kpi-panel :global(.kpi-panel__meter) {
		margin-top: 2px;
	}

	@media (min-width: 768px) {
		.kpi-row {
			grid-template-columns: repeat(4, 1fr);
			gap: 18px;
		}

		.kpi-panel {
			padding: 18px 20px;
		}

		.kpi-figure {
			font-size: 30px;
		}
	}
</style>
