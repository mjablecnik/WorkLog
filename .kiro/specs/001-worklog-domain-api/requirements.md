# Requirements Document

## Introduction

Worklog records how the user spends a working day. It is a single SvelteKit application at `worklog/`; this specification covers its **server-side half** — the domain logic, the PostgreSQL data layer and the REST API under `/api`. The browser interface that consumes it is specified separately in `002-worklog-ui`.

The server side is the single source of truth for two independent kinds of data that are reconciled against each other.

The first kind is the **timer frame**: during the day the user only presses play and stop. Each play/stop pair produces a `Work_Session` — a contiguous interval during which the user was actually working. Everything between two sessions is a break (lunch, snack, end of the day), and the server never needs to be told what a break was for.

The second kind is the **activity log**: at the end of the day, or the next morning, the user says what they were doing and on which project. This may arrive as an exact interval ("13:00–14:45 on project A"), as a bare duration ("two hours on project B"), or as nothing but a project, in which case the server records everything since the last entry ended. Activity data is always reconciled against the timer frame at write time, so a three-hour entry that spans a 15-minute break is stored as two intervals with the break preserved between them. An audit read a week later therefore shows the break, not three unbroken hours.

The server side also answers which parts of the tracked time already have an activity record and which do not, so the interface can highlight the day's unexplained stretches, and it can evaluate any write without performing it so the interface can show the consequence before the user commits to it.

The application is single-user and has no accounts. The browser authenticates with a session cookie established from a shared passphrase; external callers such as shell scripts or phone shortcuts authenticate with a static bearer token against the same endpoints.

The visual contract for the interface lives in `.design/DESIGN.md` and is the source of truth for how the data is shown. It matters here only where the server must supply something the drawing needs — the `Gauge_Window` and the `Gauge_Gap`, the per-day work intervals behind the day-rhythm strip, the `Evening_Hour` figure, and the eight `Project` colour slots.

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
- **Duration_Mode**: Creating an `Activity_Entry` from a duration of net worked time, with the start inferred and the interval it resolved to stored on the entry
- **Open_Mode**: Creating an `Activity_Entry` from no times at all — the start is inferred like `Duration_Mode` and the end is the current time
- **Placement_Anchor**: The start inferred for a `Duration_Mode` or `Open_Mode` entry — the end of the latest `Activity_Segment` of the `Target_Day`, or the start of its earliest `Work_Session` when no segment exists
- **Target_Day**: The `Logical_Day` a `Duration_Mode` or `Open_Mode` request applies to — the `date` field of the request, defaulting to the current `Logical_Day`. `Explicit_Mode` has none: the request states both bounds, and they are their own limit
- **Untracked_Policy**: The caller-selected rule for what happens to the part of a request that falls in `Untracked_Time`, outside the timer frame — one of `clip`, `extend`, `reject`. It is named after the set it governs; `Uncovered_Time` is a different set and no policy applies to it.
- **Project**: A named entity an `Activity_Entry` is attributed to
- **Logical_Day**: The day window used for grouping, running from `DAY_START_HOUR` on one calendar date to `DAY_START_HOUR` on the next, evaluated in `TIMEZONE`
- **Gauge_Window**: The stretch of the day the interface draws as its expected working hours, given by `GAUGE_START` and `GAUGE_END`. It is a pair of wall-clock times, not a pair of instants — it means the same hours on every date.
- **Gauge_Gap**: The remainder of the 24-hour clock outside the `Gauge_Window` — with the defaults, `00:00`–`06:00`
- **Overtime**: `Tracked_Time` falling outside the `Gauge_Window`
- **Evening_Hour**: The wall-clock hour after which `Tracked_Time` is additionally counted, given by `EVENING_HOUR`
- **Day_Boundary_Config**: The single stored row recording the `TIMEZONE` and `DAY_START_HOUR` the data was created under
- **Dry_Run**: A request that is validated and evaluated in full but writes nothing, returning the outcome the same write would have produced
- **Preview_Token**: The fingerprint of the stored rows a `Dry_Run` was computed against, carried back on the confirming write
- **Fixed_Constant**: A value the specification fixes rather than exposing as configuration — `MAX_RANGE_DAYS`, `MAX_INTERVAL_RANGE_DAYS`, `ACTIVITY_PAGE_SIZE`, `ERROR_DETAIL_SAMPLE_SIZE`, `FUTURE_TOLERANCE_SECONDS`, `SUGGESTED_WINDOW_COVERAGE`, `CLEANUP_INTERVAL_MINUTES`, `SERVICE_RETRY_AFTER_SECONDS`, `LOGIN_ATTEMPT_LIMIT`, `LOGIN_ATTEMPT_WINDOW_MINUTES` and `IDEMPOTENCY_RETENTION_HOURS`. All eleven are declared once, in `src/lib/server/core/config.ts`, with the values given in the design's Fixed Constants table.
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
13. IF a `Work_Session` would be created or modified so that any part of it lies further into the future than `FUTURE_TOLERANCE_SECONDS`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `FUTURE_TIMESTAMP`
14. IF a `Work_Session` would be created or modified so that it is shorter than `MIN_INTERVAL_SECONDS`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `INTERVAL_TOO_SHORT`
15. WHEN testing a `Work_Session` write for overlap, THE Worklog_Server SHALL treat an `Open_Session` as occupying the interval from its start to the current time, **uncapped**, and SHALL reject a write overlapping it with HTTP 409 and error code `SESSION_OVERLAP`, because the cap of criterion 12 removes the tail from `Tracked_Time` for **totalling only** — the row still exists, and stopping the timer will claim that whole span. A write admitted into the tail makes the following stop fail on the overlap constraint with no way out but deleting a record the user did not know was there.
16. THE Worklog_Server SHALL perform the overlap test of criterion 15 inside the same transaction as the write it guards, because the database cannot express an exclusion constraint over a session whose end is absent
17. THE Worklog_Server SHALL report the elapsed duration of an `Open_Session` as the true time since its start, uncapped, even for a `Stale_Session`, because the interface shows that figure as the running clock and a capped value would be a lie; only its contribution to `Tracked_Time` is capped by criterion 12
18. WHEN a POST request at `/api/sessions/stop` would close an `Open_Session` shorter than `MIN_INTERVAL_SECONDS`, THE Worklog_Server SHALL delete that `Work_Session` instead of storing it, SHALL return HTTP 200 reporting that it did so, and SHALL NOT return an error, because a timer the user has started must always be stoppable and a twenty-second session records nothing worth keeping

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
9. WHEN a `Work_Session` is created, modified or deleted, THE Worklog_Server SHALL re-apply `Clipping` to every `Activity_Entry` whose `Activity_Segment` records overlap the affected intervals **or** whose requested interval overlaps them, so that an entry an earlier change emptied is reconsidered when the time it asked for becomes tracked again
10. WHEN re-applying `Clipping` leaves an `Activity_Entry` with no `Activity_Segment`, THE Worklog_Server SHALL retain it as an `Orphaned_Entry` rather than deleting it
11. WHEN re-applying `Clipping` to an `Activity_Entry` created in `Duration_Mode`, THE Worklog_Server SHALL treat its stored requested interval as an `Explicit_Mode` request and SHALL NOT resolve a `Placement_Anchor` again, so that a frame change never moves an entry to a different part of the day
12. WHEN a single request both lengthens `Tracked_Time` and creates an `Activity_Entry`, THE Worklog_Server SHALL create the `Work_Session` first, re-apply `Clipping` to the affected entries second, and place the new `Activity_Entry` last, so that an entry the extension rescues claims its time before the new one does

