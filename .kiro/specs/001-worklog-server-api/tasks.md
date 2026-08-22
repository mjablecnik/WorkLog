# Implementation Plan: worklog-server-api

## Overview

Build `Worklog_Server` — a Go 1.25 HTTP service at `worklog/worklog-server/` backed by PostgreSQL 16 — from an empty directory to a deployable Fly.io app. Work proceeds bottom-up through the package graph: the pure `data` package first, then `store` against a real database, then the `services` reconciliation core, then the `api` transport layer, and finally packaging and deployment scripts.

The pure packages (`data`, `services`) are covered by unit tests and `pgregory.net/rapid` property tests that need no database. The `store` package and the atomicity guarantees are covered by integration tests against a PostgreSQL container. Handlers are covered by `net/http/httptest`. Test tasks follow the implementation task they validate, and four checkpoints mark the phase boundaries.

## Tasks

- [ ] 1. Project scaffolding and cross-cutting infrastructure
  - [ ] 1.1 Initialize the Go module and entry point
    - Create `worklog-server/go.mod` with module path `worklog-server` and `go 1.25`
    - Add dependencies: `github.com/jackc/pgx/v5`, `github.com/joho/godotenv`, `github.com/google/uuid`, `pgregory.net/rapid`
    - Create `cmd/main.go` as `package main`: load config via `core.Load()`, on error log to stderr and `os.Exit(1)`, otherwise call `api.Run(cfg)`
    - Commit `go.sum` — the lockfile is required by `code-versioning.md`
    - _Requirements: 13.6, 13.7_

  - [ ] 1.2 Implement configuration loading in `source/core/config.go`
    - Define the `Config` struct with all fields from design component 9
    - `Load()` reads `.env` via `godotenv.Load` when the file exists, then `os.Getenv`
    - Apply defaults: `PORT=8080`, `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`, `APP_ENV=production`, `DB_QUERY_TIMEOUT_SECONDS=5`, `RATE_LIMIT_PER_MINUTE=120`, `SHUTDOWN_TIMEOUT_SECONDS=30`
    - Validate: `DATABASE_URL` non-empty, `WORKLOG_API_TOKEN` at least 32 characters, `DAY_START_HOUR` in 0..23, `TIMEZONE` loadable via `time.LoadLocation`
    - Reject `CORS_ORIGINS=*` when `APP_ENV` is not `development`
    - Accumulate every validation failure and return them as one joined error rather than the first
    - _Requirements: 10.4, 10.5, 10.7, 11.6, 11.7, 13.5, 13.6, 13.7_

  - [ ] 1.3 Implement structured logging in `source/core/logger.go`
    - Configure `log/slog` with a JSON handler writing to stdout
    - Emit `timestamp`, `level`, `message`, `requestId` on every entry
    - Provide `RedactToken(s string) string` returning a fixed placeholder, used wherever a token could reach a log call
    - _Requirements: 11.5, 12.7_

  - [ ] 1.4 Implement the error envelope in `source/core/errors.go`
    - Define `APIError` with `Status`, `Code`, `Message`, `Details` and the constructors `ErrValidation`, `ErrNotFound`, `ErrConflict`
    - `WriteError` marshals `{"error","message","details"}`, sets `Content-Type: application/json`
    - Map any non-`APIError` to HTTP 500 `INTERNAL_ERROR` with a fixed message, and log the real cause at `error` with the `requestId`
    - Never include stack traces, SQL text or filesystem paths in the response body
    - _Requirements: 12.1, 12.2, 12.4_

  - [ ] 1.5 Implement request ID handling in `source/core/request_id.go`
    - Read the incoming `X-Request-Id` header; generate a UUIDv7 when absent
    - Store it in the request `context.Context` and expose `RequestIDFrom(ctx) string`
    - Echo the value back in the `X-Request-Id` response header
    - _Requirements: 12.8_

  - [ ] 1.6 Write unit tests for configuration and errors
    - `tests/core/config_test.go`: defaults applied; missing `DATABASE_URL` rejected; short token rejected; `DAY_START_HOUR=24` rejected; bad `TIMEZONE` rejected; wildcard CORS rejected outside development but accepted in development; multiple failures reported together
    - `tests/core/errors_test.go`: envelope shape for each constructor; unknown error becomes `INTERNAL_ERROR` 500; response body contains no stack trace when the source error carries one
    - _Requirements: 10.7, 11.6, 11.7, 12.1, 12.2_

  - [ ] 1.7 Create `.env.example` and `.gitignore`
    - `.env.example` lists every variable read by `Config` with placeholder values for secrets and real defaults for the rest, grouped by comments
    - `.gitignore` covers `.env`, `.env.*`, `!.env.example`, compiled binaries and `tests/tmp/`
    - _Requirements: 13.6_

