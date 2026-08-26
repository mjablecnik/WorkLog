<script lang="ts">
	/**
	 * Renders one `Preview` (from `dry-run.ts`) — what a pending write would store, lose
	 * and leave unresolved — inside `ActivityDialog` / `SessionDialog` (tasks 5.4/5.6,
	 * not yet built). This component never fetches, never debounces and never knows
	 * which endpoint produced its data; the parent dialog owns the `Dry_Run` call and
	 * the 400 ms debounce (Requirement 9.15) and passes the settled — or in-flight —
	 * result down.
	 *
	 * Prop shape (design.md gives this component no literal `type … Props` block the
	 * way it does for `ActivityDialog`/`SessionDialog`, so this is inferred):
	 *
	 * - `preview` / `loading` — the two pieces of state a dialog has while a `Dry_Run`
	 *   is outstanding or settled. `preview` is `null` before the first result arrives
	 *   (nothing typed yet, or the fields don't yet compose a valid request).
	 * - `untrackedPolicy` / `onPolicyChange` — the `Untracked_Policy` choice this panel
	 *   renders inline (Requirement 9.10) is *controlled*: this component never calls
	 *   `previewCreateActivity`/`previewPatchActivity` itself, so the parent must own
	 *   the value and re-run the `Dry_Run` when it changes. Only `'clip' | 'extend'` —
	 *   the UI's exposed choice — not the schema's third `'reject'` value, which is a
	 *   server-side default this panel never offers.
	 * - `timeZone` — every wall-clock figure renders in the server's zone, never the
	 *   device's (Requirement 1.12), exactly like `TimeInput`.
	 * - `confirmDisabled` — a `$bindable` **output**, not an input: this component is
	 *   the only place that knows `loading`/`rejection` together, so it computes
	 *   whether confirming makes sense (Requirements 9.9, 9.12) and the parent binds to
	 *   it to disable *its own* confirm button, which lives in the dialog's footer
	 *   (design.md's Dialogs section draws the primary/`Zrušit` pair there, not inside
	 *   this panel). No `onConfirm` prop: this component renders no confirm control of
	 *   its own for the parent to wire one to, and a callback nothing here would ever
	 *   call is dead weight — documented here rather than added speculatively.
	 */
	import type { Interval } from '$lib/contracts/models';
	import type { ActivityPreview, Preview, Rejection, SessionPreview } from '../dry-run';
	import * as m from '$lib/paraglide/messages';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import LoadingSkeleton from '$lib/ui/overlays/LoadingSkeleton.svelte';
	import { formatDelta, formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import { LEISURE_SLOT_CLASS, projectSlotClass } from '$lib/viz/palette';

	interface Props {
		preview: Preview | null;
		loading: boolean;
		untrackedPolicy: 'clip' | 'extend';
		onPolicyChange: (policy: 'clip' | 'extend') => void;
		timeZone: string;
		confirmDisabled?: boolean;
	}

	let {
		preview,
		loading,
		untrackedPolicy,
		onPolicyChange,
		timeZone,
		// This default IS the value rendered/bound before the $effect below ever runs
		// (SSR and first paint).
		// eslint-disable-next-line no-useless-assignment
		confirmDisabled = $bindable(false)
	}: Props = $props();

	// Requirements 9.9 / 9.12: nothing may be confirmed while a Dry_Run is in flight,
	// before one has ever settled, or when the settled one was a rejection.
	$effect(() => {
		confirmDisabled = loading || preview === null || preview.rejection !== null;
	});

	/**
	 * The server's `MIN_INTERVAL_SECONDS` default (`.env.example`), used only to word
	 * `preview_sliver`. KNOWN GAP: neither `ActivityResponse` nor `ActivityPreview`
	 * carries the value the server actually ran with, so a deployment that overrides
	 * `MIN_INTERVAL_SECONDS` shows the wrong number here. The correct fix is a small
	 * addition to `001`'s response shape (a `minIntervalSeconds` field), out of this
	 * task's scope — flagged in the implementation report instead of guessed around.
	 */
	const FALLBACK_MIN_INTERVAL_SECONDS = 60;

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}
	function fmtTime(t: Date): string {
		return formatTimeOfDay(t, '', timeZone);
	}
	function intervalSeconds(iv: Interval): number {
		return (iv.end.getTime() - iv.start.getTime()) / 1000;
	}
	function segmentsSeconds(segments: { startedAt: Date; endedAt: Date }[]): number {
		return segments.reduce((sum, s) => sum + (s.endedAt.getTime() - s.startedAt.getTime()) / 1000, 0);
	}
	function span(intervals: Interval[]): { from: Date; to: Date } | null {
		if (intervals.length === 0) return null;
		let from = intervals[0].start;
		let to = intervals[0].end;
		for (const iv of intervals) {
			if (iv.start < from) from = iv.start;
			if (iv.end > to) to = iv.end;
		}
		return { from, to };
	}

	/**
	 * `ACTIVITY_OVERLAP`/`SESSION_OVERLAP`'s wire shape — `details.conflicts[0]`,
	 * nested and differently-named per code — doesn't match `errors_activity_overlap`'s
	 * `{project, from, to}` or `errors_session_overlap[_open]`'s `{from, to}`/`{from}`
	 * flat params at all, so calling the message function with `details` verbatim
	 * rendered every interpolation as literal "undefined" (found live, task 11's E2E
	 * pass). Mirrors the identical remapping `activity-form-actions.ts`/
	 * `session-form-actions.ts` already perform server-side for the submit-failure
	 * toast, and `SessionDialog.svelte`'s own `adaptRejection` already performs for
	 * its OWN dry-run preview — done here instead, once, so every caller of this
	 * component's `rejectionMessage()` benefits (`ActivityDialog`'s live preview had
	 * no such remapping at all). A `details` that has no `conflicts` array (already
	 * flattened upstream, e.g. by `SessionDialog`'s own `adaptRejection`) passes
	 * through unchanged below — this is additive, never a second, conflicting
	 * remapping. */
	function adaptOverlapDetails(
		messageKey: string,
		details: Record<string, unknown>
	): Record<string, unknown> {
		if (
			messageKey !== 'errors_activity_overlap' &&
			messageKey !== 'errors_session_overlap' &&
			messageKey !== 'errors_session_overlap_open'
		) {
			return details;
		}
		const conflicts = details.conflicts;
		if (!Array.isArray(conflicts) || conflicts.length === 0) return details;
		const first = conflicts[0] as {
			projectName?: string;
			interval?: { start: string; end: string };
		};
		if (!first.interval) return details;
		const from = fmtTime(new Date(first.interval.start));
		// `errors_session_overlap_open` (the "still running" variant) takes only
		// `{from}`; both other keys — `errors_activity_overlap` and the closed-form
		// `errors_session_overlap` — take `{from, to}` (plus `project` for the
		// activity case). Branching on the messageKey ITSELF, never on the
		// conflict's own `open` flag: the server's raw `messageKeyFor(code)` always
		// returns the generic `errors_session_overlap` (`errors.ts`) — picking the
		// "_open" variant is a caller-side judgment call some callers (this one
		// included, going forward) make before `rejectionMessage()` ever runs, so by
		// the time a key literally says "_open" it has already decided, and the
		// generic key should always get the full closed-form params it declares.
		if (messageKey === 'errors_session_overlap_open') return { from };
		const to = fmtTime(new Date(first.interval.end));
		if (messageKey === 'errors_activity_overlap') {
			return { project: first.projectName ?? '', from, to };
		}
		return { from, to };
	}

	/**
	 * Maps a `Rejection.messageKey` — a string named by the server's error envelope —
	 * to its compiled Paraglide function and calls it with `details` as the input
	 * object. No shared helper for this exists yet anywhere in the interface (nothing
	 * else maps a dynamic key to `m` at runtime); worth extracting once a second call
	 * site needs the same lookup (Requirement 15.9's error-code table is the likely
	 * next one). Falls back to the raw key so an unrecognised code still shows
	 * something rather than throwing.
	 */
	function rejectionMessage(rejection: Rejection): string {
		const fn = (m as unknown as Record<string, (inputs?: Record<string, unknown>) => string>)[
			rejection.messageKey
		];
		if (typeof fn !== 'function') return rejection.messageKey;
		try {
			return fn(adaptOverlapDetails(rejection.messageKey, rejection.details ?? {}));
		} catch {
			return rejection.messageKey;
		}
	}

	function isActivity(p: Preview): p is ActivityPreview {
		return p.kind === 'activity';
	}
	function isSession(p: Preview): p is SessionPreview {
		return p.kind === 'session';
	}

	/**
	 * The anchor is labelled as an inference, never as an input (design.md's Activity
	 * Dialog section) — rendered only when the server actually resolved one from a
	 * reconciliation rule (`'last-segment'` / `'first-session'`), not when the user
	 * gave an explicit start.
	 *
	 * `activity_anchor_note` (the `'last-segment'` wording) takes a `duration` beside
	 * `time` — "Only worked time counts towards {duration}; breaks are skipped." That
	 * figure isn't named anywhere in the `ActivityPreview` type, so this reads it as
	 * the resulting entry's own total worked time (the sum of `entry.segments`) —
	 * the same total the segment blocks above already display piece by piece, not a
	 * second computation of anything the server didn't already return. Documented as
	 * a judgment call in the implementation report.
	 */
	function anchorNote(preview: ActivityPreview): string | null {
		const anchor = preview.anchor;
		if (anchor === null || anchor.source === 'explicit') return null;
		if (anchor.source === 'first-session') {
			return m.activity_anchor_first_session({ time: fmtTime(anchor.at) });
		}
		return m.activity_anchor_note({
			time: fmtTime(anchor.at),
			duration: fmtDuration(segmentsSeconds(preview.entry.segments))
		});
	}

	/**
	 * `preview_unplaced_why` needs a `time` this component isn't handed directly.
	 * Derived only when it's actually derivable from data the server already returned
	 * (Requirement 9.1: never recomputed, never a second opinion) — the end of the
	 * last placed segment, which is where placement stopped — and only in
	 * `Duration_Mode` (`requestedDurationMinutes !== null`), which is the only mode
	 * `preview_unplaced` describes. When nothing was placed at all there is no "last
	 * segment" to point at, so the note is skipped rather than shown with a guess.
	 */
	function unplacedWhy(preview: ActivityPreview): string | null {
		if (preview.unplacedMinutes <= 0) return null;
		if (preview.entry.requestedDurationMinutes === null) return null;
		if (preview.entry.segments.length === 0) return null;
		const last = preview.entry.segments[preview.entry.segments.length - 1];
		return m.preview_unplaced_why({
			time: fmtTime(last.endedAt),
			stored: fmtDuration(segmentsSeconds(preview.entry.segments)),
			requested: fmtDuration(preview.entry.requestedDurationMinutes * 60)
		});
	}

	const sessionHasLoss = $derived(
		preview !== null &&
			isSession(preview) &&
			preview.rejection === null &&
			(preview.reclipped.length > 0 ||
				preview.removedSeconds > 0 ||
				preview.lostUncoveredSeconds > 0)
	);
