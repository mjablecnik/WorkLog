<script lang="ts">
	/**
	 * The project breakdown (Requirement 12.3-12.5, 12.12, 12.14; design.md's
	 * `Statistics` section and `tasks.md` 8.2): one row per project, descending by
	 * `Covered_Time`, each with a swatch, name, duration and share, and beneath it an
	 * 8 px track filled to that project's **share of the range's total `Covered_Time`**
	 * — the same quantity the row prints, per design.md's explicit correction of the
	 * artboard's mistake ("The artboard drew bars relative to the largest project …
	 * while printing shares of the total … the share is the number the reader is being
	 * given"). Below a divider, the range's total `Uncovered_Time` as a plain accent
	 * figure — never a bar.
	 *
	 * Takes `projectBreakdown`/`uncoveredSeconds` under the exact names `+page.server.ts`
	 * already returns them as (`foldProjectTotals`/`computeUncoveredSeconds` in
	 * `aggregate.ts`), so a later page-assembly task wires this up with no reshaping.
	 * `projects` arrives already sorted descending and already folded past the top
	 * seven into one trailing "Other" row (`projectId`/`projectName`/`colorIndex` all
	 * `null`) — this component does not re-sort or re-fold. It also arrives already
	 * including archived projects that hold time in the range, which this component
	 * does not filter out.
	 *
	 * `aggregate.ts` deliberately returns no label for the folded "Other" row (a
	 * `ProjectRangeTotal` with a null `projectId` gets no `Palette_Slot` and no name of
	 * its own); no existing catalogue key covers it either (`stats_breakdown_uncovered`
	 * is "Bez popisu"/"Not described" — a different concept, the range's *uncovered*
	 * time, not a folded set of low-ranking projects). A `stats_breakdown_other` key
	 * ("Ostatní"/"Other") was added to `messages/cs.json`/`en.json` for this row.
	 *
	 * The row list is itself the legend design.md's mark specs ask for "whenever two or
	 * more projects appear" — every row already carries a swatch and a name, so a
	 * second, separate legend element would repeat it for nothing.
	 *
	 * Every bar (this component's and the divider figure aside) renders as an inline
	 * SVG `<rect>` sized by a percentage-width presentation attribute, never a CSS
	 * custom property or an inline `style=`, for the same CSP reason `CoverageMeter`
	 * documents.
	 */
	import type { ProjectRangeTotal } from '$modules/stats/aggregate';
	import * as m from '$lib/paraglide/messages';
	import { formatDuration } from '$lib/viz/format';
	import { projectSlotClass } from '$lib/viz/palette';
	import EmptyState from '$lib/ui/components/EmptyState.svelte';

	interface Props {
		/** Grouped by billable FIRST (003-worklog-time-categories, Requirement 11.2) —
		 *  each group descending by coveredSeconds, its own trailing "Other" row (if
		 *  any, projectId null) folded within the group, so a combined row never mixes
		 *  a paid Project with an unpaid one. */
		projectBreakdown: { paid: ProjectRangeTotal[]; unpaid: ProjectRangeTotal[] };
		uncoveredSeconds: number;
		/** Addition — the range's total Leisure_Time, shown beneath both headings,
		 *  separated from them and never one of the bars (Requirement 11.3). */
		relaxSeconds: number;
		class?: string;
	}

	let { projectBreakdown, uncoveredSeconds, relaxSeconds, class: className = '' }: Props = $props();

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}

	/** The range's total Covered_Time across BOTH groups — every row's share is
	 *  against this, never the largest row and never just its own group's total. */
	const totalCoveredSeconds = $derived(
		[...projectBreakdown.paid, ...projectBreakdown.unpaid].reduce(
			(sum, project) => sum + project.coveredSeconds,
			0
		)
	);

	function sharePercent(coveredSeconds: number): number {
		return totalCoveredSeconds > 0 ? (coveredSeconds / totalCoveredSeconds) * 100 : 0;
	}

	function rowLabel(project: ProjectRangeTotal): string {
		return project.projectId === null ? m.stats_breakdown_other() : project.projectName!;
	}

	function rowTooltip(project: ProjectRangeTotal): string {
		const percent = Math.round(sharePercent(project.coveredSeconds));
		return `${rowLabel(project)} ${fmtDuration(project.coveredSeconds)} ${percent}%`;
	}

	// A range with no records at all — nothing described and nothing left uncovered —
	// shows the empty state instead of an empty chart (Requirement 12.12).
	const isEmpty = $derived(
		projectBreakdown.paid.length === 0 &&
			projectBreakdown.unpaid.length === 0 &&
			uncoveredSeconds === 0 &&
			relaxSeconds === 0
	);
</script>

