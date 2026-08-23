/**
 * Every response shape the REST API and the interface's load functions/form actions
 * return. Declared beside `models.ts` and `schemas.ts` — outside `src/lib/server/` —
 * because `002-worklog-ui` types its components with these and may import nothing
 * under `lib/server/`.
 */
import type {
	ActivityEntry,
	Interval,
	Project,
	ProjectInterval,
	ProjectTotal,
	ReclipOutcome,
	WorkSession
} from './models';

/**
 * The fingerprint of the stored rows a Dry_Run was computed against, carried back on
 * the confirming write. Never derived from any elapsed or current time — see
 * `src/lib/server/core/preview-token.ts`.
 */
export type PreviewToken = string;

export type ActivityResponse = {
	/** Includes its segments and `orphaned`. */
	entry: ActivityEntry;
	/**
	 * Parts of the request dropped for lying in Untracked_Time under policy `clip`
	 * (Requirement 6.6) — and nothing else. A segment refused by the
	 * MIN_INTERVAL_SECONDS floor is reported in `slivers`, never here.
	 */
	discarded: Interval[];
	/** policy=extend. */
	extendedSessions: WorkSession[];
	/** Duration mode only; always 0 outside it. */
	unplacedMinutes: number;
	/** Time taken from other entries by an `extend` rescue — always present. */
	removedSeconds: number;
	/** Dropped below MIN_INTERVAL_SECONDS (Requirement 6.5). */
	slivers: Interval[];
	/**
	 * The Placement_Anchor this write resolved, or null in Explicit_Mode where none
	 * was needed (Requirement 5.16). Present on the success path, not only on failure.
	 */
	anchor: { at: string; source: 'explicit' | 'last-segment' | 'first-session' } | null;
	dryRun: boolean;
	previewToken: PreviewToken;
};

/** POST, PATCH or DELETE on a session, with dryRun. */
export type SessionChangePreview = {
	/** null for a delete. */
	session: WorkSession | null;
	/** Before/after segments per affected entry. */
	reclipped: ReclipOutcome[];
	/** Total described time that would disappear. */
	removedSeconds: number;
	/**
	 * The Uncovered_Time that would stop being Tracked_Time — worked time nobody has
	 * described yet, which vanishes without any entry losing a segment (Requirement
	 * 14.10). Both the total and the intervals; the interface must never derive this
	 * by intersecting intervals of its own.
	 */
	lostUncoveredSeconds: number;
	lostUncovered: Interval[];
	dryRun: true;
	previewToken: PreviewToken;
};

/** GET /api/activities — paged, Requirements 7.13 and 7.14. */
export type ActivityListResponse = {
	/** At most ACTIVITY_PAGE_SIZE, orphans included. */
	entries: ActivityEntry[];
	/** Opaque; null when this is the last page. */
	nextCursor: string | null;
};

/** GET /api/sessions. A bare array — the listing is bounded and never paged. */
export type SessionListResponse = WorkSession[];

/** GET /api/projects. A bare array — nothing pages it. */
export type ProjectListResponse = Project[];

export type CurrentSessionResponse = {
	session: WorkSession | null;
	/** 0 when no session is open. */
	elapsedSeconds: number;
	/** True for a Stale_Session — running past MAX_OPEN_SESSION_HOURS. */
	stale: boolean;
};

/**
 * Every session write — start, stop, create, PATCH — answers this. `session` is the
 * row as it now stands, except for the one case Requirement 1.18 creates: stopping a
 * timer that ran for less than MIN_INTERVAL_SECONDS deletes the row instead of storing
 * it, and answers 200 with `session: null` and `discarded: true`.
 */
export type SessionWriteResponse = {
	session: WorkSession | null;
	discarded: boolean;
};

