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
	 * NO SUBMISSION WIRING YET (task 5.5's job — no
	 * `src/routes/day/[date]/+page.server.ts` exists). The fields below ARE real
	 * named `<input>`s inside a real `<form>` (`bind:this={formEl}`), so task 5.5 can
	 * add `method="POST"` and `use:enhance` to the same element. The footer's Save
	 * button lives in `Modal`'s `footer` snippet — a DOM sibling of `.modal__body`,
	 * not a descendant of this `<form>` — so it can't rely on being a native
	 * `type="submit"` button inside it; `Button` (deliberately left untouched) has no
	 * `form=` passthrough either. It instead calls `formEl?.requestSubmit()`
	 * directly, which fires the form's real `submit` event exactly as a native submit
	 * button would. `handleSubmit` currently only runs the local validation and
	 * `preventDefault()`s — task 5.5 should either move the footer buttons inside the
	 * form, or add a `form` passthrough prop to `Button`, once there is somewhere for
	 * a real submission to go.
	 */
	import { z } from 'zod';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import type { ActivityEntry, Interval, Project } from '$lib/contracts/models';
	import type { CreateActivityInput, PatchActivityInput } from '$lib/contracts/schemas';
	import { previewCreateActivity, previewPatchActivity, type Preview } from '../dry-run';
	import type { Density } from './timeline-geometry';
	import ChangePreview from './ChangePreview.svelte';
	import ProjectPicker from '$modules/projects/components/ProjectPicker.svelte';
	import Modal from '$lib/ui/overlays/Modal.svelte';
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
		/** Addition — task 3.7/5.5's seam; unused by this task, see "NO SUBMISSION
		 * WIRING YET" above. */
		onSaved?: (entry: ActivityEntry) => void;
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
		onSaved: _onSaved,
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

	function fieldMessage(fieldErrors: string[] | undefined, fallback: () => string): string | undefined {
		return fieldErrors && fieldErrors.length > 0 ? fallback() : undefined;
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

	async function runPreview(): Promise<void> {
		const controller = new AbortController();
		abortController = controller;
		try {
			const result =
				mode === 'create'
					? await previewCreateActivity(buildCreateInput(), controller.signal)
					: await previewPatchActivity(entry!.id, buildPatchInput(), controller.signal);
			if (controller.signal.aborted) return;
			preview = result;
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

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await sf.validateForm({ update: true });
		// Task 5.5 wires the real submission (see the "NO SUBMISSION WIRING YET" doc
		// comment above) — nothing is persisted from here yet.
	}

	const submitDisabled = $derived(confirmDisabled || $allErrors.length > 0);
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
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button disabled={submitDisabled} onclick={() => formEl?.requestSubmit()}>
				{m.activity_submit()}
			</Button>
		</div>
	{/snippet}
</Modal>

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
</style>
