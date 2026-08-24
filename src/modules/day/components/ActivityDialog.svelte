<script lang="ts">
	/**
	 * Task 5.4 (design.md § 6 "Activity Dialog"; Dialogs section's "Add task" paragraph
	 * and shared desktop/mobile chrome table; Requirements 6.2-6.11, 6.15, 6.16, 6.19,
	 * 7.3, 14.15, 14.20-14.24).
	 *
	 * Wraps `Modal` (`dismissOnScrimClick={false}` — Requirement 14.23, a write dialog
	 * never loses input to a stray scrim click; `fullScreenOnMobile={true}` —
	 * Requirement 14.15) with the three-mode entry form and a live `Change_Preview`.
	 *
	 * ---------------------------------------------------------------------------
	 * PROP SHAPE — design.md's literal `ActivityDialogProps` plus additions, each
	 * documented at its own field below:
	 *
	 * - `timeZone` — every `TimeInput` and every `ChangePreview` figure renders in the
	 *   server's zone, never the device's (Requirement 1.12); the dialog has no other
	 *   way to get it.
	 * - `density` — `'desktop' | 'mobile'`, the SAME prop `WorkBlock`/`SegmentBlock`
	 *   already take (`./timeline-geometry.ts`'s `Density`, itself resolved from the
	 *   `worklog_viewport` cookie in `+layout.server.ts` and corrected live by a
	 *   `matchMedia` listener in the root layout). Reused here rather than adding a
	 *   second, CSS-only breakpoint mechanism: `TimeInput` already exposes a
	 *   `density` prop switching its own 44→48px sizing, and this dialog's field grid
	 *   needs the exact same signal to collapse to one column. `Modal`'s own chrome
	 *   (header height, footer stacking) still switches on its own `max-width: 767px`
	 *   media query — a minor, pre-existing tension the sibling day components already
	 *   accept, not something this task introduces or can fix without touching Modal.
	 * - `recentEntry` — Requirement 6.9 defaults the `Project` and description to "the
	 *   most recent `Activity_Entry` of the displayed day", which is data the CALLER
	 *   already holds (the day page loads the full day) and this component has no way
	 *   to fetch itself (no endpoint for "the latest entry" exists, and computing it
	 *   from a partial list here would be exactly the kind of second implementation
	 *   the project avoids elsewhere). Added as an explicit prop rather than left
	 *   unresolved, so Requirement 6.9 is actually satisfied by this task: the day
	 *   page (task 3.7 / the `+page.svelte` that opens this dialog) supplies it from
	 *   the entry list it already has.
	 * - `onProjectCreated` — `ProjectPicker`'s own `onCreate` fires once after an
	 *   inline creation; someone has to merge the new `Project` into the caller's
	 *   `projects` array (this component only reads `projects`, it doesn't own the
	 *   list), so this forwards the callback outward.
	 * - `onSaved` — task 5.5's seam: once a real form action exists, a successful save
	 *   should let the day page update `Day_Timeline` without a full reload
	 *   (Requirement 6.14 / 7.8). Declared now so the prop contract is stable; nothing
	 *   in this task calls it yet (see "NO SUBMISSION WIRING" below).
	 * - `initialFocus` — `'project' | 'description'`, for a caller that already knows
	 *   which control should receive focus (design.md § 6: "Quick_Log's 'no project'
	 *   fallback" opens this dialog in `Open_Mode` with focus on the `Project_Picker`).
	 *   Resolved to a real element and handed to `Modal`'s own `initialFocusEl` — this
	 *   component never moves focus itself, `Modal` still owns that (Requirement
	 *   14.21).
	 *
	 * ---------------------------------------------------------------------------
	 * VALIDATION — "through superforms" (tasks.md), but NOT against
	 * `createActivitySchema`/`patchActivitySchema` directly. Those two schemas are the
	 * WIRE contract (`startedAt`/`endedAt` as full RFC 3339 instants, no `mode` field
	 * at all, no `from`/`to`/day split) and per-mode requiredness is deliberately NOT
	 * encoded in them — Requirement 6.3/6.4/6.6's "which fields are required in which
	 * mode" is UI-only business logic, decided by the segmented control, and the
	 * wire schemas stay mode-agnostic on purpose (the server infers the mode from
	 * which fields arrive). Binding `zodClient(createActivitySchema)` straight to
	 * this form would therefore validate the wrong shape entirely (it has no `from`/
	 * `to`/`mode` fields to check, and would demand a full ISO `startedAt` where this
	 * UI collects an `HH:MM` and a separate day).
	 *
	 * Instead: `activityFormSchema` below is a small LOCAL schema shaped exactly like
	 * this form's own fields (`mode`, `date`, `from`, `to`, `durationMinutes`,
	 * `projectId`, `description`), with a `superRefine` encoding the per-mode
	 * requiredness. It drives a real `superForm()` instance in client-only mode
	 * (`SPA: true`, `validators: zodClient(activityFormSchema)`) — real `$form`/
	 * `$errors` stores, real inline messages beside each field (Requirement 6.10),
	 * nothing cleared on a failed validation. `buildCreateInput`/`buildPatchInput`
	 * below are the one place this UI shape is translated into the wire shape
	 * (`CreateActivityInput`/`PatchActivityInput`) — used today for the `Dry_Run`
	 * calls, and exactly the translation task 5.5's real form action will need too.
	 *
	 * ---------------------------------------------------------------------------
	 * SUBMISSION WIRING (task 5.5). `formEl` (above) is the UI-shaped form — its
	 * named inputs (`mode`, `from`, `to`, `durationMinutes`) exist for `sf`'s local
	 * validation only and it is NEVER actually POSTed (`handleSubmit` always
	 * `preventDefault()`s); `createActivitySchema`/`patchActivitySchema` are `.strict()`
	 * against a completely different, wire-shaped set of field names
	 * (`startedAt`/`endedAt`/`date`/`durationMinutes`, no `mode` at all), so this UI
	 * form's own fields could never be posted to those actions directly.
	 *
	 * Instead, two SEPARATE hidden `<form>`s exist purely as `use:enhance` submission
	 * vehicles, each holding hidden inputs bound to values already computed for the
	 * live `Dry_Run` (`wireStartedAt`/`wireEndedAt` below, `$form.date`,
	 * `$form.durationMinutes`, `untrackedPolicy`, and `preview.previewToken` —
	 * Requirement 9.14's "carry previewToken into the confirming write"): one posts to
	 * `?/createActivity` or `?/patchActivity` (`submitFormEl`), the other to
	 * `?/deleteActivity` (`deleteFormEl`, behind `ConfirmDialog`, mirroring
	 * `ProjectRow.svelte`'s own hidden-delete-form pattern). `handleSubmit` runs the
	 * local validation as before, then — once it passes — calls
	 * `submitFormEl?.requestSubmit()`, letting `use:enhance`'s real network round trip
	 * take over from there.
	 *
	 * This is the "hidden mirror input, native `use:enhance` submission" option rather
	 * than a hand-rolled `fetch`+`deserialize`: it lets SvelteKit's own tested
	 * machinery build the request and parse the `ActionResult` (no manual
	 * `x-sveltekit-action`/`Accept` header wrangling), and it matches this codebase's
	 * own established convention for a small, purpose-built submission form
	 * (`ProjectRow.svelte`'s `archiveFormEl`/`deleteFormEl`) rather than introducing a
	 * second transport mechanism. The one thing it does NOT get for free is
	 * field-error sync: `use:enhance`'s default callback would write a failure's
	 * `form` data into `$page.form`, but `sf` here is a client-only (`SPA: true`)
	 * instance never bound to page data (task 5.4's own "VALIDATION" doc comment
	 * above), so nothing reads `$page.form` automatically. `handleActivitySubmitEnhance`
	 * below bridges this by hand: the action returns a plain `fieldErrors` /
	 * `toastMessage` payload (`+page.server.ts`'s own doc comment explains why it
	 * avoids `setError` for the same reason), and the callback writes those straight
	 * into `errors` — the SAME store `fieldMessage()` already reads for the live local
	 * validation, so a server-rejected field renders through the identical code path
	 * (Requirement 6.10).
	 */
	import { z } from 'zod';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { ActivityEntry, Interval, Project } from '$lib/contracts/models';
	import type { CreateActivityInput, PatchActivityInput } from '$lib/contracts/schemas';
	import { previewCreateActivity, previewPatchActivity, type Preview } from '../dry-run';
	import type { Density } from './timeline-geometry';
	import ChangePreview from './ChangePreview.svelte';
	import ProjectPicker from '$modules/projects/components/ProjectPicker.svelte';
	import Modal from '$lib/ui/overlays/Modal.svelte';
	import ConfirmDialog from '$lib/ui/overlays/ConfirmDialog.svelte';
	import { addSuccessToast, addErrorToast } from '$lib/ui/overlays/toast-store.svelte';
	import Button from '$lib/ui/elements/Button.svelte';
	import FormField from '$lib/ui/forms/FormField.svelte';
	import DatePicker from '$lib/ui/forms/DatePicker.svelte';
	import TimeInput from '$lib/ui/forms/TimeInput.svelte';
	import { formatDuration, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import * as m from '$lib/paraglide/messages';

	type EntryMode = 'explicit' | 'duration' | 'open';

	interface Props {
		mode: 'create' | 'edit';
		/** Edit only. */
		entry?: ActivityEntry;
		prefill?: { range?: Interval; projectId?: string; description?: string };
		/** The Logical_Day being edited. */
		date: string;
		projects: Project[];
		open: boolean;
		onClose: () => void;
		/** Addition — see the doc comment above. */
		timeZone: string;
		/** Addition — see the doc comment above. */
		density: Density;
		/** Addition — Requirement 6.9's default source; see the doc comment above. */
		recentEntry?: { projectId: string; description: string } | null;
		/** Addition — forwards `ProjectPicker`'s inline-creation result. */
		onProjectCreated?: (project: Project) => void;
		/** Task 3.7's seam, wired by task 5.5: fires with the saved `ActivityEntry`
		 * once a create/patch submission succeeds. The day page does not currently
		 * need it — `invalidateAll()` (called from the same success path, just below)
		 * already reruns `load` and refreshes `Day_Timeline` without a full reload
		 * (Requirement 6.14/7.8) — but it stays available for a caller that wants the
		 * saved entry synchronously, before that reload lands. */
		onSaved?: (entry: ActivityEntry) => void;
		/** Addition — `ACTIVITY_OVERLAP`'s design.md row ("names each conflicting
		 * entry and offers to open it"): fired with the id of the entry a rejected
		 * submission conflicted with, so the caller (which holds the day's entry list,
		 * unlike this dialog) can open it for editing. */
		onConflict?: (entryId: string) => void;
		/** Addition — which control should receive focus on open, when the opener
		 * knows (e.g. Quick_Log's no-project fallback). */
		initialFocus?: 'project' | 'description';
	}

	let {
		mode,
		entry,
		prefill,
		date,
		projects,
		open,
		onClose,
		timeZone,
		density,
		recentEntry = null,
		onProjectCreated,
		onSaved,
		onConflict,
		initialFocus
	}: Props = $props();

	const TIME_RE = /^([0-9]{1,2}):([0-9]{2})$/;
	const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

	type ActivityFormValues = {
		mode: EntryMode;
		date: string;
		from: string;
		to: string;
		durationMinutes: number | null;
		projectId: string;
		description: string;
	};

	// See the "VALIDATION" doc comment above: this is a UI-shaped schema, not the
	// wire contract. Messages passed into `addIssue` are placeholders — never read;
	// `fieldMessage()` below computes the displayed text from `m.*()` at render time
	// so it tracks the current locale instead of freezing it at schema-creation time.
	const activityFormSchema = z
		.object({
			mode: z.enum(['explicit', 'duration', 'open']),
			date: z.string().regex(DATE_RE),
			from: z.string(),
			to: z.string(),
			durationMinutes: z.number().int().positive().nullable(),
			projectId: z.string().min(1),
			description: z.string().max(2000)
		})
		.superRefine((v, ctx) => {
			if (v.mode === 'explicit') {
				if (!TIME_RE.test(v.from)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'required' });
				if (!TIME_RE.test(v.to)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'required' });
			}
			if (v.mode === 'duration' && (v.durationMinutes === null || v.durationMinutes <= 0)) {
				ctx.addIssue({ code: 'custom', path: ['durationMinutes'], message: 'required' });
			}
		});

	function timeOf(d: Date): string {
		return formatTimeOfDay(d, '', timeZone);
	}

	function initialValues(): ActivityFormValues {
		if (mode === 'edit' && entry) {
			return {
				mode: entry.mode,
				date,
				from: timeOf(entry.requestedStartedAt),
				to: timeOf(entry.requestedEndedAt),
				durationMinutes: entry.requestedDurationMinutes,
				projectId: entry.projectId,
				description: entry.description
			};
		}
		const range = prefill?.range;
		return {
			mode: 'explicit',
			date,
			from: range ? timeOf(range.start) : '',
			to: range ? timeOf(range.end) : '',
			durationMinutes: null,
			projectId: prefill?.projectId ?? recentEntry?.projectId ?? '',
			description: prefill?.description ?? recentEntry?.description ?? ''
		};
	}

	const sf = superForm(initialValues(), {
		SPA: true,
		dataType: 'form',
		validators: zod4Client(activityFormSchema),
		validationMethod: 'oninput',
		taintedMessage: null,
		resetForm: false
	});
	const { form, errors, allErrors } = sf;

	/** Local-only placeholder issue message (`activityFormSchema.superRefine` above) —
	 * never displayed itself, a signal that `fieldMessage()` should compute the real
	 * text from `fallback()`. A server-rejected field (`handleActivitySubmitEnhance`
	 * below, via `applyServerFieldErrors`) writes its own ALREADY-TRANSLATED message
	 * into the same store instead of this token, so `fieldMessage` renders that text
	 * verbatim rather than recomputing a generic fallback over it — both a live local
	 * validation error and a server rejection reach the screen through this one
	 * function (Requirement 6.10). */
	const LOCAL_PLACEHOLDER = 'required';
	function fieldMessage(fieldErrors: string[] | undefined, fallback: () => string): string | undefined {
		if (!fieldErrors || fieldErrors.length === 0) return undefined;
		const first = fieldErrors[0];
		return first === LOCAL_PLACEHOLDER ? fallback() : first;
	}
	const fromMessage = $derived(fieldMessage($errors.from, m.fields_invalid_timestamp));
	const toMessage = $derived(fieldMessage($errors.to, m.fields_invalid_timestamp));
	const durationMessage = $derived(fieldMessage($errors.durationMinutes, m.fields_required));
	const projectMessage = $derived(fieldMessage($errors.projectId, m.fields_required));

	const MODE_OPTIONS: { value: EntryMode; fullLabel: () => string; shortLabel?: () => string }[] = [
		{ value: 'explicit', fullLabel: m.activity_mode_explicit, shortLabel: m.activity_mode_explicit_short },
		{ value: 'duration', fullLabel: m.activity_mode_duration },
		{ value: 'open', fullLabel: m.activity_mode_open }
	];

	function handleSegKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		const current = event.currentTarget as HTMLElement;
		const group = current.closest('[role="radiogroup"]');
		if (!group) return;
		const items = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
		const index = items.indexOf(current);
		if (index === -1) return;
		event.preventDefault();
		const delta = event.key === 'ArrowRight' ? 1 : -1;
		const next = items[(index + delta + items.length) % items.length];
		next.focus();
		next.click();
	}

	/**
	 * Requirement 7.3 / design.md "Where the requested values show": a statement
	 * above the field row, computed once from the entry being edited — never from
	 * live form input. Returns `null` when there is nothing to say (no difference,
	 * or the entry is orphaned and has no stored segments to compare against at all —
	 * that case belongs to the `Orphan_Panel`, not here).
	 */
	function requestedNote(e: ActivityEntry): string | null {
		const requested =
			e.mode === 'duration' && e.requestedDurationMinutes !== null
				? formatDuration(e.requestedDurationMinutes * 60, '')
				: `${timeOf(e.requestedStartedAt)} – ${timeOf(e.requestedEndedAt)}`;

		if (e.segments.length === 0) return null;

		let stored: string;
		let differs: boolean;
		if (e.segments.length === 1) {
			const seg = e.segments[0];
			stored = `${timeOf(seg.startedAt)} – ${timeOf(seg.endedAt)}`;
			differs =
				seg.startedAt.getTime() !== e.requestedStartedAt.getTime() ||
				seg.endedAt.getTime() !== e.requestedEndedAt.getTime();
		} else {
			stored = m.activity_requested_stored_parts({ count: e.segments.length });
			differs = true;
		}
		return differs ? m.activity_requested_note({ requested, stored }) : null;
	}

	const requestedNoteText = $derived(mode === 'edit' && entry ? requestedNote(entry) : null);

	// ---------------------------------------------------------------------------
	// Dry_Run preview: 400ms debounce (Requirement 9.15), one AbortController per
	// attempt, aborting whatever was in flight before scheduling the next one.
	let preview = $state<Preview | null>(null);
	let previewLoading = $state(false);
	let untrackedPolicy = $state<'clip' | 'extend'>('clip');
	let confirmDisabled = $state(false);

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let abortController: AbortController | null = null;

	const canPreview = $derived.by(() => {
		if ($form.projectId === '') return false;
		if (!DATE_RE.test($form.date)) return false;
		if ($form.mode === 'explicit') return TIME_RE.test($form.from) && TIME_RE.test($form.to);
		if ($form.mode === 'duration') return $form.durationMinutes !== null && $form.durationMinutes > 0;
		return true;
	});

	function buildCreateInput(): CreateActivityInput {
		const base = { projectId: $form.projectId, description: $form.description, untrackedPolicy, dryRun: false };
		if ($form.mode === 'explicit') {
			return {
				...base,
				startedAt: parseTimeOfDay($form.from, $form.date, timeZone),
				endedAt: parseTimeOfDay($form.to, $form.date, timeZone)
			};
		}
		if ($form.mode === 'duration') {
			return { ...base, date: $form.date, durationMinutes: $form.durationMinutes ?? undefined };
		}
		return { ...base, date: $form.date };
	}

	function buildPatchInput(): PatchActivityInput {
		const base = { projectId: $form.projectId, description: $form.description, untrackedPolicy, dryRun: false };
		if ($form.mode === 'explicit') {
			return {
				...base,
				startedAt: parseTimeOfDay($form.from, $form.date, timeZone),
				endedAt: parseTimeOfDay($form.to, $form.date, timeZone)
			};
		}
		if ($form.mode === 'duration') {
			return { ...base, date: $form.date, durationMinutes: $form.durationMinutes ?? undefined };
		}
		return { ...base, date: $form.date };
	}

	/** `NOTHING_TO_LOG`'s design.md row ("Quick_Log and Open_Mode in the dialog |
	 * explains there is nothing new since the last entry") needs `details.reason`
	 * picked, per the same "read the field and pick, never compose" rule
	 * `SessionDialog.svelte`'s own `adaptRejection` already follows for
	 * `SESSION_OVERLAP` — this is the `Open_Mode` half of that rule; the `Quick_Log`
	 * half is `+page.server.ts`'s `quickLog` action, already flavoring its own
	 * `messageKey` server-side before it ever reaches this dialog. Duplicated from
	 * `activity-form-actions.ts`'s `nothingToLogMessage`/`NOTHING_TO_LOG_FLAVORS`
	 * rather than imported — that file is server-only (`lib/server/**`), which a
	 * `.svelte` module cannot import at all (design.md's own build-boundary rule). */
	const NOTHING_TO_LOG_FLAVORS = new Set([
		'errors_nothing_to_log_empty_interval',
		'errors_nothing_to_log_no_tracked_time',
		'errors_nothing_to_log_already_covered',
		'errors_nothing_to_log_all_slivers'
	]);
	function adaptRejection(result: Preview): Preview {
		if (result.rejection === null || result.rejection.code !== 'NOTHING_TO_LOG') return result;
		const reason = (result.rejection.details as { reason?: string } | undefined)?.reason ?? '';
		const flavored = `errors_nothing_to_log_${reason.replace(/-/g, '_')}`;
		if (!NOTHING_TO_LOG_FLAVORS.has(flavored)) return result;
		return { ...result, rejection: { ...result.rejection, messageKey: flavored } };
	}

	async function runPreview(): Promise<void> {
		const controller = new AbortController();
		abortController = controller;
		try {
			const result =
				mode === 'create'
					? await previewCreateActivity(buildCreateInput(), controller.signal)
					: await previewPatchActivity(entry!.id, buildPatchInput(), controller.signal);
			if (controller.signal.aborted) return;
			preview = adaptRejection(result);
		} catch {
			// Abort or genuine network failure — no second opinion rendered; the next
			// edit (or a manual retry once one exists) schedules a fresh attempt.
			if (!controller.signal.aborted) preview = null;
		} finally {
			if (!controller.signal.aborted) previewLoading = false;
		}
	}

	$effect(() => {
		// Read every field the preview depends on so the effect re-runs on each.
		void $form.mode;
		void $form.date;
		void $form.from;
		void $form.to;
		void $form.durationMinutes;
		void $form.projectId;
		void $form.description;
		void untrackedPolicy;
		const isOpen = open;
		const requestable = canPreview;

		if (debounceTimer) clearTimeout(debounceTimer);
		abortController?.abort();
		abortController = null;

		if (!isOpen || !requestable) {
			preview = null;
			previewLoading = false;
			return;
		}

		previewLoading = true;
		debounceTimer = setTimeout(() => {
			void runPreview();
		}, 400);

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	// ---------------------------------------------------------------------------
	// Reset on open — only on the false → true transition, so a parent re-render
	// while the dialog is open (e.g. `projects` growing after an inline creation)
	// never clobbers what the user has typed.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			form.set(initialValues(), { taint: false });
			errors.clear();
			untrackedPolicy = 'clip';
			preview = null;
			previewLoading = false;
		}
		wasOpen = open;
	});

	// ---------------------------------------------------------------------------
	// Focus target resolution — Modal moves focus itself (Requirement 14.21); this
	// only resolves WHICH element, from refs bound inside the body content Modal
	// renders as its `children` snippet.
	let projectPickerWrapperEl: HTMLElement | undefined = $state();
	let descriptionEl: HTMLTextAreaElement | undefined = $state();
	let formEl: HTMLFormElement | undefined = $state();

	const resolvedInitialFocusEl = $derived.by((): HTMLElement | null => {
		if (initialFocus === 'project') {
			return projectPickerWrapperEl?.querySelector<HTMLElement>('input') ?? null;
		}
		if (initialFocus === 'description') {
			return descriptionEl ?? null;
		}
		return null;
	});

	function handleProjectCreated(project: Project): void {
		onProjectCreated?.(project);
	}

	function handleDurationInput(event: Event): void {
		const raw = (event.currentTarget as HTMLInputElement).value;
		$form.durationMinutes = raw === '' ? null : Number(raw);
	}

	// ---------------------------------------------------------------------------
	// Task 5.5 — the real write. See the "SUBMISSION WIRING" doc comment above for
	// why this is two hidden `use:enhance` forms rather than a `fetch`+`deserialize`.
	let submitFormEl: HTMLFormElement | undefined = $state();
	let deleteFormEl: HTMLFormElement | undefined = $state();
	let submitting = $state(false);
	let deleting = $state(false);
	let confirmDeleteOpen = $state(false);

	/** `startedAt`/`endedAt` for the hidden wire-form's `Explicit_Mode` inputs.
	 * Guarded exactly like `canPreview` (regex-shaped, non-empty) PLUS a try/catch —
	 * `TIME_RE` alone accepts an out-of-range "25:99", which `parseTimeOfDay` rejects
	 * (Requirement: never let a reactive `$derived` throw mid-keystroke and take the
	 * component down with it). Falls back to `''`, which is harmless: the Save button
	 * stays disabled — via `confirmDisabled` from `ChangePreview`, itself `true`
	 * whenever `preview` is `null` — for exactly as long as these would be empty. */
	function safeParseTimeOfDay(text: string, date: string): string {
		if (!DATE_RE.test(date) || !TIME_RE.test(text)) return '';
		try {
			return parseTimeOfDay(text, date, timeZone).toISOString();
		} catch {
			return '';
		}
	}
	const wireStartedAt = $derived($form.mode === 'explicit' ? safeParseTimeOfDay($form.from, $form.date) : '');
	const wireEndedAt = $derived($form.mode === 'explicit' ? safeParseTimeOfDay($form.to, $form.date) : '');

	type ActivityUiField = 'from' | 'to' | 'durationMinutes' | 'projectId' | 'description';
	type ActivityFailureData = {
		fieldErrors?: Partial<Record<ActivityUiField, string>>;
		toastMessage?: string;
		conflictEntryId?: string;
		stalePreview?: boolean;
		notFound?: boolean;
	};
	type ActivitySuccessData = {
		activity?: { entry: ActivityEntry; discarded: Interval[]; unplacedMinutes: number };
	};

	function applyServerFieldErrors(fieldErrors: NonNullable<ActivityFailureData['fieldErrors']>): void {
		errors.update((current) => {
			const next = { ...current };
			for (const [field, message] of Object.entries(fieldErrors)) {
				if (message !== undefined) next[field as ActivityUiField] = [message];
			}
			return next;
		});
	}

	/** `removedSeconds + lostUncoveredSeconds` is `ChangePreview`'s own headline
	 * total (design.md, task 5.2) for a SESSION change; an activity write has no
	 * `lostUncoveredSeconds` at all — what did not fit is `discarded` (policy `clip`)
	 * plus `unplacedMinutes` (Duration_Mode's leftover), exactly the two figures
	 * Requirement 15.6 says a "partial" success must name. */
	function partialSavedSeconds(activity: NonNullable<ActivitySuccessData['activity']>): number {
		const discardedSeconds = activity.discarded.reduce(
			(sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()) / 1000,
			0
		);
		return discardedSeconds + activity.unplacedMinutes * 60;
	}

	function handleActivitySubmitEnhance() {
		submitting = true;
		return async ({ result }: { result: ActionResult }) => {
			submitting = false;

			if (result.type === 'success') {
				await invalidateAll();
				const data = result.data as ActivitySuccessData | undefined;
				const activity = data?.activity;
				onClose();
				if (activity) {
					onSaved?.(activity.entry);
					const partialSeconds = partialSavedSeconds(activity);
					addSuccessToast(
						partialSeconds > 0
							? m.feedback_saved_partial({ duration: formatDuration(partialSeconds, '') })
							: m.feedback_saved()
					);
				} else {
					addSuccessToast(m.feedback_saved());
				}
				return;
			}

			if (result.type === 'failure') {
				const data = result.data as ActivityFailureData | undefined;
				if (!data) return;
				if (data.fieldErrors) applyServerFieldErrors(data.fieldErrors);
				if (data.toastMessage) {
					const conflictId = data.conflictEntryId;
					addErrorToast(
						data.toastMessage,
						conflictId
							? {
									label: m.feedback_open_conflict(),
									onclick: () => {
										onClose();
										onConflict?.(conflictId);
									}
								}
							: undefined
					);
				}
				if (data.stalePreview) void runPreview();
				if (data.notFound) {
					onClose();
					await invalidateAll();
				}
				return;
			}

			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}

			// `result.type === 'error'` — a genuine server/network failure. design.md's
			// Error Handling table: "the dialog stays open with its input intact" for
			// both a network failure and an internal error, rather than the navigation
			// `applyAction` would perform for an 'error' result. "An unreachable server
			// says so and offers retry without losing input" (task 9.2's own brief): the
			// input is already intact (this dialog never closes on this branch), so the
			// remaining half is a retry action on the same toast `feedback_open_conflict`
			// already uses for `ACTIVITY_OVERLAP` — re-submitting the identical hidden
			// form rather than asking the user to retype anything.
			addErrorToast(m.errors_internal_error({ requestId: '—' }), {
				label: m.common_retry(),
				onclick: () => submitFormEl?.requestSubmit()
			});
		};
	}

	function handleDeleteEnhance() {
		deleting = true;
		return async ({ result }: { result: ActionResult }) => {
			deleting = false;
			confirmDeleteOpen = false;

			if (result.type === 'success') {
				await invalidateAll();
				onClose();
				addSuccessToast(m.feedback_deleted());
				return;
			}
			if (result.type === 'failure') {
				const data = result.data as { toastMessage?: string; notFound?: boolean } | undefined;
				if (data?.toastMessage) addErrorToast(data.toastMessage);
				if (data?.notFound) {
					onClose();
					await invalidateAll();
				}
				return;
			}
			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}
			addErrorToast(m.errors_internal_error({ requestId: '—' }), {
				label: m.common_retry(),
				onclick: () => deleteFormEl?.requestSubmit()
			});
		};
	}

	/** Requirement 7.7: the confirmation names what will be removed — the entry's
	 * `Project`, its requested interval, and the duration actually stored (0 for an
	 * `Orphaned_Entry`, which has no segments — matching `Orphan_Panel`'s own "0 min
	 * left" wording rather than implying something is being taken away that already
	 * is not there). */
	function deleteBodyText(e: ActivityEntry): string {
		const totalSeconds = e.segments.reduce(
			(sum, seg) => sum + (seg.endedAt.getTime() - seg.startedAt.getTime()) / 1000,
			0
		);
		return m.activity_delete_body({
			project: e.projectName,
			from: timeOf(e.requestedStartedAt),
			to: timeOf(e.requestedEndedAt),
			duration: formatDuration(totalSeconds, '')
		});
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const result = await sf.validateForm({ update: true });
		if (!result.valid) return;
		submitFormEl?.requestSubmit();
	}

	const submitDisabled = $derived(confirmDisabled || $allErrors.length > 0 || submitting);
