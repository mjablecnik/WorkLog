/**
 * Component tests for `DayGauge` (task 6.6, optional). `@testing-library/svelte` +
 * jsdom, matching the pattern `tests/modules/day/components/change-preview.test.ts`
 * established as the first component test in this project — see that file's header
 * for the `resolve.conditions`/`environment`/`setupFiles` wiring this test relies on
 * without touching `vitest.config.ts` again.
 *
 * `DayGauge` is SVG-heavy and jsdom does not compute real layout (no bounding boxes,
 * no resolved `getBoundingClientRect`), so every assertion here is structural or
 * attribute-based rather than pixel-based:
 *
 * - "No arc past `trackEnd`" / "one overtime arc, labelled" are checked via the
 *   `Overtime_Arc` decorations' own identifiable classes
 *   (`.day-gauge__overtime-label`) rather than by parsing `<path>` `d` strings, per
 *   the task brief's own suggestion.
 * - The 24-hour-day test cross-references `gauge-geometry.ts`'s own `graduations()`
 *   output for the default window, rather than hardcoding which hours fall in the
 *   `Gauge_Gap`.
 * - The centring test uses a test-only host (`DayGaugeHost.svelte`) to supply the
 *   `center` snippet — `@testing-library/svelte`'s `render()` has no supported way to
 *   pass a Svelte 5 `Snippet` prop directly, only through template syntax — and
 *   asserts both DOM containment inside `.day-gauge__center` and the injected scoped
 *   CSS rule for that class, since jsdom cannot resolve the actual computed position.
 * - The accent-vs-closed test asserts directly on the `stroke="var(--accent)"` /
 *   `stroke="var(--arc-closed)"` presentation attributes `DayGauge.svelte` writes,
 *   per its own documented rule of never writing a resolved theme colour.
 * - The accessibility test documents that `DayGauge.svelte` marks the *whole* group
 *   of decorative elements `aria-hidden="true"` via one wrapping `<g>`, not each
 *   individual arc/graduation/numeral element — so "every arc … is `aria-hidden`" is
 *   verified as "every arc … sits inside the one `aria-hidden` group".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DayGauge from '../../../../src/modules/timer/components/DayGauge.svelte';
import DayGaugeHost from './DayGaugeHost.svelte';
import { createGaugeGeometry } from '../../../../src/modules/timer/components/gauge-geometry';
import type { ActivityEntry, Interval, WorkSession } from '../../../../src/lib/contracts/models';
import { formatDuration, formatTimeOfDay } from '../../../../src/lib/viz/format';
import * as m from '../../../../src/lib/paraglide/messages';

// --- Fixed reference day, never the real wall clock (matches timeline-geometry.test.ts) --
const BASE_DAY_MS = Date.UTC(2026, 5, 15);
const TZ = 'UTC';
const DATE = '2026-06-15';
const GAUGE_WINDOW = { start: '06:00', end: '00:00' }; // the default 06:00 -> 00:00 window

/** A UTC instant `dayOffset` days after the reference day, at `hour:minute`. */
function dt(dayOffset: number, hour: number, minute = 0): Date {
	return new Date(BASE_DAY_MS + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000);
}

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

function mkSession(start: Date, end: Date | null, opts: Partial<WorkSession> = {}): WorkSession {
	return {
		id: nextId('session'),
		startedAt: start,
		endedAt: end,
		stale: false,
		createdAt: start,
		updatedAt: end ?? start,
		...opts
	};
}

function fmtDuration(seconds: number): string {
	return formatDuration(seconds, '');
}
function fmtTime(t: Date): string {
	return formatTimeOfDay(t, '', TZ);
}

type DayGaugeProps = {
	sessions: WorkSession[];
	entries: ActivityEntry[];
	uncovered: Interval[];
	window: { start: string; end: string };
	date: string;
	timeZone: string;
	now: Date;
	density?: 'desktop' | 'mobile';
};

