# Requirements Document

## Introduction

Worklog records how the user spends a working day. It is a single SvelteKit application at `worklog/`; this specification covers its **server-side half** — the domain logic, the PostgreSQL data layer and the REST API under `/api`. The browser interface that consumes it is specified separately in `002-worklog-ui`.

The server side is the single source of truth for two independent kinds of data that are reconciled against each other.

The first kind is the **timer frame**: during the day the user only presses play and stop. Each play/stop pair produces a `Work_Session` — a contiguous interval during which the user was actually working. Everything between two sessions is a break (lunch, snack, end of the day), and the server never needs to be told what a break was for.

The second kind is the **activity log**: at the end of the day, or the next morning, the user says what they were doing and on which project. This may arrive as an exact interval ("13:00–14:45 on project A"), as a bare duration ("two hours on project B"), or as nothing but a project, in which case the server records everything since the last entry ended. Activity data is always reconciled against the timer frame at write time, so a three-hour entry that spans a 15-minute break is stored as two intervals with the break preserved between them. An audit read a week later therefore shows the break, not three unbroken hours.

The server side also answers which parts of the tracked time already have an activity record and which do not, so the interface can highlight the day's unexplained stretches, and it can evaluate any write without performing it so the interface can show the consequence before the user commits to it.

The application is single-user and has no accounts. The browser authenticates with a session cookie established from a shared passphrase; external callers such as shell scripts or phone shortcuts authenticate with a static bearer token against the same endpoints.

## Glossary

- **Worklog_Server**: The server-side half of the SvelteKit application at `worklog/` — the domain logic in `src/lib/server/domain/`, the data layer in `src/lib/server/store/`, and the REST routes under `src/routes/api/`
- **Work_Session**: A contiguous interval during which the timer was running, produced by one play/stop pair. Has a start and an end; the end is absent while the timer is running.
- **Open_Session**: The single `Work_Session` whose end is absent, i.e. the timer is currently running
- **Stale_Session**: An `Open_Session` that has been running longer than `MAX_OPEN_SESSION_HOURS` — almost certainly a timer the user forgot to stop
- **Tracked_Time**: The union of all `Work_Session` intervals in a given range — the time the user was working
- **Untracked_Time**: Any time inside a queried range that is not part of `Tracked_Time` — breaks and non-working time
- **Activity_Entry**: One logical record submitted by the user, carrying a `Project`, a description, and the originally requested interval or duration
- **Activity_Segment**: A stored interval belonging to exactly one `Activity_Entry`. One `Activity_Entry` produces zero or more `Activity_Segment` records.
- **Orphaned_Entry**: An `Activity_Entry` holding no `Activity_Segment`, because reconciliation left nothing of it
- **Covered_Time**: The union of all `Activity_Segment` intervals in a given range — time for which the user has said what they were doing
- **Uncovered_Time**: `Tracked_Time` minus `Covered_Time` — time the user was working but has not yet described
- **Clipping**: The write-time operation that turns a requested interval or duration into `Activity_Segment` records aligned to `Tracked_Time`
- **Explicit_Mode**: Creating an `Activity_Entry` from a known start and end
- **Duration_Mode**: Creating an `Activity_Entry` from a duration of net worked time, with the start inferred
- **Open_Mode**: Creating an `Activity_Entry` from no times at all — the start is inferred like `Duration_Mode` and the end is the current time
- **Placement_Anchor**: The start inferred for a `Duration_Mode` or `Open_Mode` entry — the end of the latest `Activity_Segment` of the `Target_Day`, or the start of its earliest `Work_Session` when no segment exists
- **Target_Day**: The `Logical_Day` a `Duration_Mode` or `Open_Mode` request applies to — the `date` field of the request, defaulting to the current `Logical_Day`
- **Uncovered_Policy**: The caller-selected rule for what happens to the part of a request that falls outside `Tracked_Time` — one of `clip`, `extend`, `reject`
- **Project**: A named entity an `Activity_Entry` is attributed to
- **Logical_Day**: The day window used for grouping, running from `DAY_START_HOUR` on one calendar date to `DAY_START_HOUR` on the next, evaluated in `TIMEZONE`
- **Dry_Run**: A request that is validated and evaluated in full but writes nothing, returning the outcome the same write would have produced
- **Auth_Hook**: The SvelteKit `handle` hook in `src/hooks.server.ts` that authenticates every request before it reaches a route
- **Browser_Session**: The authenticated state of the browser, carried by an HttpOnly session cookie
- **API_Token**: The static bearer token used by non-browser callers such as shell scripts and phone shortcuts
- **Health_Endpoint**: The unauthenticated HTTP endpoint at `GET /api/health`

