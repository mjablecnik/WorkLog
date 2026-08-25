<script lang="ts">
	/**
	 * The timer page — task 6.7 (design.md "Timer Page"; Requirements 3.1-3.20,
	 * 6.12-6.18, 16.13, 16.14). Lives at the root route (Requirement 3.4).
	 *
	 * TWO STATES, ONE LAYOUT (design.md's own framing): the hero readout, its
	 * caption and the centre control's icon are the only things that differ between
	 * a running and a resting day — the gauge draws the day's arcs identically
	 * either way (`running` below), and every other element (the three figures,
	 * `QuickLog`, `ProjectLegend`) reads straight off the day's totals regardless.
	 *
	 * ELAPSED OWNERSHIP: this page owns its OWN `createElapsed` instance — a
	 * separate one from `+layout.svelte`'s `runningIndicatorElapsed`, exactly as
	 * `elapsed.svelte.ts`'s own doc comment anticipates ("a page wires this up with
	 * its own `invalidateAll`"). `+layout.svelte` already hides the
	 * `Running_Indicator` on this route (`showRunningIndicator = !isTimerPage && …`)
	 * so the two instances never render two competing readouts.
	 *
	 * SYNC STRATEGY (Requirements 3.10, 3.12, 3.13): rather than two separate paths
	 * for "sync on success" vs "roll back on failure", both are the SAME mechanism —
	 * an `$effect` that calls `elapsed.sync(data.currentSession)` whenever `data`
	 * changes. Every write action's `use:enhance` callback calls SvelteKit's own
	 * `update()`, which invalidates this page's `load` regardless of outcome; the
	 * reloaded `data.currentSession` (recomputed fresh in `+page.server.ts`, see its
	 * own doc comment) is therefore ALWAYS the authoritative post-write truth, success
	 * or failure alike — "roll back" and "sync the real result" collapse into the one
	 * case of "load ran again". `TimerControl`'s `onStart`/`onStop` still apply
	 * `elapsed.start()`/`elapsed.stop()` optimistically, synchronously, before that
	 * round trip resolves, so the hero flips instantly; this effect then corrects it
	 * to the true value once the reload lands (a no-op when the guess was right).
	 *
	 * ERROR REPORTING (Requirement 3.17): a SEPARATE `$effect` watches `form`
	 * specifically (not `data`) — `form` carries what `data.currentSession` cannot,
	 * the failed action's `code`/`messageKey`/`details`. `buildFailureMessage` below
	 * interpolates the session-specific keys (`errors_session_already_running`,
	 * `errors_session_overlap[_open]`) from those details, per each key's own real
	 * compiled parameters (checked against `messages/en.json` directly, not guessed).
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import type { ActivityEntry, Project } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import { formatClock, formatDuration, formatDurationShort, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import DayGauge from '$modules/timer/components/DayGauge.svelte';
	import TimerControl from '$modules/timer/components/TimerControl.svelte';
	import QuickLog from '$modules/timer/components/QuickLog.svelte';
	import ProjectLegend from '$modules/timer/components/ProjectLegend.svelte';
	import ActivityDialog from '$modules/day/components/ActivityDialog.svelte';
	import TimeInput from '$lib/ui/forms/TimeInput.svelte';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import { createElapsed } from '$modules/timer/elapsed.svelte';
	import { useTabTitle } from '$modules/timer/tab-title.svelte';
	import { addErrorToast, addSuccessToast } from '$lib/ui/overlays/toast-store.svelte';

	interface Props {
		data: PageData;
		form: ActionData;
	}

	let { data, form }: Props = $props();

	const density = $derived(data.density);
	const timeZone = $derived(data.serverConfig.timezone);
	const locale = $derived(data.locale);
	const maxOpenSessionHours = $derived(data.serverConfig.maxOpenSessionHours);

	const openSession = $derived(data.currentSession.session);
	const running = $derived(openSession !== null);
	const stale = $derived(running && data.currentSession.stale);

	// ---------------------------------------------------------------------------
	// The elapsed store — see the module doc's "ELAPSED OWNERSHIP"/"SYNC STRATEGY".
	const elapsed = createElapsed({
		openedAt: untrack(() => data.currentSession.session?.startedAt ?? null)
	});
	$effect(() => {
		elapsed.sync(data.currentSession);
	});

	useTabTitle({
		runningSeconds: () => elapsed.runningSeconds,
		running: () => running,
		plainTitle: m.nav_brand()
	});

	/** The Day_Gauge's Open_Session arc end — derived from the SAME ticking counter
	 * as the hero readout (design.md's own DayGauge doc: "a parent's single ticking
	 * clock … is the one source of 'now' a render used"), never a second independent
	 * `Date.now()` that could disagree with the hero by a tick. */
	const gaugeNow = $derived(
		running && openSession !== null
			? new Date(openSession.startedAt.getTime() + elapsed.runningSeconds * 1000)
			: data.now
	);

	// ---------------------------------------------------------------------------
	// Hero readout + caption (Requirements 3.3, 3.4, 3.19, 3.20).
	const heroText = $derived(
		running ? formatClock(elapsed.runningSeconds) : formatDuration(data.totals.trackedSeconds, locale)
	);

	const lastSessionEnd = $derived.by(() => {
		const closedEnds = data.sessions
			.filter((s) => s.endedAt !== null)
			.map((s) => s.endedAt as Date);
		if (closedEnds.length === 0) return null;
		return closedEnds.reduce((latest, end) => (end.getTime() > latest.getTime() ? end : latest));
	});

	const captionText = $derived.by(() => {
		if (running && openSession !== null) {
			return m.timer_running_since({ time: formatTimeOfDay(openSession.startedAt, locale, timeZone) });
		}
		if (lastSessionEnd !== null) {
			return m.timer_stopped_at({ time: formatTimeOfDay(lastSessionEnd, locale, timeZone) });
		}
		return m.timer_idle_caption();
	});

	// ---------------------------------------------------------------------------
	// Start/stop optimism (TimerControl's own props) — see the module doc.
	function handleOptimisticStart(): void {
		elapsed.start();
	}
	function handleOptimisticStop(): void {
		elapsed.stop();
	}

	// ---------------------------------------------------------------------------
	// Stale_Session notice (Requirement 3.16). `staleStopValue` is the notice's own
	// `TimeInput` text, prefilled with `startedAt + MAX_OPEN_SESSION_HOURS` whenever a
	// Stale_Session newly appears — an `$effect` rather than a `$derived` because it
	// is a starting point for further EDITS, not a value that must always track the
	// prefill formula (the user may type a different instant before submitting).
	let staleStopValue = $state('');
	let staleSubmitting = $state(false);

	$effect(() => {
		if (!stale || openSession === null) return;
		const cutoff = new Date(openSession.startedAt.getTime() + maxOpenSessionHours * 3_600_000);
		untrack(() => {
			staleStopValue = formatTimeOfDay(cutoff, locale, timeZone);
		});
	});

	const handleStopAtSubmit: SubmitFunction = ({ formData, cancel }) => {
		let iso: string;
		try {
			iso = parseTimeOfDay(staleStopValue, data.date, timeZone).toISOString();
		} catch {
			cancel();
			addErrorToast(m.errors_invalid_interval());
			return;
		}
		formData.set('endedAt', iso);
		staleSubmitting = true;
		return async ({ update }) => {
			await update();
			staleSubmitting = false;
		};
	};

	// ---------------------------------------------------------------------------
	// The three figures (Requirements 3.4, 3.5, 3.6, 3.7).
	function figureText(seconds: number): string {
		return density === 'desktop' ? formatDuration(seconds, locale) : formatDurationShort(seconds, locale);
	}

	// ---------------------------------------------------------------------------
	// Quick_Log -> Activity_Dialog fallback (Requirements 6.13, 6.18).
	// `ActivityDialog.svelte`'s hidden submit form posts to the RELATIVE actions
	// `?/createActivity`/`?/patchActivity`/`?/deleteActivity` — relative to whatever
	// route currently renders it. This route now defines those same three actions
	// (see `+page.server.ts`), both imported from the shared
	// `$lib/server/services/activity-form-actions.ts` module `day/[date]/+page.server.ts`
	// also imports, so the dialog behaves identically whichever route mounted it.
	let projectsList = $derived(data.projects);

	let activityDialogOpen = $state(false);
	let activityDialogPrefill = $state<{ projectId?: string } | undefined>(undefined);
	let activityDialogInitialFocus = $state<'project' | 'description' | undefined>(undefined);

	function openActivityDialogFromQuickLog(prefill: { projectId?: string }): void {
		activityDialogPrefill = prefill.projectId !== undefined ? { projectId: prefill.projectId } : undefined;
		activityDialogInitialFocus = prefill.projectId !== undefined ? undefined : 'project';
		activityDialogOpen = true;
	}
	function closeActivityDialog(): void {
		activityDialogOpen = false;
	}
	function handleProjectCreated(project: Project): void {
		projectsList = [...projectsList, project];
	}
	function handleQuickLogged(_entry: ActivityEntry): void {
		// The page's own `load` already refreshes via QuickLog's own `update()` call
		// (its default `use:enhance` behaviour invalidates this route), so the new
		// entry reaches `data.entries`/`data.totals` without anything extra here.
	}

	// ---------------------------------------------------------------------------
	// Failure toasts (Requirement 3.13, 3.17) — see the module doc's "ERROR REPORTING".
	function buildFailureMessage(messageKey: string, details: unknown): string {
		const d = (details ?? {}) as Record<string, unknown>;
		switch (messageKey) {
			case 'errors_session_already_running': {
				const startedAt = typeof d.startedAt === 'string' ? d.startedAt : undefined;
				return m.errors_session_already_running({
					startedAt: startedAt ? formatTimeOfDay(new Date(startedAt), locale, timeZone) : ''
				});
			}
			case 'errors_session_overlap': {
				const conflicts = Array.isArray(d.conflicts)
					? (d.conflicts as { interval: { start: string; end: string }; open: boolean }[])
					: [];
				const first = conflicts[0];
				if (first === undefined) return m.errors_session_overlap({ from: '', to: '' });
				if (first.open) {
					return m.errors_session_overlap_open({
						from: formatTimeOfDay(new Date(first.interval.start), locale, timeZone)
					});
				}
				return m.errors_session_overlap({
					from: formatTimeOfDay(new Date(first.interval.start), locale, timeZone),
					to: formatTimeOfDay(new Date(first.interval.end), locale, timeZone)
				});
			}
			case 'errors_no_placement_anchor':
				return m.errors_no_placement_anchor({ date: typeof d.date === 'string' ? d.date : data.date });
			case 'errors_nothing_to_log_empty_interval':
				return m.errors_nothing_to_log_empty_interval();
			case 'errors_nothing_to_log_no_tracked_time':
				return m.errors_nothing_to_log_no_tracked_time();
			case 'errors_nothing_to_log_already_covered':
				return m.errors_nothing_to_log_already_covered();
			case 'errors_nothing_to_log_all_slivers':
				return m.errors_nothing_to_log_all_slivers();
			case 'errors_nothing_to_log':
				return m.errors_nothing_to_log();
			case 'errors_no_session_running':
				return m.errors_no_session_running();
			case 'errors_project_archived':
				return m.errors_project_archived({
					projectName: typeof d.projectName === 'string' ? d.projectName : ''
				});
			default: {
				// Every code above needed its `details` reshaped to match its catalogue
				// key's own params (a `conflicts` array flattened to `from`/`to`, a raw
				// ISO string reformatted, …). Everything else this page's actions can
				// fail with — `errors_future_timestamp` (no params), `errors_interval_too_short`
				// (`{minSeconds}`, already the field name `details` carries),
				// `errors_service_unavailable`/`errors_rate_limited*` (`{retryAfterSeconds}`,
				// likewise already named right), `errors_stale_preview`/`errors_not_found`
				// (no params) — already carries exactly the params its own message
				// expects, so this falls back to the same generic key→function lookup
				// `ChangePreview.svelte`'s `rejectionMessage` already uses for a `Dry_Run`
				// rejection, rather than growing this switch case by case and risking the
				// same silent "shows the wrong sentence" gap that left this default
				// returning `errors_validation_error()` for every one of them until now.
				const fn = (m as unknown as Record<string, (inputs?: Record<string, unknown>) => string>)[
					messageKey
				];
				if (typeof fn !== 'function') return m.errors_validation_error();
				try {
					return fn(d);
				} catch {
					return m.errors_validation_error();
				}
			}
		}
	}

	let lastHandledForm: typeof form = undefined;
	$effect(() => {
		if (form === undefined || form === null) return;
		if (form === lastHandledForm) return;
		lastHandledForm = form;
		if ('discarded' in form && form.discarded === true) {
			addSuccessToast(m.timer_stop_discarded());
		}
		if ('messageKey' in form && typeof form.messageKey === 'string') {
			addErrorToast(buildFailureMessage(form.messageKey, 'details' in form ? form.details : undefined));
		}
	});