- [ ] 2. Pure domain — interval algebra and logical day
  - [ ] 2.1 Implement the interval algebra in `source/data/interval.go`
    - Define `Interval{Start, End}` as half-open `[Start, End)` with `Duration`, `IsEmpty`, `Overlaps`
    - Implement `Normalize`, `Union`, `Intersect`, `Subtract`, `Clamp`, `Total`, `Take`, `Gaps` per design component 1
    - `Normalize` sorts by start, drops empty intervals and merges overlapping **and touching** ones
    - `Take` splits the interval in which the requested duration runs out and returns the unconsumed remainder
    - The file imports only `time` and `sort` — no project package, no `pgx`, no `net/http`
    - _Requirements: 9.2, 9.3_

  - [ ] 2.2 Write unit tests for the interval algebra
    - `tests/data/interval_test.go`: empty inputs; single interval; touching intervals merge; overlapping intervals merge; disjoint intervals stay separate
    - `Subtract` producing a hole in the middle, at the head, at the tail, and eliminating an interval entirely
    - `Take` with duration zero, less than the first interval, exactly the first interval, spanning two intervals, and exceeding the total
    - `Gaps` over a window wider than, narrower than, and equal to the input
    - _Requirements: 9.2, 9.3_

  - [ ]* 2.3 Write property tests for the interval algebra
    - `tests/data/interval_property_test.go`, generators producing random unsorted interval lists with duplicates and zero-length entries
    - **Property 4: Interval algebra is conservative** — `Total(Intersect(a,b)) + Total(Subtract(a,b)) == Total(Normalize(a))`
    - **Property 5: Normalization is idempotent and canonical** — `Normalize(Normalize(x)) == Normalize(x)`, output sorted, pairwise disjoint, non-touching
    - **Property 6: Take is exact and order-preserving** — `Total(taken) + remainder == d`, `Total(taken) == min(Total(in), d)`, `taken` is a time-ordered prefix of `in`
    - **Validates: Requirements 5.6, 5.7, 9.2, 9.3**

  - [ ] 2.4 Implement `DayResolver` in `source/data/logicalday.go`
    - `NewDayResolver(tz string, startHour int)` fails on an unloadable zone or an hour outside 0..23
    - `Bounds(date string) (Interval, error)` returns the window from `startHour` on `date` to `startHour` on the following date, computed in the configured location
    - `DateOf(t time.Time) string` returns the `YYYY-MM-DD` name of the containing `Logical_Day`, attributing instants before `startHour` to the previous calendar date
    - `Range(from, to time.Time) []Interval` returns one window per day in the span
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ] 2.5 Write unit tests for `DayResolver`
    - `tests/data/logicalday_test.go`: 02:30 belongs to the previous date; 03:00 belongs to the current date; 23:59 belongs to the current date
    - Both `Europe/Prague` DST transitions — the spring forward day is 23 hours long and the autumn back day 25 hours, and `Bounds` reflects that
    - `startHour = 0` behaves as a plain calendar day
    - Invalid `YYYY-MM-DD` input rejected
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ]* 2.6 Write a property test for logical day assignment
    - `tests/data/logicalday_property_test.go`, generator producing random instants across several years including both DST transitions
    - **Property 12: Logical day assignment is a partition** — for any instant `t`, `t` lies inside `Bounds(DateOf(t))`, and consecutive day windows touch without overlapping
    - **Validates: Requirements 10.5, 10.6**

  - [ ] 2.7 Implement the domain models in `source/data/models.go`
    - Define `ActivityMode` with `ModeExplicit` and `ModeDuration`
    - Define `WorkSession`, `Project`, `ActivityEntry` and `ActivitySegment` with the JSON tags from design component 4
    - `ActivityEntry` carries `RequestedStartedAt`, `RequestedEndedAt` and `RequestedDurationMinutes` as the verbatim record of the original request
    - Marshal every timestamp as RFC 3339 in UTC
    - _Requirements: 4.2, 10.1, 10.3_

