<script lang="ts">
	/**
	 * The day page's shell — task 3.7 (design.md "Day Page, Desktop"/"Day Page,
	 * Mobile"; Requirements 5.1-5.6, 6.1). Assembles the heading line, `DayNav`,
	 * the two create-action pills (desktop only) and the two-column layout
	 * (`DayTimeline` + a side column) around the read-only load from
	 * `+page.server.ts`.
	 *
	 * TWO INTEGRATION POINTS ARE STILL OPEN, both flagged in the task's own brief:
	 *
	 * 1. `DaySummaryPanels` (task 3.8, running in parallel this same wave) does not
	 *    exist yet. `.day-page__summary-slot` below is where it mounts — desktop's
	 *    fixed 290px column, sliding below the timeline on mobile per design.md's
	 *    own words ("The two side panels move below the timeline"). Left as an
	 *    empty, `aria-hidden` placeholder rather than invented content.
	 * 2. `SessionDialog` (task 5.6) does not exist yet either. The `+ úsek` pill and
	 *    `DayTimeline`'s `onSessionActivate`/`onSessionEdgeActivate` callbacks are
	 *    wired to real handlers that currently do nothing (see the `TODO(5.6)`
	 *    comments below) rather than opening a dialog that isn't built.
	 *
	 * `density` comes from `data.density` — the root layout's server-resolved value
	 * (`+layout.server.ts`, from the `worklog_viewport` cookie). `+layout.svelte`
	 * (task 1.10, not touched by this task) keeps its own live `matchMedia`-corrected
	 * copy for `SettingsMenu` but exposes it through no context or prop this page can
	 * read, so `DayNav`/`DayTimeline`/`ActivityDialog` all see the server-resolved
	 * density here, corrected only on the next navigation (exactly as `availablePx`
	 * already documents for itself) rather than live on an in-place resize.
	 */
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import type { ActivityEntry, Interval, Project } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import { formatDayLabel, formatTimeOfDay, formatDuration } from '$lib/viz/format';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import DayNav from '$modules/day/components/DayNav.svelte';
	import DayTimeline from '$modules/day/components/DayTimeline.svelte';
	import ActivityDialog from '$modules/day/components/ActivityDialog.svelte';
	import DaySummaryPanels from '$modules/day/components/DaySummaryPanels.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const density = $derived(data.density);
	const timeZone = $derived(data.serverConfig.timezone);
	const locale = $derived(data.locale);
	const today = $derived(data.today.date);

	const dateLabel = $derived(formatDayLabel(data.date, locale, today, 'relative'));
	const fromLabel = $derived(formatTimeOfDay(data.bounds.start, locale, timeZone));
	const toLabel = $derived(formatTimeOfDay(data.bounds.end, locale, timeZone));
	const workedLabel = $derived(formatDuration(data.totals.trackedSeconds, locale));
	const metaLabel = $derived(m.day_heading_meta({ from: fromLabel, to: toLabel, worked: workedLabel }));

	// ---------------------------------------------------------------------------
	// Activity_Dialog wiring (Requirements 6.1, 6.14; the timeline's activation
	// callbacks). `projectsList` is a local copy so `onProjectCreated` (an inline
	// Project creation inside the Project_Picker) can append to it without a
	// round trip back through `load`. Seeded via `untrack()` (same pattern as the
	// root layout's own `density` seed) — the initializer is deliberately a
	// one-time snapshot, kept in sync afterward by the `$effect` below rather than
	// by reactively re-reading `data.projects` here.
	let projectsList = $state(untrack(() => data.projects));
	$effect(() => {
		projectsList = data.projects;
	});

	let activityDialogOpen = $state(false);
	let activityDialogMode = $state<'create' | 'edit'>('create');
	let activityDialogEntry = $state<ActivityEntry | undefined>(undefined);
	let activityDialogPrefill = $state<
		{ range?: Interval; projectId?: string; description?: string } | undefined
	>(undefined);

	function openCreateActivity(range?: Interval): void {
		activityDialogMode = 'create';
		activityDialogEntry = undefined;
		activityDialogPrefill = range ? { range } : undefined;
		activityDialogOpen = true;
	}

	function openEditActivity(entryId: string): void {
		const entry = data.entries.find((e) => e.id === entryId);
		if (!entry) return;
		activityDialogMode = 'edit';
		activityDialogEntry = entry;
		activityDialogPrefill = undefined;
		activityDialogOpen = true;
	}

	function closeActivityDialog(): void {
		activityDialogOpen = false;
	}

	function handleProjectCreated(project: Project): void {
		projectsList = [...projectsList, project];
	}

	// ---------------------------------------------------------------------------
	// Session_Dialog (task 5.6) does not exist yet — see the doc comment above.
	// These are real, wired handlers that intentionally do nothing until that task
	// builds the dialog; they are not stand-ins for missing plumbing.
	function handleAddSession(): void {
		// TODO(5.6): open SessionDialog in create mode once it exists.
	}
	function handleSessionActivate(_sessionId: string): void {
		// TODO(5.6): open SessionDialog in edit mode once it exists.
	}
	function handleSessionEdgeActivate(_sessionId: string, _edge: 'start' | 'end'): void {
		// TODO(5.6): open SessionDialog in edit mode, focused on the given edge.
	}

	// ---------------------------------------------------------------------------
	// Orphan_Panel wiring (DaySummaryPanels, task 3.8; Requirement 7.11). Re-entering
	// the time reuses the same Activity_Dialog edit flow as any other entry -- an
	// Orphaned_Entry is still a real ActivityEntry, just one with an empty
	// `segments` array, and ActivityDialog already renders its "requested vs
	// stored" note for exactly this case. Deletion has no write action yet
	// (task 5.5), so it's the same documented no-op pattern as the session handlers
	// above rather than invented plumbing.
	function handleReenterOrphan(entryId: string): void {
		openEditActivity(entryId);
	}
	function handleDeleteOrphan(_entryId: string): void {
		// TODO(5.5): call the delete-activity form action once it exists.
	}