## Requirements

### Requirement 1: Timer Session Control

**User Story:** As a user tracking my work, I want to start and stop a timer from my client, so that the server knows which parts of the day I was actually working.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/sessions/start` and no `Open_Session` exists, THE Worklog_Server SHALL create a `Work_Session` with its start set to the current time and its end absent, and return HTTP 201 with the created `Work_Session`
2. IF a POST request is received at `/api/sessions/start` and an `Open_Session` already exists, THEN THE Worklog_Server SHALL return HTTP 409 with error code `SESSION_ALREADY_RUNNING` and SHALL NOT create a second `Work_Session`
3. WHEN a POST request is received at `/api/sessions/start` with an explicit `startedAt` value, THE Worklog_Server SHALL use that value instead of the current time
4. IF a POST request at `/api/sessions/start` would overlap an existing `Work_Session`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `SESSION_OVERLAP` and SHALL include the conflicting session identifiers in the error details
5. WHEN a POST request is received at `/api/sessions/stop` and an `Open_Session` exists, THE Worklog_Server SHALL set that session's end to the current time and return HTTP 200 with the closed `Work_Session`
6. IF a POST request is received at `/api/sessions/stop` and no `Open_Session` exists, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NO_SESSION_RUNNING`
7. WHEN a POST request is received at `/api/sessions/stop` with an explicit `endedAt` value, THE Worklog_Server SHALL use that value instead of the current time
8. WHEN a GET request is received at `/api/sessions/current`, THE Worklog_Server SHALL return HTTP 200 with the `Open_Session`, its elapsed duration in seconds and whether it is a `Stale_Session`, or with a null session when no `Open_Session` exists
9. THE Worklog_Server SHALL permit at most one `Open_Session` to exist at any time
10. WHEN an `Open_Session` has been running longer than `MAX_OPEN_SESSION_HOURS`, THE Worklog_Server SHALL report it as a `Stale_Session` in every response that carries it
11. THE Worklog_Server SHALL NOT close a `Stale_Session` on its own
12. WHILE a `Work_Session` is a `Stale_Session`, THE Worklog_Server SHALL exclude the part of it beyond `MAX_OPEN_SESSION_HOURS` from `Tracked_Time`, so an abandoned timer cannot inflate totals or `Uncovered_Time`
13. IF a `Work_Session` would be created or modified so that any part of it lies more than five minutes in the future, THEN THE Worklog_Server SHALL return HTTP 400 with error code `FUTURE_TIMESTAMP`
14. IF a `Work_Session` would be shorter than `MIN_INTERVAL_SECONDS`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `INTERVAL_TOO_SHORT`

### Requirement 2: Work Session Creation, Listing and Correction