- [ ] 3. Checkpoint — pure domain layer proven
  - Run `go test ./tests/data/... ./tests/core/...` and ensure everything passes with no database running

- [ ] 4. Database schema and persistence
  - [ ] 4.1 Write `migrations/001_init.sql`
    - Create `btree_gist`, then `projects`, `work_sessions`, `activity_entries`, `activity_segments` and `schema_migrations` exactly as in the design Data Models section
    - Include `work_sessions_one_open`, both `EXCLUDE USING gist` constraints, `projects_name_unique` on `lower(btrim(name))`, and the check constraints on mode fields and description length
    - Declare `activity_segments_no_overlap` as `DEFERRABLE INITIALLY DEFERRED`
    - _Requirements: 1.8, 2.5, 3.2, 3.3, 4.5, 4.7, 6.4_

  - [ ] 4.2 Write `scripts/migrate.sh`
    - `#!/bin/bash` with `set -euo pipefail` and the Script Portability preamble resolving `PROJECT_DIR`
    - Take the environment name as `$1`, defaulting to the local `.env`
    - Create `schema_migrations` when absent, then apply every unapplied `migrations/*.sql` in filename order inside a transaction, recording each filename
    - Idempotent: a second run applies nothing and exits 0
    - _Requirements: 13.6_

  - [ ] 4.3 Implement the database layer in `source/store/db.go`
    - `NewPool(ctx, cfg)` builds a `pgxpool.Pool` with the query timeout from config
    - `WithTx(ctx, pool, fn)` opens a transaction, executes `SELECT pg_advisory_xact_lock(4919372001)` as its first statement, runs `fn`, and commits or rolls back
    - Export the lock constant as `WorklogAdvisoryLock`
    - `TranslateConstraintError(err)` maps SQLSTATE `23P01` on `work_sessions_no_overlap` to `SESSION_OVERLAP`, on `activity_segments_no_overlap` to `ACTIVITY_OVERLAP`, and `23505` on `work_sessions_one_open` to `SESSION_ALREADY_RUNNING`
    - _Requirements: 6.9, 13.5_

  - [ ] 4.4 Implement `source/store/session_store.go`
    - Implement every method from design component 5 against `pgx.Tx`
    - `TrackedIntervals` returns normalized `data.Interval` values for the window, treating an `Open_Session` as running until the supplied `now`
    - `InsertMany` inserts the intervals produced by the `extend` policy
    - _Requirements: 1.1, 1.4, 1.7, 2.1, 2.3, 2.6_

  - [ ] 4.5 Implement `source/store/project_store.go`
    - Create, get, list with an `includeArchived` flag, update name and archived state, delete
    - Uniqueness is checked by the database index on `lower(btrim(name))`; translate `23505` to `PROJECT_EXISTS`
    - Translate a foreign-key violation on delete to `PROJECT_IN_USE`, including the referencing entry count in the details
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 4.6 Implement `source/store/activity_store.go`
    - Implement every method from design component 6 against `pgx.Tx`
    - `Create` inserts the entry and its segments in one call; `ReplaceSegments` deletes then reinserts, relying on the deferred constraint
    - `CoveredIntervals` accepts an optional entry id to exclude, used when re-clipping that entry
    - `EntriesOverlapping` orders by `requested_started_at` then `created_at` so re-clipping is deterministic
    - `ListOverlapping` joins the project name and returns entries with their segments attached, ordered by earliest segment start
    - _Requirements: 4.1, 7.1, 7.3, 7.4, 7.6, 7.8_

  - [ ] 4.7 Write integration tests for the schema constraints
    - `tests/store/schema_test.go`, run against a PostgreSQL 16 container started with plain `docker run` on the sandbox network and reached by container name
    - A second `Open_Session` is rejected; overlapping closed sessions are rejected; sessions touching at a single instant are accepted
    - Overlapping `activity_segments` are rejected; a delete-then-reinsert reshuffle inside one transaction succeeds
    - Deleting a `Project` referenced by an entry is rejected; duplicate project names differing only in case or surrounding whitespace are rejected
    - _Requirements: 1.8, 2.5, 3.2, 3.7, 4.5, 6.4_

  - [ ] 4.8 Write integration tests for the stores
    - `tests/store/session_store_test.go`: start, stop, current when none open, list by window including partially overlapping sessions, `TrackedIntervals` with an open session
    - `tests/store/activity_store_test.go`: create with multiple segments, `CoveredIntervals` with and without exclusion, `ReplaceSegments`, `EntriesOverlapping` ordering, cascade delete of segments
    - Provide a shared helper that truncates all tables between tests
    - _Requirements: 1.1, 1.4, 1.7, 2.1, 4.1, 7.1, 7.8_

