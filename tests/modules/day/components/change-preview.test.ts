/**
 * Component tests for `ChangePreview` (task 5.3). This is the first `.svelte`-rendering
 * test in the project — `@testing-library/svelte` + `@testing-library/jest-dom` are
 * wired into the `components` Vitest project via `tests/setup/dom.ts` (jsdom
 * environment, configured in `vitest.config.ts`), which now imports
 * `@testing-library/jest-dom/vitest` to register its matchers.
 *
 * Paraglide's `getLocale()` defaults to `baseLocale` ("en") when no cookie/URL/locale
 * strategy resolves anything in jsdom, so no locale initialization step is needed —
 * `m.*()` calls render the English strings straight away, verified empirically by
 * running this file.
 *
 * Fixtures are built with small local helpers against the exact `ActivityPreview` /
 * `SessionPreview` shapes in `src/modules/day/dry-run.ts`, on a fixed reference day
 * rather than the real wall clock, matching the convention in
 * `tests/modules/day/components/timeline-geometry.test.ts`. Expected duration/time
 * strings are always computed via the real `formatDuration`/`formatTimeOfDay` — never
 * hardcoded literals — so they can never drift from what the component itself calls.
 *
 * `confirmDisabled` is a `$bindable` output prop; Svelte 5 gives no supported way to
 * read a bound value back through `@testing-library/svelte`'s `render()`, so
 * `ChangePreviewHost.svelte` (test-only) binds it locally and reports every value
 * through a plain callback prop instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ChangePreview from '../../../../src/modules/day/components/ChangePreview.svelte';
import ChangePreviewHost from './ChangePreviewHost.svelte';
import type { ActivityPreview, Preview, SessionPreview } from '../../../../src/modules/day/dry-run';
import type { ActivityEntry, ActivitySegment, Interval } from '../../../../src/lib/contracts/models';
import { formatDuration, formatTimeOfDay } from '../../../../src/lib/viz/format';
import * as m from '../../../../src/lib/paraglide/messages';

// --- Fixed reference day, never the real wall clock (matches timeline-geometry.test.ts) --
const BASE_DAY_MS = Date.UTC(2026, 5, 15);
const TZ = 'UTC';

function dt(hour: number, minute = 0): Date {
	return new Date(BASE_DAY_MS + hour * 3_600_000 + minute * 60_000);
}

function iv(startHour: number, startMinute: number, endHour: number, endMinute: number): Interval {
	return { start: dt(startHour, startMinute), end: dt(endHour, endMinute) };
}

/** The exact separator `ChangePreview.svelte` renders between a range's two times. */
const RANGE_DASH = String.fromCharCode(0x2013); // "–"