**User Story:** As a user who forgot to start the timer before a meeting, I want to add, correct and delete recorded sessions, so that the timer frame matches what actually happened.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/sessions` with a start and an end, THE Worklog_Server SHALL create a closed `Work_Session` and return HTTP 201 with the created record
2. WHEN a GET request is received at `/api/sessions` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with all `Work_Session` records overlapping that range, ordered by start ascending
3. IF a GET request is received at `/api/sessions` without `from` and `to`, THEN THE Worklog_Server SHALL default the range to the current `Logical_Day`
4. IF a range requested at `/api/sessions` spans more than 366 `Logical_Day` values, THEN THE Worklog_Server SHALL return HTTP 400 with error code `RANGE_TOO_LARGE`
5. WHEN a PATCH request is received at `/api/sessions/{id}` with a new start, a new end, or both, THE Worklog_Server SHALL update the `Work_Session` and return HTTP 200 with the updated record
6. IF a POST or PATCH request would produce a `Work_Session` whose start is not strictly before its end, THEN THE Worklog_Server SHALL return HTTP 400 with error code `INVALID_INTERVAL`
7. IF a POST or PATCH request would produce a `Work_Session` overlapping another `Work_Session`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `SESSION_OVERLAP` and SHALL include the conflicting session identifiers in the error details
8. WHEN a DELETE request is received at `/api/sessions/{id}`, THE Worklog_Server SHALL remove the `Work_Session` and return HTTP 204
9. WHEN a `Work_Session` is created, modified or deleted, THE Worklog_Server SHALL re-apply `Clipping` to every `Activity_Entry` holding an `Activity_Segment` that overlapped the affected interval, so that stored segments continue to match the new `Tracked_Time`
10. WHEN re-applying `Clipping` leaves an `Activity_Entry` with no `Activity_Segment`, THE Worklog_Server SHALL retain it as an `Orphaned_Entry` rather than deleting it

### Requirement 3: Project Management

**User Story:** As a user logging work, I want named projects, so that I can attribute each activity to one and later total my time per project.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/projects` with a name, THE Worklog_Server SHALL create a `Project` and return HTTP 201 with the created record
2. IF a POST request is received at `/api/projects` with a name that already exists, ignoring case and surrounding whitespace, THEN THE Worklog_Server SHALL return HTTP 409 with error code `PROJECT_EXISTS`
3. IF a POST or PATCH request is received at `/api/projects` with a name that is empty or longer than 200 characters, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
4. WHEN a GET request is received at `/api/projects`, THE Worklog_Server SHALL return HTTP 200 with all non-archived `Project` records ordered by name ascending
5. WHEN a GET request is received at `/api/projects` with `include_archived=true`, THE Worklog_Server SHALL additionally return archived `Project` records
6. WHEN a PATCH request is received at `/api/projects/{id}`, THE Worklog_Server SHALL update the name, the archived state, the colour index, or any combination of them, and return HTTP 200
7. IF a DELETE request is received at `/api/projects/{id}` and the `Project` is referenced by at least one `Activity_Entry`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `PROJECT_IN_USE` and SHALL include the identifiers of the referencing entries in the error details, so the caller can show which records block the deletion
8. WHEN a DELETE request is received at `/api/projects/{id}` and the `Project` is referenced by no `Activity_Entry`, THE Worklog_Server SHALL remove it and return HTTP 204
9. WHEN a `Project` is created, THE Worklog_Server SHALL assign it a colour index that is the lowest value not currently held by a non-archived `Project`, wrapping around when every value is taken
10. THE Worklog_Server SHALL keep a `Project` colour index unchanged when the project is renamed, archived or unarchived
11. WHEN a PATCH request at `/api/projects/{id}` supplies a colour index within range, THE Worklog_Server SHALL store it even when another `Project` already holds it

### Requirement 4: Activity Logging in Explicit Mode