export type DaySummary = {
	/** YYYY-MM-DD. */
	date: string;
	trackedSeconds: number;
	coveredSeconds: number;
	uncoveredSeconds: number;
	/** Work_Session ROWS that began in this day — Requirement 8.9. */
	sessionCount: number;
	/**
	 * The longest uninterrupted stretch of Tracked_Time, measured over the normalized
	 * intervals (Requirement 8.11).
	 */
	longestBlockSeconds: number;
	/** Overtime — tracked time outside the Gauge_Window (Requirement 8.12). */
	overtimeSeconds: number;
	/** Tracked time after the Evening_Hour — Requirement 8.19. */
	eveningSeconds: number;
	/**
	 * The shape of the day. All three are present only when the request asked for
	 * `include=intervals` AND the range is at most MAX_INTERVAL_RANGE_DAYS long; all
	 * three are absent otherwise (Requirements 8.18, 8.23).
	 */
	tracked?: Interval[];
	covered?: ProjectInterval[];
	uncovered?: Interval[];
	byProject: ProjectTotal[];
};

export type DaysRangeResponse = {
	days: DaySummary[];
	/**
	 * The shortest window on the 24-hour clock containing at least
	 * SUGGESTED_WINDOW_COVERAGE of the range's Tracked_Time, as wall-clock times in the
	 * server zone (Requirement 8.13). Null when the range holds no Work_Session
	 * (Requirement 8.21).
	 */
	suggestedWindow: { start: string; end: string } | null;
	/**
	 * True when every DaySummary carries `tracked`, `covered` and `uncovered`; false
	 * when they were left out. False is a normal 200, never an error.
	 */
	intervalsIncluded: boolean;
};

/**
 * The unauthenticated configuration handshake (Requirement 13.1). Every value the
 * interface would otherwise have to guess is published here.
 */
export type HealthResponse = {
	status: 'ok' | 'degraded';
	version: string;
	timezone: string;
	dayStartHour: number;
	gaugeStart: string;
	gaugeEnd: string;
	eveningHour: number;
	maxOpenSessionHours: number;
};

export type CoverageResponse = {
	/** RFC 3339 UTC. */
	from: string;
	to: string;
	tracked: Interval[];
	covered: Interval[];
	/** Uncovered_Time — worked, nothing logged against it. */
	uncovered: Interval[];
	/** Untracked_Time — breaks, the timer was not running. */
	untracked: Interval[];
	/**
	 * Requirements 9.4 and 9.8: `min_gap_seconds` filters the `uncovered` LIST only.
	 * These totals always describe the whole range.
	 */
	totals: {
		trackedSeconds: number;
		coveredSeconds: number;
		uncoveredSeconds: number;
		untrackedSeconds: number;
	};
};

export type DayResponse = {
	/** YYYY-MM-DD. */
	date: string;
	bounds: Interval;
	sessions: WorkSession[];
	/** Same order as /api/activities — Requirement 7.1. */
	entries: ActivityEntry[];
	coverage: CoverageResponse;
	totals: {
		trackedSeconds: number;
		coveredSeconds: number;
		uncoveredSeconds: number;
		/** ProjectTotal, so `archived` is present — Requirement 8.5 needs it. */
		byProject: ProjectTotal[];
		/**
		 * The three figures the day page's "shape of the day" panel shows, defined
		 * exactly as in DaySummary (Requirement 8.24).
		 */
		sessionCount: number;
		longestBlockSeconds: number;
		eveningSeconds: number;
	};
	/**
	 * What a one-touch Open_Mode write would record right now, resolved by exactly
	 * the rules of Requirement 15 — the end included: now for the current Logical_Day,
	 * but the end of that day's last Work_Session for a day in the past.
	 *
	 * Null when the day has no anchor, or when no Activity_Entry exists anywhere to
	 * take a project from.
	 */
	quickLog: {
		start: string;
		/** now for today; the day's last session end for a past day. */
		end: string;
		anchorSource: 'last-segment' | 'first-session';
		/** The Project a one-touch write attributes the entry to. */
		projectId: string;
		projectName: string;
		colorIndex: number;
	} | null;
};