### Requirement 3: Project Management

**User Story:** As a user logging work, I want named projects, so that I can attribute each activity to one and later total my time per project.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/projects` with a name, THE Worklog_Server SHALL create a `Project` and return HTTP 201 with the created record
2. IF a POST request is received at `/api/projects` with a name that already exists, ignoring case and surrounding whitespace, THEN THE Worklog_Server SHALL return HTTP 409 with error code `PROJECT_EXISTS`
3. IF a POST or PATCH request is received at `/api/projects` with a name that is empty or longer than 200 characters, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
4. WHEN a GET request is received at `/api/projects`, THE Worklog_Server SHALL return HTTP 200 with all non-archived `Project` records ordered by name ascending
5. WHEN a GET request is received at `/api/projects` with `include_archived=true`, THE Worklog_Server SHALL additionally return archived `Project` records
6. WHEN a PATCH request is received at `/api/projects/{id}`, THE Worklog_Server SHALL update the name, the archived state, the colour index, or any combination of them, and return HTTP 200
7. IF a DELETE request is received at `/api/projects/{id}` and the `Project` is referenced by at least one `Activity_Entry`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `PROJECT_IN_USE`, SHALL include in the error details the total number of referencing entries and, for at most `ERROR_DETAIL_SAMPLE_SIZE` of them, the identifier, the description and the requested interval, so the caller can name which records block the deletion without fetching them
8. WHEN a DELETE request is received at `/api/projects/{id}` and the `Project` is referenced by no `Activity_Entry`, THE Worklog_Server SHALL remove it and return HTTP 204
9. WHEN a `Project` is created and at least one colour index is not held by a non-archived `Project`, THE Worklog_Server SHALL assign the lowest such index
10. THE Worklog_Server SHALL keep a `Project` colour index unchanged when the project is renamed, archived or unarchived
11. WHEN a PATCH request at `/api/projects/{id}` supplies a colour index within range, THE Worklog_Server SHALL store it even when another `Project` already holds it
12. IF every colour index is already held by a non-archived `Project` when one is created, THEN THE Worklog_Server SHALL assign the index held by the fewest non-archived `Project` records, choosing the lowest such index when several are tied, so the assignment stays deterministic

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
10. IF any part of a requested interval lies further into the future than `FUTURE_TOLERANCE_SECONDS`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `FUTURE_TIMESTAMP`
11. IF `endedAt` is supplied without `startedAt`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`, because `Explicit_Mode` has no rule for inferring a start

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
11. IF the eligible time after the placement start is shorter than `durationMinutes`, THEN THE Worklog_Server SHALL apply the `Untracked_Policy` and SHALL report the unplaced remainder in minutes in the response
12. IF `durationMinutes` is not a positive integer, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
13. THE Worklog_Server SHALL record the resolved start and end of a `Duration_Mode` entry as its requested interval, alongside the requested duration, so the entry can be ordered, re-placed after a later frame change, and found again when reconciliation empties it
14. WHEN `Clipping` discards a produced interval for being shorter than `MIN_INTERVAL_SECONDS`, THE Worklog_Server SHALL add its duration to the unplaced remainder reported in the response, so that placed time plus unplaced time always equals the requested duration
15. THE Worklog_Server SHALL NOT produce an `Activity_Segment` shorter than `MIN_INTERVAL_SECONDS` while walking forward, and SHALL report time it therefore leaves unplaced, so that the walk cannot end in a sliver it must immediately throw away
16. THE Worklog_Server SHALL report the resolved `Placement_Anchor` and how it was arrived at in every successful response that used one, not only in the details of a failure, so that a `Dry_Run` can name where the entry will start before the user commits to it

### Requirement 6: Clipping Activity Entries to Tracked Time

**User Story:** As a user reviewing my history a week later, I want my breaks to remain visible inside long activity entries, so that the log shows when I was genuinely working rather than one unbroken block.

#### Acceptance Criteria

