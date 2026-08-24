/**
 * The dry-run client: five functions, one per write that can destroy something —
 * creating and editing an `Activity_Entry`, and creating, editing or deleting a
 * `Work_Session`. Each sends the request with its dry-run flag set, and maps the
 * server's response into `ActivityPreview` or `SessionPreview`, field for field.
 *
 * Nothing here is computed from the day data already loaded — every figure the
 * component will render (`anchor`, `slivers`, `discarded`, `extendedSessions`,
 * `unplacedMinutes`, `removedSeconds`, `reclipped`, `lostUncoveredSeconds`,
 * `lostUncovered`) comes straight from the server's `ActivityResponse` /
 * `SessionChangePreview` (Requirement 9.1). The one addition on this side is
 * `rejection`, this client's mapping of a non-2xx error envelope — the server has no
 * such field.
 *
 * Debouncing is the caller's job (`ChangePreview.svelte`, a later task, waits 400 ms
 * of typing pause before calling in — Requirement 9.15). What this module owns is the
 * `AbortSignal`: every function passes it straight into `fetch`, so the caller can
 * abort a superseded request. An abort's `AbortError` — and any genuine network
 * failure — propagates as a thrown rejection of the returned promise; only a non-2xx
 * HTTP response becomes a `rejection` value (Requirement 9.13).
 *
 * Timestamps arrive as RFC 3339 strings and are revived into `Date` here, at the
 * fetch boundary, recursively wherever they appear — interval bounds, segment and
 * session bounds, and `anchor.at`.
 */
import type { ActivityEntry, ActivitySegment, Interval, WorkSession } from '$lib/contracts/models';
import type { ActivityResponse, SessionChangePreview } from '$lib/contracts/responses';
import type {
	CreateActivityInput,
	CreateSessionInput,
	PatchActivityInput,
	PatchSessionInput
} from '$lib/contracts/schemas';

export type Anchor = {
	at: Date;
	source: 'explicit' | 'last-segment' | 'first-session';
} | null;

export type ActivityPreview = {
	kind: 'activity';
	/** The anchor the server resolved, for Duration_Mode and Open_Mode. */
	anchor: Anchor;
	/** Segments dropped for falling under MIN_INTERVAL_SECONDS — discarded time the user must see. */
	slivers: Interval[];
	/** The entry as it would be stored, carrying its resulting segments — the server's shape. */
	entry: ActivityEntry;
	discarded: Interval[];
	extendedSessions: WorkSession[];
	unplacedMinutes: number;
	removedSeconds: number;
	previewToken: string;
	rejection: Rejection | null;
};

export type SessionPreview = {
	kind: 'session';
	/** null for a delete. */
	session: WorkSession | null;
	reclipped: {
		entryId: string;
		projectName: string;
		/** Joined, read-only — restored from the server's `ReclipOutcome` (Requirement 11.9)
		 * so `ChangePreview` can draw the slot-coloured tick beside each affected entry. */
		colorIndex: number;
		description: string;
		before: Interval[];
		after: Interval[];
		removedMs: number;
		orphaned: boolean;
	}[];
	removedSeconds: number;
	/** Uncovered_Time that would fall outside Tracked_Time — from the server, never derived here. */
	lostUncoveredSeconds: number;
	lostUncovered: Interval[];
	previewToken: string;
	rejection: Rejection | null;
};

export type Rejection = { code: string; messageKey: string; details?: Record<string, unknown> };
export type Preview = ActivityPreview | SessionPreview;

/**
 * The wire shape of `T` — every `Date` a JSON-serialized RFC 3339 string, recursively
 * through arrays and plain objects. `ActivityResponse` and `SessionChangePreview` are
 * declared (in `$lib/contracts/responses`) as the server holds them in memory, with
 * real `Date` values; what actually arrives over `fetch` is this shape instead. Typing
 * the raw response this way, rather than by hand, keeps the two from drifting: a
 * `Date` added to a contract type here becomes a `string` automatically.
 */
