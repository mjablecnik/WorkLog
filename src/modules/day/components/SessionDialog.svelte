<script lang="ts">
	/**
	 * Task 5.6 (design.md § 6's `SessionDialog` — the "Edit session" paragraph and "The
	 * Two Dialog Flows" section; Requirements 8.1-8.10, 9.7, 14.15, 14.20-14.24, 17.8).
	 *
	 * Architecturally this follows `ActivityDialog.svelte` — `Modal`, a client-only
	 * `superForm` for local UI-shaped validation, and hidden `use:enhance` forms as the
	 * real submission vehicle — but the FLOW is deliberately different (design.md's "The
	 * Two Dialog Flows"): `ActivityDialog` shows its `Change_Preview` continuously,
	 * updating live under the form as the user types. `SessionDialog` shows it only as a
	 * gate: editing the fields runs the same debounced `Dry_Run` silently in the
	 * background, and submitting moves the dialog into a distinct **Confirming** state
	 * where the `Change_Preview` REPLACES the fields entirely and the footer swaps to
	 * "confirm and save" beside "back to editing" (Requirement 8.4). The shortcut in
	 * both mermaid diagrams applies here too: a `Dry_Run` reporting no `reclipped`
	 * entries and `removedSeconds: 0` has nothing to confirm, so submitting goes
	 * straight to the real write — see `handleSubmit` below for the exact condition,
	 * copied verbatim from design.md's own wording (a discrepancy with `ChangePreview`'s
	 * own three-way `sessionHasLoss` check, which also weighs `lostUncoveredSeconds`, is
	 * a known, deliberate divergence — flagged in this task's implementation report,
	 * not silently reconciled by widening the shortcut's condition past what design.md
	 * states).
	 *
	 * ---------------------------------------------------------------------------
	 * NO DAY/DATE FIELD. Unlike `ActivityDialog`, which shows an explicit, editable
	 * `DatePicker` (Requirement 6's Explicit_Mode composes its timestamp from it), the
	 * "Edit session" paragraph never mentions one — just two 44px fields, start and
	 * end. A `Work_Session` can legitimately span midnight (design.md's own Day Timeline
	 * example: "21:00 – 03:00 · 6 h 00 min v kuse"), so each field needs its OWN
	 * calendar-date anchor rather than one shared date the way `ActivityDialog`'s
	 * from/to do. In edit mode those anchors come from the real entity being edited —
	 * `session.startedAt`'s and `session.endedAt`'s own calendar dates (server time
	 * zone), fixed once when the dialog opens and never recomputed from what the user
	 * types — so an existing overnight session keeps reading correctly while its times
	 * are adjusted. In create mode, with no entity yet, both anchors default to the
	 * `date` prop (the Logical_Day the day page is showing) — the same simplification
	 * `ActivityDialog`'s own single shared `date` field already makes for
	 * `Explicit_Mode`, so creating a session that itself crosses midnight isn't
	 * reachable through this dialog. Flagged as a known, judgment-call limitation
	 * shared with the existing `ActivityDialog`, not a new gap this task introduces.
	 *
	 * ---------------------------------------------------------------------------
	 * DELETION (Requirements 8.3, 8.10). The inline `--destructive` text link opens a
	 * lightweight `ConfirmDialog` first, naming the interval (Requirement 8.3) — its
	 * `entries` count comes from `previewDeleteSession`, run the moment the link is
	 * clicked (never derived from the day data already loaded — Requirement 9.1's rule
	 * applies to a delete's consequence exactly as it does to an edit's). Confirming
	 * THAT dialog is not the real delete: unless the preview's shortcut applies, it
	 * moves the SAME dialog into the SAME Confirming state an edit would (`pendingDelete`
	 * below), so the full before/after `Change_Preview` (Requirement 8.10 — every
	 * affected `Activity_Entry`, and the `Uncovered_Time` row) is shown before the real
	 * delete happens, exactly as design.md's task 5.6 brief asks for ("same
	 * Confirming-state treatment, since a delete's Dry_Run also reports
	 * reclipped/removedSeconds/lostUncoveredSeconds").
	 */
	import { tick } from 'svelte';
	import { z } from 'zod';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { WorkSession } from '$lib/contracts/models';
	import type { SessionWriteResponse } from '$lib/contracts/responses';
	import type { CreateSessionInput, PatchSessionInput } from '$lib/contracts/schemas';
	import {
		previewCreateSession,
		previewPatchSession,
		previewDeleteSession,
		type SessionPreview
	} from '../dry-run';
	import type { Density } from './timeline-geometry';
	import ChangePreview from './ChangePreview.svelte';
	import Modal from '$lib/ui/overlays/Modal.svelte';
	import ConfirmDialog from '$lib/ui/overlays/ConfirmDialog.svelte';
	import { addSuccessToast, addErrorToast } from '$lib/ui/overlays/toast-store.svelte';
	import Button from '$lib/ui/elements/Button.svelte';
	import FormField from '$lib/ui/forms/FormField.svelte';
	import TimeInput from '$lib/ui/forms/TimeInput.svelte';
	import { formatDuration, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		mode: 'create' | 'edit';
		/** Edit only. */
		session?: WorkSession;
		/** The Logical_Day being edited/created within — see the "NO DAY/DATE FIELD" doc
		 * comment above for exactly how it is used. */
		date: string;
		open: boolean;
		onClose: () => void;
		timeZone: string;
		density: Density;
		/** The instant the day's data was loaded — anchors an open session's still-blank
		 * end field, and the "now" shown for one in the delete confirmation. */
		now: Date;
		/** Which field a rail-edge activation wants focused+selected (Requirement 8.7 /
		 * 14.21). `undefined` focuses the first control, matching `Modal`'s own default. */
		initialFocus?: 'start' | 'end';
		/** Task 3.7's seam, mirroring `ActivityDialog`'s own `onSaved` — fires with the
		 * resulting session once a create/patch succeeds, or `null` after a delete. */
		onSaved?: (session: WorkSession | null) => void;
	}

	let {
		mode,
		session,
		date,
		open,
		onClose,
		timeZone,
		density,
		now,
		initialFocus,
		onSaved
	}: Props = $props();

	const TIME_RE = /^([0-9]{1,2}):([0-9]{2})$/;

	type SessionFormValues = { start: string; end: string };

	function timeOf(d: Date): string {
		return formatTimeOfDay(d, '', timeZone);
	}

	/** A client-safe, small duplicate of `WorkBlock.svelte`'s own private helper of the
	 * same purpose — this component may not import `$lib/server/**`, and there is no
	 * shared export for it (see that component's own comment on why it keeps its own
	 * copy rather than reaching for the server's `logical-day.ts`). */
	function dateStringInZone(instantMs: number, tz: string): string {
		const dtf = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		return dtf.format(new Date(instantMs));
	}

	// ---------------------------------------------------------------------------
	// Per-field calendar-date anchors — see the "NO DAY/DATE FIELD" doc comment.
	let startDateAnchor = $state('');
	let endDateAnchor = $state('');
	let originalStartText = $state('');
	let originalEndText = $state('');

	function initialValues(): SessionFormValues {
		if (mode === 'edit' && session) {
			return {
				start: timeOf(session.startedAt),
				end: session.endedAt !== null ? timeOf(session.endedAt) : ''
			};
		}
		return { start: '', end: '' };
	}

	const LOCAL_REQUIRED = 'required';
	const LOCAL_INVERTED = 'inverted';

	// A UI-shaped local schema, exactly like `ActivityDialog`'s own `activityFormSchema`
	// — never bound to `createSessionSchema`/`patchSessionSchema` directly, which are
	// the wire contract (full RFC 3339 instants, no notion of "leave the end
	// unchanged"). `end` is required only in create mode: in edit mode a blank end
	// means "don't change it" — the normal starting state for an open session, and a
	// legitimate (if unusual) choice for a closed one.
	const sessionFormSchema = z
		.object({ start: z.string(), end: z.string() })
		.superRefine((v, ctx) => {
			if (!TIME_RE.test(v.start)) {
				ctx.addIssue({ code: 'custom', path: ['start'], message: LOCAL_REQUIRED });
			}
			if (v.end === '') {
				if (mode === 'create') ctx.addIssue({ code: 'custom', path: ['end'], message: LOCAL_REQUIRED });
				return;
			}
			if (!TIME_RE.test(v.end)) {
				ctx.addIssue({ code: 'custom', path: ['end'], message: LOCAL_REQUIRED });
				return;
			}
			if (!TIME_RE.test(v.start)) return;
			try {
				const s = parseTimeOfDay(v.start, startDateAnchor, timeZone);
				const e = parseTimeOfDay(v.end, endDateAnchor, timeZone);
				if (e.getTime() <= s.getTime()) {
					ctx.addIssue({ code: 'custom', path: ['end'], message: LOCAL_INVERTED });
				}
			} catch {
				// Malformed input is already reported above via TIME_RE.
			}
		});

	const sf = superForm(initialValues(), {
		SPA: true,
		dataType: 'form',
		validators: zod4Client(sessionFormSchema),
		validationMethod: 'oninput',
		taintedMessage: null,
		resetForm: false
	});
	const { form, errors } = sf;

	/** Mirrors `ActivityDialog`'s own `fieldMessage` — a local placeholder issue is
	 * recomputed as translated text; a server-rejected field already carries real,
	 * translated text and renders verbatim (Requirement 6.10's rule, unchanged here). */
	function fieldMessage(fieldErrors: string[] | undefined): string | undefined {
		if (!fieldErrors || fieldErrors.length === 0) return undefined;
		const first = fieldErrors[0];
		if (first === LOCAL_REQUIRED) return m.fields_required();
		if (first === LOCAL_INVERTED) return m.errors_invalid_interval();
		return first;
	}
	const startMessage = $derived(fieldMessage($errors.start));
	const endMessage = $derived(fieldMessage($errors.end));
	const endFieldRequired = $derived(mode === 'create');

	const startChanged = $derived(mode === 'edit' && $form.start !== originalStartText);
	const endChanged = $derived(mode === 'edit' && $form.end !== originalEndText);

	// ---------------------------------------------------------------------------
	// Phase machine — design.md's "SessionDialog — preview as a confirmation state"
	// mermaid diagram, verbatim.
	type Phase = 'editing' | 'confirming' | 'saving';
	let phase = $state<Phase>('editing');
	/** True while the Confirming/Saving phase is on behalf of a delete rather than a
	 * save — decides which preview `ChangePreview` reads and which hidden form the
	 * confirm button submits. */
	let pendingDelete = $state(false);
	let confirmDisabled = $state(false);

	// ---------------------------------------------------------------------------
	// The live, silent Dry_Run — computed while editing, but (unlike ActivityDialog)
	// never rendered until the user submits.
	let preview = $state<SessionPreview | null>(null);
	let previewLoading = $state(false);
	let previewKey = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let abortController: AbortController | null = null;

	const canPreview = $derived.by(() => {
		if (!TIME_RE.test($form.start)) return false;
		if ($form.end === '') return mode === 'edit';
		if (!TIME_RE.test($form.end)) return false;
		try {
			const s = parseTimeOfDay($form.start, startDateAnchor, timeZone);
			const e = parseTimeOfDay($form.end, endDateAnchor, timeZone);
			return e.getTime() > s.getTime();
		} catch {
			return false;
		}
	});

	function currentFieldsKey(): string {
		return `${mode}|${$form.start}|${$form.end}`;
	}

	/** `SESSION_OVERLAP`'s wire shape (`details.conflicts`, an array of
	 * `{sessionId, interval, open}`) does not match `errors_session_overlap`'s own
	 * `{from, to}` — or `errors_session_overlap_open`'s `{from}` — parameters at all;
	 * `activity-form-actions.ts`'s `activityErrorFailure` performs the identical
	 * remapping server-side for the submit-failure toast. This is that same remapping,
	 * applied here so `ChangePreview`'s existing, unmodified generic rejection
	 * renderer (`rejectionMessage`, `ChangePreview.svelte`) shows the right sentence
	 * for a `Dry_Run` rejection too (Requirement 8.5's "show which sessions conflict"),
	 * without adding a special case inside `ChangePreview` itself. */
	function adaptRejection(result: SessionPreview): SessionPreview {
		if (result.rejection === null || result.rejection.code !== 'SESSION_OVERLAP') return result;
		const conflicts =
			(result.rejection.details?.conflicts as
				| { sessionId: string; interval: { start: string; end: string }; open: boolean }[]
				| undefined) ?? [];
		const first = conflicts[0];
		if (!first) return result;
		const messageKey = first.open ? 'errors_session_overlap_open' : 'errors_session_overlap';
		const details = first.open
			? { from: timeOf(new Date(first.interval.start)) }
			: { from: timeOf(new Date(first.interval.start)), to: timeOf(new Date(first.interval.end)) };
		return { ...result, rejection: { ...result.rejection, messageKey, details } };
	}

	function buildCreateInput(): CreateSessionInput | null {
		if (!TIME_RE.test($form.start) || !TIME_RE.test($form.end)) return null;
		try {
			const startedAt = parseTimeOfDay($form.start, startDateAnchor, timeZone);
			const endedAt = parseTimeOfDay($form.end, endDateAnchor, timeZone);
			return { startedAt, endedAt, dryRun: false };
		} catch {
			return null;
		}
	}

	function buildPatchInput(): PatchSessionInput | null {
		if (!TIME_RE.test($form.start)) return null;
		try {
			const startedAt = parseTimeOfDay($form.start, startDateAnchor, timeZone);
			const base: PatchSessionInput = { dryRun: false, startedAt };
			if ($form.end !== '') {
				if (!TIME_RE.test($form.end)) return null;
				base.endedAt = parseTimeOfDay($form.end, endDateAnchor, timeZone);
			}
			return base;
		} catch {
			return null;
		}
	}

	async function runPreview(): Promise<void> {
		const controller = new AbortController();
		abortController = controller;
		const key = currentFieldsKey();
		try {
			let result: SessionPreview;
			if (mode === 'create') {
				const input = buildCreateInput();
				if (!input) return;
				result = await previewCreateSession(input, controller.signal);
			} else {
				if (!session) return;
				const input = buildPatchInput();
				if (!input) return;
				result = await previewPatchSession(session.id, input, controller.signal);
			}
			if (controller.signal.aborted) return;
			preview = adaptRejection(result);
			previewKey = key;
		} catch {
			if (!controller.signal.aborted) preview = null;
		} finally {
			if (!controller.signal.aborted) previewLoading = false;
		}
	}

	/** Design.md: "run the debounced Dry_Run (or use the one already computed)". Reuses
	 * `preview` when it is already fresh for the current field values; otherwise runs
	 * one immediately, bypassing the 400 ms debounce — the user has already asked to
	 * proceed. */
	async function ensurePreview(): Promise<void> {
		const key = currentFieldsKey();
		if (preview !== null && previewKey === key && !previewLoading) return;
		if (debounceTimer) clearTimeout(debounceTimer);
		previewLoading = true;
		await runPreview();
	}

	$effect(() => {
		void $form.start;
		void $form.end;
		if (phase !== 'editing') return; // Confirming/Saving own the preview shown; don't disturb it.

		if (debounceTimer) clearTimeout(debounceTimer);
		abortController?.abort();
		abortController = null;

		if (!open || !canPreview) {
			preview = null;
			previewKey = null;
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
	// Deletion — a separate, lightweight ConfirmDialog first (Requirement 8.3), then
	// the same Confirming/ChangePreview treatment (Requirement 8.10). See the
	// "DELETION" doc comment at the top of this file.
	let deleteConfirmOpen = $state(false);
	let deletePreview = $state<SessionPreview | null>(null);
	let deletePreviewLoading = $state(false);
	let deleteAbortController: AbortController | null = null;

	async function runDeletePreview(): Promise<void> {
		if (!session) return;
		deleteAbortController?.abort();
		const controller = new AbortController();
		deleteAbortController = controller;
		deletePreviewLoading = true;
		try {
			const result = await previewDeleteSession(session.id, null, controller.signal);
			if (controller.signal.aborted) return;
			deletePreview = adaptRejection(result);
		} catch {
			if (!controller.signal.aborted) deletePreview = null;
		} finally {
			if (!controller.signal.aborted) deletePreviewLoading = false;
		}
	}

	function openDeleteConfirm(): void {
		deletePreview = null;
		deleteConfirmOpen = true;
		void runDeletePreview();
	}

	function handleDeleteConfirmCancel(): void {
		deleteConfirmOpen = false;
	}

	function handleDeleteConfirmConfirm(): void {
		if (deletePreviewLoading || deletePreview === null) return; // ConfirmDialog's own `loading` already blocks this.
		deleteConfirmOpen = false;
		pendingDelete = true;
		if (
			deletePreview.rejection === null &&
			deletePreview.reclipped.length === 0 &&
			deletePreview.removedSeconds === 0
		) {
			phase = 'saving';
			deleteFormEl?.requestSubmit();
			return;
		}
		phase = 'confirming';
	}

	const deleteDuration = $derived(
		session ? ((session.endedAt ?? now).getTime() - session.startedAt.getTime()) / 1000 : 0
	);
	/** Requirement 8.3: the confirmation names the interval that will be removed. The
	 * actual compiled `session_delete_body` (`messages/cs.json`/`en.json` — the real
	 * contract, not design.md's illustrative template text) takes only `{entries}`, so
	 * the interval and duration are composed from `day_block_head` (already "{from} –
	 * {to}", the exact shape `WorkBlock`'s own heading uses) and `formatDuration`
	 * rather than invented as a new message key. */
	const deleteBodyText = $derived(
		session
			? `${m.day_block_head({ from: timeOf(session.startedAt), to: timeOf(session.endedAt ?? now) })} · ${formatDuration(deleteDuration, '')}. ${m.session_delete_body({ entries: deletePreview?.reclipped.length ?? 0 })}`
			: ''
	);

	// ---------------------------------------------------------------------------
	// The preview `ChangePreview` renders while Confirming/Saving — whichever of the
	// two independent dry-runs (edit or delete) is currently pending.
	const displayedPreview = $derived(pendingDelete ? deletePreview : preview);
	const displayedLoading = $derived(pendingDelete ? deletePreviewLoading : previewLoading);

	// ---------------------------------------------------------------------------
	// Reset on open — only on the false -> true transition, mirroring ActivityDialog.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			if (mode === 'edit' && session) {
				startDateAnchor = dateStringInZone(session.startedAt.getTime(), timeZone);
				endDateAnchor =
					session.endedAt !== null
						? dateStringInZone(session.endedAt.getTime(), timeZone)
						: dateStringInZone(now.getTime(), timeZone);
				originalStartText = timeOf(session.startedAt);
				originalEndText = session.endedAt !== null ? timeOf(session.endedAt) : '';
			} else {
				startDateAnchor = date;
				endDateAnchor = date;
				originalStartText = '';
				originalEndText = '';
			}
			form.set(initialValues(), { taint: false });
			errors.clear();
			preview = null;
			previewKey = null;
			previewLoading = false;
			phase = 'editing';
			pendingDelete = false;
			deletePreview = null;
			deleteConfirmOpen = false;
		}
		wasOpen = open;
	});

	// ---------------------------------------------------------------------------
	// Focus target resolution — Modal moves focus itself (Requirement 14.21); this only
	// resolves WHICH element and additionally selects its text (Requirement 8.7's "that
	// edge's field focused and selected" — Modal.svelte only focuses, since TimeInput
	// exposes no `onfocus` hook to select from itself, and is out of this task's scope
	// to add one to).
	let startFieldWrapperEl: HTMLElement | undefined = $state();
	let endFieldWrapperEl: HTMLElement | undefined = $state();
	let formEl: HTMLFormElement | undefined = $state();

	const resolvedInitialFocusEl = $derived.by((): HTMLElement | null => {
		if (initialFocus === 'start') return startFieldWrapperEl?.querySelector<HTMLElement>('input') ?? null;
		if (initialFocus === 'end') return endFieldWrapperEl?.querySelector<HTMLElement>('input') ?? null;
		return null;
	});

	$effect(() => {
		if (!open) return;
		const target = resolvedInitialFocusEl;
		if (!(target instanceof HTMLInputElement)) return;
		void tick().then(() => {
			target.focus();
			target.select();
		});
	});

	// ---------------------------------------------------------------------------
	// Submission plumbing — two hidden `use:enhance` forms, mirroring ActivityDialog's
	// own "SUBMISSION WIRING" (see that component's doc comment for the full rationale
	// for hidden mirror inputs over a hand-rolled fetch).
	let submitFormEl: HTMLFormElement | undefined = $state();
	let deleteFormEl: HTMLFormElement | undefined = $state();

	function safeWireTimestamp(text: string, dateAnchor: string): string {
		if (!TIME_RE.test(text)) return '';
		try {
			return parseTimeOfDay(text, dateAnchor, timeZone).toISOString();
		} catch {
			return '';
		}
	}
	const wireStartedAt = $derived(safeWireTimestamp($form.start, startDateAnchor));
	const wireEndedAt = $derived($form.end === '' ? '' : safeWireTimestamp($form.end, endDateAnchor));

	type SessionFailureData = {
		fieldErrors?: Partial<Record<'start' | 'end', string>>;
		toastMessage?: string;
		stalePreview?: boolean;
		notFound?: boolean;
	};
	type SessionSuccessData = { session?: SessionWriteResponse };

	function applyServerFieldErrors(fieldErrors: NonNullable<SessionFailureData['fieldErrors']>): void {
		errors.update((current) => {
			const next = { ...current };
			for (const [field, message] of Object.entries(fieldErrors)) {
				if (message !== undefined) next[field as 'start' | 'end'] = [message];
			}
			return next;
		});
	}

	/** True only for the brief async gap between the user pressing Save and the
	 * dialog landing on Confirming or Saving — Requirement 15.2's "disable the submit
	 * control and show progress" while `ensurePreview()` is awaiting a network round
	 * trip that the debounce hadn't already finished. */
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const result = await sf.validateForm({ update: true });
		if (!result.valid) return;

		submitting = true;
		pendingDelete = false;
		await ensurePreview();
		submitting = false;
		if (preview === null) return;

		// Design.md's shortcut, verbatim — see this file's top doc comment for the
		// deliberate discrepancy with `ChangePreview`'s own `sessionHasLoss`.
		if (preview.rejection === null && preview.reclipped.length === 0 && preview.removedSeconds === 0) {
			phase = 'saving';
			submitFormEl?.requestSubmit();
			return;
		}
		phase = 'confirming';
	}

	function handleBackToEditing(): void {
		phase = 'editing';
		pendingDelete = false;
	}

	function handleConfirmClick(): void {
		phase = 'saving';
		if (pendingDelete) {
			deleteFormEl?.requestSubmit();
		} else {
			submitFormEl?.requestSubmit();
		}
	}

	function handleSessionSubmitEnhance() {
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidateAll();
				const data = result.data as SessionSuccessData | undefined;
				onClose();
				addSuccessToast(m.feedback_saved());
				onSaved?.(data?.session?.session ?? null);
				return;
			}

			if (result.type === 'failure') {
				const data = result.data as SessionFailureData | undefined;
				if (!data) {
					phase = 'editing';
					return;
				}
				if (data.fieldErrors) applyServerFieldErrors(data.fieldErrors);
				if (data.toastMessage) addErrorToast(data.toastMessage);
				if (data.stalePreview) {
					preview = null;
					previewKey = null;
					await runPreview();
					phase = 'confirming';
					return;
				}
				if (data.notFound) {
					onClose();
					await invalidateAll();
					return;
				}
				preview = null;
				previewKey = null;
				phase = 'editing';
				return;
			}

			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}

			// A genuine network/server failure — design.md's Error Handling table: the
			// dialog stays open with its input intact.
			addErrorToast(m.errors_internal_error({ requestId: '—' }));
			phase = 'editing';
		};
	}

	function handleSessionDeleteEnhance() {
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidateAll();
				onClose();
				addSuccessToast(m.feedback_deleted());
				onSaved?.(null);
				return;
			}

			if (result.type === 'failure') {
				const data = result.data as SessionFailureData | undefined;
				if (data?.toastMessage) addErrorToast(data.toastMessage);
				if (data?.stalePreview) {
					deletePreview = null;
					await runDeletePreview();
					phase = 'confirming';
					return;
				}
				if (data?.notFound) {
					onClose();
					await invalidateAll();
					return;
				}
				deletePreview = null;
				phase = 'editing';
				pendingDelete = false;
				return;
			}

			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}

			addErrorToast(m.errors_internal_error({ requestId: '—' }));
			phase = 'editing';
			pendingDelete = false;
		};
	}