1. WHEN `Clipping` an `Activity_Entry`, THE Worklog_Server SHALL produce `Activity_Segment` records that are subsets of `Tracked_Time`
2. THE Worklog_Server SHALL NOT produce an `Activity_Segment` that overlaps `Untracked_Time`
3. WHEN a requested interval spans a break between two `Work_Session` records, THE Worklog_Server SHALL produce one `Activity_Segment` per overlapped `Work_Session` rather than a single spanning segment
4. THE Worklog_Server SHALL produce `Activity_Segment` records ordered by start ascending, with no two segments of the same `Activity_Entry` overlapping or touching
5. THE Worklog_Server SHALL discard any `Activity_Segment` shorter than `MIN_INTERVAL_SECONDS` and SHALL report it separately from the parts falling outside `Tracked_Time`, so that unclickable slivers never reach the interface and a caller can tell the two kinds of loss apart
6. WHEN the `Untracked_Policy` is `clip`, THE Worklog_Server SHALL discard the parts of the request falling outside `Tracked_Time` and SHALL report the discarded intervals in the response
7. WHEN the `Untracked_Policy` is `extend`, THE Worklog_Server SHALL create or lengthen `Work_Session` records so that as much of the request as it may lawfully cover becomes part of `Tracked_Time`, and SHALL report the created or lengthened sessions in the response
8. THE Worklog_Server SHALL NOT create or lengthen a `Work_Session` into the future under any `Untracked_Policy`
9. IF the `Untracked_Policy` is `reject` and any part of the request falls outside `Tracked_Time`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `OUTSIDE_TRACKED_TIME` and SHALL create nothing. In `Duration_Mode` this condition can never hold — a duration states no interval, so no part of the request lies anywhere until the walk places it — and THE Worklog_Server SHALL there treat `reject` exactly as `clip`, reporting any shortfall as the unplaced remainder. A remainder left by eligible time running out, by time already being `Covered_Time`, or by the `MIN_INTERVAL_SECONDS` floor is not `Untracked_Time`, and `Untracked_Time` is the only set this policy governs. `extend` keeps its full meaning in `Duration_Mode`; only `reject` has nothing to act on
10. IF no `Untracked_Policy` is supplied, THEN THE Worklog_Server SHALL use `clip`
11. THE Worklog_Server SHALL apply the whole write as a single database transaction, so that a rejected request leaves no `Activity_Entry`, no `Activity_Segment` and no modified `Work_Session` behind
12. IF `Clipping` would produce no `Activity_Segment` at all, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NOTHING_TO_LOG` and SHALL create nothing, in every mode, so that a write never immediately produces an `Orphaned_Entry`
13. THE Worklog_Server SHALL NOT lengthen or create a `Work_Session` under the `extend` policy outside the time the request itself asks for: in `Explicit_Mode` that is the requested interval, whose two stated bounds are their own limit; in `Duration_Mode` and `Open_Mode`, which state no interval, it is the `Target_Day`. One rule — `extend` never manufactures `Tracked_Time` the request did not reach for — expressed against whatever bound the mode actually has
14. IF an interval the `extend` policy would create overlaps an existing `Work_Session`, THEN THE Worklog_Server SHALL leave that interval uncreated and SHALL report the corresponding time as unplaced rather than failing the request
15. THE Worklog_Server SHALL reduce the unplaced remainder only by the time the `extend` policy actually placed, so that time refused by criteria 8, 13 or 14 is reported rather than silently lost
16. THE Worklog_Server SHALL report an unplaced remainder of zero in `Explicit_Mode` and `Open_Mode`, because in those modes time removed by an `Untracked_Policy` is reported as discarded and time below `MIN_INTERVAL_SECONDS` as a sliver
17. IF the `extend` policy would create a `Work_Session` shorter than `MIN_INTERVAL_SECONDS`, THEN THE Worklog_Server SHALL not create it and SHALL report that time as unplaced, so that no stored session is shorter than the floor
18. THE Worklog_Server SHALL NOT create or lengthen a `Work_Session` under the `extend` policy inside the span of an `Open_Session`, taking that span uncapped as criterion 1.15 does, and SHALL report the corresponding time as unplaced. Criterion 1.12 removes a `Stale_Session`'s tail from `Tracked_Time`, which would otherwise make it look like ordinary untracked time for `extend` to fill — and filling it writes a closed session inside a row that is still running

### Requirement 7: Activity Listing, Modification and Deletion

**User Story:** As a user who mistyped an entry, I want to find, change or remove it, so that the log stays accurate without my having to rebuild the day.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/activities` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with every `Activity_Entry` holding at least one `Activity_Segment` overlapping that range, each with its segments, ordered by requested start ascending, then by creation time, then by identifier — one total order that an `Orphaned_Entry` also has a key in
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
12. IF a PATCH request at `/api/activities/{id}` sets a `projectId` referencing an archived `Project`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `PROJECT_ARCHIVED`
13. THE Worklog_Server SHALL return at most `ACTIVITY_PAGE_SIZE` entries from `/api/activities` in one response, together with a cursor for the next page whenever more entries match, so that a year-long query cannot return an unbounded body
14. WHEN a GET request at `/api/activities` carries a `cursor` query parameter, THE Worklog_Server SHALL continue the listing from it in the order of criterion 1
15. THE Worklog_Server SHALL return with every `Activity_Entry` the name and the colour index of its `Project`, so that a caller never has to fetch the project list and join it itself to draw the entry
16. WHEN a PATCH request at `/api/activities/{id}` supplies a new interval for an `Orphaned_Entry`, THE Worklog_Server SHALL accept it on the same terms as for any other `Activity_Entry`, because rewriting the time of an entry reconciliation emptied is the only way to recover it
17. WHEN a PATCH request at `/api/activities/{id}` supplies both a start and an end, THE Worklog_Server SHALL replace the entry's requested interval with them, SHALL clear the requested duration, and SHALL set the entry's mode to `Explicit_Mode`, because the times are now stated rather than inferred
18. WHEN a PATCH re-applying `Clipping` produces at least one `Activity_Segment` for an `Orphaned_Entry`, THE Worklog_Server SHALL report the entry as no longer orphaned
19. IF a PATCH re-applying `Clipping` produces no `Activity_Segment`, THEN THE Worklog_Server SHALL return HTTP 409 with error code `NOTHING_TO_LOG` and SHALL leave the `Activity_Entry` exactly as it was, so a failed rescue attempt never destroys the record it was trying to save
20. IF a PATCH at `/api/activities/{id}` supplies one of `startedAt` and `endedAt` without the other, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
21. IF a PATCH at `/api/activities/{id}` supplies `durationMinutes` without a `date`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`, because the `Target_Day` a duration is placed in cannot be guessed from the entry being replaced
22. WHILE re-applying `Clipping` for a PATCH, THE Worklog_Server SHALL ignore the entry's own `Activity_Segment` records when resolving the `Placement_Anchor` as well as when testing for overlap, so that an entry cannot block or displace itself
23. WHEN a GET request at `/api/activities` carries `order=desc`, THE Worklog_Server SHALL reverse the order of criterion 1, so that the most recent entries can be fetched without reading the whole range
24. WHEN a GET request at `/api/activities` carries `limit`, THE Worklog_Server SHALL return at most that many entries, capped at `ACTIVITY_PAGE_SIZE`
25. IF a PATCH at `/api/activities/{id}` supplies both `endedAt` and `durationMinutes`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `AMBIGUOUS_MODE`, exactly as a create does, because the two name different modes and an entry can only be in one — without this, criteria 17 and 9 prescribe opposite things for the same request
26. WHEN a PATCH at `/api/activities/{id}` supplies `durationMinutes` with the `date` criterion 21 requires, THE Worklog_Server SHALL set the entry's mode to `Duration_Mode`, SHALL resolve the `Placement_Anchor` within that `Target_Day` by the rules of criteria 5.5 to 5.7 and 22, SHALL walk the duration forward as a create in `Duration_Mode` does, and SHALL replace the entry's requested interval with the one the walk resolved to and its requested duration with the value supplied

### Requirement 8: Day Overview

**User Story:** As a user opening the client, I want one call that returns everything about a day, so that the app can draw the whole timeline without stitching several responses together.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/days/{date}`, THE Worklog_Server SHALL return HTTP 200 with the `Logical_Day` boundaries, all `Work_Session` records overlapping that day, all `Activity_Entry` records with their `Activity_Segment` records, the `Uncovered_Time` intervals and the `Untracked_Time` intervals of that day
2. THE Worklog_Server SHALL return `Work_Session` and `Activity_Segment` records with their true, unclipped bounds, so the interface can show that a record continues beyond the day
3. THE Worklog_Server SHALL clamp every duration total and every coverage interval in the day response to the `Logical_Day` boundaries, so that a record crossing a boundary is counted once in each day for only the part belonging to it
4. THE Worklog_Server SHALL include in the day response the total `Tracked_Time` in seconds, the total `Covered_Time` in seconds and the total `Uncovered_Time` in seconds
5. THE Worklog_Server SHALL include in the day response a per-`Project` breakdown giving, for each `Project`, its identifier, its name, its colour index and the total `Covered_Time` in seconds attributed to it, including archived projects that hold time in the range
6. THE Worklog_Server SHALL include in the day response every `Orphaned_Entry` whose requested interval overlaps the day
7. IF `{date}` is not a valid `YYYY-MM-DD` date, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
8. WHEN a GET request is received at `/api/days/{date}` for a day holding no records, THE Worklog_Server SHALL return HTTP 200 with empty collections and zero totals rather than HTTP 404
9. WHEN a GET request is received at `/api/days` with `from` and `to` query parameters, THE Worklog_Server SHALL return HTTP 200 with one summary object per `Logical_Day` in the range, each carrying its date, the totals defined in criteria 4 and 5, and the number of `Work_Session` rows that began in it — a count of records, not of uninterrupted stretches
10. IF the range requested at `/api/days` spans more than 366 `Logical_Day` values, THEN THE Worklog_Server SHALL return HTTP 400 with error code `RANGE_TOO_LARGE`
11. THE Worklog_Server SHALL include in every day summary the duration of the longest uninterrupted stretch of `Tracked_Time` in that day, measured after merging sessions that touch, so that two adjacent `Work_Session` rows count as the one block of work they are
12. THE Worklog_Server SHALL include in every day summary the amount of `Tracked_Time` that falls outside the `Gauge_Window`, so the interface can report overtime
13. THE Worklog_Server SHALL include in a multi-day response the shortest window on the 24-hour clock, expressed as two times of day and permitted to run past midnight, that contains at least `SUGGESTED_WINDOW_COVERAGE` of the range's `Tracked_Time`, so the interface can suggest a `Gauge_Window` fitted to real habits
14. THE Worklog_Server SHALL expose the configured `GAUGE_START` and `GAUGE_END` to clients
15. WHEN a GET request at `/api/days` carries `include=intervals`, THE Worklog_Server SHALL include in every day summary the `Tracked_Time` intervals of that `Logical_Day`, clamped to its boundaries, so the interface can show where in the day the work fell and not only how much of it there was
16. WHEN a GET request at `/api/days` carries `include=intervals`, THE Worklog_Server SHALL additionally include in every day summary the `Covered_Time` intervals of that `Logical_Day`, clamped to its boundaries, each carrying the identifier of the `Project` it is attributed to, so each stretch can be drawn in that project's colour
17. WHEN a GET request at `/api/days` carries `include=intervals`, THE Worklog_Server SHALL additionally include in every day summary the `Uncovered_Time` intervals of that `Logical_Day`, clamped to its boundaries, so undescribed stretches are drawn from returned data rather than derived by the caller
18. IF a GET request at `/api/days` carries `include=intervals` for a range longer than `MAX_INTERVAL_RANGE_DAYS`, THEN THE Worklog_Server SHALL return HTTP 200 carrying the summaries, SHALL omit every interval collection, and SHALL report in the response body that it omitted them — a range that long is unreadable drawn as a rhythm strip, so the intervals have no reason to travel and a statistics page over a year SHALL NOT fail
19. THE Worklog_Server SHALL include in every day summary the amount of `Tracked_Time` falling after the `Evening_Hour` of that `Logical_Day`, taking that instant to be the first occurrence of that wall-clock hour at or after the day's start
20. IF a GET request is received at `/api/days` without `from` and `to`, THEN THE Worklog_Server SHALL default the range to the current `Logical_Day`, as the other range routes do
21. IF the range holds no `Work_Session`, or if no window on the 24-hour clock satisfies both criterion 13 and criterion 22, THEN THE Worklog_Server SHALL report no suggested window at all rather than one that fails either test — for a habitual 22:00–04:00 worker under `DAY_START_HOUR=3` no such window exists, and that is a normal answer
22. THE Worklog_Server SHALL report a suggested window that would itself satisfy the startup checks of Requirements 13.12, 13.15 and 13.22, so the interface never offers a `Gauge_Window` the server would refuse to start with
23. IF a GET request at `/api/days` does not carry `include=intervals`, THEN THE Worklog_Server SHALL omit every interval collection and return the summaries alone
24. THE Worklog_Server SHALL include in the single-day response the same session count, longest uninterrupted stretch and post-`Evening_Hour` total that criteria 9, 11 and 19 give a day summary, so that the day page never has to call a second endpoint to fill its panels
25. THE Worklog_Server SHALL include in the single-day response the interval an `Open_Mode` write would record at that moment, resolved by exactly the rules of Requirement 15 — `Placement_Anchor` to the current time for the current `Logical_Day`, and `Placement_Anchor` to the end of that day's last `Work_Session` for a day in the past — so the control names the same interval that pressing it records
26. THE Worklog_Server SHALL include with that interval the identifier, the name and the colour index of the `Project` a one-touch write would attribute it to: the `Project` of the most recent `Activity_Entry` of the day being viewed, or of the most recent `Activity_Entry` of any day when that day has none
27. IF no `Activity_Entry` exists at all, or the day holds neither an `Activity_Segment` nor a `Work_Session`, THEN THE Worklog_Server SHALL report the whole quick-log offer as absent, because a one-touch write needs a `Project` and has no way to invent one

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
8. THE Worklog_Server SHALL include in the coverage response the total seconds of `Tracked_Time`, `Covered_Time`, `Uncovered_Time` and `Untracked_Time` in the range, so a filtered list still reports the full amount
9. IF `min_gap_seconds` is absent, THEN THE Worklog_Server SHALL use `0` and omit nothing

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
10. THE Worklog_Server SHALL record the `TIMEZONE` and `DAY_START_HOUR` under which the data was created as the `Day_Boundary_Config`, and SHALL refuse to start when they differ from the configured values unless `ALLOW_DAY_BOUNDARY_CHANGE` is set, because changing them regroups history retroactively
11. IF no `Day_Boundary_Config` exists at startup, THEN THE Worklog_Server SHALL write it from the configured `TIMEZONE` and `DAY_START_HOUR` before serving any request, so the check of criterion 10 has something to compare against from the first run onwards
12. WHEN `ALLOW_DAY_BOUNDARY_CHANGE` is set and the `Day_Boundary_Config` differs from the configured values, THE Worklog_Server SHALL overwrite it with the configured values and log the change at warning level
13. IF the hour named by `DAY_START_HOUR` fails to exist or is ambiguous on any date in `TIMEZONE`, THEN THE Worklog_Server SHALL log an error and refuse to start, because a day boundary that occurs twice or not at all cannot partition the timeline
14. THE Worklog_Server SHALL resolve an ambiguous wall-clock time to the same side of the transition everywhere it computes a `Logical_Day`, so that a boundary and the day it belongs to can never disagree
15. THE Worklog_Server SHALL interpret every `from`–`to` query as the half-open instant range `[from, to)`, and SHALL include a `Logical_Day` in a per-day response exactly when its window intersects that range, so that a `to` falling on a day boundary does not add an empty trailing day
16. THE Worklog_Server SHALL count a range's length in `Logical_Day` values by that same rule when enforcing `MAX_RANGE_DAYS` and `MAX_INTERVAL_RANGE_DAYS`
17. THE Worklog_Server SHALL make the current `Logical_Day` and its boundaries available to every server-rendered page, recomputed for each request, so that the interface never derives them and a page rendered after midnight is never stale
18. IF a range request supplies one of `from` and `to` without the other, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`, because a half-stated range reads as two different ranges to two readers

### Requirement 11: Authentication

**User Story:** As the sole user of the application, I want the browser to stay logged in without holding a token it could leak, while scripts and phone shortcuts can still reach the same endpoints with a bearer token.

#### Acceptance Criteria

1. THE Auth_Hook SHALL authenticate every request except `GET /api/health`, the login route, a CORS preflight, and the static assets the framework serves, so that the login page renders with its stylesheet and hydrates
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
13. IF more login attempts arrive from one client address within `LOGIN_ATTEMPT_WINDOW_MINUTES` than `LOGIN_ATTEMPT_LIMIT` permits, THEN THE Worklog_Server SHALL reject further attempts with HTTP 429, and THE Worklog_Server SHALL NOT expose this limit as configuration, because a deployment must not be able to weaken it
14. WHEN the user logs out, THE Worklog_Server SHALL delete the stored session so the cookie can no longer authenticate
15. THE Worklog_Server SHALL delete stored sessions once they expire
16. IF `WORKLOG_API_TOKEN` is unset or shorter than 32 characters, or `WORKLOG_PASSPHRASE_HASH` is unset, THEN THE Worklog_Server SHALL log an error and refuse to start
17. THE Worklog_Server SHALL restrict cross-origin requests to the origins listed in the `CORS_ORIGINS` environment variable, and SHALL reject a wildcard value when `APP_ENV` is not `development`
18. THE Worklog_Server SHALL NOT accept a `Browser_Session` cookie on a cross-origin request, so that `SameSite=Strict` remains sufficient protection against cross-site request forgery
19. WHEN a CORS preflight `OPTIONS` request is received, THE Worklog_Server SHALL answer it before authentication runs, so a preflight is never met with HTTP 401
20. THE Worklog_Server SHALL derive the client address used for rate limiting by discarding exactly `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For` and taking the next one, and SHALL use the socket address when `TRUSTED_PROXY_HOPS` is zero or the header is absent, so that a caller cannot choose its own identity by prepending addresses
21. THE Worklog_Server SHALL delete expired `Browser_Session` records on a sweep running every `CLEANUP_INTERVAL_MINUTES` as well as when one is presented, so a session nobody returns to does not outlive its expiry
22. WHEN redirecting after a successful login, THE Worklog_Server SHALL accept only a local path — one beginning with a single `/` and not with `//` — and SHALL redirect to the application root otherwise
23. THE Worklog_Server SHALL read `CORS_ORIGINS` as a comma-separated list of origins with no surrounding whitespace, and SHALL match an `Origin` against it exactly, scheme, host and port together
24. WHEN answering a CORS preflight, THE Worklog_Server SHALL return `Access-Control-Allow-Origin` naming the matched origin, `Access-Control-Allow-Methods` listing `GET, POST, PATCH, DELETE, OPTIONS`, `Access-Control-Allow-Headers` listing at least `Authorization, Content-Type, Idempotency-Key, X-Request-Id`, `Access-Control-Max-Age` of 600 seconds, and `Access-Control-Allow-Credentials: false`, since a cross-origin caller authenticates with the `API_Token` and never with the `Browser_Session`
25. THE Worklog_Server SHALL accept the login passphrase in a form field named `passphrase`, SHALL take the post-login destination from a `next` query parameter, and SHALL accept a `reason` query parameter whose value `session_expired` states why the login page was reached
26. THE Worklog_Server SHALL exempt `GET /api/health` from rate limiting, because a platform health check polls it from one address at a fixed interval and would otherwise exhaust the bucket
27. THE Worklog_Server SHALL expire a `Browser_Session` `SESSION_DURATION_HOURS` after it was created, and SHALL NOT extend it on use, so that a session has one absolute lifetime