- [ ] 5. Checkpoint — persistence proven against a real database
  - Run `go test ./tests/store/...` with a PostgreSQL container running and ensure every constraint test passes

- [ ] 6. Reconciliation core
  - [ ] 6.1 Implement `Clip` for `Explicit_Mode` in `source/services/clipping.go`
    - Define `UncoveredPolicy` with `PolicyClip`, `PolicyExtend`, `PolicyReject`, and the `ClipInput` and `ClipResult` structs from design component 3
    - Compute `inside = Intersect(requested, Tracked)` and `outside = Subtract(requested, Tracked)`
    - Set `Conflicts = Intersect(inside, Covered)` — a non-empty value tells the caller to reject
    - Apply the policy: `clip` sets `Discarded = outside`; `extend` sets `Extend = outside` and `Segments` to the whole requested interval; `reject` leaves `outside` for the caller to detect
    - The file imports only `time` and `worklog-server/source/data`
    - _Requirements: 4.1, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ] 6.2 Implement `ResolveAnchor` and `Clip` for `Duration_Mode`
    - `ResolveAnchor` returns the explicit start when given, else the end of the latest segment of the day, else the start of the earliest session of the day, else `ErrNoPlacementAnchor`
    - Compute `eligible = Subtract(Clamp(Tracked, [anchor, DayBounds.End)), Covered)`
    - Call `data.Take(eligible, duration)` and set `Segments` to the taken prefix and `Unplaced` to the remainder
    - Under `extend`, append one interval of length `Unplaced` starting at the later of the anchor and the last tracked instant in the window; return it in `Extend` and set `Unplaced` to zero
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ] 6.3 Write unit tests for `Clip`
    - `tests/services/clipping_test.go`
    - Named case `worked example, explicit`: tracked `[08:00–14:48, 15:12–18:00]`, requested `13:00–16:00` → segments `[13:00–14:48, 15:12–16:00]`
    - Named case `worked example, duration`: same frame, anchor `14:00`, duration `2h` → segments `[14:00–14:48, 15:12–16:24]` totalling exactly 120 minutes
    - Request entirely inside one session produces one segment; request entirely outside tracked time produces no segments and reports the whole request as discarded
    - Each policy exercised for both modes; `Conflicts` populated when the request meets an existing segment
    - `ResolveAnchor` for all four branches of Requirements 5.2–5.5
    - _Requirements: 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 6.3, 6.5, 6.6, 6.7_

  - [ ]* 6.4 Write property tests for `Clip`
    - `tests/services/clipping_property_test.go`, generators producing random session frames, random requests and random policies
    - **Property 1: Segments never cover untracked time** — under `clip` and `reject`, every segment lies within `Tracked_Time`
    - **Property 2: Duration mode preserves the requested duration** — when enough eligible time exists, total segment duration equals `d` and `Unplaced` is zero
    - **Property 3: Breaks survive inside an entry** — the gaps between consecutive segments contain no eligible tracked time
    - **Property 11: The original request is preserved** — the requested values on the entry are unchanged by clipping
    - **Validates: Requirements 4.2, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4**

  - [ ] 6.5 Implement re-clipping in `source/services/reclip.go`
    - Declare the `ReclipPorts` interface from design component 7 so `services` never imports `store`
    - `ReclipAffected` loads the affected entries in deterministic order, clears their segments, and re-runs `Clip` for each with `PolicyClip`
    - Treat entries already re-clipped in this pass as part of `Covered_Time` for the entries that follow
    - Keep an entry with zero segments rather than deleting it when nothing survives
    - _Requirements: 2.7, 2.8_

  - [ ] 6.6 Write tests for re-clipping with a fake `ReclipPorts`
    - `tests/services/reclip_test.go` using an in-memory fake, no database
    - Shrinking a session splits an entry that spanned it; deleting a session leaves the entry with zero segments; widening a session restores coverage
    - Two entries competing for the same freed time are resolved in `requested_started_at` order
    - _Requirements: 2.7, 2.8_

  - [ ]* 6.7 Write a property test for re-clipping determinism
    - `tests/services/reclip_property_test.go`
    - **Property 9: Re-clipping is deterministic and idempotent** — applying `ReclipAffected` twice over the same interval yields the same segments as applying it once
    - **Validates: Requirements 2.7, 2.8**

