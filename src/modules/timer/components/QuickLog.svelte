<script lang="ts">
	/**
	 * Task 5.8 (design.md § 6 "Activity Dialog", "Which project `Quick_Log` sends"
	 * paragraph; design.md's architecture table row `Quick_Log | form action posting
	 * in Open_Mode`; Main.dc.html/TimerLight.dc.html/TimerMobile.dc.html's 50px pill;
	 * Requirements 6.12, 6.13, 6.17, 6.18).
	 *
	 * The one-tap "log since the last thing I described, up to now" control on the
	 * timer page. Lives under `timer/components/` (a sibling of `DayGauge.svelte`),
	 * not `day/components/`, per design.md's page-layout order — even though what it
	 * triggers is functionally an `Activity_Entry` write.
	 *
	 * ---------------------------------------------------------------------------
	 * PROP SHAPE — inferred, no literal `type … Props` block exists for this
	 * component in design.md (same situation `DayGauge.svelte` documents for
	 * itself). Additions beyond the task brief's four are documented at their own
	 * field below.
	 *
	 * - `quickLog` — `DayResponse['quickLog']`, exactly as the server computed it;
	 *   never recomputed here (design.md: "the pill has to name what it will do
	 *   *before* it is pressed, and the answer is the anchor rule again").
	 *   `start`/`end` arrive as RFC 3339 strings (the wire shape crosses the
	 *   network as JSON — `Date` does not survive that), so they are revived with
	 *   `new Date(...)` before ever reaching `formatTimeOfDay`.
	 * - `date` — addition. The Logical_Day this control writes into
	 *   (`createActivitySchema`'s optional `date` field, which only defaults to
	 *   "the current Logical_Day" server-side — a day in the past needs it
	 *   explicit). The caller already has this from the day page it's rendering
	 *   on, exactly as `ActivityDialog`'s own `date` prop.
	 * - `timeZone` — addition, same reasoning as `ActivityDialog`'s and
	 *   `DayGauge`'s own `timeZone` prop: every wall-clock rendering happens in
	 *   the server's zone, never the device's (Requirement 1.12), and
	 *   `formatTimeOfDay` has no other way to get it.
	 * - `uncoveredSeconds` — the day's outstanding `Uncovered_Time` total, shown
	 *   beside the pill on desktop only (design.md line 520: "dropped on
	 *   mobile").
	 * - `hasAnyProject` — addition, optional. `quickLog: null` alone cannot
	 *   distinguish "nothing new since the last entry" (Requirement 6.13, pill
	 *   disabled with a reason) from "no `Project` exists in the whole system at
	 *   all" (Requirement 6.18, pill opens `Activity_Dialog` focused on the
	 *   `Project_Picker`) — the type carries no reason code, only `null`. The
	 *   caller already has the full projects list loaded (the day page/layout
	 *   does), so it can tell the two apart precisely; this prop lets it. Left
	 *   unset, the safer assumption is made — that a project exists and there is
	 *   genuinely nothing new to log — since that is the far more common shape of
	 *   "nothing to do here" for a user who has already logged at least once.
	 *   Only an explicit `false` opens the dialog on the picker.
	 * - `density` — the same `Density` (`'desktop' | 'mobile'`) type
	 *   `ActivityDialog`/`WorkBlock`/`SegmentBlock` already take.
	 * - `onLogged` — fired once the form action reports success, so the caller
	 *   can fold the new entry into the day it already has without a full
	 *   reload (Requirement 6.14's "no full reload" applied to this write too).
	 * - `onOpenDialog` — the caller owns the single `ActivityDialog` instance
	 *   (task 5.4); this component only signals *that* it should open and *what*
	 *   to prefill — `{ projectId }` when one is known, `{}` when the dialog
	 *   should focus the `Project_Picker` instead (the dialog resolves that
	 *   itself from `initialFocus: 'project'` when no `prefill.projectId` is
	 *   given — this component does not decide `initialFocus`).
	 *
	 * ---------------------------------------------------------------------------
	 * THE WRITE — form action, not `fetch`, per design.md's architecture table:
	 * "`Quick_Log` | form action posting in `Open_Mode` | the server resolves the
	 * interval; the browser sends only the project". Unlike the `Dry_Run`/
	 * timer-refresh/project-creation cases (which the same table lists as
	 * `fetch`), this is a real, non-preview write with nothing to preview —
	 * `Open_Mode` has no interval for a `Dry_Run` to render before the pill is
	 * pressed, the pill already states the one it expects, straight from
	 * `DayResponse.quickLog` (never computed here) — so there is no draft state
	 * for a `fetch`-driven preview to manage.
	 *
	 * A real `<form method="POST" action="?/quickLog" use:enhance>` with two
	 * hidden fields, `projectId` and `date` — nothing about the interval, exactly
	 * as `createActivitySchema`'s Open_Mode shape wants it (no `startedAt`/
	 * `endedAt`/`durationMinutes`; the handler infers the mode from which fields
	 * are absent, same as `ActivityDialog`'s own doc comment explains for its
	 * `buildCreateInput`).
	 *
	 * INTEGRATION POINT LEFT FOR A LATER TASK: no `+page.server.ts` exists yet for
	 * whichever route renders this component (task 5.5's `ActivityDialog` submit
	 * wiring is in the same position). `action="?/quickLog"` names a form action
	 * that does not exist yet — the next task to add it should:
	 *   1. Read `projectId` and `date` from the submitted `FormData`.
	 *   2. Validate them (`projectId` through `createActivitySchema`'s own
	 *      `projectId: z.uuid()`; `date` likewise).
	 *   3. Call the same activity-creation code path `POST /api/activities`
	 *      uses, with `dryRun: false` and no interval fields, exactly as this
	 *      form's hidden inputs already assemble the wire shape.
	 *   4. Return `{ entry }` on success (this component reads `result.data.entry`
	 *      off exactly that shape) — and a `fail(...)` with a `messageKey` on a
	 *      rejection (`NOTHING_TO_LOG`/`NO_PLACEMENT_ANCHOR`), for whatever
	 *      surfaces the page's `form` prop once task 9.2 exists to map it.
	 *
	 * ---------------------------------------------------------------------------
	 * THE THREE STATES (Requirements 6.12, 6.13, 6.17, 6.18):
	 *
	 * 1. `quickLog !== null` — the pill submits the form above in `Open_Mode`.
	 * 2. `quickLog === null` and `hasAnyProject !== false` — nothing new to log
	 *    right now (`NOTHING_TO_LOG`, already applied server-side; this
	 *    component never re-derives *why*). The pill renders disabled with
	 *    `errors_nothing_to_log` as its label and `title` — the one message the
	 *    catalogue carries that fits a reason-less `null` with no error payload
	 *    to read a `NOTHING_TO_LOG.reason`-flavoured key from (those flavoured
	 *    keys — `errors_nothing_to_log_empty_interval` etc. — belong to an actual
	 *    rejection response, which a disabled pill that never posted never
	 *    receives).
	 * 3. `quickLog === null` and `hasAnyProject === false` — opens
	 *    `Activity_Dialog` in `Open_Mode` focused on the `Project_Picker`
	 *    instead of posting anything (Requirement 6.18), since the dialog is
	 *    also where the first `Project` gets created (design.md).
	 *
	 * DEVIATION NOTE FROM DESIGN.MD FLAGGED, NOT SILENTLY RESOLVED: design.md's
	 * "Which project Quick_Log sends" paragraph glosses both null cases as "opens
	 * the dialog", but Requirement 6.13/6.18 and the task's own bullet list split
	 * them exactly as implemented above (disabled-with-reason vs. opens-dialog).
	 * The requirements text is more specific and is what this task cites, so it
	 * governs here.
	 *
	 * DEVIATION NOTE ON THE PROJECT NAME: design.md's prose also says "The pill
	 * always names the project it will send" — but neither `Main.dc.html`/
	 * `TimerLight.dc.html`/`TimerMobile.dc.html` (all three literally draw
	 * "Zapsat 01:30 → teď" with no project name in the pill) nor the
	 * `timer_quicklog` catalogue message (`Timer_QuicklogInputs` is `{ from }`
	 * only — no `to`, no project param) actually carry a project name. This
	 * component follows the pixel-and-string-literal artboards/catalogue exactly
	 * (no visible project name, no swatch — confirmed no `Palette_Slot` colour
	 * appears anywhere near the pill in any artboard) and additionally sets the
	 * project name as the pill's `title` attribute and folds it into its
	 * `aria-label`, so "never a blind one-tap log" is satisfied for anyone using
	 * a screen reader or hovering, without inventing new visible copy the design
	 * never drew. Flagged for the designer/spec owner rather than resolved by
	 * guessing which of the two disagreeing sources should change.
	 *
	 * No colour swatch: confirmed by grepping every `.design/artboards/*.dc.html`
	 * occurrence of the pill — none draws a `Palette_Slot` swatch (unlike the
	 * `ProjectLegend` row directly beneath it, which does). Requirement 11.11
	 * only requires a name to be shown *alongside* any colour shown, never that
	 * every surface must show one, so a text-only identity here is conforming.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActivityEntry } from '$lib/contracts/models';
	import type { DayResponse } from '$lib/contracts/responses';
	import type { Density } from '$modules/day/components/timeline-geometry';
	import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import Button from '$lib/ui/elements/Button.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		quickLog: DayResponse['quickLog'];
		uncoveredSeconds: number;
		density: Density;
		/** The Logical_Day this control writes into — see the doc comment above. */
		date: string;
		/** Addition — see the doc comment above. */
		timeZone: string;
		/** Addition — see the doc comment above. Undefined is treated as "unknown,
		 * assume a project exists" (state 2), not as state 3. */
		hasAnyProject?: boolean;
		onLogged?: (entry: ActivityEntry) => void;
		onOpenDialog: (prefill: { projectId?: string }) => void;
	}

	let { quickLog, uncoveredSeconds, density, date, timeZone, hasAnyProject, onLogged, onOpenDialog }: Props =
		$props();

	let submitting = $state(false);

	const noProjectAtAll = $derived(quickLog === null && hasAnyProject === false);

	const fromLabel = $derived(quickLog ? formatTimeOfDay(new Date(quickLog.start), '', timeZone) : '');
	const toLabel = $derived(quickLog ? formatTimeOfDay(new Date(quickLog.end), '', timeZone) : '');

	const quickLogAriaLabel = $derived(
		quickLog
			? `${m.timer_quicklog({ from: fromLabel })} (${fromLabel}–${toLabel}) — ${quickLog.projectName}`
			: undefined
	);

	const handleQuickLogSubmit: SubmitFunction = () => {
		submitting = true;
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data && 'entry' in result.data) {
				onLogged?.(result.data.entry as ActivityEntry);
			}
			await update();
			submitting = false;
		};
	};