function renderGauge(overrides: Partial<DayGaugeProps> = {}) {
	return render(DayGauge, {
		props: {
			sessions: [],
			entries: [],
			uncovered: [],
			window: GAUGE_WINDOW,
			date: DATE,
			timeZone: TZ,
			now: dt(0, 12),
			density: 'desktop',
			...overrides
		}
	});
}

// --- Tests ----------------------------------------------------------------------------

describe('DayGauge', () => {
	it('draws no Overtime_Arc for a day whose sessions stay inside the window (Requirement 16.9)', () => {
		const session = mkSession(dt(0, 8), dt(0, 10)); // 08:00-10:00, well inside 06:00-24:00
		const { container } = renderGauge({ sessions: [session], now: dt(0, 11) });

		// No overtime label/dot decoration anywhere — the only identifiable markers
		// DayGauge gives an arc that reaches past trackStart/trackEnd.
		expect(container.querySelectorAll('.day-gauge__overtime-label').length).toBe(0);
		expect(container.querySelectorAll('circle[fill="var(--accent)"]').length).toBe(0);

		// Sanity: the session itself is still drawn, as a closed arc.
		expect(container.querySelectorAll('[stroke="var(--arc-closed)"]').length).toBeGreaterThan(0);
	});

	it('draws and labels one Overtime_Arc for a day ending at 03:00 (Requirement 16.9, 16.13)', () => {
		const session = mkSession(dt(0, 20), dt(1, 3)); // 20:00 -> 03:00 the next day
		const { container } = renderGauge({ sessions: [session], now: dt(1, 4) });

		const expectedLabel = fmtTime(dt(1, 3)); // "03:00"
		const label = screen.getByText(expectedLabel);
		expect(label).toBeInTheDocument();
		expect(label).toHaveClass('day-gauge__overtime-label');

		// Exactly one — the session starts inside the window (20:00 >= 06:00), so only
		// the "after GAUGE_END" overtime decoration should appear, never the "before
		// GAUGE_START" one too.
		expect(container.querySelectorAll('.day-gauge__overtime-label').length).toBe(1);
		expect(container.querySelectorAll('circle[fill="var(--accent)"]').length).toBe(1);
	});

	it('emits a <circle> for a 24-hour day and leaves the Gauge_Gap empty of graduations (Requirement 16.12)', () => {
		const session = mkSession(dt(0, 6), dt(1, 6)); // exactly 24h: 06:00 -> 06:00 next day
		const { container } = renderGauge({ sessions: [session], now: dt(1, 7) });

		// The closed-session outer ring is emitted as a <circle>, per the degenerate-arc
		// rule DayGauge.svelte documents.
		const fullCircle = container.querySelector('circle[r="138"][stroke="var(--arc-closed)"]');
		expect(fullCircle).not.toBeNull();

		// Cross-reference against gauge-geometry.ts's own graduations() for this exact
		// window/date/timeZone, rather than hardcoding which hours are absent.
		const geometry = createGaugeGeometry(GAUGE_WINDOW, DATE, TZ, 160, 160);
		const marks = geometry.graduations();
		const labelledHours = marks.filter((mark) => mark.label !== null).map((mark) => mark.label as string);

		// The default window's gap (00:00-06:00) never produces a mark for these hours.
		for (const hour of ['01', '02', '03', '04', '05']) {
			expect(labelledHours).not.toContain(hour);
			expect(screen.queryByText(hour)).toBeNull();
		}

		// The rendered <line>/<text> graduation elements match geometry.graduations()
		// exactly in count — nothing extra leaks into the gap, and the full-circle
		// outer ring doesn't add or remove any.
		expect(container.querySelectorAll('svg line').length).toBe(marks.length);
		expect(container.querySelectorAll('svg text.day-gauge__numeral').length).toBe(labelledHours.length);

		// No overtime decorations either — a full-coverage day suppresses them.
		expect(container.querySelectorAll('.day-gauge__overtime-label').length).toBe(0);
	});

	it('positions the center snippet inside the centring wrapper (Requirement 16.14)', () => {
		render(DayGaugeHost, {
			props: {
				sessions: [],
				entries: [],
				uncovered: [],
				window: GAUGE_WINDOW,
				date: DATE,
				timeZone: TZ,
				now: dt(0, 9),
				density: 'desktop'
			}
		});

		const stub = screen.getByTestId('timer-control-stub');
		const wrapper = stub.closest('.day-gauge__center');
		expect(wrapper).not.toBeNull();
		// The wrapper is the immediate sibling of the <svg> inside `.day-gauge`, i.e.
		// structurally centred over the dial rather than nested inside it.
		expect(wrapper?.parentElement).toHaveClass('day-gauge');

		// jsdom does not inject/resolve the component's scoped <style> block at all in
		// this project's test setup (verified empirically: document.head stays empty
		// after render), so the actual centring rule is verified by reading
		// DayGauge.svelte's own source rather than a resolved computed style.
		// `run-vitest.sh` always runs with the project root as `cwd` (see its own header).
		const daygaugeSource = readFileSync(
			resolve(process.cwd(), 'src/modules/timer/components/DayGauge.svelte'),
			'utf-8'
		);
		const ruleMatch = /\.day-gauge__center\s*\{([^}]*)\}/.exec(daygaugeSource);
		expect(ruleMatch).not.toBeNull();
		const rule = (ruleMatch?.[1] ?? '').replace(/\s+/g, '');
		expect(rule).toContain('position:absolute');
		expect(rule).toContain('left:50%');
		expect(rule).toContain('top:50%');
		expect(rule).toContain('transform:translate(-50%,-50%)');
	});

	it('draws an open session in the accent and a closed one in --arc-closed (Requirement 16.5)', () => {
		const closedOnly = renderGauge({ sessions: [mkSession(dt(0, 8), dt(0, 10))], now: dt(0, 11) });
		expect(closedOnly.container.querySelectorAll('[stroke="var(--accent)"]').length).toBe(0);
		expect(closedOnly.container.querySelectorAll('[stroke="var(--arc-closed)"]').length).toBeGreaterThan(0);

		const withOpen = renderGauge({
			sessions: [mkSession(dt(0, 8), null)],
			now: dt(0, 9)
		});
		expect(withOpen.container.querySelectorAll('[stroke="var(--accent)"]').length).toBeGreaterThan(0);
	});

	it('carries role="img" with a summarising aria-label and keeps every arc inside one aria-hidden group (Requirement 16.19)', () => {
		const session = mkSession(dt(0, 8), dt(0, 10)); // 2h worked, nothing described
		const { container } = renderGauge({ sessions: [session], now: dt(0, 11) });

		const svg = container.querySelector('svg');
		expect(svg).not.toBeNull();
		expect(svg).toHaveAttribute('role', 'img');

		const expectedLabel = m.timer_gauge_label({
			date: DATE,
			worked: fmtDuration(7200),
			covered: fmtDuration(0),
			uncovered: fmtDuration(0),
			// timer_gauge_label's compiled selector compares against the literal string
			// "true"/"false", never a boolean (see .agents/ISSUES.md and the component's
			// own module doc).
			running: 'false'
		});
		expect(svg).toHaveAttribute('aria-label', expectedLabel);
		expect(svg?.getAttribute('aria-label')).not.toBe('');

		// DayGauge.svelte marks the whole decorative group aria-hidden via one wrapping
		// <g>, rather than tagging each individual arc/graduation/numeral — every
		// path/line/text/circle in the SVG lives inside that group.
		const hiddenGroup = svg?.querySelector(':scope > g[aria-hidden="true"]');
		expect(hiddenGroup).not.toBeNull();
		const decorativeElements = svg?.querySelectorAll('path, line, text, circle') ?? [];
		expect(decorativeElements.length).toBeGreaterThan(0);
		decorativeElements.forEach((el) => {
			expect(hiddenGroup?.contains(el)).toBe(true);
		});
	});
});