**User Story:** As a user who remembers exactly when I did something, I want to log an activity with a precise start and end, so that the record matches reality.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/activities` with `startedAt`, `endedAt`, a `projectId` and a description, THE Worklog_Server SHALL create an `Activity_Entry` in `Explicit_Mode`, apply `Clipping`, and return HTTP 201 with the entry and its resulting `Activity_Segment` records
2. THE Worklog_Server SHALL store the originally requested start and end on the `Activity_Entry` unchanged, regardless of how `Clipping` alters the stored segments
3. IF a POST request at `/api/activities` supplies both an explicit end and a duration, THEN THE Worklog_Server SHALL return HTTP 400 with error code `AMBIGUOUS_MODE`
4. IF `startedAt` is not strictly before `endedAt`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `INVALID_INTERVAL`
5. IF the requested interval overlaps an `Activity_Segment` belonging to a different `Activity_Entry`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `ACTIVITY_OVERLAP` and SHALL include the conflicting entry identifiers, their project names, their descriptions and the overlapping intervals in the error details
6. IF `projectId` does not reference an existing `Project`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
7. IF `projectId` references an archived `Project`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `PROJECT_ARCHIVED`
8. IF the description is longer than 2000 characters, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
9. THE Worklog_Server SHALL accept an `Activity_Entry` whose description is empty
10. IF any part of a requested interval lies more than five minutes in the future, THEN THE Worklog_Server SHALL return HTTP 400 with error code `FUTURE_TIMESTAMP`

### Requirement 5: Activity Logging in Duration Mode

**User Story:** As a user who only remembers roughly how long something took, I want to log a bare duration, so that the server places it in the day for me without my having to reconstruct exact times.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/activities` with `durationMinutes`, a `projectId` and a description, and without `endedAt`, THE Worklog_Server SHALL create an `Activity_Entry` in `Duration_Mode`, apply `Clipping`, and return HTTP 201 with the entry and its resulting `Activity_Segment` records
2. WHEN a request carries a `date`, THE Worklog_Server SHALL use the `Logical_Day` it names as the `Target_Day`
3. IF a request carries no `date`, THEN THE Worklog_Server SHALL use the current `Logical_Day` as the `Target_Day`
4. IF `startedAt` is supplied together with `durationMinutes`, THEN THE Worklog_Server SHALL use that value as the placement start
5. IF `startedAt` is not supplied, THEN THE Worklog_Server SHALL use the end of the latest `Activity_Segment` within the `Target_Day` as the placement start
6. IF `startedAt` is not supplied and the `Target_Day` contains no `Activity_Segment`, THEN THE Worklog_Server SHALL use the start of the earliest `Work_Session` of that `Target_Day` as the placement start
7. IF `startedAt` is not supplied and the `Target_Day` contains neither an `Activity_Segment` nor a `Work_Session`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NO_PLACEMENT_ANCHOR`
8. WHEN placing a `Duration_Mode` entry, THE Worklog_Server SHALL advance forward from the placement start and consume only time that is part of `Tracked_Time` and is not already part of `Covered_Time`, until the requested duration is exhausted
9. THE Worklog_Server SHALL bound the forward search at the end of the `Target_Day`
10. THE Worklog_Server SHALL produce `Activity_Segment` records whose total duration equals `durationMinutes` whenever enough eligible time exists after the placement start
11. IF the eligible time after the placement start is shorter than `durationMinutes`, THEN THE Worklog_Server SHALL apply the `Uncovered_Policy` and SHALL report the unplaced remainder in minutes in the response
12. IF `durationMinutes` is not a positive integer, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`

### Requirement 6: Clipping Activity Entries to Tracked Time

**User Story:** As a user reviewing my history a week later, I want my breaks to remain visible inside long activity entries, so that the log shows when I was genuinely working rather than one unbroken block.

#### Acceptance Criteria

1. WHEN `Clipping` an `Activity_Entry`, THE Worklog_Server SHALL produce `Activity_Segment` records that are subsets of `Tracked_Time`
2. THE Worklog_Server SHALL NOT produce an `Activity_Segment` that overlaps `Untracked_Time`
3. WHEN a requested interval spans a break between two `Work_Session` records, THE Worklog_Server SHALL produce one `Activity_Segment` per overlapped `Work_Session` rather than a single spanning segment
4. THE Worklog_Server SHALL produce `Activity_Segment` records ordered by start ascending, with no two segments of the same `Activity_Entry` overlapping or touching
5. THE Worklog_Server SHALL discard any `Activity_Segment` shorter than `MIN_INTERVAL_SECONDS` and SHALL report it among the discarded intervals, so that unclickable slivers never reach the interface
6. WHEN the `Uncovered_Policy` is `clip`, THE Worklog_Server SHALL discard the parts of the request falling outside `Tracked_Time` and SHALL report the discarded intervals in the response
7. WHEN the `Uncovered_Policy` is `extend`, THE Worklog_Server SHALL create or lengthen `Work_Session` records so that the whole requested interval becomes part of `Tracked_Time`, and SHALL report the created or lengthened sessions in the response
8. THE Worklog_Server SHALL NOT create or lengthen a `Work_Session` into the future under any `Uncovered_Policy`
9. IF the `Uncovered_Policy` is `reject` and any part of the request falls outside `Tracked_Time`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `OUTSIDE_TRACKED_TIME` and SHALL create nothing
10. IF no `Uncovered_Policy` is supplied, THEN THE Worklog_Server SHALL use `clip`
11. THE Worklog_Server SHALL apply the whole write as a single database transaction, so that a rejected request leaves no `Activity_Entry`, no `Activity_Segment` and no modified `Work_Session` behind