</script>

<Modal
	{open}
	title={mode === 'create' ? m.activity_add_title() : m.activity_edit_title()}
	size="lg"
	fullScreenOnMobile={true}
	dismissOnScrimClick={false}
	initialFocusEl={resolvedInitialFocusEl}
	onclose={onClose}
>
	<form bind:this={formEl} class="activity-dialog activity-dialog--{density}" onsubmit={handleSubmit}>
		<input type="hidden" name="mode" value={$form.mode} />

		<div class="activity-dialog__seg-group" role="radiogroup" aria-label={m.activity_mode_label()}>
			{#each MODE_OPTIONS as opt (opt.value)}
				{@const active = opt.value === $form.mode}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					tabindex={active ? 0 : -1}
					class="activity-dialog__seg-item"
					class:activity-dialog__seg-item--active={active}
					onclick={() => {
						$form.mode = opt.value;
					}}
					onkeydown={handleSegKeydown}
				>
					{density === 'mobile' && opt.shortLabel ? opt.shortLabel() : opt.fullLabel()}
				</button>
			{/each}
		</div>

		{#if requestedNoteText !== null}
			<p class="activity-dialog__requested-note">{requestedNoteText}</p>
		{/if}

		<div class="activity-dialog__grid activity-dialog__grid--{$form.mode} activity-dialog__grid--{density}">
			<FormField label={m.activity_field_day()} required>
				{#snippet children({ id, describedBy })}
					<!-- DatePicker (task 1.3, not touched by this task) has no `name` prop —
					     a hidden mirror input carries the real named field a future native
					     form submission needs, matching `date` in the local form schema. -->
					<input type="hidden" name="date" value={$form.date} />
					<DatePicker {id} bind:value={$form.date} required aria-describedby={describedBy} />
				{/snippet}
			</FormField>

			{#if $form.mode === 'explicit'}
				<FormField label={m.activity_field_from()} required error={fromMessage}>
					{#snippet children({ id, describedBy })}
						<TimeInput
							{id}
							name="from"
							date={$form.date}
							{timeZone}
							{density}
							bind:value={$form.from}
							required
							error={fromMessage !== undefined}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</FormField>
				<FormField label={m.activity_field_to()} required error={toMessage}>
					{#snippet children({ id, describedBy })}
						<TimeInput
							{id}
							name="to"
							date={$form.date}
							{timeZone}
							{density}
							bind:value={$form.to}
							required
							error={toMessage !== undefined}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</FormField>
			{/if}

			{#if $form.mode === 'duration'}
				<FormField label={m.activity_field_duration()} required error={durationMessage}>
					{#snippet children({ id, describedBy })}
						<input
							{id}
							name="durationMinutes"
							type="number"
							inputmode="numeric"
							min="1"
							step="1"
							required
							class="activity-dialog__duration-input activity-dialog__duration-input--{density}"
							class:activity-dialog__duration-input--error={durationMessage !== undefined}
							value={$form.durationMinutes ?? ''}
							aria-describedby={describedBy}
							aria-invalid={durationMessage !== undefined}
							oninput={handleDurationInput}
						/>
					{/snippet}
				</FormField>
			{/if}

			<FormField label={m.activity_field_project()} required error={projectMessage}>
				{#snippet children({ id, describedBy })}
					<div bind:this={projectPickerWrapperEl}>
						<ProjectPicker
							{id}
							name="projectId"
							{projects}
							value={$form.projectId === '' ? null : $form.projectId}
							onChange={(projectId) => {
								$form.projectId = projectId;
							}}
							onCreate={handleProjectCreated}
							required
							error={projectMessage !== undefined}
							aria-describedby={describedBy}
						/>
					</div>
				{/snippet}
			</FormField>
		</div>

		<FormField label={m.activity_field_description()}>
			{#snippet children({ id, describedBy })}
				<textarea
					bind:this={descriptionEl}
					{id}
					name="description"
					class="activity-dialog__description activity-dialog__description--{density}"
					bind:value={$form.description}
					aria-describedby={describedBy}
				></textarea>
			{/snippet}
		</FormField>

		<ChangePreview
			{preview}
			loading={previewLoading}
			{untrackedPolicy}
			onPolicyChange={(policy) => {
				untrackedPolicy = policy;
			}}
			{timeZone}
			bind:confirmDisabled
		/>
	</form>

	{#snippet footer()}
		<p class="modal__footer-hint">{m.common_esc_hint()}</p>
		<div class="modal__footer-actions">
			{#if mode === 'edit' && entry}
				<Button
					variant="ghost"
					class="activity-dialog__delete-trigger"
					disabled={submitting}
					onclick={() => (confirmDeleteOpen = true)}
				>
					{m.common_delete()}
				</Button>
			{/if}
			<Button variant="ghost" disabled={submitting} onclick={onClose}>{m.common_cancel()}</Button>
			<Button disabled={submitDisabled} loading={submitting} onclick={() => formEl?.requestSubmit()}>
				{m.activity_submit()}
			</Button>
		</div>
	{/snippet}
</Modal>

<!-- The real write — see the "SUBMISSION WIRING" doc comment at the top of the
     script. A hidden `use:enhance` form, never the UI form above: its inputs are
     the WIRE shape `createActivitySchema`/`patchActivitySchema` expect, not this
     dialog's own `mode`/`from`/`to` fields. -->
<form
	bind:this={submitFormEl}
	method="POST"
	action={mode === 'create' ? '?/createActivity' : '?/patchActivity'}
	class="activity-dialog__wire-form"
	use:enhance={handleActivitySubmitEnhance}
>
	{#if mode === 'edit' && entry}
		<input type="hidden" name="id" value={entry.id} />
	{/if}
	<input type="hidden" name="projectId" value={$form.projectId} />
	<input type="hidden" name="description" value={$form.description} />
	<input type="hidden" name="untrackedPolicy" value={untrackedPolicy} />
	<input type="hidden" name="dryRun" value="false" />
	{#if $form.mode === 'explicit'}
		<input type="hidden" name="startedAt" value={wireStartedAt} />
		<input type="hidden" name="endedAt" value={wireEndedAt} />
	{:else if $form.mode === 'duration'}
		<input type="hidden" name="date" value={$form.date} />
		<input type="hidden" name="durationMinutes" value={$form.durationMinutes ?? ''} />
	{:else}
		<input type="hidden" name="date" value={$form.date} />
	{/if}
	{#if preview && preview.rejection === null}
		<input type="hidden" name="previewToken" value={preview.previewToken} />
	{/if}
</form>

{#if mode === 'edit' && entry}
	<ConfirmDialog
		open={confirmDeleteOpen}
		title={m.activity_delete_title()}
		message={deleteBodyText(entry)}
		variant="destructive"
		loading={deleting}
		onconfirm={() => deleteFormEl?.requestSubmit()}
		oncancel={() => (confirmDeleteOpen = false)}
	/>
	<form
		bind:this={deleteFormEl}
		method="POST"
		action="?/deleteActivity"
		class="activity-dialog__wire-form"
		use:enhance={handleDeleteEnhance}
	>
		<input type="hidden" name="id" value={entry.id} />
	</form>
{/if}

<style>
	.activity-dialog {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	/* --------------------------------------------------------------------
	 * Segmented mode control
	 * ------------------------------------------------------------------ */
	.activity-dialog__seg-group {
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: var(--radius-12);
		background: rgba(255, 255, 255, 0.04);
	}

	.activity-dialog__seg-item {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		border: none;
		border-radius: var(--radius-9);
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		font-weight: 400;
		cursor: pointer;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			color var(--dur-hover) var(--ease-standard);
	}
	.activity-dialog--mobile .activity-dialog__seg-item {
		height: 40px;
		font-size: 12.5px;
	}

	.activity-dialog__seg-item:hover {
		color: var(--text);
	}
	.activity-dialog__seg-item--active {
		background: rgba(209, 138, 106, 0.16);
		color: var(--accent);
		font-weight: 500;
	}
	.activity-dialog__seg-item--active:hover {
		color: var(--accent);
	}
	.activity-dialog__seg-item:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--dialog)),
			0 0 0 4px var(--accent);
	}

	/* --------------------------------------------------------------------
	 * Requested-vs-stored note (Requirement 7.3)
	 * ------------------------------------------------------------------ */
	.activity-dialog__requested-note {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-faint);
	}

	/* --------------------------------------------------------------------
	 * Field grid — column template follows the mode (Requirement 6.19);
	 * mobile always collapses to one field per row.
	 * ------------------------------------------------------------------ */
	.activity-dialog__grid {
		display: grid;
		gap: 12px;
		align-items: start;
	}
	.activity-dialog__grid--explicit {
		grid-template-columns: 1fr 0.8fr 0.8fr 1.4fr;
	}
	.activity-dialog__grid--duration {
		grid-template-columns: 1fr 1fr 1.2fr;
	}
	.activity-dialog__grid--open {
		grid-template-columns: 1fr 1.6fr;
	}
	.activity-dialog__grid--mobile {
		grid-template-columns: 1fr;
		gap: 14px;
	}

	/* --------------------------------------------------------------------
	 * Duration field — no dedicated component exists anywhere in the
	 * interface for "a number of minutes"; styled to match TimeInput/
	 * DatePicker's own field chrome (44/48 tall, radius 11, --field bg).
	 * ------------------------------------------------------------------ */
	.activity-dialog__duration-input {
		display: block;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: var(--radius-11);
		background-color: var(--field);
		color: var(--text);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}
	.activity-dialog__duration-input--mobile {
		min-height: 48px;
		font-size: 0.9375rem;
	}
	.activity-dialog__duration-input:hover {
		background-color: var(--field-active-bg);
	}
	.activity-dialog__duration-input:focus-visible {
		background-color: var(--field-active-bg);
		box-shadow: var(--field-active-ring);
		outline: none;
	}
	.activity-dialog__duration-input--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}

	/* --------------------------------------------------------------------
	 * Description field
	 * ------------------------------------------------------------------ */
	.activity-dialog__description {
		display: block;
		width: 100%;
		min-height: 66px;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: var(--radius-11);
		background-color: var(--field);
		color: var(--text);
		font-size: 0.875rem;
		font-family: inherit;
		resize: vertical;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}
	.activity-dialog__description--mobile {
		min-height: 62px;
		font-size: 0.9375rem;
	}
	.activity-dialog__description:hover {
		background-color: var(--field-active-bg);
	}
	.activity-dialog__description:focus-visible {
		background-color: var(--field-active-bg);
		box-shadow: var(--field-active-ring);
		outline: none;
	}

	/* --------------------------------------------------------------------
	 * Submission plumbing (task 5.5) — the two hidden `use:enhance` forms
	 * carry no visible content of their own (see the "SUBMISSION WIRING" doc
	 * comment). The footer's delete trigger tints `Button`'s own `ghost`
	 * variant toward `--destructive`, matching the token
	 * `session_delete_link` (task 5.6) is asked to use for the same action
	 * elsewhere.
	 * ------------------------------------------------------------------ */
	.activity-dialog__wire-form {
		display: none;
	}

	/* :global -- passed as a `class` prop into `Button` (a child component), not
	   written on an element in THIS component's own template, so Svelte's
	   scoped-CSS dead-code analysis can't see it's used and would otherwise prune
	   it (the same reason `+page.svelte`'s `.day-page__summary-slot` needs it). */
	:global(.activity-dialog__delete-trigger) {
		color: var(--destructive);
	}
</style>