</script>

<div class="change-preview" class:change-preview--loss={sessionHasLoss}>
	<div class="change-preview__heading">
		<Icon name="eye" size={16} class="change-preview__eye" />
		<span class="lbl change-preview__label">{m.preview_label()}</span>
	</div>

	<div class="change-preview__body" aria-live="polite" aria-busy={loading}>
		{#if preview === null}
			{#if loading}
				<div class="change-preview__skeleton" aria-hidden="true">
					<LoadingSkeleton radius={9} class="change-preview__skeleton-row" />
					<LoadingSkeleton radius={9} class="change-preview__skeleton-row" />
					<LoadingSkeleton radius={9} class="change-preview__skeleton-row change-preview__skeleton-row--short" />
				</div>
			{/if}
		{:else if preview.rejection !== null}
			<p class="change-preview__rejection">{rejectionMessage(preview.rejection)}</p>
		{:else if isActivity(preview)}
			{@const activity = preview}
			<div class="change-preview__segments">
				{#each activity.entry.segments as segment (segment.id)}
					<div class="change-preview__segment">
						<span
							class="change-preview__tick {activity.entry.colorIndex === null
								? LEISURE_SLOT_CLASS
								: projectSlotClass(activity.entry.colorIndex)}"
							aria-hidden="true"
						></span>
						<span class="change-preview__segment-range"
							>{fmtTime(segment.startedAt)}–{fmtTime(segment.endedAt)}</span
						>
					</div>
				{/each}
				{#if activity.entry.segments.length > 1}
					<p class="change-preview__note">
						{m.preview_parts({ count: activity.entry.segments.length })}
					</p>
				{/if}
			</div>

			{#if activity.slivers.length > 0 || activity.discarded.length > 0 || activity.unplacedMinutes > 0}
				<div class="change-preview__warning">
					<Icon name="warning" size={14} class="change-preview__warning-icon" />
					<div class="change-preview__warning-body">
						{#each activity.slivers as sliver, i (i)}
							<p class="change-preview__note">
								{m.preview_sliver({
									duration: fmtDuration(intervalSeconds(sliver)),
									minimum: fmtDuration(FALLBACK_MIN_INTERVAL_SECONDS)
								})}
							</p>
						{/each}
						{#each activity.discarded as discarded, i (i)}
							<p class="change-preview__note">
								{fmtTime(discarded.start)}–{fmtTime(discarded.end)} · {fmtDuration(
									intervalSeconds(discarded)
								)}
							</p>
						{/each}
						{#if activity.unplacedMinutes > 0}
							<p class="change-preview__note">
								{m.preview_unplaced({ duration: fmtDuration(activity.unplacedMinutes * 60) })}
							</p>
							{#if unplacedWhy(activity) !== null}
								<p class="change-preview__note">{unplacedWhy(activity)}</p>
							{/if}
						{/if}
					</div>
				</div>
			{/if}

			{#if anchorNote(activity) !== null}
				<div class="change-preview__anchor">
					<Icon name="info" size={14} class="change-preview__anchor-icon" />
					<p class="change-preview__note">{anchorNote(activity)}</p>
				</div>
			{/if}

			{#if activity.discarded.length > 0}
				<div class="change-preview__policy">
					<p class="lbl change-preview__policy-label">{m.preview_policy_label()}</p>
					<div
						class="change-preview__policy-group"
						role="radiogroup"
						aria-label={m.preview_policy_label()}
					>
						<button
							type="button"
							role="radio"
							aria-checked={untrackedPolicy === 'clip'}
							class="change-preview__policy-item"
							class:change-preview__policy-item--active={untrackedPolicy === 'clip'}
							onclick={() => onPolicyChange('clip')}
						>
							{m.preview_policy_clip()}
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={untrackedPolicy === 'extend'}
							class="change-preview__policy-item"
							class:change-preview__policy-item--active={untrackedPolicy === 'extend'}
							onclick={() => onPolicyChange('extend')}
						>
							{m.preview_policy_extend()}
						</button>
					</div>
				</div>
			{/if}
		{:else if isSession(preview)}
			{@const session = preview}
			{#if !sessionHasLoss}
				<p class="change-preview__note">{m.preview_no_change()}</p>
			{:else}
				<div class="change-preview__loss">
					<p class="change-preview__loss-title">
						<Icon name="warning" size={14} class="change-preview__loss-icon" />
						{m.preview_loss_title()}
					</p>
					<p class="change-preview__headline">
						{m.preview_total({
							count: session.reclipped.length,
							duration: fmtDuration(session.removedSeconds + session.lostUncoveredSeconds)
						})}
					</p>
					<p class="change-preview__note">
						{m.preview_total_split({
							entriesDuration: fmtDuration(session.removedSeconds),
							uncoveredDuration: fmtDuration(session.lostUncoveredSeconds)
						})}
					</p>

					{#each session.reclipped as entry (entry.entryId)}
						<div class="change-preview__entry">
							<div class="change-preview__entry-head">
								<span
									class="change-preview__tick {projectSlotClass(entry.colorIndex)}"
									aria-hidden="true"
								></span>
								<span class="change-preview__entry-name">{entry.projectName}</span>
								<span class="change-preview__entry-loss"
									>{m.preview_entry_loss({ duration: formatDelta(-(entry.removedMs / 1000), '') })}</span
								>
							</div>
							{#if entry.orphaned}
								{@const emptied = span(entry.before)}
								{#if emptied !== null}
									<p class="change-preview__note change-preview__emptied">
										{m.preview_emptied({ from: fmtTime(emptied.from), to: fmtTime(emptied.to) })}
									</p>
								{/if}
							{:else}
								<div class="change-preview__ba-grid">
									<div class="change-preview__ba-col">
										<span class="lbl">{m.preview_now()}</span>
										{#each entry.before as iv, i (i)}
											<span class="change-preview__ba-time">{fmtTime(iv.start)}–{fmtTime(iv.end)}</span>
										{/each}
									</div>
									<span class="change-preview__ba-arrow" aria-hidden="true">→</span>
									<div class="change-preview__ba-col">
										<span class="lbl">{m.preview_after()}</span>
										{#each entry.after as iv, i (i)}
											<span class="change-preview__ba-time">{fmtTime(iv.start)}–{fmtTime(iv.end)}</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}

					{#if session.lostUncoveredSeconds > 0}
						<div class="change-preview__entry change-preview__entry--uncovered">
							<div class="change-preview__entry-head">
								<span class="change-preview__tick change-preview__tick--uncovered" aria-hidden="true"
								></span>
								<p class="change-preview__note change-preview__uncovered-text">
									{m.preview_uncovered_row()} · {fmtDuration(session.lostUncoveredSeconds)}
								</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	<p class="change-preview__footer">{m.common_server_computed()}</p>
</div>

<style>
	.change-preview {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: var(--panel);
		border-radius: var(--radius-14);
	}
	.change-preview--loss {
		background: rgba(209, 138, 106, 0.07);
		border: 1px solid rgba(209, 138, 106, 0.28);
	}

	.change-preview__heading {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent);
	}
	.change-preview__label {
		color: var(--accent);
	}

	.change-preview__body {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.change-preview__skeleton {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.change-preview__skeleton :global(.change-preview__skeleton-row) {
		height: 18px;
	}
	.change-preview__skeleton :global(.change-preview__skeleton-row--short) {
		width: 60%;
	}

	.change-preview__rejection {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text-dim);
	}

	.change-preview__note {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text-dim);
	}

	.change-preview__segments {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.change-preview__segment {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 11px;
		border-radius: var(--radius-9);
		background: var(--row);
	}
	.change-preview__segment-range {
		font-size: 12px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.change-preview__tick {
		width: 3px;
		height: 18px;
		border-radius: var(--radius-3);
		background: var(--pj);
		flex-shrink: 0;
	}
	.change-preview__tick--uncovered {
		background: rgba(209, 138, 106, 0.6);
	}

	.change-preview__warning {
		display: flex;
		gap: 8px;
		padding: 11px;
		border-radius: var(--radius-11);
		border: 1px dashed var(--accent);
	}
	.change-preview__warning-icon {
		flex-shrink: 0;
		color: var(--accent);
		margin-top: 1px;
	}
	.change-preview__warning-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.change-preview__anchor {
		display: flex;
		gap: 8px;
		padding: 11px;
		border-radius: var(--radius-11);
		background: var(--row);
	}
	.change-preview__anchor-icon {
		flex-shrink: 0;
		color: var(--text-faint);
		margin-top: 1px;
	}

	.change-preview__policy {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.change-preview__policy-label {
		margin: 0;
	}
	.change-preview__policy-group {
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: var(--radius-12);
		background: var(--group);
	}
	.change-preview__policy-item {
		flex: 1 1 0;
		height: 36px;
		border: none;
		border-radius: var(--radius-9);
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		line-height: 1.4;
		cursor: pointer;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			color var(--dur-hover) var(--ease-standard);
	}
	.change-preview__policy-item--active {
		background: var(--segment-active);
		color: var(--accent-on-tint);
		font-weight: 500;
	}

	.change-preview__loss {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.change-preview__loss-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--accent);
	}
	.change-preview__loss-icon {
		flex-shrink: 0;
	}
	.change-preview__headline {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		line-height: 1.3;
		color: var(--accent);
	}

	.change-preview__entry {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px;
		border-radius: var(--radius-11);
		background: var(--panel);
	}
	.change-preview__entry-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.change-preview__entry-name {
		flex: 1 1 auto;
		font-size: 13.5px;
		font-weight: 500;
		line-height: 1.4;
		color: var(--text);
	}
	.change-preview__entry-loss {
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.change-preview__emptied {
		padding-left: 11px;
	}

	.change-preview__ba-grid {
		display: grid;
		grid-template-columns: 1fr 20px 1fr;
		align-items: center;
		gap: 4px;
		padding-left: 11px;
	}
	.change-preview__ba-col {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.change-preview__ba-time {
		font-size: 12px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}
	.change-preview__ba-arrow {
		text-align: center;
		color: var(--text-faint);
	}

	.change-preview__entry--uncovered .change-preview__uncovered-text {
		flex: 1 1 auto;
	}

	.change-preview__footer {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.35;
		color: var(--text-faint);
	}
</style>