</script>

<svelte:head>
	<title>{m.nav_brand()}</title>
</svelte:head>

<div class="timer-page timer-page--{density}">
	<h1 class="sr-only">{m.nav_timer()}</h1>

	{#if stale && openSession !== null}
		<div class="stale-notice">
			<div class="stale-notice__header">
				<Icon name="warning" size={15} />
				<span class="stale-notice__title"
					>{m.timer_stale_title({ start: formatTimeOfDay(openSession.startedAt, locale, timeZone) })}</span
				>
			</div>
			<p class="stale-notice__body">{m.timer_stale_body({ hours: maxOpenSessionHours })}</p>
			<form method="POST" action="?/stopAt" class="stale-notice__form" use:enhance={handleStopAtSubmit}>
				<TimeInput bind:value={staleStopValue} date={data.date} {timeZone} {density} disabled={staleSubmitting} />
				<button type="submit" class="stale-notice__stop-btn" disabled={staleSubmitting}>
					{m.timer_stale_stop()}
				</button>
			</form>
		</div>
	{/if}

	<div class="timer-page__hero">
		<div class="timer-page__hero-value text-hero tabular">{heroText}</div>
		<span class="lbl">{captionText}</span>
	</div>

	<DayGauge
		sessions={data.sessions}
		entries={data.entries}
		uncovered={data.coverage.uncovered}
		window={{ start: data.serverConfig.gaugeStart, end: data.serverConfig.gaugeEnd }}
		date={data.date}
		{timeZone}
		now={gaugeNow}
		{density}
	>
		{#snippet center()}
			<TimerControl {running} {density} onStart={handleOptimisticStart} onStop={handleOptimisticStop} />
		{/snippet}
	</DayGauge>

	<div class="timer-page__figures">
		<div class="timer-page__figure">
			<span class="lbl">{density === 'desktop' ? m.timer_worked() : m.timer_worked_short()}</span>
			<span class="text-timer-figure tabular">{figureText(data.totals.trackedSeconds)}</span>
		</div>
		<div class="timer-page__figure">
			<span class="lbl">{density === 'desktop' ? m.timer_covered() : m.timer_covered_short()}</span>
			<span class="text-timer-figure tabular">{figureText(data.totals.coveredSeconds)}</span>
		</div>
		<div class="timer-page__figure">
			<span class="lbl">{density === 'desktop' ? m.timer_uncovered() : m.timer_uncovered_short()}</span>
			<span class="text-timer-figure tabular timer-page__figure-value--accent"
				>{figureText(data.totals.uncoveredSeconds)}</span
			>
		</div>
	</div>

	<QuickLog
		quickLog={data.quickLog}
		uncoveredSeconds={data.totals.uncoveredSeconds}
		{density}
		date={data.date}
		{timeZone}
		hasAnyProject={data.projects.length > 0}
		onLogged={handleQuickLogged}
		onOpenDialog={openActivityDialogFromQuickLog}
	/>

	<ProjectLegend byProject={data.totals.byProject} />
</div>

<ActivityDialog
	mode="create"
	prefill={activityDialogPrefill}
	date={data.date}
	projects={projectsList}
	open={activityDialogOpen}
	onClose={closeActivityDialog}
	{timeZone}
	{density}
	recentEntry={data.recentEntry}
	onProjectCreated={handleProjectCreated}
	initialFocus={activityDialogInitialFocus}
/>

<style>
	/* A real level-one heading for the page (axe `page-has-heading-one`; found
	 * live, task 11's E2E pass — this page had none). The hero readout itself is
	 * a ticking figure, not a title, so this is a visually-hidden sibling naming
	 * the page instead of promoting the hero to <h1>. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.timer-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		box-sizing: border-box;
		width: 100%;
		min-height: 100%;
		padding: 24px 48px;
	}

	.timer-page--mobile {
		gap: 20px;
		padding: 14px 22px 20px;
	}

	.timer-page__hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.timer-page--mobile .timer-page__hero {
		gap: 7px;
	}

	.timer-page__hero-value {
		text-align: center;
	}

	.timer-page__figures {
		display: flex;
		align-items: flex-start;
		gap: 56px;
		margin-top: 2px;
	}

	.timer-page--mobile .timer-page__figures {
		width: 100%;
		gap: 0;
		justify-content: space-between;
		padding: 0 6px;
	}

	.timer-page__figure {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
	}

	.timer-page--mobile .timer-page__figure {
		gap: 5px;
	}

	.timer-page__figure-value--accent {
		color: var(--accent);
	}

	/* --------------------------------------------------------------------
	 * Stale_Session notice (Requirement 3.16) — a --panel box, accent
	 * border, 15px warning icon, 13px --text-dim explanation, a 44px
	 * TimeInput and one 42px accent pill, no dismiss action.
	 * ------------------------------------------------------------------ */
	.stale-notice {
		display: flex;
		flex-direction: column;
		gap: 9px;
		width: 100%;
		max-width: 420px;
		border-radius: var(--radius-14);
		background-color: var(--panel);
		border: 1px solid rgb(from var(--accent) r g b / 0.28);
		padding: 15px 16px;
		box-sizing: border-box;
	}

	.stale-notice__header {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent);
	}

	.stale-notice__title {
		font-size: 13px;
		font-weight: 500;
	}

	.stale-notice__body {
		margin: 0;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.5;
	}

	.stale-notice__form {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.stale-notice__form :global(input) {
		flex: 1;
	}

	.stale-notice__stop-btn {
		flex-shrink: 0;
		height: var(--h-dialog-button);
		padding: 0 18px;
		border: none;
		border-radius: var(--radius-full);
		background-color: var(--accent);
		color: var(--ink-on-accent);
		font: inherit;
		font-weight: 600;
		font-size: 13.5px;
		white-space: nowrap;
		cursor: pointer;
		transition: background-color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.stale-notice__stop-btn:not(:disabled):hover {
		background-color: var(--accent-hover);
	}

	.stale-notice__stop-btn:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.stale-notice__stop-btn:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--panel)),
			0 0 0 4px var(--accent);
	}
</style>