type Wire<T> = T extends Date
	? string
	: T extends (infer U)[]
		? Wire<U>[]
		: T extends object
			? { [K in keyof T]: Wire<T[K]> }
			: T;

type WireActivityResponse = Wire<ActivityResponse>;
type WireSessionChangePreview = Wire<SessionChangePreview>;

/** The standard error envelope (`src/lib/server/core/errors.ts`'s `ErrorBody`), as it arrives over the wire. */
type WireErrorBody = {
	error: string;
	message: string;
	messageKey: string;
	requestId: string;
	details?: Record<string, unknown>;
};

function reviveInterval(raw: Wire<Interval>): Interval {
	return { start: new Date(raw.start), end: new Date(raw.end) };
}

function reviveIntervals(raw: Wire<Interval>[]): Interval[] {
	return raw.map(reviveInterval);
}

function reviveSegment(raw: Wire<ActivitySegment>): ActivitySegment {
	return {
		id: raw.id,
		entryId: raw.entryId,
		startedAt: new Date(raw.startedAt),
		endedAt: new Date(raw.endedAt)
	};
}

function reviveEntry(raw: Wire<ActivityEntry>): ActivityEntry {
	return {
		id: raw.id,
		projectId: raw.projectId,
		projectName: raw.projectName,
		colorIndex: raw.colorIndex,
		description: raw.description,
		mode: raw.mode,
		requestedStartedAt: new Date(raw.requestedStartedAt),
		requestedEndedAt: new Date(raw.requestedEndedAt),
		requestedDurationMinutes: raw.requestedDurationMinutes,
		orphaned: raw.orphaned,
		createdAt: new Date(raw.createdAt),
		updatedAt: new Date(raw.updatedAt),
		segments: raw.segments.map(reviveSegment)
	};
}

function reviveSession(raw: Wire<WorkSession>): WorkSession {
	return {
		id: raw.id,
		startedAt: new Date(raw.startedAt),
		endedAt: raw.endedAt === null ? null : new Date(raw.endedAt),
		stale: raw.stale,
		createdAt: new Date(raw.createdAt),
		updatedAt: new Date(raw.updatedAt)
	};
}

function reviveAnchor(raw: Wire<ActivityResponse>['anchor']): Anchor {
	return raw === null ? null : { at: new Date(raw.at), source: raw.source };
}

/** A placeholder entry for a rejected `ActivityPreview` — never read; `rejection` is checked first. */
const EMPTY_ACTIVITY_ENTRY: ActivityEntry = {
	id: '',
	projectId: '',
	projectName: '',
	colorIndex: 0,
	description: '',
	mode: 'open',
	requestedStartedAt: new Date(0),
	requestedEndedAt: new Date(0),
	requestedDurationMinutes: null,
	orphaned: false,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	segments: []
};

function rejectedActivityPreview(rejection: Rejection): ActivityPreview {
	return {
		kind: 'activity',
		anchor: null,
		slivers: [],
		entry: EMPTY_ACTIVITY_ENTRY,
		discarded: [],
		extendedSessions: [],
		unplacedMinutes: 0,
		removedSeconds: 0,
		previewToken: '',
		rejection
	};
}

function rejectedSessionPreview(rejection: Rejection): SessionPreview {
	return {
		kind: 'session',
		session: null,
		reclipped: [],
		removedSeconds: 0,
		lostUncoveredSeconds: 0,
		lostUncovered: [],
		previewToken: '',
		rejection
	};
}

function toActivityPreview(raw: WireActivityResponse): ActivityPreview {
	return {
		kind: 'activity',
		anchor: reviveAnchor(raw.anchor),
		slivers: reviveIntervals(raw.slivers),
		entry: reviveEntry(raw.entry),
		discarded: reviveIntervals(raw.discarded),
		extendedSessions: raw.extendedSessions.map(reviveSession),
		unplacedMinutes: raw.unplacedMinutes,
		removedSeconds: raw.removedSeconds,
		previewToken: raw.previewToken,
		rejection: null
	};
}

