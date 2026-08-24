/**
 * Store tests for `createElapsed` (part of task 6.9; Requirements 3.3, 3.7, 3.10).
 *
 * FILE LOCATION / VITEST PROJECT — placed under `tests/modules/timer/`, mirroring
 * `src/modules/timer/elapsed.svelte.ts`'s own location one level up from
 * `components/`. `vitest.config.ts`'s `domain` project only includes
 * `tests/lib/server/domain/**` and `tests/lib/viz/**`, so a file under
 * `tests/modules/**` is never picked up there regardless of whether the store itself
 * could run in a bare `node` environment — only the `components` (jsdom) project's
 * `include: ['tests/modules/**\/*.test.ts', ...]` matches this path, which settles the
 * question by file-location convention alone. Independently of that, `createElapsed`
 * calls `$effect` internally (the once-a-second tick) and Svelte 5 requires a
 * component/effect-root context for that even under `node` — confirmed empirically:
 * calling it directly from a bare `.test.ts` throws `effect_orphan`. See
 * `elapsed-harness.svelte.ts`'s own header for how this file gets that context without
 * mounting a component.
 *
 * FAKE TIMERS — no other test in this project's suite uses them (re-grepped for
 * `useFakeTimers`/`vi.useFakeTimers` immediately before writing this file: the only
 * hit is `activity-dialog.test.ts`'s own doc comment noting the same thing, still
 * true). This file is the first exception, and deliberately so: `runningSeconds` only
 * advances when the tick `$effect`'s `setInterval` callback actually fires and moves
 * the internal `nowMs` forward — there is no way to demonstrate "a naive local tick
 * would have produced a different number than what `sync()` gives" without real time
 * (or fake time standing in for it) actually elapsing between `start()` and `sync()`.
 * `vi.useFakeTimers()` fakes `Date` along with the timers by default in this Vitest
 * version, which is why `Date.now()` (used throughout `elapsed.svelte.ts`) advances
 * together with `vi.advanceTimersByTime()` rather than needing a separate
 * `vi.setSystemTime()` call per step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentSessionResponse } from '../../../src/lib/contracts/responses';
import type { WorkSession } from '../../../src/lib/contracts/models';
import { withElapsed, flushSync } from './elapsed-harness.svelte';

const T0 = new Date('2026-06-15T09:00:00.000Z');

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

function mkSession(startedAt: Date, overrides: Partial<WorkSession> = {}): WorkSession {
	return {
		id: nextId('session'),
		startedAt,
		endedAt: null,
		stale: false,
		createdAt: startedAt,
		updatedAt: startedAt,
		...overrides
	};
}

function mkCurrentSession(overrides: Partial<CurrentSessionResponse> = {}): CurrentSessionResponse {
	return {
		session: mkSession(T0),
		elapsedSeconds: 0,
		stale: false,
		...overrides
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createElapsed', () => {
	it('sets runningSeconds from an immediate sync() to the server-reported elapsedSeconds (Requirement 3.3)', () => {
		withElapsed({ openedAt: null }, (store) => {
			expect(store.runningSeconds).toBe(0);

			store.sync(mkCurrentSession({ elapsedSeconds: 500 }));
			flushSync();

			expect(store.runningSeconds).toBe(500);
		});
	});

	it("sync() overrides whatever the local tick produced, replacing it with the server's own count (Requirement 3.10)", () => {
		withElapsed({ openedAt: null }, (store) => {
			store.start();
			flushSync();

			// 5 real ticks pass with nothing syncing — the naive local-only count.
			vi.advanceTimersByTime(5000);
			expect(store.runningSeconds).toBe(5);

			// The server disagrees materially (100s, not ~5s) — sync() must win
			// immediately, not merge with or average against the local count.
			store.sync(mkCurrentSession({ elapsedSeconds: 100 }));
			flushSync();
			expect(store.runningSeconds).toBe(100);

			// Ticking continues from the new, server-given anchor afterwards.
			vi.advanceTimersByTime(2000);
			expect(store.runningSeconds).toBe(102);
		});
	});

	it('start() flips to running and begins ticking immediately, without waiting for a sync() (Requirement 3.13)', () => {
		withElapsed({ openedAt: null }, (store) => {
			expect(store.runningSeconds).toBe(0);

			store.start();
			flushSync();
			// No sync() call anywhere in this test — the optimistic start alone must be
			// what makes the store start ticking.
			vi.advanceTimersByTime(3000);

			expect(store.runningSeconds).toBe(3);
		});
	});

	it('stop() flips to not-running and freezes the count immediately, without waiting for a sync() (Requirement 3.13)', () => {
		// Constructed already open, mirroring a page load with a running timer.
		withElapsed({ openedAt: T0 }, (store) => {
			vi.advanceTimersByTime(4000);
			expect(store.runningSeconds).toBe(4);

			store.stop();
			flushSync();
			expect(store.runningSeconds).toBe(0);

			// No sync() call anywhere in this test — the optimistic stop alone must be
			// what stops the ticking (were it still running, this would read 3, not 0).
			vi.advanceTimersByTime(3000);
			expect(store.runningSeconds).toBe(0);
		});
	});

	it('stale reflects exactly what the most recent sync() was given (Requirement 3.10)', () => {
		withElapsed({ openedAt: null }, (store) => {
			expect(store.stale).toBe(false);

			store.sync(mkCurrentSession({ stale: true }));
			flushSync();
			expect(store.stale).toBe(true);

			store.sync(mkCurrentSession({ stale: false }));
			flushSync();
			expect(store.stale).toBe(false);
		});
	});

	it('start() and stop() each reset stale to false optimistically (Requirement 3.10)', () => {
		withElapsed({ openedAt: null }, (store) => {
			store.sync(mkCurrentSession({ stale: true }));
			flushSync();
			expect(store.stale).toBe(true);

			store.start();
			flushSync();
			expect(store.stale).toBe(false);

			store.sync(mkCurrentSession({ stale: true }));
			flushSync();
			expect(store.stale).toBe(true);

			store.stop();
			flushSync();
			expect(store.stale).toBe(false);
		});
	});
});
