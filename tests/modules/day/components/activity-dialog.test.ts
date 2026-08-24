/**
 * Component tests for `ActivityDialog` (task 5.4), covering task 5.9's bullet list one
 * group per bullet: the three-mode segmented control and its per-mode field row, the
 * inferred anchor a `Duration_Mode` `Dry_Run` resolves, `Open_Mode`'s empty field row,
 * prefill from a gap, defaulting from the most recent entry, keeping typed input on a
 * validation failure, the preview panel's position under the form, and Escape's
 * close-and-return-focus behaviour.
 *
 * Follows the pattern established by `change-preview.test.ts` and
 * `project-picker.test.ts`: `@testing-library/svelte` in the `components` Vitest
 * project (jsdom), Paraglide's `getLocale()` defaulting to `baseLocale` ("en") with no
 * explicit init needed, small local fixture builders, and a fixed reference day rather
 * than the real wall clock.
 *
 * `$modules/day/dry-run` is mocked at the exact relative path `ActivityDialog.svelte`
 * itself imports from (`../dry-run`, resolved here as `../../../../src/modules/day/dry-run`) —
 * `vi.mock` intercepts by resolved module id, so the alias form and this relative form
 * name the same file and either would work; the relative form is used to match this
 * project's existing test convention of importing source files by relative path rather
 * than by `$lib`/`$modules` alias (see `change-preview.test.ts`, `project-picker.test.ts`).
 * `previewCreateSession`/`previewPatchSession`/`previewDeleteSession` are mocked too
 * because the module is mocked as a whole — `ActivityDialog` itself never calls them.
 *
 * Debounce handling: no test anywhere in this project's suite uses fake timers
 * (confirmed by grepping for `useFakeTimers` before writing this file), so the two
 * tests that need the real 400ms debounce to settle (the anchor note and the preview
 * panel) use real timers and `findBy*`/`waitFor`, which poll against the real DOM
 * until the timer fires and the mocked dry-run promise resolves — no manual sleep.
 *
 * KNOWN GAP found while writing the Escape test (not fixed — out of this task's
 * scope, `Modal.svelte` and `ActivityDialog.svelte` are both off limits): when
 * `ActivityDialog` opens WITHOUT an `initialFocus` prop, `Modal`'s own
 * `defaultFocusTarget()` fallback (`focusableElements()[0]`, filtered only to exclude
 * `.modal__header`) resolves to `ActivityDialog`'s hidden mirror `<input type="hidden"
 * name="mode">` — the very first element inside the `<form>`, placed there before any
 * real control specifically for a future native submission (see the component's own
 * "NO SUBMISSION WIRING YET" doc comment). `input[type="hidden"]` is never a
 * focusable area per the HTML spec (jsdom's `isFocusableAreaElement` implements this
 * exactly, confirmed empirically), so `target?.focus()` silently no-ops and focus
 * never actually moves into the dialog at all on a plain `create` open with no
 * `prefill`/`recentEntry`-driven `initialFocus` — contrary to Requirement 14.21's
 * "falls back to the first focusable control". This test file works around it by
 * passing `initialFocus: 'description'` (a real, working, already-documented prop)
 * wherever a genuine open-then-return focus transition needs to be observed.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ActivityEntry, Interval, Project } from '../../../../src/lib/contracts/models';
import type { ActivityPreview } from '../../../../src/modules/day/dry-run';
import { formatDuration, formatTimeOfDay } from '../../../../src/lib/viz/format';
import * as m from '../../../../src/lib/paraglide/messages';

vi.mock('../../../../src/modules/day/dry-run', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/modules/day/dry-run')>();
	return {
		...actual,
		previewCreateActivity: vi.fn(),
		previewPatchActivity: vi.fn(),
		previewCreateSession: vi.fn(),
		previewPatchSession: vi.fn(),
		previewDeleteSession: vi.fn()
	};
});

import ActivityDialog from '../../../../src/modules/day/components/ActivityDialog.svelte';
import { previewCreateActivity } from '../../../../src/modules/day/dry-run';

// --- Fixed reference day, never the real wall clock (matches change-preview.test.ts) --
const BASE_DAY_MS = Date.UTC(2026, 5, 15);
const TZ = 'UTC';
const DATE_STR = '2026-06-15';

function dt(hour: number, minute = 0): Date {
	return new Date(BASE_DAY_MS + hour * 3_600_000 + minute * 60_000);
}

function fmtTime(t: Date): string {
	return formatTimeOfDay(t, '', TZ);
}
function fmtDuration(seconds: number): string {
	return formatDuration(seconds, '');
}

/** Matches a substring of a text node, escaping regex metacharacters in `text`. */
function containing(text: string): RegExp {
	return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

// --- Fixture builders ---------------------------------------------------------------

function mkProject(overrides: Partial<Project> = {}): Project {
	idCounter += 1;
	return {
		id: `project-${idCounter}`,
		name: `Project ${idCounter}`,
		colorIndex: 0,
		archivedAt: null,
		archived: false,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides
	};
}

function mkEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
	return {
		id: nextId('entry'),
		projectId: nextId('project'),
		projectName: 'Client Work',
		colorIndex: 0,
		description: '',
		mode: 'explicit',
		requestedStartedAt: dt(9),
		requestedEndedAt: dt(11),
		requestedDurationMinutes: null,
		orphaned: false,
		createdAt: dt(9),
		updatedAt: dt(9),
		segments: [],
		...overrides
	};
}