{#snippet group(projects: ProjectRangeTotal[])}
	<ul class="breakdown__list">
		{#each projects as project (project.projectId ?? 'other')}
			{@const percent = sharePercent(project.coveredSeconds)}
			<li class="row" title={rowTooltip(project)}>
				<div class="row-head">
					<span
						class="swatch {project.colorIndex === null ? 'swatch--other' : projectSlotClass(project.colorIndex)}"
					></span>
					<span class="name">{rowLabel(project)}</span>
					<span class="duration tabular">{fmtDuration(project.coveredSeconds)}</span>
					<span class="share tabular">{Math.round(percent)}%</span>
				</div>
				<svg
					class="bar"
					viewBox="0 0 100 8"
					preserveAspectRatio="none"
					role="presentation"
					aria-hidden="true"
				>
					<rect class="bar-track" x="0" y="0" width="100" height="8" rx="4" ry="4" />
					<rect
						class="bar-fill {project.colorIndex === null ? 'bar-fill--other' : projectSlotClass(project.colorIndex)}"
						x="0"
						y="0"
						width="{percent}%"
						height="8"
						rx="4"
						ry="4"
					/>
				</svg>
			</li>
		{/each}
	</ul>
{/snippet}

{#if isEmpty}
	<div class="breakdown-empty {className}">
		<EmptyState icon="info" message={m.stats_empty_title()} />
		<p class="empty-body">{m.stats_empty_body()}</p>
	</div>
{:else}
	<div class="breakdown {className}">
		{#if projectBreakdown.paid.length > 0}
			<p class="lbl group-heading">{m.stats_breakdown_paid_heading()}</p>
			{@render group(projectBreakdown.paid)}
		{/if}

		{#if projectBreakdown.unpaid.length > 0}
			<p class="lbl group-heading group-heading--spaced">{m.stats_breakdown_unpaid_heading()}</p>
			{@render group(projectBreakdown.unpaid)}
		{/if}

		<div class="divider"></div>

		<div class="uncovered-row">
			<span class="uncovered-label">{m.stats_breakdown_uncovered()}</span>
			<span class="uncovered-value tabular">{fmtDuration(uncoveredSeconds)}</span>
		</div>

		<!-- Requirement 11.3: the range's total Leisure_Time, beneath both headings,
		     separated from them and never one of the bars. -->
		<div class="uncovered-row">
			<span class="uncovered-label">{m.stats_breakdown_leisure()}</span>
			<span class="uncovered-value tabular">{fmtDuration(relaxSeconds)}</span>
		</div>
	</div>
{/if}

<style>
	.breakdown {
		display: flex;
		flex-direction: column;
	}

	.breakdown__list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.group-heading {
		margin: 0 0 10px;
	}

	.group-heading--spaced {
		margin-top: 18px;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	/* Mobile: swatch + name on the first line, duration + share on the second. */
	.row-head {
		display: grid;
		grid-template-columns: 9px 1fr auto;
		grid-template-areas: 'swatch name name' '. duration share';
		column-gap: 8px;
		row-gap: 2px;
		align-items: center;
	}

	.swatch {
		grid-area: swatch;
		width: 9px;
		height: 9px;
		border-radius: var(--radius-2);
		background: var(--pj);
	}

	.swatch--other {
		background: var(--text-faint);
	}

	.name {
		grid-area: name;
		overflow: hidden;
		font-size: 13.5px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.duration {
		grid-area: duration;
		font-size: 12px;
		color: var(--text-faint);
	}

	.share {
		grid-area: share;
		justify-self: end;
		font-size: 12px;
		color: var(--text-faint);
	}

	.bar {
		display: block;
		width: 100%;
		height: var(--h-breakdown-bar);
		/* The 2 px surface gap the mark specs ask for between adjacent bars — the row's
		   own gap (above) already clears more than this; this margin keeps the bar
		   itself from ever touching the row text right above it. */
		margin-top: 2px;
	}

	.bar-track {
		fill: var(--track);
	}

	.bar-fill {
		fill: var(--pj);
		transition: width var(--dur-panel) var(--ease-standard);
	}

	.bar-fill--other {
		fill: var(--text-faint);
	}

	.divider {
		height: 1px;
		margin: 14px 0;
		background: var(--divider);
	}

	.uncovered-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.uncovered-label {
		font-size: 13px;
		color: var(--text-dim);
	}

	.uncovered-value {
		font-size: 14px;
		font-weight: 300;
		color: var(--accent);
	}

	.breakdown-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.empty-body {
		margin: -24px 0 0;
		font-size: 14px;
		color: var(--text-dim);
		text-align: center;
	}

	@media (min-width: 768px) {
		.row-head {
			grid-template-columns: 9px 1fr auto 42px;
			grid-template-areas: 'swatch name duration share';
		}

		.name {
			font-size: 14px;
		}

		.duration {
			font-size: 14px;
			font-weight: 300;
			color: var(--text);
		}

		.share {
			font-size: 12px;
			color: var(--text-faint);
		}
	}
</style>