### Requirement 12: Validation, Errors and Rate Limiting

**User Story:** As a client developer, I want every failure to arrive in the same shape, so that I can handle errors in one place.

#### Acceptance Criteria

1. THE Worklog_Server SHALL name every field of a JSON request and response body in `camelCase`, and every query parameter in `snake_case`
2. WHEN any request fails, THE Worklog_Server SHALL return a JSON body containing an `error` string in UPPER_SNAKE_CASE, a human-readable English `message`, a `messageKey` naming the translation of that message, the `requestId` of the request, and an optional `details` object
3. THE Worklog_Server SHALL NOT include stack traces, SQL statements, filesystem paths or dependency versions in any response body
4. WHEN a request body is not valid JSON or carries an unknown field, THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
5. WHEN a path identifier does not reference an existing record, THE Worklog_Server SHALL return HTTP 404 with error code `NOT_FOUND`
6. THE Worklog_Server SHALL reject a request body larger than 1 MiB with HTTP 413 and error code `PAYLOAD_TOO_LARGE`
7. WHEN more requests arrive from one client address within 60 seconds than `RATE_LIMIT_PER_MINUTE` permits, THE Worklog_Server SHALL return HTTP 429 with error code `RATE_LIMITED` and a `Retry-After` header
8. WHEN a POST request to `/api/activities` carries an `Idempotency-Key` header that a previous request already used, THE Worklog_Server SHALL return the original response without creating a second `Activity_Entry`
9. THE Worklog_Server SHALL retain an `Idempotency-Key` for at least `IDEMPOTENCY_RETENTION_HOURS`
10. THE Worklog_Server SHALL emit one structured JSON log line per request carrying `timestamp`, `level`, `message`, `requestId`, method, path, status and duration
11. THE Worklog_Server SHALL propagate an incoming `X-Request-Id` header as the `requestId`, and SHALL generate one when the header is absent
12. THE Worklog_Server SHALL set `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` on every response, and SHALL additionally set `Content-Security-Policy` including a directive denying framing on every rendered HTML page — a JSON response executes nothing, so a policy on it protects nothing
13. THE Worklog_Server SHALL serve a `Content-Security-Policy` carrying neither `unsafe-inline` nor `unsafe-eval` when `APP_ENV` is not `development`
14. IF the database is unreachable or a query exceeds `DB_QUERY_TIMEOUT_SECONDS`, THEN THE Worklog_Server SHALL return HTTP 503 with error code `SERVICE_UNAVAILABLE`, so a caller can tell a transient failure from a defect and retry
15. THE Worklog_Server SHALL enforce the body size limit while reading the request stream, so that a chunked request carrying no `Content-Length` cannot exceed it
16. THE Worklog_Server SHALL retain the HTTP status of the original response alongside its body for an `Idempotency-Key`, and SHALL replay both
17. THE Worklog_Server SHALL retain an `Idempotency-Key` for its full lifetime even when the `Activity_Entry` it created is deleted, so that a retry after a deletion does not create a second entry
18. WHEN THE Worklog_Server rejects a request, THE Worklog_Server SHALL include in `details` every value a caller needs to name the obstacle — the conflicting records with their project names and descriptions, the offending field and its value, or the limit that was exceeded — so that no client has to fetch another resource to explain the failure to the user
19. WHEN a write is rejected with `NOTHING_TO_LOG`, THE Worklog_Server SHALL report which cause applied: the resolved interval was empty, it lay wholly outside `Tracked_Time`, it was already `Covered_Time`, or every interval it produced was shorter than `MIN_INTERVAL_SECONDS`
20. WHEN a write is rejected with `STALE_PREVIEW`, THE Worklog_Server SHALL report both the submitted and the current `Preview_Token`, so the caller can re-run the `Dry_Run` and show the new outcome instead of guessing what changed
21. WHEN THE Worklog_Server returns HTTP 429 or HTTP 503, THE Worklog_Server SHALL set `Retry-After` to the seconds remaining in the current rate-limit window and to `SERVICE_RETRY_AFTER_SECONDS` respectively
22. IF a request carries an `Idempotency-Key` a previous request used with a different body, THEN THE Worklog_Server SHALL return HTTP 409 with error code `IDEMPOTENCY_KEY_REUSED` and SHALL create nothing, because replaying the first response for a different request would silently discard the second
23. IF an `Idempotency-Key` is longer than 200 characters or contains a character outside `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`
24. IF a request reaches an existing path with a method that path does not implement, THEN THE Worklog_Server SHALL return HTTP 405 with error code `METHOD_NOT_ALLOWED` and an `Allow` header listing the methods it does implement
25. WHEN rendering a page, THE Worklog_Server SHALL replace the `%lang%` and `%theme%` placeholders in the document with the effective locale and the effective theme, because only the server knows either before hydration
26. THE Worklog_Server SHALL resolve the effective locale in one place and in this order: the `worklog_locale` cookie when it names a supported locale, otherwise the highest-weighted supported locale in the `Accept-Language` header, otherwise `cs`
27. THE Worklog_Server SHALL be the only place the locale is resolved, so that the language of the rendered text and the `lang` attribute can never disagree
28. THE Worklog_Server SHALL take the theme preference from the `worklog_theme` cookie, one of `system`, `light` and `dark`, defaulting to `system`, and SHALL treat an unrecognised value as that default rather than as an error
29. THE Worklog_Server SHALL accept a second theme cookie, `worklog_theme_resolved`, holding the last theme the browser actually resolved — `light` or `dark` — written by the interface from `prefers-color-scheme`
30. THE Worklog_Server SHALL set and accept all three preference cookies readable by script, with `SameSite=Lax`, an explicit `Path`, a `Max-Age` of one year, and `Secure` whenever `APP_ENV` is not `development`, since none of them is a credential and all must be visible to the interface as well as to the renderer
31. WHEN the theme preference is `light` or `dark`, THE Worklog_Server SHALL substitute that value for `%theme%`
32. WHEN the theme preference is `system`, THE Worklog_Server SHALL substitute the value of `worklog_theme_resolved`, and SHALL substitute `DEFAULT_RENDER_THEME` when that cookie is absent or unrecognised, so that the rendered document never carries the literal placeholder and never leaves the theme for the client to settle after the first paint
33. THE Worklog_Server SHALL serve a `Content-Security-Policy` naming an explicit `font-src` of the application's own origin, and SHALL NOT name any external font host in any environment, because the application hosts its typeface itself
34. WHEN a request body fails schema validation, THE Worklog_Server SHALL return in `details` a message key per failing field, drawn from an enumerated catalogue, so that a field error can be shown in the user's language rather than as the schema's English sentence