### Requirement 7: Activity Listing, Modification and Deletion

**User Story:** As a user who mistyped an entry, I want to find, change or remove it, so that the log stays accurate without my having to rebuild the day.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/activities` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with every `Activity_Entry` holding at least one `Activity_Segment` overlapping that range, each with its segments, ordered by earliest segment start ascending
2. THE Worklog_Server SHALL additionally return every `Orphaned_Entry` whose requested interval overlaps the range, so that an entry reconciliation emptied remains reachable
3. THE Worklog_Server SHALL mark each returned entry as to whether it is an `Orphaned_Entry`
4. IF a GET request is received at `/api/activities` without `from` and `to`, THEN THE Worklog_Server SHALL default the range to the current `Logical_Day`
5. IF a range requested at `/api/activities` spans more than 366 `Logical_Day` values, THEN THE Worklog_Server SHALL return HTTP 400 with error code `RANGE_TOO_LARGE`
6. WHEN a GET request is received at `/api/activities` with a `project_id` query parameter, THE Worklog_Server SHALL return only entries attributed to that `Project`
7. WHEN a GET request is received at `/api/activities/{id}`, THE Worklog_Server SHALL return HTTP 200 with that `Activity_Entry` and its `Activity_Segment` records
8. WHEN a PATCH request is received at `/api/activities/{id}` changing the description or the `projectId`, THE Worklog_Server SHALL update the `Activity_Entry` without re-applying `Clipping`
9. WHEN a PATCH request is received at `/api/activities/{id}` changing the requested interval or duration, THE Worklog_Server SHALL replace all existing `Activity_Segment` records of that entry by re-applying `Clipping`
10. WHILE re-applying `Clipping` for a PATCH request, THE Worklog_Server SHALL ignore the entry's own existing `Activity_Segment` records when testing for overlap
11. WHEN a DELETE request is received at `/api/activities/{id}`, THE Worklog_Server SHALL remove the `Activity_Entry` together with all its `Activity_Segment` records and return HTTP 204

### Requirement 8: Day Overview

**User Story:** As a user opening the client, I want one call that returns everything about a day, so that the app can draw the whole timeline without stitching several responses together.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/days/{date}`, THE Worklog_Server SHALL return HTTP 200 with the `Logical_Day` boundaries, all `Work_Session` records overlapping that day, all `Activity_Entry` records with their `Activity_Segment` records, the `Uncovered_Time` intervals and the `Untracked_Time` intervals of that day
2. THE Worklog_Server SHALL return `Work_Session` and `Activity_Segment` records with their true, unclipped bounds, so the interface can show that a record continues beyond the day
3. THE Worklog_Server SHALL clamp every duration total and every coverage interval in the day response to the `Logical_Day` boundaries, so that a record crossing a boundary is counted once in each day for only the part belonging to it
4. THE Worklog_Server SHALL include in the day response the total `Tracked_Time` in seconds, the total `Covered_Time` in seconds and the total `Uncovered_Time` in seconds
5. THE Worklog_Server SHALL include in the day response a per-`Project` breakdown giving the total `Covered_Time` in seconds attributed to each `Project`, including archived projects that hold time in the range
6. THE Worklog_Server SHALL include in the day response every `Orphaned_Entry` whose requested interval overlaps the day
7. IF `{date}` is not a valid `YYYY-MM-DD` date, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
8. WHEN a GET request is received at `/api/days/{date}` for a day holding no records, THE Worklog_Server SHALL return HTTP 200 with empty collections and zero totals rather than HTTP 404
9. WHEN a GET request is received at `/api/days` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with one summary object per `Logical_Day` in the range, each carrying its date, the totals defined in criteria 4 and 5, and the number of `Work_Session` records that began in it
10. IF the range requested at `/api/days` spans more than 366 `Logical_Day` values, THEN THE Worklog_Server SHALL return HTTP 400 with error code `RANGE_TOO_LARGE`

### Requirement 9: Coverage and Gaps

