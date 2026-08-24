<script lang="ts">
	/**
	 * Task 3.8 (design.md "Day Page, Desktop": *souhrn dne* / *tvar dne* / *mimo
	 * výkaz*; Requirements 7.9, 7.10, 7.11, 10.1, 10.5, 10.8).
	 *
	 * The day page's 290 px side column: two always-present panels reading the
	 * `Day_Response`'s already-loaded `totals` (never a second request — Requirement
	 * 10.8), plus the `Orphan_Panel`, rendered only when the day holds at least one
	 * `Orphaned_Entry` (Requirement 7.10) — an `Activity_Entry` with `orphaned: true`
	 * has no `Activity_Segment` and therefore no position on the `Day_Timeline` at
	 * all, which is the whole reason this panel exists beside it rather than being
	 * folded into it.
	 *
	 * No `ActivityList`, no `UncoveredList` (tasks.md 3.8): the `Day_Timeline` is
	 * already the day's list of both.
	 *
	 * ---------------------------------------------------------------------------
	 * ORPHAN ROW SELECTION. design.md: "one shared pair of actions at the foot —
	 * re-enter the times, or delete — acting on the selected row … Per-row pairs
	 * were considered and rejected: at 290 pixels wide they cost more height than
	 * the rows they belong to." So the rows form a `role="radiogroup"` of
	 * `role="radio"` buttons (the exact roving-tabindex pattern already used by
	 * `ActivityDialog`'s mode control, `ChangePreview`'s policy control and
	 * `SettingsMenu`'s theme/locale controls — Arrow Up/Down here since this list is
	 * vertical rather than the others' horizontal segmented controls), and the two
	 * foot actions act on whichever row is selected. The selection defaults to the
	 * FIRST orphaned entry rather than requiring an explicit selection step first —
	 * design.md does not say either way, but leaving the actions disabled until a
	 * user who has exactly one orphan (the common case) hunts for a selection step
	 * would be a worse default, and a default selection is still visibly marked via
	 * `aria-checked`/`data-selected` exactly as an explicit one would be. This is a
	 * judgment call, not a stated requirement.
	 *
	 * `effectiveSelectedId` is fully derived rather than kept in sync with an
	 * `$effect` — it falls back to the first orphan whenever `selectedOrphanId` is
	 * null OR no longer names a row still present (an orphan was just re-entered or
	 * deleted out from under the selection), so there is never a moment where a
	 * removed row stays "selected" for its own now-vanished actions.
	 */
	import type { ActivityEntry } from '$lib/contracts/models';
	import type { DayResponse } from '$lib/contracts/responses';
	import * as m from '$lib/paraglide/messages';
	import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import { projectSlotClass } from '$lib/viz/palette';
	import CoverageMeter from '$modules/stats/components/CoverageMeter.svelte';

	interface Props {
		entries: ActivityEntry[];
		totals: DayResponse['totals'];
		/** From the Health_Endpoint — named in the *tvar dne* label, never assumed. */
		eveningHour: number;
		timeZone: string;
		/** Opens the Activity_Dialog in edit mode for the selected Orphaned_Entry. */
		onReenterOrphan: (entryId: string) => void;
		/** Emits intent only — task 5.5 wires the actual delete write. */
		onDeleteOrphan: (entryId: string) => void;
		class?: string;
	}

	let {
		entries,
		totals,
		eveningHour,
		timeZone,
		onReenterOrphan,
		onDeleteOrphan,
		class: className = ''
	}: Props = $props();

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}

	function timeOf(t: Date): string {
		return formatTimeOfDay(t, '', timeZone);
	}

	/** A bare configuration hour as a wall-clock string — "21" → "21:00". A small
	 * independent copy of `RhythmPanel.svelte`'s own private `formatHour`: the two
	 * modules may not import from each other for a two-line helper. */
	function formatHour(hour: number): string {
		return `${String(hour).padStart(2, '0')}:00`;
	}

	const describedSharePercent = $derived(
		totals.trackedSeconds > 0 ? (totals.coveredSeconds / totals.trackedSeconds) * 100 : 0
	);

	const orphanedEntries = $derived(entries.filter((e) => e.orphaned));

	let selectedOrphanId = $state<string | null>(null);

	const effectiveSelectedId = $derived(
		selectedOrphanId !== null && orphanedEntries.some((e) => e.id === selectedOrphanId)
			? selectedOrphanId
			: (orphanedEntries[0]?.id ?? null)
	);

	function selectOrphan(entryId: string): void {
		selectedOrphanId = entryId;
	}

	function handleRowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const current = event.currentTarget as HTMLElement;
		const group = current.closest('[role="radiogroup"]');
		if (!group) return;
		const items = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
		const index = items.indexOf(current);
		if (index === -1) return;
		event.preventDefault();
		const delta = event.key === 'ArrowDown' ? 1 : -1;
		const next = items[(index + delta + items.length) % items.length];
		next.focus();
		next.click();
	}

	function handleReenter(): void {
		if (effectiveSelectedId !== null) onReenterOrphan(effectiveSelectedId);
	}

	function handleDelete(): void {
		if (effectiveSelectedId !== null) onDeleteOrphan(effectiveSelectedId);
	}