- [ ] 7. HTTP transport layer
  - [ ] 7.1 Implement middleware in `source/core/middleware.go`
    - Panic recovery logging at `error` and returning `INTERNAL_ERROR` 500
    - Request logging emitting method, path, status and duration alongside the `requestId`
    - `http.MaxBytesReader` capping bodies at 1 MiB and returning `PAYLOAD_TOO_LARGE` 413
    - CORS restricted to the configured origins, never reflecting an arbitrary `Origin`
    - _Requirements: 11.7, 12.5, 12.7, 12.8_

  - [ ] 7.2 Implement bearer token authentication in `source/core/auth.go`
    - Require `Authorization: Bearer <token>`; return `UNAUTHORIZED` 401 when absent, malformed or mismatched
    - Compare with `crypto/subtle.ConstantTimeCompare`
    - Never write the supplied token to a log
    - Exempt `GET /health`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 7.3 Implement rate limiting in `source/core/ratelimit.go`
    - Per-client-address token bucket allowing `RATE_LIMIT_PER_MINUTE` requests per 60 seconds
    - Return `RATE_LIMITED` 429 with a `Retry-After` header when exceeded
    - Evict idle buckets so memory does not grow without bound
    - _Requirements: 12.6_

  - [ ] 7.4 Implement the router and server in `source/api/router.go` and `source/api/server.go`
    - Register every route from the design using Go 1.22 method patterns
    - Chain middleware: request ID → logging → recovery → body limit → CORS → rate limit → auth
    - `Run(cfg)` builds the pool, resolves the `DayResolver`, constructs the stores, starts the server on `PORT`
    - On SIGTERM or SIGINT stop accepting connections, allow in-flight requests up to `SHUTDOWN_TIMEOUT_SECONDS`, close the pool, exit 0
    - _Requirements: 13.4, 13.7_

  - [ ] 7.5 Implement session handlers in `source/api/sessions.go`
    - `POST /sessions/start`, `POST /sessions/stop`, `GET /sessions/current`, `GET /sessions`, `PATCH /sessions/{id}`, `DELETE /sessions/{id}`
    - Accept an optional explicit `started_at` or `ended_at`, defaulting to the current time
    - Return `SESSION_ALREADY_RUNNING` and `NO_SESSION_RUNNING` as specified
    - `GET /sessions/current` reports the elapsed seconds of the `Open_Session`, or a null session
    - PATCH and DELETE call `services.ReclipAffected` for the union of the old and new interval inside the same transaction
    - Default the listing range to the current `Logical_Day` when `from` and `to` are absent
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 7.6 Write HTTP tests for the session endpoints
    - `tests/api/sessions_test.go`: start returns 201; a second start returns 409; stop returns 200; stop with none running returns 409; current with and without an open session
    - PATCH producing an inverted interval returns 400; PATCH producing an overlap returns 409 with conflict identifiers in the details
    - DELETE returns 204 and re-clips entries that overlapped the removed session
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.7, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 7.7 Implement project handlers in `source/api/projects.go`
    - `POST /projects`, `GET /projects` with `include_archived`, `PATCH /projects/{id}`, `DELETE /projects/{id}`
    - Validate the name as non-empty and at most 200 characters
    - Map store errors to `PROJECT_EXISTS` 409 and `PROJECT_IN_USE` 409
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 7.8 Write HTTP tests for the project endpoints
    - `tests/api/projects_test.go`: create, duplicate name in different case rejected, empty and over-long names rejected, listing excludes archived by default, delete in use rejected, delete unused succeeds
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8_

  - [ ] 7.9 Implement activity handlers in `source/api/activities.go`
    - Define `CreateActivityRequest` and `ActivityResponse` from design component 6
    - Select the mode: `ended_at` without `duration_minutes` is `Explicit_Mode`; `duration_minutes` without `ended_at` is `Duration_Mode`; both is `AMBIGUOUS_MODE` 400; neither is `VALIDATION_ERROR` 400
    - Reject a timestamp lacking an explicit offset and a body carrying an unknown field
    - Run the whole write in one `WithTx` call: load tracked and covered intervals, call `services.Clip`, persist the entry, its segments and any extended sessions
    - Return `ACTIVITY_OVERLAP`, `OUTSIDE_TRACKED_TIME` and `NO_PLACEMENT_ANCHOR` as specified, always reporting `discarded`, `extended_sessions` and `unplaced_minutes`
    - `GET /activities`, `GET /activities/{id}`, `PATCH /activities/{id}`, `DELETE /activities/{id}`; a PATCH touching only the description or project skips re-clipping, a PATCH touching the interval or duration replaces the segments while ignoring the entry's own segments for overlap
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.5, 5.8, 5.9, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.2, 12.3_

  - [ ] 7.10 Write HTTP tests for the activity endpoints
    - `tests/api/activities_test.go`, seeding the frame `[08:00–14:48, 15:12–18:00]` before each case
    - Explicit `13:00–16:00` returns 201 with two segments and the requested values unchanged on the entry
    - Duration `2h` anchored at `14:00` returns 201 with segments totalling exactly 120 minutes
    - Both `ended_at` and `duration_minutes` returns 400 `AMBIGUOUS_MODE`; neither returns 400; a naive timestamp returns 400; an unknown field returns 400
    - An overlapping explicit request returns 409 `ACTIVITY_OVERLAP`; policy `reject` outside tracked time returns 409 and writes nothing; policy `extend` creates the covering session and reports it
    - Duration exceeding the remaining eligible time reports `unplaced_minutes` under the default policy
    - PATCH of description alone leaves segments untouched; PATCH of the interval replaces them; DELETE returns 204 and removes the segments
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.8, 6.5, 6.6, 6.7, 6.9, 7.4, 7.5, 7.6, 7.8, 10.2, 12.3_

  - [ ] 7.11 Implement day and coverage handlers in `source/api/days.go` and `source/api/coverage.go`
    - `GET /days/{date}` returns bounds, sessions, entries with segments, coverage and totals including the per-project breakdown
    - An empty day returns 200 with empty collections and zero totals, never 404
    - `GET /days` accepts `from` and `to` and returns one summary per `Logical_Day`, rejecting spans over 366 days with `RANGE_TOO_LARGE`
    - `GET /coverage` returns `tracked`, `covered`, `uncovered` and `untracked`, computing `uncovered` as `data.Subtract(tracked, covered)` and `untracked` as `data.Gaps(tracked, window)`
    - Honour `min_gap_seconds` by dropping shorter `uncovered` intervals; default the range to the current `Logical_Day`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 7.12 Write HTTP tests for the day and coverage endpoints
    - `tests/api/days_test.go`: a populated day returns correct totals and per-project seconds; an empty day returns 200 with zeroes; a malformed date returns 400; a 400-day range returns `RANGE_TOO_LARGE`
    - `tests/api/coverage_test.go`: `covered` and `uncovered` reconstruct `tracked` exactly; `untracked` holds the breaks; `min_gap_seconds` filters short gaps; `from` after `to` returns 400
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 9.1, 9.3, 9.4, 9.6_

  - [ ] 7.13 Implement the health endpoint in `source/api/health.go`
    - `GET /health` returns 200 with status `ok` and the configured version, without authentication
    - Return 503 with status `degraded` when a short database ping fails
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 7.14 Write tests for authentication, rate limiting and health
    - `tests/core/auth_test.go`: missing header, malformed header and wrong token all return 401; the correct token passes; `/health` is reachable with no header; no log line contains the token
    - `tests/core/ratelimit_test.go`: requests beyond the limit return 429 with `Retry-After`
    - `tests/api/health_test.go`: 200 with a reachable database, 503 when the pool is closed
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 12.6, 13.1, 13.2, 13.3_