</script>

<svelte:head>
	<title>{dateLabel} · {m.nav_brand()}</title>
</svelte:head>

<div class="day-page day-page--{density}">
	{#if density === 'desktop'}
		<div class="day-page__heading">
			<div class="day-page__heading-left">
				<DayNav date={data.date} {today} {locale} density="desktop" {metaLabel} />
				<div class="day-page__title">
					<span class="day-page__date">{dateLabel}</span>
					<span class="day-page__meta">{metaLabel}</span>
				</div>
			</div>
			<div class="day-page__actions">
				<button
					type="button"
					class="day-page__pill day-page__pill--primary"
					onclick={() => openCreateActivity()}
				>
					<Icon name="plus" size={13} />
					{m.day_add_activity()}
				</button>
				<button type="button" class="day-page__pill day-page__pill--ghost" onclick={handleAddSession}>
					<Icon name="plus" size={13} />
					{m.day_add_session()}
				</button>
			</div>
		</div>
	{:else}
		<DayNav date={data.date} {today} {locale} density="mobile" {metaLabel} />
	{/if}

	<div class="day-page__body">
		<div class="day-page__timeline">
			<DayTimeline
				sessions={data.sessions}
				entries={data.entries}
				uncovered={data.coverage.uncovered}
				maxOpenSessionHours={data.serverConfig.maxOpenSessionHours}
				eveningHour={data.serverConfig.eveningHour}
				now={data.now}
				{density}
				{timeZone}
				{locale}
				date={data.date}
				onActivityActivate={openEditActivity}
				onUncoveredActivate={(range) => openCreateActivity(range)}
				onSessionActivate={handleSessionActivate}
				onSessionEdgeActivate={handleSessionEdgeActivate}
			/>
		</div>

		<DaySummaryPanels
			class="day-page__summary-slot"
			entries={data.entries}
			totals={data.totals}
			eveningHour={data.serverConfig.eveningHour}
			{timeZone}
			onReenterOrphan={handleReenterOrphan}
			onDeleteOrphan={handleDeleteOrphan}
		/>
	</div>
</div>

<ActivityDialog
	mode={activityDialogMode}
	entry={activityDialogEntry}
	prefill={activityDialogPrefill}
	date={data.date}
	projects={projectsList}
	open={activityDialogOpen}
	onClose={closeActivityDialog}
	{timeZone}
	{density}
	recentEntry={data.recentEntry}
	onProjectCreated={handleProjectCreated}
/>

<style>
	.day-page {
		display: flex;
		flex-direction: column;
		gap: 20px;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: 24px 48px;
	}

	.day-page--mobile {
		gap: 14px;
		padding: 16px 16px 20px;
	}

	/* --------------------------------------------------------------------
	 * Heading line (desktop only — mobile's equivalent is DayNav's own row)
	 * ------------------------------------------------------------------ */
	.day-page__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.day-page__heading-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.day-page__title {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.day-page__date {
		font-size: 20px;
		font-weight: 500;
		color: var(--text);
	}

	.day-page__meta {
		font-size: 13px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.day-page__actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.day-page__pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 16px;
		border: none;
		border-radius: 9999px;
		font-size: 13.5px;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.day-page__pill--primary {
		background-color: var(--accent);
		color: var(--ink-on-accent);
		font-weight: 600;
	}

	.day-page__pill--primary:hover {
		background-color: var(--accent-hover);
	}

	.day-page__pill--ghost {
		background-color: var(--chip);
		color: var(--text-dim);
		font-weight: 400;
	}

	.day-page__pill--ghost:hover {
		background-color: rgb(from var(--chip) r g b / calc(alpha + 0.03));
		color: var(--text);
	}

	.day-page__pill:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	/* --------------------------------------------------------------------
	 * Two-column body — DayTimeline growing to fill, a fixed 290px side
	 * column that moves below the timeline on mobile (design.md).
	 * ------------------------------------------------------------------ */
	.day-page__body {
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1;
		min-height: 0;
	}

	.day-page--desktop .day-page__body {
		flex-direction: row;
		gap: 24px;
	}

	.day-page__timeline {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	/* :global -- `.day-page__summary-slot` is passed as a `class` prop into
	   DaySummaryPanels (a child component), not written as a literal class on an
	   element in THIS component's own template, so Svelte's scoped-CSS dead-code
	   analysis can't see it's used and would otherwise prune it. */
	:global(.day-page__summary-slot) {
		flex-shrink: 0;
	}

	.day-page--desktop :global(.day-page__summary-slot) {
		width: 290px;
	}
</style>
