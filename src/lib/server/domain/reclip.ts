/**
 * Re-applies Clipping to every `Activity_Entry` a `Work_Session` change may affect.
 * Stays pure of persistence by receiving the operations it needs as a `ReclipPorts`
 * object — the store satisfies it in production, tests supply an in-memory fake.
 */
import type { ActivityEntry, Interval } from '$lib/contracts/models';
import { clip } from './clipping';
import { normalize, subtract, total } from './interval';

/** The slice of persistence re-clipping needs. The store satisfies it; tests supply a fake. */
export type ReclipPorts = {
	trackedIntervals(window: Interval[], now: Date): Promise<Interval[]>;
	/** By segment overlap OR requested-interval overlap — Requirement 2.9, both halves. */
	entriesAffectedBy(window: Interval[]): Promise<ActivityEntry[]>;
	coveredIntervals(window: Interval[], excludeEntryId: string | null): Promise<Interval[]>;
	replaceSegments(entryId: string, segments: Interval[]): Promise<void>;
};

export type ReclipOutcome = {
	entryId: string;
	/** Carried so a preview can name the entry even when it belongs to another day. */
	projectName: string;
	colorIndex: number;
	description: string;
	before: Interval[];
	after: Interval[];
	removedMs: number;
	/** True when `after` is empty — the entry becomes an Orphaned_Entry. */
	orphaned: boolean;
};

function toInterval(entry: ActivityEntry): Interval {
	return { start: entry.requestedStartedAt, end: entry.requestedEndedAt };
}

/**
 * Re-runs clipping for every entry whose segments intersect `affected` — or whose
 * requested interval does, so an `Orphaned_Entry` (no segments left to intersect) is
 * still found — in deterministic order, with policy `clip`. The caller must already
 * hold the advisory lock and an open transaction; `ports` are bound to it.
 */
export async function reclipAffected(
	ports: ReclipPorts,
	affected: Interval[],
	now: Date,
	minIntervalMs: number
): Promise<ReclipOutcome[]> {
	const normalizedAffected = normalize(affected);
	if (normalizedAffected.length === 0) return [];

	const entries = await ports.entriesAffectedBy(normalizedAffected);
	if (entries.length === 0) return [];

	// A total order: requestedStartedAt, then createdAt, then id — the same one every
	// listing uses (Requirement 7.1). Sorted here rather than trusted from the port,
	// since determinism is this function's own guarantee to make.
	const ordered = [...entries].sort((a, b) => {
		const byStart = a.requestedStartedAt.getTime() - b.requestedStartedAt.getTime();
		if (byStart !== 0) return byStart;
		const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
		if (byCreated !== 0) return byCreated;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});

	// `before` is captured from the entries as loaded, ahead of any mutation.
	const beforeByEntry = new Map<string, Interval[]>();
	for (const entry of ordered) {
		beforeByEntry.set(
			entry.id,
			normalize(entry.segments.map((s) => ({ start: s.startedAt, end: s.endedAt })))
		);
	}

	// Clear every affected entry's segments FIRST, in one pass, so that when entry N
	// is re-clipped, `coveredIntervals` never reflects the STALE segments of an entry
	// later in this same batch that has not been re-clipped yet — only real, unrelated
	// coverage, plus whatever this batch has already re-clipped ahead of entry N
	// ("treating already re-clipped entries as part of Covered_Time").
	for (const entry of ordered) {
		await ports.replaceSegments(entry.id, []);
	}

	// trackedIntervals is loaded over the UNION of the selected entries' requested
	// intervals, not over `affected` — an entry may reach well outside the changed
	// stretch, and tracked time loaded only for `affected` would delete the parts of
	// it the change never touched.
	const requestedWindow = normalize(ordered.map(toInterval));
	const tracked = await ports.trackedIntervals(requestedWindow, now);

	const outcomes: ReclipOutcome[] = [];
	for (const entry of ordered) {
		const covered = await ports.coveredIntervals(requestedWindow, entry.id);
		// A Duration_Mode entry re-clips as an EXPLICIT request over its frozen
		// requested interval (Requirement 2.11) — the Placement_Anchor is never
		// resolved again, or a morning session edit would relocate an afternoon entry.
		const result = clip({
			mode: 'explicit',
			requested: toInterval(entry),
			tracked,
			covered,
			policy: 'clip',
			minIntervalMs,
			now
		});

		await ports.replaceSegments(entry.id, result.segments);

		const before = beforeByEntry.get(entry.id) ?? [];
		const after = normalize(result.segments);
		outcomes.push({
			entryId: entry.id,
			projectName: entry.projectName,
			colorIndex: entry.colorIndex,
			description: entry.description,
			before,
			after,
			// Time that was there and is now gone. Never negative, and exactly zero
			// when a session grew.
			removedMs: total(subtract(before, after)),
			orphaned: after.length === 0
		});
	}

	return outcomes;
}