**User Story:** As a user filling in the day's log, I want to know which stretches of tracked time still have no activity record, so that I can see what is left to describe.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/coverage` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with the `Tracked_Time` intervals, the `Covered_Time` intervals, the `Uncovered_Time` intervals and the `Untracked_Time` intervals of that range
2. THE Worklog_Server SHALL return each interval collection as a normalized list — sorted by start ascending, with adjacent and overlapping intervals merged
3. THE Worklog_Server SHALL guarantee that the returned `Covered_Time` and `Uncovered_Time` intervals together reconstruct exactly the returned `Tracked_Time` intervals
4. WHEN a GET request is received at `/api/coverage` with a `min_gap_seconds` query parameter, THE Worklog_Server SHALL omit `Uncovered_Time` intervals shorter than that value from the returned list while still counting them in the returned totals
5. IF a GET request is received at `/api/coverage` without `from` and `to`, THEN THE Worklog_Server SHALL default the range to the current `Logical_Day`
6. IF a range requested at `/api/coverage` spans more than 366 `Logical_Day` values, THEN THE Worklog_Server SHALL return HTTP 400 with error code `RANGE_TOO_LARGE`
7. IF `from` is not strictly before `to`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `INVALID_INTERVAL`

### Requirement 10: Logical Day and Time Zone Handling

**User Story:** As a user who sometimes works past midnight, I want late-night work to belong to the day it started, so that my day totals are not split in two.

#### Acceptance Criteria

1. THE Worklog_Server SHALL store every timestamp in UTC
2. THE Worklog_Server SHALL accept every timestamp in requests as an RFC 3339 string carrying an explicit offset, and SHALL reject a timestamp without an offset with HTTP 400 and error code `VALIDATION_ERROR`
3. THE Worklog_Server SHALL emit every timestamp in responses as an RFC 3339 string in UTC
4. THE Worklog_Server SHALL compute `Logical_Day` boundaries in the time zone named by the `TIMEZONE` environment variable, defaulting to `Europe/Prague`
5. THE Worklog_Server SHALL begin each `Logical_Day` at the hour given by the `DAY_START_HOUR` environment variable, defaulting to `3`
6. WHEN an instant falls between midnight and `DAY_START_HOUR`, THE Worklog_Server SHALL attribute it to the previous calendar date
7. THE Worklog_Server SHALL NOT split a `Work_Session` or an `Activity_Segment` that crosses a `Logical_Day` boundary, and SHALL attribute to each day only the part of it that falls inside that day
8. THE Worklog_Server SHALL expose the effective `TIMEZONE` and `DAY_START_HOUR` to clients, so the interface can render and parse wall-clock times in the same zone the server groups by
9. IF `TIMEZONE` does not name a loadable time zone or `DAY_START_HOUR` is outside the range 0 to 23, THEN THE Worklog_Server SHALL log an error and exit with a non-zero status at startup
10. THE Worklog_Server SHALL record the `TIMEZONE` and `DAY_START_HOUR` under which the data was created, and SHALL refuse to start when they differ from the configured values unless `ALLOW_DAY_BOUNDARY_CHANGE` is set, because changing them regroups history retroactively

### Requirement 11: Authentication

**User Story:** As the sole user of the application, I want the browser to stay logged in without holding a token it could leak, while scripts and phone shortcuts can still reach the same endpoints with a bearer token.

#### Acceptance Criteria