- [ ] 8. Checkpoint — API complete
  - Run `go test ./...` with a PostgreSQL container running, and ensure every unit, property, integration and HTTP test passes

- [ ] 9. Architecture and atomicity guards
  - [ ] 9.1 Write the import guard test
    - `tests/core/imports_test.go` walks the package import graph with `go/packages`
    - Fail when `data` imports any project package, `pgx` or `net/http`; when `services` imports `store`, `pgx` or `net/http`; when `core` imports `data`, `store`, `services` or `api`
    - _Requirements: 6.1, 6.2_

  - [ ]* 9.2 Write a property test for write atomicity
    - `tests/store/atomicity_property_test.go` against a real database, generating random requests of which many are rejected
    - **Property 10: Rejected writes leave no trace** — after any 4xx response the contents of `work_sessions`, `activity_entries` and `activity_segments` are unchanged
    - **Validates: Requirements 6.9**

  - [ ]* 9.3 Write a property test for the global non-overlap invariant
    - `tests/store/overlap_property_test.go` against a real database, applying a random sequence of accepted writes
    - **Property 8: Activity segments never overlap globally** — no two rows in `activity_segments` overlap after any sequence of accepted operations
    - **Validates: Requirements 4.5, 6.4**

  - [ ]* 9.4 Write a property test for the coverage partition
    - `tests/api/coverage_property_test.go`
    - **Property 7: Coverage partitions tracked time** — `covered` and `uncovered` are disjoint and their union equals `tracked` exactly
    - **Validates: Requirements 9.3**