function toSessionPreview(raw: WireSessionChangePreview): SessionPreview {
	return {
		kind: 'session',
		session: raw.session === null ? null : reviveSession(raw.session),
		reclipped: raw.reclipped.map((r) => ({
			entryId: r.entryId,
			projectName: r.projectName,
			colorIndex: r.colorIndex,
			description: r.description,
			before: reviveIntervals(r.before),
			after: reviveIntervals(r.after),
			removedMs: r.removedMs,
			orphaned: r.orphaned
		})),
		removedSeconds: raw.removedSeconds,
		lostUncoveredSeconds: raw.lostUncoveredSeconds,
		lostUncovered: reviveIntervals(raw.lostUncovered),
		previewToken: raw.previewToken,
		rejection: null
	};
}

/**
 * Runs one dry-run `fetch` and reports which of the two outcomes Requirement 9.13
 * describes: a 2xx with the parsed body, or a non-2xx mapped into a `Rejection`. An
 * abort or a genuine network failure is not caught here — `fetch` itself rejects, and
 * that rejection propagates to the caller unchanged.
 */
async function runDryRun<T>(
	input: RequestInfo | URL,
	init: RequestInit
): Promise<{ ok: true; body: T } | { ok: false; rejection: Rejection }> {
	const res = await fetch(input, init);
	const body = await res.json();
	if (res.ok) {
		return { ok: true, body: body as T };
	}
	const err = body as WireErrorBody;
	return {
		ok: false,
		rejection: {
			code: err.error,
			messageKey: err.messageKey,
			...(err.details !== undefined ? { details: err.details } : {})
		}
	};
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export async function previewCreateActivity(
	input: CreateActivityInput,
	signal: AbortSignal
): Promise<ActivityPreview> {
	const result = await runDryRun<WireActivityResponse>('/api/activities', {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ ...input, dryRun: true }),
		signal
	});
	return result.ok ? toActivityPreview(result.body) : rejectedActivityPreview(result.rejection);
}

export async function previewPatchActivity(
	id: string,
	input: PatchActivityInput,
	signal: AbortSignal
): Promise<ActivityPreview> {
	const result = await runDryRun<WireActivityResponse>(`/api/activities/${id}`, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: JSON.stringify({ ...input, dryRun: true }),
		signal
	});
	return result.ok ? toActivityPreview(result.body) : rejectedActivityPreview(result.rejection);
}

export async function previewCreateSession(
	input: CreateSessionInput,
	signal: AbortSignal
): Promise<SessionPreview> {
	const result = await runDryRun<WireSessionChangePreview>('/api/sessions', {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ ...input, dryRun: true }),
		signal
	});
	return result.ok ? toSessionPreview(result.body) : rejectedSessionPreview(result.rejection);
}

export async function previewPatchSession(
	id: string,
	input: PatchSessionInput,
	signal: AbortSignal
): Promise<SessionPreview> {
	const result = await runDryRun<WireSessionChangePreview>(`/api/sessions/${id}`, {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: JSON.stringify({ ...input, dryRun: true }),
		signal
	});
	return result.ok ? toSessionPreview(result.body) : rejectedSessionPreview(result.rejection);
}

/**
 * `DELETE /api/sessions/{id}` carries no body, so its dry-run flags travel as query
 * parameters (`deleteSessionQuery`, `.strict()`, snake_case): `dry_run` is always
 * `true` here, and `preview_token` is present only when the caller already holds one
 * — the first dry run seeding a preview has none yet.
 */
export async function previewDeleteSession(
	id: string,
	previewToken: string | null,
	signal: AbortSignal
): Promise<SessionPreview> {
	const params = new URLSearchParams({ dry_run: 'true' });
	if (previewToken !== null) params.set('preview_token', previewToken);
	const result = await runDryRun<WireSessionChangePreview>(
		`/api/sessions/${id}?${params.toString()}`,
		{ method: 'DELETE', signal }
	);
	return result.ok ? toSessionPreview(result.body) : rejectedSessionPreview(result.rejection);
}