1. THE Auth_Hook SHALL authenticate every request except `GET /api/health` and the login route
2. WHEN a request carries a `Browser_Session` cookie that matches an unexpired stored session, THE Auth_Hook SHALL admit the request
3. WHEN a request carries an `Authorization: Bearer <token>` header equal to the `API_Token`, THE Auth_Hook SHALL admit the request
4. IF a request to a path under `/api` carries neither a valid `Browser_Session` nor a valid `API_Token`, THEN THE Auth_Hook SHALL return HTTP 401 with error code `UNAUTHORIZED`
5. IF a request to any other path carries no valid `Browser_Session`, THEN THE Auth_Hook SHALL redirect to the login route carrying the originally requested path, so the user returns to it after logging in
6. THE Worklog_Server SHALL store the login passphrase only as an argon2id hash, never in a form from which it can be recovered
7. THE Worklog_Server SHALL store a `Browser_Session` identifier only as a hash, so a leaked database cannot be used to impersonate a session
8. THE Auth_Hook SHALL compare the `API_Token` in constant time
9. THE Auth_Hook SHALL NOT write the `API_Token`, the login passphrase or the session identifier to the logs
10. WHEN the correct passphrase is submitted at the login route, THE Worklog_Server SHALL create a stored session and set a cookie carrying its identifier
11. THE Worklog_Server SHALL set the session cookie with `HttpOnly`, `SameSite=Strict`, an explicit `Path`, an explicit `Max-Age`, and `Secure` whenever `APP_ENV` is not `development`
12. IF the submitted passphrase is wrong, THEN THE Worklog_Server SHALL return a message that does not reveal whether any credential exists
13. IF more than 5 login attempts arrive from one client address within 15 minutes, THEN THE Worklog_Server SHALL reject further attempts with HTTP 429
14. WHEN the user logs out, THE Worklog_Server SHALL delete the stored session so the cookie can no longer authenticate
15. THE Worklog_Server SHALL delete stored sessions once they expire
16. IF `WORKLOG_API_TOKEN` is unset or shorter than 32 characters, or `WORKLOG_PASSPHRASE_HASH` is unset, THEN THE Worklog_Server SHALL log an error and refuse to start
17. THE Worklog_Server SHALL restrict cross-origin requests to the origins listed in the `CORS_ORIGINS` environment variable, and SHALL reject a wildcard value when `APP_ENV` is not `development`
18. THE Worklog_Server SHALL NOT accept a `Browser_Session` cookie on a cross-origin request, so that `SameSite=Strict` remains sufficient protection against cross-site request forgery

### Requirement 12: Validation, Errors and Rate Limiting

**User Story:** As a client developer, I want every failure to arrive in the same shape, so that I can handle errors in one place.

#### Acceptance Criteria

1. THE Worklog_Server SHALL name every field of a JSON request and response body in `camelCase`, and every query parameter in `snake_case`
2. WHEN any request fails, THE Worklog_Server SHALL return a JSON body containing an `error` string in UPPER_SNAKE_CASE, a human-readable English `message`, a `messageKey` naming the translation of that message, and an optional `details` object
3. THE Worklog_Server SHALL NOT include stack traces, SQL statements, filesystem paths or dependency versions in any response body
4. WHEN a request body is not valid JSON or carries an unknown field, THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
5. WHEN a path identifier does not reference an existing record, THE Worklog_Server SHALL return HTTP 404 with error code `NOT_FOUND`
6. THE Worklog_Server SHALL reject a request body larger than 1 MiB with HTTP 413 and error code `PAYLOAD_TOO_LARGE`
7. WHEN more than 120 requests arrive from one client address within 60 seconds, THE Worklog_Server SHALL return HTTP 429 with error code `RATE_LIMITED` and a `Retry-After` header
8. WHEN a POST request to `/api/activities` carries an `Idempotency-Key` header that a previous request already used, THE Worklog_Server SHALL return the original response without creating a second `Activity_Entry`
9. THE Worklog_Server SHALL retain an `Idempotency-Key` for at least 24 hours
10. THE Worklog_Server SHALL emit one structured JSON log line per request carrying `timestamp`, `level`, `message`, `requestId`, method, path, status and duration
11. THE Worklog_Server SHALL propagate an incoming `X-Request-Id` header as the `requestId`, and SHALL generate one when the header is absent
12. THE Worklog_Server SHALL set `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a directive denying framing on every response
13. THE Worklog_Server SHALL serve a `Content-Security-Policy` carrying neither `unsafe-inline` nor `unsafe-eval` when `APP_ENV` is not `development`

### Requirement 13: Operational Behavior

**User Story:** As the operator of the service, I want it to report its health and shut down cleanly, so that deployments cause no lost writes.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/health`, THE Health_Endpoint SHALL return HTTP 200 with a JSON body reporting status `ok`, the service version, the effective `TIMEZONE` and the effective `DAY_START_HOUR`
2. THE Health_Endpoint SHALL NOT require authentication
3. IF the database is unreachable, THEN THE Health_Endpoint SHALL return HTTP 503 with status `degraded`
4. IF the database is reachable but has unapplied migrations, THEN THE Health_Endpoint SHALL return HTTP 503 with status `degraded` and THE Worklog_Server SHALL refuse to serve any other route
5. WHEN the process receives SIGTERM or SIGINT, THE Worklog_Server SHALL stop accepting new connections, allow in-flight requests up to 30 seconds to finish, close the database pool and exit with status 0
6. THE Worklog_Server SHALL apply an explicit timeout to every database query, configurable via `DB_QUERY_TIMEOUT_SECONDS` and defaulting to 5
7. THE Worklog_Server SHALL set the `updatedAt` column of every record it modifies to the time of that modification
8. THE Worklog_Server SHALL read its configuration from environment variables and from a `.env` file when present, and SHALL exit with a non-zero status when a required variable is missing
9. THE Worklog_Server SHALL take its version from the `package.json` manifest, which is the single source of truth for it
10. THE Worklog_Server SHALL listen on the port given by the `PORT` environment variable, defaulting to `3000`

