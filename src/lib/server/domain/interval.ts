/**
 * The interval algebra: every function is total, takes and returns half-open
 * `[start, end)` intervals, and normalizes its output where the doc comment says so.
 * This is the foundation `clipping.ts` and `reclip.ts` build on — splitting a
 * three-hour entry around a break, walking a bare duration forward, deciding what
 * falls outside the timer frame all reduce to `normalize`, `intersect`, `subtract`
 * and `take` here.
 *
 * This module imports nothing from the project but the `Interval` type, no Drizzle
 * and no SvelteKit runtime — enforced by `tests/lib/server/imports.test.ts`.
 */
import type { Interval } from '$lib/contracts/models';

export function isEmpty(i: Interval): boolean {
	return i.start.getTime() >= i.end.getTime();
}

/** Milliseconds. */
export function duration(i: Interval): number {
	return Math.max(0, i.end.getTime() - i.start.getTime());
}

/** Half-open overlap: two intervals touching at a single instant do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
	return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** Sorts, drops empty intervals, merges overlapping and touching ones. Idempotent. */
export function normalize(input: Interval[]): Interval[] {
	const nonEmpty = input.filter((i) => !isEmpty(i));
	const sorted = [...nonEmpty].sort((a, b) => a.start.getTime() - b.start.getTime());
	const out: Interval[] = [];
	for (const i of sorted) {
		const last = out[out.length - 1];
		if (last !== undefined && i.start.getTime() <= last.end.getTime()) {
			if (i.end.getTime() > last.end.getTime()) {
				out[out.length - 1] = { start: last.start, end: i.end };
			}
		} else {
			out.push({ start: i.start, end: i.end });
		}
	}
	return out;
}

export function union(a: Interval[], b: Interval[]): Interval[] {
	return normalize([...a, ...b]);
}

/** The parts of `a` that also lie in `b`. Result is always normalized. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
	const na = normalize(a);
	const nb = normalize(b);
	const out: Interval[] = [];
	let j = 0;
	for (const x of na) {
		while (j < nb.length && nb[j].end.getTime() <= x.start.getTime()) j++;
		let k = j;
		while (k < nb.length && nb[k].start.getTime() < x.end.getTime()) {
			const start = x.start.getTime() > nb[k].start.getTime() ? x.start : nb[k].start;
			const end = x.end.getTime() < nb[k].end.getTime() ? x.end : nb[k].end;
			if (start.getTime() < end.getTime()) out.push({ start, end });
			k++;
		}
	}
	return normalize(out);
}

/** The parts of `a` that do not lie in `b`. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
	const nb = normalize(b);
	const out: Interval[] = [];
	for (const x of normalize(a)) {
		let cursor = x.start;
		for (const y of nb) {
			if (y.end.getTime() <= cursor.getTime()) continue;
			if (y.start.getTime() >= x.end.getTime()) break;
			if (y.start.getTime() > cursor.getTime()) {
				out.push({ start: cursor, end: y.start });
			}
			if (y.end.getTime() > cursor.getTime()) cursor = y.end;
			if (cursor.getTime() >= x.end.getTime()) break;
		}
		if (cursor.getTime() < x.end.getTime()) out.push({ start: cursor, end: x.end });
	}
	return normalize(out);
}

/** Clips every interval of `input` to `window`, dropping what falls entirely outside it. */
export function clamp(input: Interval[], window: Interval): Interval[] {
	return intersect(input, [window]);
}

/** Milliseconds. */
export function total(input: Interval[]): number {
	return normalize(input).reduce((sum, i) => sum + duration(i), 0);
}

/**
 * Walks `input` forward consuming up to `ms`, splitting the interval in which it runs
 * out, and never emitting a piece shorter than `minIntervalMs` — wherever that piece
 * occurs. A stretch of `eligible` already below the floor is skipped and the walk
 * continues; only a final piece may be a truncation.
 *
 * `total(taken) + remainder === ms` always; `total(taken) === min(total(input), ms)`
 * only when no piece was refused by the floor.
 *
 * `slivers` names the stretches of `input` skipped for being already below
 * `minIntervalMs`, in the order encountered, for callers that need to report them
 * specifically (`NOTHING_TO_LOG`'s `all-slivers` reason names the exact intervals).
 * Only stretches actually visited while `remaining > 0` are collected — anything past
 * where the walk stopped for another reason was never reached and is not a sliver.
 */
export function take(
	input: Interval[],
	ms: number,
	minIntervalMs: number
): { taken: Interval[]; remainder: number; slivers: Interval[] } {
	const sorted = normalize(input);
	const taken: Interval[] = [];
	const slivers: Interval[] = [];
	let remaining = Math.max(0, ms);

	for (const interval of sorted) {
		if (remaining <= 0) break;
		const available = duration(interval);
		if (available < minIntervalMs) {
			slivers.push(interval); // skip a stretch already below the floor
			continue;
		}

		if (available <= remaining) {
			// Whole interval fits (and is itself at least the floor).
			taken.push(interval);
			remaining -= available;
			continue;
		}

		// The walk runs out inside this interval. The piece taken must be at least the
		// floor; if what's left of `remaining` is below it, take the floor instead (a
		// truncation is only ever the LAST piece) and treat the difference as spent —
		// no, the floor cannot be manufactured out of nothing: if remaining is below
		// the floor, nothing more can be taken here without exceeding `ms`, so this
		// piece is skipped entirely and the remainder stays as `remaining`.
		if (remaining < minIntervalMs) break;

		const end = new Date(interval.start.getTime() + remaining);
		taken.push({ start: interval.start, end });
		remaining = 0;
		break;
	}

	return { taken: normalize(taken), remainder: remaining, slivers };
}

/** The complement of `input` within `window`. */
export function gaps(input: Interval[], window: Interval): Interval[] {
	return subtract([window], input);
}
