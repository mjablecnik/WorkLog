<script lang="ts">
	/**
	 * Task 6.7 (design.md § "Timer Page", bullet 5: "`Project_Legend` — 12
	 * `--text-faint` items with `gap: 22`, each an 8×8 swatch of radius 2 beside the
	 * project name, closing with a 14 px dashed accent rule labelled `bez popisu`";
	 * Requirement 3.8). `DayGauge.svelte`'s arcs are `aria-hidden` and carry project
	 * identity only through colour — this is that identity's text alternative, so it
	 * is never optional (design.md's "9. Timer Control" section, `ProjectLegend.svelte`
	 * paragraph).
	 *
	 * Reads straight off the day payload's already-computed `totals.byProject`
	 * (`ProjectTotal[]` — `$lib/contracts/models.ts`) rather than deriving its own
	 * list from `sessions`/`entries`: the server already resolved which projects and
	 * which `colorIndex` each has, exactly once, and a second derivation here would be
	 * a second opinion about the same figure `DayGauge`'s inner arcs already draw from
	 * that same source. The prop type below only names the three fields this
	 * component actually reads, so a `ProjectTotal[]` (which carries more) is
	 * structurally assignable without a cast at the call site.
	 *
	 * Swatch markup mirrors the established convention (`ProjectPicker.svelte`'s
	 * `.project-picker__swatch`, `--radius-2` is itself commented "legend swatch" in
	 * `theme.css`): a `span` carrying `projectSlotClass(colorIndex)` so the element
	 * picks up that slot's `--pj` custom property, painted as `background`.
	 *
	 * The dashed `Uncovered_Time` entry reuses `--uncovered-dash` — the exact token
	 * `DayGauge.svelte` strokes its own dashed arcs with — rather than a second literal
	 * rgba, so the legend's swatch and the gauge's dashes can never drift apart.
	 */
	import * as m from '$lib/paraglide/messages';
	import { projectSlotClass } from '$lib/viz/palette';

	interface ProjectLegendItem {
		projectId: string;
		projectName: string;
		colorIndex: number;
	}

	interface Props {
		byProject: ProjectLegendItem[];
	}

	let { byProject }: Props = $props();
</script>

<div class="project-legend">
	{#each byProject as project (project.projectId)}
		<span class="project-legend__item">
			<span class="project-legend__swatch {projectSlotClass(project.colorIndex)}" aria-hidden="true"
			></span>
			{project.projectName}
		</span>
	{/each}
	<span class="project-legend__item project-legend__item--uncovered">
		<span class="project-legend__dash" aria-hidden="true"></span>
		{m.timer_legend_uncovered()}
	</span>
</div>

<style>
	.project-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 22px;
	}

	.project-legend__item {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--text-faint);
		white-space: nowrap;
	}

	.project-legend__swatch {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-2);
		background: var(--pj);
	}

	.project-legend__dash {
		flex-shrink: 0;
		width: 14px;
		height: 0;
		border-top: 2px dashed var(--uncovered-dash);
	}
</style>
