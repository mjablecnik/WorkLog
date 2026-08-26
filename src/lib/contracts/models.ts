/**
 * Domain types shared between the server and the browser. `002-worklog-ui` types its
 * components with these, so they live outside `src/lib/server/` where client code may
 * not import from. `src/lib/server/domain/interval.ts` imports `Interval` from here
 * rather than declaring it a second time.
 *
 * This module imports nothing but its own types — no database client, no `$env`, no
 * `$app`, no Drizzle, no SvelteKit. It must be safe to ship to the browser.
 *
 * Timestamps are `Date` inside the server and RFC 3339 UTC strings on the wire
 * (Requirement 10.3); the interface revives them on receipt.
 */

/** Half-open `[start, end)`. Two intervals may touch without overlapping. */
export type Interval = {
	start: Date;
	end: Date;
};

export type WorkSession = {
	id: string;
	startedAt: Date;
	/** Absent while the timer runs. */
	endedAt: Date | null;
	/**
	 * True for a Stale_Session — an Open_Session running past MAX_OPEN_SESSION_HOURS.
	 * Derived at read time from `now`, never stored. Lives on the session rather than
	 * only on CurrentSessionResponse because Requirement 1.10 demands the flag in
	 * every response carrying the session.
	 */
	stale: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type Project = {
	id: string;
	name: string;
	/** 0..7, stable slot in the eight-colour categorical palette (see 002-worklog-ui). */
	colorIndex: number;
	/** Whether a Work_Entry attributed to this Project is paid (true) or unpaid (false). */
	billable: boolean;
	archivedAt: Date | null;
	/** `archivedAt !== null`, sent so no caller has to derive the flag it filters on. */
	archived: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type ActivityMode = 'explicit' | 'duration' | 'open';

/**
 * The three-way classification of an Activity_Entry, derived at read time and never
 * stored — `paid` for a Work_Entry whose Project is billable, `unpaid` for a
 * Work_Entry whose Project is not billable, `relax` for a Leisure_Entry.
 */
export type Category = 'paid' | 'unpaid' | 'relax';

export type ActivitySegment = {
	id: string;
	entryId: string;
	startedAt: Date;
	endedAt: Date;
};

export type ActivityEntry = {
	id: string;
	/** Null for a Leisure_Entry. */
	projectId: string | null;
	/** Joined, read-only. Null for a Leisure_Entry. */
	projectName: string | null;
	/** Joined, read-only — Requirement 7.15. Null for a Leisure_Entry — none of the
	 *  eight Palette_Slot values represents it. */
	colorIndex: number | null;
	/** Derived: paid/unpaid from the Project's billable flag, or relax when projectId
	 *  is null. Never stored. */
	category: Category;
	description: string;
	mode: ActivityMode;

	/**
	 * The interval the request resolved to, stored before Clipping and never rewritten
	 * by it. Non-null in every mode (Requirement 5.13).
	 */
	requestedStartedAt: Date;
	requestedEndedAt: Date;
	/** Duration_Mode only: what the user actually asked for, kept beside the result. */
	requestedDurationMinutes: number | null;

	/** True when `segments` is empty — an Orphaned_Entry (Requirements 2.10, 7.3). */
	orphaned: boolean;

	createdAt: Date;
	updatedAt: Date;
	segments: ActivitySegment[];
};

/** What `createEntry` is given: the entry row before the database assigns anything. */
export type NewActivityEntry = {
	/** Null creates a Leisure_Entry. */
	projectId: string | null;
	description: string;
	mode: ActivityMode;
	requestedStartedAt: Date;
	requestedEndedAt: Date;
	requestedDurationMinutes: number | null;
};

export type ProjectTotal = {
	projectId: string;
	projectName: string;
	colorIndex: number;
	/** So an archived project holding time in a range is still recognisable. */
	archived: boolean;
	coveredSeconds: number;
	/** Lets a caller split a per-project breakdown into paid and unpaid without a
	 *  second Project lookup. */
	billable: boolean;
};

/**
 * A stretch of Covered_Time with the Project it belongs to (Requirement 8.16). Carries
 * the palette slot as well as the id, so a caller never has to join against the
 * project list to colour a stretch.
 */
export type ProjectInterval = Interval & { projectId: string; colorIndex: number };

/**
 * What `reclipAffected` (`src/lib/server/domain/reclip.ts`) reports for one
 * `Activity_Entry` it touched. Declared here rather than in `domain/reclip.ts` itself
 * because `SessionChangePreview` (`responses.ts`) carries a list of these on the wire,
 * and `lib/contracts` may not import from `lib/server` — the domain module imports the
 * type from here instead, exactly as it does `Interval`.
 */
/**
 * Non-nullable by design: `entriesAffectedBy` (`store/activities.ts`) is filtered to
 * Work_Entry rows only, so no Leisure_Entry ever reaches `reclipAffected` and neither
 * field below can be null here — unlike `ActivityEntry`'s nullable fields.
 */
export type ReclipOutcome = {
	entryId: string;
	/** Carried so a preview can name the entry even when it belongs to another day. */
	projectName: string;
	/** The preview lists entries in their project colours. */
	colorIndex: number;
	description: string;
	before: Interval[];
	after: Interval[];
	removedMs: number;
	/** True when `after` is empty — the entry becomes an Orphaned_Entry. */
	orphaned: boolean;
};