</script>

<div class="day-summary-panels {className}">
	<div class="day-summary-panels__panel day-summary-panels__panel--summary">
		<span class="lbl">{m.day_summary_label()}</span>
		<dl class="day-summary-panels__dl">
			<div class="day-summary-panels__row">
				<dt>{m.day_summary_worked()}</dt>
				<dd class="day-summary-panels__value--headline">{fmtDuration(totals.trackedSeconds)}</dd>
			</div>
			<div class="day-summary-panels__row">
				<dt>{m.day_summary_covered()}</dt>
				<dd class="day-summary-panels__value--headline">{fmtDuration(totals.coveredSeconds)}</dd>
			</div>
			<div class="day-summary-panels__row">
				<dt>{m.day_summary_uncovered()}</dt>
				<dd class="day-summary-panels__value--headline day-summary-panels__value--accent">
					{fmtDuration(totals.uncoveredSeconds)}
				</dd>
			</div>
		</dl>
		<CoverageMeter percent={describedSharePercent} class="day-summary-panels__meter" />
		{#if totals.uncoveredSeconds === 0}
			<p class="day-summary-panels__caption">{m.day_summary_complete()}</p>
		{:else}
			<p class="day-summary-panels__caption">
				{m.day_summary_share({ percent: Math.round(describedSharePercent) })}
			</p>
		{/if}
	</div>

	<div class="day-summary-panels__panel day-summary-panels__panel--shape">
		<span class="lbl">{m.day_shape_label()}</span>
		<dl class="day-summary-panels__dl">
			<div class="day-summary-panels__row">
				<dt>{m.day_shape_blocks()}</dt>
				<dd class="day-summary-panels__value--plain">{totals.sessionCount}</dd>
			</div>
			<div class="day-summary-panels__row">
				<dt>{m.day_shape_longest()}</dt>
				<dd class="day-summary-panels__value--plain">{fmtDuration(totals.longestBlockSeconds)}</dd>
			</div>
			<div class="day-summary-panels__row">
				<dt>{m.day_shape_evening({ eveningHour: formatHour(eveningHour) })}</dt>
				<dd class="day-summary-panels__value--plain">{fmtDuration(totals.eveningSeconds)}</dd>
			</div>
		</dl>
	</div>

	{#if orphanedEntries.length > 0}
		<div class="day-summary-panels__panel day-summary-panels__panel--orphans">
			<div class="day-summary-panels__orphans-head">
				<span class="lbl day-summary-panels__orphans-label">{m.day_orphans_label()}</span>
				<span class="day-summary-panels__orphans-count">{orphanedEntries.length}</span>
			</div>
			<p class="day-summary-panels__orphans-body">{m.day_orphans_body()}</p>

			<div
				class="day-summary-panels__orphans-list"
				role="radiogroup"
				aria-label={m.day_orphans_label()}
			>
				{#each orphanedEntries as entry (entry.id)}
					{@const selected = entry.id === effectiveSelectedId}
					<button
						type="button"
						role="radio"
						aria-checked={selected}
						tabindex={selected ? 0 : -1}
						class="day-summary-panels__orphan-row {projectSlotClass(entry.colorIndex)}"
						class:day-summary-panels__orphan-row--selected={selected}
						onclick={() => selectOrphan(entry.id)}
						onkeydown={handleRowKeydown}
					>
						<span class="day-summary-panels__orphan-project">{entry.projectName}</span>
						<span class="day-summary-panels__orphan-times">
							{m.day_orphans_row({
								from: timeOf(entry.requestedStartedAt),
								to: timeOf(entry.requestedEndedAt)
							})}
						</span>
					</button>
				{/each}
			</div>

			<div class="day-summary-panels__orphans-actions">
				<button
					type="button"
					class="day-summary-panels__orphans-action day-summary-panels__orphans-action--reenter"
					disabled={effectiveSelectedId === null}
					onclick={handleReenter}
				>
					{m.day_orphans_reenter()}
				</button>
				<button
					type="button"
					class="day-summary-panels__orphans-action day-summary-panels__orphans-action--delete"
					disabled={effectiveSelectedId === null}
					onclick={handleDelete}
				>
					{m.common_delete()}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Full width on mobile, where the two/three panels move below the Day_Timeline
	 * in DOM order (a page-assembly concern, task 3.7); the fixed 290 px column
	 * only applies from the same 768 px breakpoint theme.css uses throughout. */
	.day-summary-panels {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 100%;
	}

	@media (min-width: 768px) {
		.day-summary-panels {
			width: 290px;
			flex-shrink: 0;
		}
	}

	.day-summary-panels__panel {
		display: flex;
		flex-direction: column;
		gap: 11px;
		box-sizing: border-box;
		padding: 16px;
		border-radius: var(--radius-14);
		background: var(--panel);
		/* design.md's Focus Ring section: "--panel inside a panel". */
		--focus-gap: var(--panel);
	}

	.day-summary-panels__panel--summary {
		gap: 12px;
	}

	.day-summary-panels__panel--orphans {
		border: 1px solid rgba(209, 138, 106, 0.28);
	}

	/* `display: contents` keeps `<dl>`/`<dt>`/`<dd>` semantics without the `<dl>`
	 * itself taking part in layout — each row div becomes a direct flex child of
	 * `.day-summary-panels__panel`, sharing that single gap with the label and the
	 * meter/caption exactly as the artboard's flat flex column draws it, rather
	 * than nesting a second gap inside a first. */
	.day-summary-panels__dl {
		display: contents;
	}

	.day-summary-panels__row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin: 0;
	}

	.day-summary-panels__row dt {
		font-size: 13px;
		font-weight: 400;
		color: var(--text-dim);
	}

	.day-summary-panels__row dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.day-summary-panels__value--headline {
		font-size: 15px;
		font-weight: 500;
	}

	.day-summary-panels__value--plain {
		font-size: 13px;
		font-weight: 400;
	}

	.day-summary-panels__value--accent {
		color: var(--accent);
	}

	.day-summary-panels__panel :global(.day-summary-panels__meter) {
		margin-top: 2px;
	}

	.day-summary-panels__caption {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.day-summary-panels__orphans-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.day-summary-panels__orphans-label {
		flex-grow: 1;
		color: var(--accent);
	}

	.day-summary-panels__orphans-count {
		font-size: 11px;
		color: var(--text-faint);
	}

	.day-summary-panels__orphans-body {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.day-summary-panels__orphans-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.day-summary-panels__orphan-row {
		display: flex;
		flex-direction: column;
		gap: 3px;
		box-sizing: border-box;
		width: 100%;
		padding: 9px 11px;
		border: none;
		border-left: 3px solid var(--pj);
		border-radius: var(--radius-9);
		background: var(--row);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}

	.day-summary-panels__orphan-row:hover {
		background: var(--row-hover);
	}

	.day-summary-panels__orphan-row--selected {
		background: var(--row-active);
	}

	.day-summary-panels__orphan-project {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--text);
	}

	.day-summary-panels__orphan-times {
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}

	.day-summary-panels__orphans-actions {
		display: flex;
		gap: 8px;
		margin-top: 2px;
	}

	.day-summary-panels__orphans-action {
		flex: 1 1 0;
		box-sizing: border-box;
		padding: 8px 0;
		border: none;
		border-radius: var(--radius-8);
		font: inherit;
		font-size: 12px;
		text-align: center;
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}

	.day-summary-panels__orphans-action:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.day-summary-panels__orphans-action--reenter {
		background: rgba(209, 138, 106, 0.14);
		color: var(--accent);
		font-weight: 500;
	}

	.day-summary-panels__orphans-action--reenter:not(:disabled):hover {
		background: rgba(209, 138, 106, 0.2);
	}

	.day-summary-panels__orphans-action--delete {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-dim);
	}

	.day-summary-panels__orphans-action--delete:not(:disabled):hover {
		background: rgba(255, 255, 255, 0.08);
	}
</style>