### Requirement 13: Operational Behavior

**User Story:** As the operator of the service, I want it to report its health and shut down cleanly, so that deployments cause no lost writes.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/health`, THE Health_Endpoint SHALL return HTTP 200 with a JSON body reporting status `ok`, the service version, the effective `TIMEZONE`, the effective `DAY_START_HOUR`, the effective `GAUGE_START`, the effective `GAUGE_END`, the effective `EVENING_HOUR` and the effective `MAX_OPEN_SESSION_HOURS`, because this is the one unauthenticated place a client reads them from and none of them may be inferred from returned data
2. THE Health_Endpoint SHALL NOT require authentication
3. IF the database is unreachable, THEN THE Health_Endpoint SHALL return HTTP 503 with status `degraded`
4. IF the database is reachable but has unapplied migrations, THEN THE Health_Endpoint SHALL return HTTP 503 with status `degraded` and THE Worklog_Server SHALL refuse to serve any other route
5. WHEN the process receives SIGTERM or SIGINT, THE Worklog_Server SHALL stop accepting new connections, allow in-flight requests up to 30 seconds to finish, close the database pool and exit with status 0
6. THE Worklog_Server SHALL apply an explicit timeout to every database query, configurable via `DB_QUERY_TIMEOUT_SECONDS` and defaulting to 5
7. THE Worklog_Server SHALL set the `updatedAt` column of every `Work_Session`, `Activity_Entry` and `Project` row it modifies to the time of that modification; `Activity_Segment` rows are replaced rather than updated and carry no such column
8. THE Worklog_Server SHALL read its configuration from environment variables and from a `.env` file when present, and SHALL exit with a non-zero status when a required variable is missing
9. THE Worklog_Server SHALL take its version from the `package.json` manifest, which is the single source of truth for it
10. THE Worklog_Server SHALL listen on the port given by the `PORT` environment variable, defaulting to `3000`
11. THE Worklog_Server SHALL read the `Gauge_Window` from `GAUGE_START` and `GAUGE_END`, defaulting to `06:00` and `00:00`
12. IF `GAUGE_START` and `GAUGE_END` do not describe a window between 1 and 24 hours long, THEN THE Worklog_Server SHALL log an error and refuse to start
13. IF `GAUGE_END` is less than or equal to `GAUGE_START`, THEN THE Worklog_Server SHALL take `GAUGE_END` as falling on the following calendar date, so that the default `06:00`–`00:00` describes eighteen hours rather than none
14. THE Worklog_Server SHALL require the hour named by `DAY_START_HOUR` to fall inside the `Gauge_Gap`, so that the `Gauge_Window` lies wholly inside one `Logical_Day` and can be described by a single start and a single end
15. IF the hour named by `DAY_START_HOUR` falls inside the `Gauge_Window`, THEN THE Worklog_Server SHALL log an error and refuse to start, because the window would then be split into two disjoint stretches belonging to different `Logical_Day` values
16. THE Worklog_Server SHALL read the `Evening_Hour` from `EVENING_HOUR`, defaulting to `21`
17. IF `EVENING_HOUR` is outside the range 0 to 23, THEN THE Worklog_Server SHALL log an error and refuse to start
18. THE Worklog_Server SHALL read `MAX_OPEN_SESSION_HOURS` from the environment, defaulting to `12`
19. THE Worklog_Server SHALL read `MIN_INTERVAL_SECONDS` from the environment, defaulting to `60`
20. THE Worklog_Server SHALL read `SESSION_DURATION_HOURS` from the environment, defaulting to `720`
21. THE Worklog_Server SHALL read `RATE_LIMIT_PER_MINUTE` from the environment, defaulting to `120`
22. IF the `Gauge_Window` contains an hour at which `TIMEZONE` changes its offset, THEN THE Worklog_Server SHALL log an error and refuse to start, so that the window is the same number of hours on every date
23. THE Worklog_Server SHALL read `TRUSTED_PROXY_HOPS` from the environment, defaulting to `0`
24. IF a configuration value is missing, unparseable, outside its range or violates a `Gauge_Window` invariant, THEN THE Worklog_Server SHALL log the complete list of problems and exit with a non-zero status before it accepts any connection, because no request can be answered correctly and a restart cannot help
25. THE Worklog_Server SHALL run as a single instance, because rate-limit state is held in process memory, is lost on restart and is not shared between processes
26. THE Worklog_Server SHALL read `LOG_LEVEL` from the environment, defaulting to `info` and accepting only `debug`, `info`, `warn` and `error`
27. THE Worklog_Server SHALL read `DB_POOL_MAX` from the environment, defaulting to `10`
28. IF `CORS_ORIGINS` is unset, THEN THE Worklog_Server SHALL admit no cross-origin request at all, rather than defaulting to a permissive value
29. IF `PORT` is outside 1 to 65535, `DB_QUERY_TIMEOUT_SECONDS` outside 1 to 60, `DB_POOL_MAX` outside 1 to 100, `RATE_LIMIT_PER_MINUTE` outside 1 to 10000, `SESSION_DURATION_HOURS` outside 1 to 8760, `MAX_OPEN_SESSION_HOURS` outside 1 to 24, `MIN_INTERVAL_SECONDS` outside 1 to 3600, or `TRUSTED_PROXY_HOPS` outside 0 to 8, THEN THE Worklog_Server SHALL log an error and refuse to start
30. THE Worklog_Server SHALL run the cleanup sweep of expired `Browser_Session` records and `Idempotency-Key` records every `CLEANUP_INTERVAL_MINUTES`
31. WHILE the database is unmigrated or its `Day_Boundary_Config` disagrees with the configuration, THE Worklog_Server SHALL keep running and SHALL answer every route except the `Health_Endpoint` with HTTP 503 and error code `SERVICE_UNAVAILABLE`, because that condition is repaired by migrating or reconfiguring rather than by restarting the process
32. THE Worklog_Server SHALL exempt the `Health_Endpoint` from the check of criterion 31, so that an operator can always ask what is wrong
33. THE Worklog_Server SHALL accept `APP_ENV` values `development`, `test` and `production` only, defaulting to `production`
34. THE Worklog_Server SHALL read its own public origin from `PUBLIC_ORIGIN`, and SHALL refuse to start when it is unset while `APP_ENV` is `production`, because behind a TLS-terminating proxy the runtime otherwise infers the wrong scheme and host, and both the cross-origin check and the framework's own form-action protection are decided from that value
35. WHEN `APP_ENV` is `test`, THE Worklog_Server SHALL omit `Secure` from every cookie it sets and SHALL relax nothing else whatsoever, because an end-to-end run drives the application over `http://localhost` where a `Secure` cookie is discarded and no login can succeed

