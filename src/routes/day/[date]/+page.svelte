<script lang="ts">
	/**
	 * The day page's shell — task 3.7 (design.md "Day Page, Desktop"/"Day Page,
	 * Mobile"; Requirements 5.1-5.6, 6.1). Assembles the heading line, `DayNav`,
	 * the two create-action pills (desktop only) and the two-column layout
	 * (`DayTimeline` + a side column) around the read-only load from
	 * `+page.server.ts`. `DaySummaryPanels` (task 3.8) and `SessionDialog` (task 5.6)
	 * are both wired in below — the `+ úsek` pill and `DayTimeline`'s
	 * `onSessionActivate`/`onSessionEdgeActivate` callbacks open `SessionDialog` in
	 * create/edit mode, the latter with the activated edge's field focused.
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
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { PageData } from './$types';
	import type { ActivityEntry, Interval, Project, WorkSession } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import { formatDayLabel, formatTimeOfDay, formatDuration } from '$lib/viz/format';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import DayNav from '$modules/day/components/DayNav.svelte';
	import DayTimeline from '$modules/day/components/DayTimeline.svelte';
	import ActivityDialog from '$modules/day/components/ActivityDialog.svelte';
	import SessionDialog from '$modules/day/components/SessionDialog.svelte';
	import DaySummaryPanels from '$modules/day/components/DaySummaryPanels.svelte';
	import ConfirmDialog from '$lib/ui/overlays/ConfirmDialog.svelte';
	import { addSuccessToast, addErrorToast } from '$lib/ui/overlays/toast-store.svelte';

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
	// Session_Dialog wiring (task 5.6; Requirements 8.1, 8.7, 8.9). Mirrors the
	// Activity_Dialog wiring above: the desktop "+ úsek" ghost pill opens create mode,
	// a Work_Block's head/rail-mid opens edit mode with no field focused, and a
	// Session_Rail edge opens edit mode with that end's field focused and selected
	// (task 5.6's own `initialFocus` prop, resolved by `SessionDialog` itself).
	let sessionDialogOpen = $state(false);
	let sessionDialogMode = $state<'create' | 'edit'>('create');
	let sessionDialogSession = $state<WorkSession | undefined>(undefined);
	let sessionDialogInitialFocus = $state<'start' | 'end' | undefined>(undefined);

	function handleAddSession(): void {
		sessionDialogMode = 'create';
		sessionDialogSession = undefined;
		sessionDialogInitialFocus = undefined;
		sessionDialogOpen = true;
	}
	function handleSessionActivate(sessionId: string): void {
		const found = data.sessions.find((s) => s.id === sessionId);
		if (!found) return;
		sessionDialogMode = 'edit';
		sessionDialogSession = found;
		sessionDialogInitialFocus = undefined;
		sessionDialogOpen = true;
	}
	function handleSessionEdgeActivate(sessionId: string, edge: 'start' | 'end'): void {
		const found = data.sessions.find((s) => s.id === sessionId);
		if (!found) return;
		sessionDialogMode = 'edit';
		sessionDialogSession = found;
		sessionDialogInitialFocus = edge;
		sessionDialogOpen = true;
	}
	function closeSessionDialog(): void {
		sessionDialogOpen = false;
	}

	// ---------------------------------------------------------------------------
	// Orphan_Panel wiring (DaySummaryPanels, task 3.8; Requirement 7.11). Re-entering
	// the time reuses the same Activity_Dialog edit flow as any other entry -- an
	// Orphaned_Entry is still a real ActivityEntry, just one with an empty
	// `segments` array, and ActivityDialog already renders its "requested vs
	// stored" note for exactly this case. Deletion mirrors ActivityDialog's own
	// hidden-form-behind-ConfirmDialog pattern (task 5.5) rather than opening the
	// dialog first, since the Orphan_Panel's own foot actions are the direct trigger
	// per design.md -- Requirement 7.7 only asks that deletion sit behind a
	// confirmation naming what is removed, not that it go through the edit dialog.
	function handleReenterOrphan(entryId: string): void {
		openEditActivity(entryId);
	}

	let deleteOrphanConfirmOpen = $state(false);
	let deleteOrphanId = $state<string | null>(null);
	let deleteOrphanDeleting = $state(false);
	let deleteOrphanFormEl = $state<HTMLFormElement | undefined>();

	function handleDeleteOrphan(entryId: string): void {
		deleteOrphanId = entryId;
		deleteOrphanConfirmOpen = true;
	}

	const deleteOrphanEntry = $derived(
		deleteOrphanId ? (data.entries.find((e) => e.id === deleteOrphanId) ?? null) : null
	);

	const deleteOrphanBody = $derived(
		deleteOrphanEntry
			? m.day_orphans_row({
					from: formatTimeOfDay(deleteOrphanEntry.requestedStartedAt, locale, timeZone),
					to: formatTimeOfDay(deleteOrphanEntry.requestedEndedAt, locale, timeZone)
				})
			: ''
	);

	function handleDeleteOrphanEnhance() {
		deleteOrphanDeleting = true;
		return async ({ result }: { result: ActionResult }) => {
			deleteOrphanDeleting = false;
			deleteOrphanConfirmOpen = false;
			deleteOrphanId = null;

			if (result.type === 'success') {
				await invalidateAll();
				addSuccessToast(m.feedback_deleted());
				return;
			}
			if (result.type === 'failure') {
				const failureData = result.data as { toastMessage?: string; notFound?: boolean } | undefined;
				if (failureData?.toastMessage) addErrorToast(failureData.toastMessage);
				if (failureData?.notFound) await invalidateAll();
				return;
			}
			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}
			addErrorToast(m.errors_internal_error({ requestId: '—' }));
		};
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

<SessionDialog
	mode={sessionDialogMode}
	session={sessionDialogSession}
	date={data.date}
	open={sessionDialogOpen}
	onClose={closeSessionDialog}
	{timeZone}
	{density}
	now={data.now}
	initialFocus={sessionDialogInitialFocus}
/>

<ConfirmDialog
	open={deleteOrphanConfirmOpen}
	title={m.activity_delete_title()}
	message={deleteOrphanBody}
	variant="destructive"
	loading={deleteOrphanDeleting}
	onconfirm={() => deleteOrphanFormEl?.requestSubmit()}
	oncancel={() => {
		deleteOrphanConfirmOpen = false;
		deleteOrphanId = null;
	}}
/>
<form
	bind:this={deleteOrphanFormEl}
	method="POST"
	action="?/deleteActivity"
	class="day-page__wire-form"
	use:enhance={handleDeleteOrphanEnhance}
>
	<input type="hidden" name="id" value={deleteOrphanId ?? ''} />
</form>

<style>
	.day-page__wire-form {
		display: none;
	}

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