### Requirement 14: Dry Run

**User Story:** As a user about to shorten a timer session, I want to see what it will do to my logged activities before I save, so that I never lose recorded work by surprise.

#### Acceptance Criteria

1. WHEN a request to create or modify an `Activity_Entry` carries `dryRun` set to true, THE Worklog_Server SHALL evaluate it in full and return the outcome without writing anything
2. WHEN a request to create, modify or delete a `Work_Session` carries `dryRun` set to true, THE Worklog_Server SHALL return every `Activity_Entry` that would be re-clipped, each with its project name, its description, and its `Activity_Segment` records as they are now and as they would become
3. THE Worklog_Server SHALL return a `Dry_Run` response in the same shape and with the same HTTP status code as the corresponding write, with an added field marking it as a `Dry_Run`
4. THE Worklog_Server SHALL apply the same validation to a `Dry_Run` as to the corresponding write, and SHALL return the same error codes for the same reasons
5. THE Worklog_Server SHALL leave `Work_Session`, `Activity_Entry` and `Activity_Segment` records byte-identical after a `Dry_Run`
6. THE Worklog_Server SHALL report in every `Dry_Run` response the total duration in seconds that would be removed from existing `Activity_Segment` records
7. THE Worklog_Server SHALL include in a `Dry_Run` response a token identifying the state of the timer frame it was computed against
8. IF a write carries a `Dry_Run` token that no longer matches the current timer frame, THEN THE Worklog_Server SHALL return HTTP 409 with error code `STALE_PREVIEW`, so a preview cannot be confirmed after another device changed the frame
9. IF `dryRun` is absent from a request, THEN THE Worklog_Server SHALL perform the write

### Requirement 15: Activity Logging in Open Mode

**User Story:** As a user who has just finished something, I want to log it by naming the project and nothing else, so that a quick record costs one call and no arithmetic.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/activities` with a `projectId` and neither `endedAt` nor `durationMinutes`, THE Worklog_Server SHALL create an `Activity_Entry` in `Open_Mode`
2. WHEN creating an `Open_Mode` entry for the current `Logical_Day`, THE Worklog_Server SHALL use the `Placement_Anchor` as the start and the current time as the end
3. WHEN creating an `Open_Mode` entry for a `Target_Day` in the past, THE Worklog_Server SHALL use the `Placement_Anchor` as the start and the end of that day's last `Work_Session` as the end
4. IF `startedAt` is supplied in `Open_Mode`, THEN THE Worklog_Server SHALL use that value as the start instead of the `Placement_Anchor`
5. THE Worklog_Server SHALL apply `Clipping` to an `Open_Mode` entry exactly as it does to an `Explicit_Mode` entry
6. THE Worklog_Server SHALL record the resolved start and end as the requested interval of an `Open_Mode` entry, so the entry remains auditable
7. IF the resolved start is not strictly before the resolved end, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NOTHING_TO_LOG`
8. IF the `Target_Day` contains neither an `Activity_Segment` nor a `Work_Session`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NO_PLACEMENT_ANCHOR`
9. THE Worklog_Server SHALL support `dryRun` in `Open_Mode` on the same terms as the other modes