</script>

<Modal
	{open}
	title={mode === 'create' ? m.session_add_title() : m.session_edit_title()}
	size="lg"
	fullScreenOnMobile={true}
	dismissOnScrimClick={false}
	initialFocusEl={resolvedInitialFocusEl}
	onclose={onClose}
>
	{#if phase === 'editing'}
		<form bind:this={formEl} class="session-dialog session-dialog--{density}" onsubmit={handleSubmit}>
			<div class="session-dialog__grid session-dialog__grid--{density}">
				<FormField label={m.session_field_start()} required error={startMessage}>
					{#snippet children({ id, describedBy })}
						<div bind:this={startFieldWrapperEl}>
							<TimeInput
								{id}
								date={startDateAnchor}
								{timeZone}
								{density}
								bind:value={$form.start}
								required
								error={startMessage !== undefined}
								aria-describedby={describedBy}
							/>
						</div>
						{#if startChanged}
							<span class="session-dialog__old-value">{originalStartText}</span>
						{/if}
					{/snippet}
				</FormField>

				<FormField label={m.session_field_end()} required={endFieldRequired} error={endMessage}>
					{#snippet children({ id, describedBy })}
						<div bind:this={endFieldWrapperEl}>
							<TimeInput
								{id}
								date={endDateAnchor}
								{timeZone}
								{density}
								bind:value={$form.end}
								required={endFieldRequired}
								error={endMessage !== undefined}
								aria-describedby={describedBy}
							/>
						</div>
						{#if endChanged}
							<span class="session-dialog__old-value">{originalEndText}</span>
						{/if}
					{/snippet}
				</FormField>
			</div>

			{#if mode === 'edit' && session}
				<button type="button" class="session-dialog__delete-link" onclick={openDeleteConfirm}>
					{m.session_delete_link({
						from: originalStartText,
						to: originalEndText === '' ? timeOf(now) : originalEndText
					})}
				</button>
			{/if}
		</form>
	{:else}
		<ChangePreview
			preview={displayedPreview}
			loading={displayedLoading}
			untrackedPolicy="clip"
			onPolicyChange={() => {}}
			{timeZone}
			bind:confirmDisabled
		/>
	{/if}

	{#snippet footer()}
		<p class="modal__footer-hint">{m.common_server_computed()}</p>
		<div class="modal__footer-actions">
			{#if phase === 'editing'}
				<Button variant="ghost" disabled={submitting} onclick={onClose}>{m.common_cancel()}</Button>
				<Button disabled={submitting} loading={submitting} onclick={() => formEl?.requestSubmit()}>
					{m.common_save()}
				</Button>
			{:else}
				<Button variant="ghost" disabled={phase === 'saving'} onclick={handleBackToEditing}>
					{m.session_back_to_edit()}
				</Button>
				<Button
					disabled={confirmDisabled || phase === 'saving'}
					loading={phase === 'saving'}
					onclick={handleConfirmClick}
				>
					{m.session_confirm_save()}
				</Button>
			{/if}
		</div>
	{/snippet}
</Modal>

<!-- The real write — hidden `use:enhance` forms, never the UI form above. See
     ActivityDialog.svelte's "SUBMISSION WIRING" doc comment for the full rationale. -->
<form
	bind:this={submitFormEl}
	method="POST"
	action={mode === 'create' ? '?/createSession' : '?/patchSession'}
	class="session-dialog__wire-form"
	use:enhance={handleSessionSubmitEnhance}
>
	{#if mode === 'edit' && session}
		<input type="hidden" name="id" value={session.id} />
	{/if}
	<input type="hidden" name="startedAt" value={wireStartedAt} />
	{#if mode === 'create' || $form.end !== ''}
		<input type="hidden" name="endedAt" value={wireEndedAt} />
	{/if}
	<input type="hidden" name="dryRun" value="false" />
	{#if preview && preview.rejection === null}
		<input type="hidden" name="previewToken" value={preview.previewToken} />
	{/if}
</form>

{#if mode === 'edit' && session}
	<ConfirmDialog
		open={deleteConfirmOpen}
		title={m.session_delete_title()}
		message={deleteBodyText}
		variant="destructive"
		loading={deletePreviewLoading}
		onconfirm={handleDeleteConfirmConfirm}
		oncancel={handleDeleteConfirmCancel}
	/>
	<form
		bind:this={deleteFormEl}
		method="POST"
		action="?/deleteSession"
		class="session-dialog__wire-form"
		use:enhance={handleSessionDeleteEnhance}
	>
		<input type="hidden" name="id" value={session.id} />
		{#if deletePreview && deletePreview.rejection === null}
			<input type="hidden" name="previewToken" value={deletePreview.previewToken} />
		{/if}
	</form>
{/if}

<style>
	.session-dialog {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.session-dialog__grid {
		display: grid;
		gap: 12px;
	}
	.session-dialog__grid--desktop {
		grid-template-columns: 1fr 1fr;
	}
	.session-dialog__grid--mobile {
		grid-template-columns: 1fr;
		gap: 14px;
	}

	/* --------------------------------------------------------------------
	 * The changed field's previous value, struck through (design.md's "Edit
	 * session" paragraph: "the changed one carries the new value with the old
	 * one struck through at 12 --text-faint").
	 * ------------------------------------------------------------------ */
	.session-dialog__old-value {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-faint);
		text-decoration: line-through;
		font-variant-numeric: tabular-nums;
	}

	/* --------------------------------------------------------------------
	 * Deletion — an inline destructive text link, never a Palette_Slot pill
	 * (design.md: "Deletion is an inline --destructive text link").
	 * ------------------------------------------------------------------ */
	.session-dialog__delete-link {
		align-self: flex-start;
		border: none;
		background: transparent;
		padding: 0;
		margin-top: 4px;
		font-size: 13px;
		line-height: 1.4;
		color: var(--destructive);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.session-dialog__delete-link:hover {
		text-decoration-thickness: 2px;
	}
	.session-dialog__delete-link:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--dialog)),
			0 0 0 4px var(--accent);
		border-radius: var(--radius-3);
	}

	.session-dialog__wire-form {
		display: none;
	}
</style>