function mkActivityPreview(overrides: Partial<ActivityPreview> = {}): ActivityPreview {
	return {
		kind: 'activity',
		anchor: null,
		slivers: [],
		entry: mkEntry(),
		discarded: [],
		extendedSessions: [],
		unplacedMinutes: 0,
		removedSeconds: 0,
		previewToken: 'token-activity',
		rejection: null,
		...overrides
	};
}

// --- Render helper --------------------------------------------------------------------

/** Mirrors `ActivityDialog.svelte`'s own `Props` interface. */
type ActivityDialogProps = {
	mode: 'create' | 'edit';
	entry?: ActivityEntry;
	prefill?: { range?: Interval; projectId?: string; description?: string };
	date: string;
	projects: Project[];
	open: boolean;
	onClose: () => void;
	timeZone: string;
	density: 'desktop' | 'mobile';
	recentEntry?: { projectId: string; description: string } | null;
	onProjectCreated?: (project: Project) => void;
	onSaved?: (entry: ActivityEntry) => void;
	initialFocus?: 'project' | 'description';
};

function renderDialog(props: Partial<ActivityDialogProps> = {}) {
	return render(ActivityDialog, {
		props: {
			mode: 'create',
			date: DATE_STR,
			projects: [mkProject()],
			open: true,
			onClose: vi.fn(),
			timeZone: TZ,
			density: 'desktop',
			...props
		}
	});
}

/** Opens the Project_Picker and selects the named project — mirrors
 * `project-picker.test.ts`'s real `.focus()` pattern for opening the dropdown. */
async function selectProject(name: string): Promise<void> {
	const input = screen.getByRole('combobox') as HTMLInputElement;
	input.focus();
	await tick();
	const option = await screen.findByRole('option', { name: containing(name) });
	await fireEvent.click(option);
}

/**
 * `FormField` always renders a trailing `<span aria-hidden="true">*</span>` beside a
 * required field's label text, so the label's full text content is e.g. "from *", not
 * "from" — `getByLabelText`'s default exact match never finds it. Every field this
 * dialog renders through `FormField` needs `exact: false` for that reason.
 */
function fieldByLabel(text: string): HTMLElement {
	return screen.getByLabelText(text, { exact: false });
}
function queryFieldByLabel(text: string): HTMLElement | null {
	return screen.queryByLabelText(text, { exact: false });
}

// --- Tests ------------------------------------------------------------------------------