- [ ] 10. Packaging, deployment and documentation
  - [ ] 10.1 Write the `Dockerfile` and `.dockerignore`
    - Multi-stage build: a pinned `golang:1.25-alpine` builder running `go mod download` before copying sources, then a distroless or `alpine` runtime stage
    - Inject the version through an `ldflags` build argument
    - Run as a non-root user and expose the configured port
    - `.dockerignore` excludes `.git`, `tests/`, `.env*`, `.kiro/` and build output
    - _Requirements: 13.7_

  - [ ] 10.2 Write `fly.toml`
    - Set `app = "worklog-server"`, a region, and an `[env]` section holding only non-secret configuration — `PORT`, `TIMEZONE`, `DAY_START_HOUR`, `APP_ENV`
    - Configure an HTTP health check against `/health`
    - Never place `WORKLOG_API_TOKEN` or `DATABASE_URL` in this file
    - _Requirements: 11.6, 13.1_

  - [ ] 10.3 Write `scripts/build.sh`, `scripts/start-docker.sh` and `scripts/stop-docker.sh`
    - All three use `#!/bin/bash`, `set -euo pipefail` and the Script Portability preamble
    - Parse `APP_NAME` from the resolved fly config rather than hardcoding it
    - `start-docker.sh` builds the image and runs the container with `--env-file .env` on the ports declared in `fly.toml`
    - _Requirements: 13.6, 13.7_

  - [ ] 10.4 Write `scripts/deploy.sh`
    - Take the environment name as `$1`, defaulting to `prod`; resolve `.env.<env>` and `fly.<env>.toml` with a `fly.toml` fallback
    - Pre-flight validation exiting 2 when the fly config, env file or Dockerfile is missing, before any remote call
    - Resolve the org from the fly config, prompting through `/dev/tty` when absent and persisting the choice
    - Create the app only when `fly status` reports it missing, set secrets from the env file skipping keys already in `[env]`, then `fly deploy --config`
    - _Requirements: 13.6_

  - [ ] 10.5 Write `README.md`
    - Sections for local Docker setup, running migrations, and Fly.io deployment, in the order required by the README standard
    - Document every environment variable, and a full endpoint table with request and response examples
    - Include a worked example of the reconciliation showing how `13:00–16:00` over a broken frame becomes two segments
    - _Requirements: 13.6_