### Requirement 14: Dry Run

**User Story:** As a user about to shorten a timer session, I want to see what it will do to my logged activities before I save, so that I never lose recorded work by surprise.

#### Acceptance Criteria

1. WHEN a request to create or modify an `Activity_Entry` carries `dryRun` set to true, THE Worklog_Server SHALL evaluate it in full and return the outcome without writing anything
2. WHEN a request to create, modify or delete a `Work_Session` carries `dryRun` set to true, THE Worklog_Server SHALL return every `Activity_Entry` that would be re-clipped, each with its project name, its project colour index, its description, and its `Activity_Segment` records as they are now and as they would become
3. THE Worklog_Server SHALL return a `Dry_Run` response in the same shape and with the same HTTP status code as the corresponding write, except as criterion 11 provides for a write answering HTTP 204, with an added field marking it as a `Dry_Run`
4. THE Worklog_Server SHALL apply the same validation to a `Dry_Run` as to the corresponding write, and SHALL return the same error codes for the same reasons
5. THE Worklog_Server SHALL leave `Work_Session`, `Activity_Entry` and `Activity_Segment` records byte-identical after a `Dry_Run`
6. THE Worklog_Server SHALL report in every `Dry_Run` response the total duration in seconds that would be removed from existing `Activity_Segment` records
7. THE Worklog_Server SHALL include in a `Dry_Run` response a token derived from the stored `Work_Session` and `Activity_Segment` rows the outcome was computed against, and SHALL NOT derive it from any elapsed or current time, so that a running timer does not invalidate a preview every second
8. IF a write carries a `Dry_Run` token that no longer matches the current timer frame, THEN THE Worklog_Server SHALL return HTTP 409 with error code `STALE_PREVIEW`, so a preview cannot be confirmed after another device changed the frame
9. IF `dryRun` is absent from a request, THEN THE Worklog_Server SHALL perform the write
10. WHEN a request to create, modify or delete a `Work_Session` carries `dryRun` set to true, THE Worklog_Server SHALL additionally report the `Uncovered_Time` that would stop being part of `Tracked_Time`, both as a total in seconds and as the intervals themselves, so the interface can name the stretch that disappears instead of deriving it from the data it happens to hold
11. IF the corresponding write would answer HTTP 204, THEN THE Worklog_Server SHALL answer the `Dry_Run` with HTTP 200 and the preview body, because a preview returning no content tells the caller nothing
12. WHEN a DELETE request carries a `Dry_Run` or a `Preview_Token`, THE Worklog_Server SHALL accept them as the `dry_run` and `preview_token` query parameters, because a DELETE request body is not carried reliably by every client

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
10. IF the `Target_Day` of an `Open_Mode` request lies in the future, THEN THE Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`, because a day that has not begun has no `Placement_Anchor` and no end to log up to