describe('ActivityDialog', () => {
	it('offers three modes and swaps the field row per mode (Requirements 6.2, 6.3, 6.4, 6.6)', async () => {
		const { baseElement } = renderDialog();

		const explicitOption = screen.getByRole('radio', { name: m.activity_mode_explicit() });
		const durationOption = screen.getByRole('radio', { name: m.activity_mode_duration() });
		const openOption = screen.getByRole('radio', { name: m.activity_mode_open() });
		expect(explicitOption).toBeInTheDocument();
		expect(durationOption).toBeInTheDocument();
		expect(openOption).toBeInTheDocument();

		// Default (create, no prefill) starts in Explicit_Mode: both "from" and "to",
		// no duration field.
		expect(explicitOption).toHaveAttribute('aria-checked', 'true');
		expect(fieldByLabel(m.activity_field_from())).toBeInTheDocument();
		expect(fieldByLabel(m.activity_field_to())).toBeInTheDocument();
		expect(baseElement.querySelector('input[name="durationMinutes"]')).toBeNull();

		await fireEvent.click(durationOption);
		expect(baseElement.querySelector('input[name="from"]')).toBeNull();
		expect(baseElement.querySelector('input[name="to"]')).toBeNull();
		expect(fieldByLabel(m.activity_field_duration())).toBeInTheDocument();

		await fireEvent.click(openOption);
		expect(baseElement.querySelector('input[name="from"]')).toBeNull();
		expect(baseElement.querySelector('input[name="to"]')).toBeNull();
		expect(baseElement.querySelector('input[name="durationMinutes"]')).toBeNull();

		await fireEvent.click(explicitOption);
		expect(fieldByLabel(m.activity_field_from())).toBeInTheDocument();
		expect(fieldByLabel(m.activity_field_to())).toBeInTheDocument();
		expect(baseElement.querySelector('input[name="durationMinutes"]')).toBeNull();
	});

	it('shows the inferred anchor once a Duration_Mode preview settles (Requirements 6.4, 9.1)', async () => {
		const project = mkProject();
		const anchorAt = dt(9, 30);
		const segments = [
			{ id: nextId('segment'), entryId: 'entry-x', startedAt: dt(9, 30), endedAt: dt(10, 15) }
		];
		vi.mocked(previewCreateActivity).mockResolvedValue(
			mkActivityPreview({
				anchor: { at: anchorAt, source: 'last-segment' },
				entry: mkEntry({ projectId: project.id, mode: 'duration', segments })
			})
		);

		renderDialog({ projects: [project] });

		await fireEvent.click(screen.getByRole('radio', { name: m.activity_mode_duration() }));
		await selectProject(project.name);
		const durationInput = fieldByLabel(m.activity_field_duration());
		await fireEvent.input(durationInput, { target: { value: '45' } });

		const expectedNote = m.activity_anchor_note({
			time: fmtTime(anchorAt),
			duration: fmtDuration(45 * 60)
		});
		expect(await screen.findByText(expectedNote, {}, { timeout: 2000 })).toBeInTheDocument();
	});

	it('offers neither a "to" field nor a duration field in Open_Mode (Requirement 6.6)', async () => {
		const { baseElement } = renderDialog();

		await fireEvent.click(screen.getByRole('radio', { name: m.activity_mode_open() }));

		expect(queryFieldByLabel(m.activity_field_from())).toBeNull();
		expect(queryFieldByLabel(m.activity_field_to())).toBeNull();
		expect(queryFieldByLabel(m.activity_field_duration())).toBeNull();
		// Actually absent from the DOM, not merely hidden.
		expect(baseElement.querySelector('input[name="from"]')).toBeNull();
		expect(baseElement.querySelector('input[name="to"]')).toBeNull();
		expect(baseElement.querySelector('input[name="durationMinutes"]')).toBeNull();
	});

	it("pre-fills Explicit_Mode with a gap's exact times (Requirement 6.5)", () => {
		const start = dt(13, 15);
		const end = dt(14, 45);
		renderDialog({ prefill: { range: { start, end } } });

		const explicitOption = screen.getByRole('radio', { name: m.activity_mode_explicit() });
		expect(explicitOption).toHaveAttribute('aria-checked', 'true');

		const fromInput = fieldByLabel(m.activity_field_from()) as HTMLInputElement;
		const toInput = fieldByLabel(m.activity_field_to()) as HTMLInputElement;
		expect(fromInput).toHaveValue(fmtTime(start));
		expect(toInput).toHaveValue(fmtTime(end));
	});

	it('defaults the project and description from recentEntry (Requirement 6.9)', () => {
		const project = mkProject({ name: 'Website Redesign' });
		renderDialog({
			projects: [project],
			recentEntry: { projectId: project.id, description: 'Fixed the header layout' }
		});

		const projectInput = screen.getByRole('combobox') as HTMLInputElement;
		expect(projectInput).toHaveValue(project.name);

		const descriptionField = fieldByLabel(
			m.activity_field_description()
		) as HTMLTextAreaElement;
		expect(descriptionField).toHaveValue('Fixed the header layout');
	});

	it('keeps the typed input and shows an inline error after a validation failure (Requirement 6.10)', async () => {
		const project = mkProject();
		const { baseElement } = renderDialog({ projects: [project] });

		await selectProject(project.name);

		const fromInput = fieldByLabel(m.activity_field_from()) as HTMLInputElement;
		const toInput = fieldByLabel(m.activity_field_to()) as HTMLInputElement;
		const descriptionField = fieldByLabel(
			m.activity_field_description()
		) as HTMLTextAreaElement;

		await fireEvent.input(fromInput, { target: { value: 'not-a-time' } });
		await fireEvent.input(toInput, { target: { value: '10:00' } });
		await fireEvent.input(descriptionField, { target: { value: 'Wrote the proposal' } });

		// Dispatched directly on the <form> (rather than via the footer's Save button
		// and `requestSubmit()`) so jsdom's own HTML5 constraint validation — which
		// `requestSubmit()` runs first and which would otherwise block the "from"
		// pattern mismatch before the component's own onsubmit ever ran — is bypassed,
		// exercising exactly the client-side Zod validation this test targets.
		//
		// Selected by `.activity-dialog` specifically (task 5.5 added two more hidden
		// `use:enhance` wire-forms — `submitFormEl`/`deleteFormEl` — as siblings for the
		// real write; a bare `form` selector would ambiguously match whichever of the
		// three happens to be first in DOM order, not necessarily this visible one).
		const form = baseElement.querySelector('form.activity-dialog')!;
		await fireEvent.submit(form);
		await tick();

		expect(fromInput).toHaveValue('not-a-time');
		expect(toInput).toHaveValue('10:00');
		expect(descriptionField).toHaveValue('Wrote the proposal');
		expect((screen.getByRole('combobox') as HTMLInputElement)).toHaveValue(project.name);

		expect(screen.getByText(m.fields_invalid_timestamp())).toBeInTheDocument();
	});

	it('renders the Change_Preview panel below the form fields once a preview settles (Requirement 9.1)', async () => {
		const project = mkProject();
		vi.mocked(previewCreateActivity).mockResolvedValue(
			mkActivityPreview({ entry: mkEntry({ projectId: project.id, mode: 'explicit' }) })
		);

		const { baseElement } = renderDialog({ projects: [project] });

		await selectProject(project.name);
		const fromInput = fieldByLabel(m.activity_field_from());
		const toInput = fieldByLabel(m.activity_field_to());
		await fireEvent.input(fromInput, { target: { value: '09:00' } });
		await fireEvent.input(toInput, { target: { value: '10:00' } });

		await waitFor(
			() => {
				expect(screen.getByText(m.preview_label())).toBeInTheDocument();
			},
			{ timeout: 2000 }
		);

		const grid = baseElement.querySelector('.activity-dialog__grid')!;
		const changePreview = baseElement.querySelector('.change-preview')!;
		expect(grid).toBeTruthy();
		expect(changePreview).toBeTruthy();
		const relation = grid.compareDocumentPosition(changePreview);
		// eslint-disable-next-line no-bitwise
		expect(Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
	});

	it('closes on Escape and returns focus to the opener once the parent closes the dialog (Requirement 14.21)', async () => {
		const opener = document.createElement('button');
		opener.textContent = 'Open dialog';
		document.body.appendChild(opener);
		opener.focus();
		expect(document.activeElement).toBe(opener);

		const onClose = vi.fn();
		const project = mkProject();
		// `initialFocus: 'description'` resolves to a real, genuinely focusable element
		// (`Modal`'s own `initialFocusEl` prop, bypassing its `defaultFocusTarget()`
		// fallback) — see the file header's KNOWN GAP note for why the fallback path
		// can't be used here.
		const { rerender } = renderDialog({
			projects: [project],
			onClose,
			initialFocus: 'description'
		});

		await tick();
		// Modal moved focus into the dialog on open (Requirement 14.21) — the opener no
		// longer has it.
		expect(document.activeElement).not.toBe(opener);
		expect(document.activeElement).toBe(fieldByLabel(m.activity_field_description()));

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);

		// Escape only calls `onClose` — actually closing (flipping `open`) is the
		// parent's job (design.md: `open` is a controlled prop). Simulate the parent's
		// response here so Modal's own `$effect` cleanup — which returns focus to
		// whatever `document.activeElement` was when the dialog opened — actually runs.
		await rerender({ open: false });
		await tick();

		expect(document.activeElement).toBe(opener);

		opener.remove();
	});
});