- [ ] 11. Checkpoint — deployable service
  - Run `./scripts/start-docker.sh`, apply migrations, exercise the worked example end to end with `curl`, confirm `/health` responds, then `./scripts/stop-docker.sh`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.7"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.1", "2.4", "2.7", "4.1", "4.2"] },
    { "id": 2, "tasks": ["1.6", "2.2", "2.3", "2.5", "2.6", "4.3"] },
    { "id": 3, "tasks": ["4.4", "4.5", "4.6", "6.1"] },
    { "id": 4, "tasks": ["4.7", "4.8", "6.2", "7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["6.3", "6.4", "6.5", "7.4"] },
    { "id": 6, "tasks": ["6.6", "6.7", "7.5", "7.7", "7.13"] },
    { "id": 7, "tasks": ["7.6", "7.8", "7.9", "7.11", "7.14"] },
    { "id": 8, "tasks": ["7.10", "7.12", "9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Every one of them is a property test; the unit, integration and HTTP tests are not optional.
- Shell scripts run under bash and start with `#!/bin/bash` and `set -euo pipefail`. Ad-hoc commands must stay zsh-compatible.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL with plain `docker run` on the sandbox's own network and reach it by container name — a published port on `localhost` will not be reachable from the shell. The `sandbox-docker-net` skill has the details.
- The schema in `migrations/001_init.sql` was verified against `postgres:16-alpine` while the design was written: the single-open-session index, both exclusion constraints, acceptance of touching intervals and the deferred reshuffle all behave as specified.
- `Interval` is half-open `[Start, End)`. This is what lets one session end at 12:00 and the next begin at 12:00 without overlapping, and it must hold in the Go code and the `tstzrange` columns alike.
- `services` must never import `store`. `ReclipAffected` takes the `ReclipPorts` interface instead, which is also what makes it testable without a database. Task 9.1 enforces this.
- File names inside a package do not repeat the package name — `api/sessions.go`, not `api/session_handlers.go`.
- The advisory lock constant `4919372001` is arbitrary but fixed. Every mutating transaction must take it as its first statement, or the clipping read-modify-write cycle is open to races.
- `pause` is not a server concept. The client sends `/sessions/stop` to pause and `/sessions/start` to resume; the gap between the two sessions is the break that reconciliation later preserves.
- Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