function fmtDuration(seconds: number): string {
	return formatDuration(seconds, '');
}
function fmtTime(t: Date): string {
	return formatTimeOfDay(t, '', TZ);
}
function rangeText(start: Date, end: Date): string {
	return `${fmtTime(start)}${RANGE_DASH}${fmtTime(end)}`;
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

function mkSegment(entryId: string, start: Date, end: Date): ActivitySegment {
	return { id: nextId('segment'), entryId, startedAt: start, endedAt: end };
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

function mkSessionPreview(overrides: Partial<SessionPreview> = {}): SessionPreview {
	return {
		kind: 'session',
		session: null,
		reclipped: [],
		removedSeconds: 0,
		lostUncoveredSeconds: 0,
		lostUncovered: [],
		previewToken: 'token-session',
		rejection: null,
		...overrides
	};
}

function mkReclipped(overrides: Partial<SessionPreview['reclipped'][number]> = {}): SessionPreview['reclipped'][number] {
	return {
		entryId: nextId('entry'),
		projectName: 'Client Work',
		colorIndex: 0,
		description: '',
		before: [],
		after: [],
		removedMs: 0,
		orphaned: false,
		...overrides
	};
}

const noopPolicyChange = () => {};

/** Mirrors `ChangePreview.svelte`'s own (unexported) `Props` interface. */
type ChangePreviewProps = {
	preview: Preview | null;
	loading: boolean;
	untrackedPolicy: 'clip' | 'extend';
	onPolicyChange: (policy: 'clip' | 'extend') => void;
	timeZone: string;
};

/** Renders `ChangePreview` directly, for every assertion that needs no bound output. */
function renderPreview(props: Partial<ChangePreviewProps> = {}) {
	return render(ChangePreview, {
		props: {
			preview: null,
			loading: false,
			untrackedPolicy: 'clip',
			onPolicyChange: noopPolicyChange,
			timeZone: TZ,
			...props
		}
	});
}

/**
 * Renders `ChangePreview` through the test-only host so `confirmDisabled` — a
 * `$bindable` output — can be observed via `onConfirmDisabledChange`.
 */
function renderPreviewHost(
	preview: Preview | null,
	loading: boolean,
	onConfirmDisabledChange: (value: boolean) => void
) {
	return render(ChangePreviewHost, {
		props: {
			preview,
			loading,
			untrackedPolicy: 'clip',
			onPolicyChange: noopPolicyChange,
			timeZone: TZ,
			onConfirmDisabledChange
		}
	});
}

// --- Tests ----------------------------------------------------------------------------

describe('ChangePreview', () => {
	it('states the part count for a two-segment split (Requirement 9.2)', () => {
		const entryId = nextId('entry');
		const entry = mkEntry({
			id: entryId,
			segments: [mkSegment(entryId, dt(9), dt(10, 30)), mkSegment(entryId, dt(11), dt(12))]
		});
		renderPreview({ preview: mkActivityPreview({ entry }) });

		expect(screen.getByText(m.preview_parts({ count: 2 }))).toBeInTheDocument();
	});

	it('shows discarded time with its formatted duration (Requirement 9.3)', () => {
		const discardedInterval = iv(9, 0, 9, 4); // 4 minutes
		const expectedDuration = fmtDuration(4 * 60);
		renderPreview({
			preview: mkActivityPreview({ discarded: [discardedInterval] })
		});

		expect(screen.getByText(containing(expectedDuration))).toBeInTheDocument();
	});

	it('shows unplaced minutes (Requirement 9.4)', () => {
		const unplacedMinutes = 45;
		const expectedDuration = fmtDuration(unplacedMinutes * 60);
		renderPreview({
			preview: mkActivityPreview({ unplacedMinutes })
		});

		expect(screen.getByText(m.preview_unplaced({ duration: expectedDuration }))).toBeInTheDocument();
	});

	it('lists an affected session entry with its before and after ranges (Requirement 9.5)', () => {
		const before = [iv(9, 0, 11, 0)];
		const after = [iv(9, 0, 10, 0)];
		const reclipped = mkReclipped({
			projectName: 'Website Redesign',
			colorIndex: 2,
			before,
			after,
			removedMs: 3_600_000
		});
		renderPreview({
			preview: mkSessionPreview({ reclipped: [reclipped], removedSeconds: 3600 })
		});

		expect(screen.getByText('Website Redesign')).toBeInTheDocument();
		expect(screen.getByText(rangeText(before[0].start, before[0].end))).toBeInTheDocument();
		expect(screen.getByText(rangeText(after[0].start, after[0].end))).toBeInTheDocument();
	});

	it('states the headline total as removed + lost-uncovered, splits it, and counts entries only (Requirement 9.6)', () => {
		const removedSeconds = 1800;
		const lostUncoveredSeconds = 5400;
		const reclipped = [
			mkReclipped({ before: [iv(9, 0, 10, 0)], after: [iv(9, 0, 9, 30)] }),
			mkReclipped({ before: [iv(13, 0, 14, 0)], after: [iv(13, 0, 13, 30)] })
		];
		renderPreview({
			preview: mkSessionPreview({ reclipped, removedSeconds, lostUncoveredSeconds })
		});

		const totalDuration = fmtDuration(removedSeconds + lostUncoveredSeconds);
		expect(
			screen.getByText(m.preview_total({ count: 2, duration: totalDuration }))
		).toBeInTheDocument();
		expect(screen.queryByText(m.preview_total({ count: 3, duration: totalDuration }))).toBeNull();

		expect(
			screen.getByText(
				m.preview_total_split({
					entriesDuration: fmtDuration(removedSeconds),
					uncoveredDuration: fmtDuration(lostUncoveredSeconds)
				})
			)
		).toBeInTheDocument();
	});

	it('describes an emptied entry in prose with no before/after grid (Requirement 9.8)', () => {
		const before = [iv(9, 0, 10, 0)];
		const reclipped = mkReclipped({ before, after: [], orphaned: true, removedMs: 3_600_000 });
		renderPreview({
			preview: mkSessionPreview({ reclipped: [reclipped], removedSeconds: 3600 })
		});

		expect(
			screen.getByText(
				m.preview_emptied({ from: fmtTime(before[0].start), to: fmtTime(before[0].end) })
			)
		).toBeInTheDocument();
		expect(screen.queryByText(m.preview_now())).toBeNull();
		expect(screen.queryByText(m.preview_after())).toBeNull();
	});

	it('shows a lost uncovered stretch as its own row, after the reclipped entries (Requirement 9.7)', () => {
		const reclipped = mkReclipped({ before: [iv(9, 0, 10, 0)], after: [iv(9, 0, 9, 30)] });
		const lostUncoveredSeconds = 900;
		const { container } = renderPreview({
			preview: mkSessionPreview({
				reclipped: [reclipped],
				removedSeconds: 1800,
				lostUncoveredSeconds,
				lostUncovered: [iv(14, 0, 14, 15)]
			})
		});

		const expectedText = `${m.preview_uncovered_row()} · ${fmtDuration(lostUncoveredSeconds)}`;
		expect(screen.getByText(expectedText)).toBeInTheDocument();

		const rows = container.querySelectorAll('.change-preview__entry');
		expect(rows.length).toBe(2);
		expect(rows[rows.length - 1].textContent).toContain(m.preview_uncovered_row());
		expect(rows[0].textContent).not.toContain(m.preview_uncovered_row());
	});

	it('shows the rejection reason and disables confirm (Requirement 9.9)', () => {
		const onConfirmDisabledChange = vi.fn();
		const preview = mkSessionPreview({
			rejection: {
				code: 'SESSION_OVERLAP',
				messageKey: 'errors_session_overlap',
				details: { from: '13:00', to: '14:00' }
			}
		});
		renderPreviewHost(preview, false, onConfirmDisabledChange);

		expect(
			screen.getByText(m.errors_session_overlap({ from: '13:00', to: '14:00' }))
		).toBeInTheDocument();
		expect(onConfirmDisabledChange).toHaveBeenLastCalledWith(true);
	});

	it('disables confirm and shows a loading treatment while the preview is in flight (Requirement 9.12)', () => {
		const onConfirmDisabledChange = vi.fn();
		const { container } = renderPreviewHost(null, true, onConfirmDisabledChange);

		expect(onConfirmDisabledChange).toHaveBeenLastCalledWith(true);
		const body = container.querySelector('.change-preview__body');
		expect(body).toHaveAttribute('aria-busy', 'true');
		expect(container.querySelectorAll('.change-preview__skeleton-row').length).toBe(3);
	});

	it('calls onPolicyChange when the Untracked_Policy choice changes (Requirement 9.10)', async () => {
		const onPolicyChange = vi.fn();
		renderPreview({
			preview: mkActivityPreview({ discarded: [iv(9, 0, 9, 4)] }),
			untrackedPolicy: 'clip',
			onPolicyChange
		});

		const extendOption = screen.getByRole('radio', { name: m.preview_policy_extend() });
		await fireEvent.click(extendOption);

		expect(onPolicyChange).toHaveBeenCalledWith('extend');
	});
});
