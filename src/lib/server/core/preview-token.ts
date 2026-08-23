/**
 * The `Preview_Token` of Requirement 14.7: a fingerprint of the stored rows a
 * `Dry_Run` was computed against, so a write carrying a stale token can be told apart
 * from one that still matches the current timer frame. Computed here and verified by
 * re-computing it inside the confirming transaction.
 *
 * Deliberately never derived from any elapsed or current time: an `Open_Session`'s
 * `endedAt` is null in the row and stays null in the fingerprint — the state that
 * changes the outcome is the row, not the clock. Fingerprinting the resulting
 * Tracked_Time would embed "the Open_Session runs until now", making the token change
 * every second the timer runs and every preview stale before it could be confirmed.
 */
import { createHash } from 'node:crypto';

export type SessionFingerprintInput = {
	id: string;
	startedAt: Date;
	endedAt: Date | null;
	updatedAt: Date;
};

export type SegmentFingerprintInput = {
	id: string;
	startedAt: Date;
	endedAt: Date;
};

/**
 * sha256 over a fixed order: every Work_Session overlapping the affected window (id,
 * startedAt, endedAt, updatedAt), then every Activity_Segment in that window (id,
 * startedAt, endedAt) — both sorted by id so the fingerprint does not depend on
 * whatever order the database happened to return rows in.
 */
export function computePreviewToken(
	sessions: SessionFingerprintInput[],
	segments: SegmentFingerprintInput[]
): string {
	const sortedSessions = [...sessions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const sortedSegments = [...segments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	const parts: string[] = [];
	for (const s of sortedSessions) {
		parts.push(
			`S:${s.id}:${s.startedAt.toISOString()}:${s.endedAt?.toISOString() ?? 'null'}:${s.updatedAt.toISOString()}`
		);
	}
	for (const seg of sortedSegments) {
		parts.push(`A:${seg.id}:${seg.startedAt.toISOString()}:${seg.endedAt.toISOString()}`);
	}

	return createHash('sha256').update(parts.join('|')).digest('hex');
}