</script>

<div class="quick-log quick-log--{density}">
	{#if quickLog !== null}
		<form
			method="POST"
			action="?/quickLog"
			class="quick-log__form"
			use:enhance={handleQuickLogSubmit}
		>
			<input type="hidden" name="projectId" value={quickLog.projectId} />
			<input type="hidden" name="date" value={date} />
			<button
				type="submit"
				class="quick-log__pill"
				disabled={submitting}
				title={quickLog.projectName}
				aria-label={quickLogAriaLabel}
			>
				<span class="quick-log__icon"><Icon name="pencil" size={17} /></span>
				<span class="quick-log__label">{m.timer_quicklog({ from: fromLabel })}</span>
				{#if density === 'desktop'}
					<span class="quick-log__remaining">
						{m.timer_quicklog_remaining({ duration: formatDuration(uncoveredSeconds, '') })}
					</span>
				{/if}
			</button>
		</form>
		<Button
			variant="ghost"
			size="sm"
			class="quick-log__open-link"
			onclick={() => onOpenDialog({ projectId: quickLog.projectId })}
		>
			{m.timer_quicklog_open_dialog()}
		</Button>
	{:else if noProjectAtAll}
		<button type="button" class="quick-log__pill quick-log__pill--empty" onclick={() => onOpenDialog({})}>
			<span class="quick-log__icon"><Icon name="pencil" size={17} /></span>
			<span class="quick-log__label">{m.timer_quicklog_no_project()}</span>
		</button>
	{:else}
		<button
			type="button"
			class="quick-log__pill quick-log__pill--disabled"
			disabled
			aria-disabled="true"
			title={m.errors_nothing_to_log()}
		>
			<span class="quick-log__icon"><Icon name="pencil" size={17} /></span>
			<span class="quick-log__label">{m.errors_nothing_to_log()}</span>
		</button>
		<Button variant="ghost" size="sm" class="quick-log__open-link" onclick={() => onOpenDialog({})}>
			{m.timer_quicklog_open_dialog()}
		</Button>
	{/if}
</div>

<style>
	.quick-log {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.quick-log--mobile {
		flex-direction: column;
		align-items: stretch;
		width: 100%;
	}

	.quick-log__form {
		display: contents;
	}

	.quick-log__pill {
		display: flex;
		align-items: center;
		gap: 14px;
		height: var(--h-quick-log-pill);
		padding: 0 22px 0 14px;
		border: none;
		border-radius: var(--radius-full);
		background-color: var(--field);
		color: inherit;
		font: inherit;
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}
	.quick-log--mobile .quick-log__pill {
		width: 100%;
		justify-content: center;
	}

	.quick-log__pill:not(:disabled):hover {
		background-color: var(--field-hover);
	}
	.quick-log__pill:not(:disabled):active {
		background-color: var(--field-active);
	}
	.quick-log__pill:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}
	.quick-log__pill:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.quick-log__icon {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-9);
		background-color: var(--chip);
		color: var(--text-dim);
	}

	.quick-log__label {
		font-size: 14px;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.quick-log__remaining {
		font-size: 13px;
		color: var(--text-faint);
		white-space: nowrap;
	}

	:global(.quick-log__open-link) {
		flex-shrink: 0;
	}
	.quick-log--mobile :global(.quick-log__open-link) {
		align-self: center;
	}
</style>
