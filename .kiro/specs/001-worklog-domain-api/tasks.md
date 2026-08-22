# Implementation Plan: worklog-domain-api

## Overview

Build the `Worklog_Server` — the server-side half of the Worklog SvelteKit application: the pure reconciliation domain, the PostgreSQL data layer, the `Auth_Hook` and the REST routes under `/api`. Work proceeds bottom-up — the pure `domain` modules first, then the schema and stores against a real database, then authentication, then the routes.

The runtime is Bun 1.2.15 with SvelteKit ^2.63 on Svelte 5, Drizzle ORM over `postgres.js`, and Zod at every boundary. Pure logic is covered by Vitest unit tests and `fast-check` property tests that need no database; the schema guarantees and atomicity are covered by integration tests against a PostgreSQL container; routes are covered by direct handler tests. Test tasks follow the implementation task they validate, and four checkpoints mark the phase boundaries.

## Tasks

- [ ] 1. Project scaffolding and server infrastructure
  - [ ] 1.1 Initialize the SvelteKit project
    - Scaffold with Bun 1.2.15; set `packageManager`, `engines.bun`, `.npmrc` with `engine-strict=true`, and `bunfig.toml` with `[run] bun = true`
    - Dependencies: `@sveltejs/kit` ^2.63, `svelte` ^5.56, `vite` ^8, `@sveltejs/adapter-node` ^5.5, `typescript` ^6 strict, `drizzle-orm` ^0.45, `postgres` ^3.4, `zod` ^4, `@date-fns/tz` ^1.5, `@inlang/paraglide-js` ^2.18
    - Dev dependencies: `vitest` ^4, `fast-check` ^4 declared explicitly, `@playwright/test`, `drizzle-kit`, `eslint`, `prettier`
    - Scripts matching the workspace: `dev`, `build`, `preview`, `prepare`, `messages:compile`, `check`, `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:local`, `test:all`, `lint`, `format`
    - Aliases in `svelte.config.js`: `$lib`, `$db`, `$modules`; `compilerOptions.runes: true`
    - Commit `bun.lock`
    - _Requirements: 13.6, 13.7_

  - [ ] 1.2 Implement configuration in `src/lib/server/core/config.ts`
    - Define `Config` and `loadConfig()` per design component 11
    - Defaults: `PORT=3000`, `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`, `APP_ENV=production`, `DB_QUERY_TIMEOUT_SECONDS=5`, `RATE_LIMIT_PER_MINUTE=120`, `SESSION_DURATION_HOURS=720`
    - Validate: `DATABASE_URL` non-empty; `WORKLOG_API_TOKEN` at least 32 characters; `WORKLOG_PASSPHRASE` at least 12 characters; `DAY_START_HOUR` in 0..23; `TIMEZONE` loadable
    - Reject `CORS_ORIGINS=*` unless `APP_ENV` is `development`
    - Throw once listing every problem, not just the first, so a misconfigured deployment surfaces all of them
    - _Requirements: 10.4, 10.5, 10.7, 11.14, 11.15, 13.5, 13.6, 13.7_

  - [ ] 1.3 Implement logging and request identity
    - `src/lib/server/core/logger.ts`: JSON lines to stdout carrying `timestamp`, `level`, `message`, `requestId`; a redaction helper used wherever a secret could reach a log call
    - `src/lib/server/core/request-id.ts`: read `X-Request-Id`, generate a UUID when absent, expose it on `locals`, echo it back in the response header
    - Declare `App.Locals` in `src/app.d.ts` with `requestId` and `auth`
    - _Requirements: 11.7, 12.7, 12.8_

  - [ ] 1.4 Implement the error envelope in `src/lib/server/core/errors.ts`
    - Define the `ErrorCode` union, the `ApiError` class and `errorResponse()` per design component 8
    - `message` carries a Paraglide message key, never prose
    - Map any unknown error to 500 `INTERNAL_ERROR` with a fixed key, logging the real cause with the `requestId`
    - Never place stack traces, SQL text or filesystem paths in a response body
    - _Requirements: 12.1, 12.2, 12.4_

  - [ ] 1.5 Write unit tests for configuration and errors
    - `tests/lib/server/core/config.test.ts`: defaults applied; missing `DATABASE_URL`, short token and short passphrase each rejected; `DAY_START_HOUR=24` rejected; bad `TIMEZONE` rejected; wildcard CORS rejected outside development but accepted in development; several failures reported together
    - `tests/lib/server/core/errors.test.ts`: envelope shape per code; unknown error becomes `INTERNAL_ERROR` 500; a source error carrying a stack trace does not leak it into the body
    - _Requirements: 10.7, 11.14, 11.15, 12.1, 12.2_

  - [ ] 1.6 Create `.env.example` and `.gitignore`
    - `.env.example` lists every variable `loadConfig` reads, grouped by comments, with placeholders for secrets and real defaults elsewhere
    - `.gitignore` covers `.env`, `.env.*`, `!.env.example`, `src/lib/paraglide/`, `build/`, `node_modules/`, `.svelte-kit/`
    - _Requirements: 13.6_

- [ ] 2. Pure domain — interval algebra and logical day
  - [ ] 2.1 Implement the interval algebra in `src/lib/server/domain/interval.ts`
    - Define `Interval` as half-open `[start, end)` and implement `isEmpty`, `duration`, `overlaps`, `normalize`, `union`, `intersect`, `subtract`, `clamp`, `total`, `take`, `gaps` per design component 1
    - `normalize` sorts by start, drops empty intervals, merges overlapping **and touching** ones
    - `take` splits the interval in which the requested duration runs out and reports the unconsumed remainder
    - The module imports nothing from the project, no Drizzle and no SvelteKit
    - _Requirements: 9.2, 9.3_

  - [ ] 2.2 Write unit tests for the interval algebra
    - `tests/lib/server/domain/interval.test.ts`: empty input; single interval; touching intervals merge; overlapping merge; disjoint stay separate
    - `subtract` producing a hole in the middle, at the head, at the tail, and eliminating an interval entirely
    - `take` with zero, less than the first interval, exactly the first interval, spanning two intervals, and exceeding the total
    - `gaps` over a window wider than, narrower than and equal to the input
    - _Requirements: 9.2, 9.3_

  - [ ]* 2.3 Write property tests for the interval algebra
    - `tests/lib/server/domain/interval.property.test.ts` with generators producing unsorted lists containing duplicates and zero-length entries
    - **Property 4: Interval algebra is conservative** — `total(intersect(a,b)) + total(subtract(a,b)) === total(normalize(a))`
    - **Property 5: Normalization is idempotent and canonical** — `normalize(normalize(x))` equals `normalize(x)`; output sorted, pairwise disjoint, non-touching
    - **Property 6: Take is exact and order-preserving** — `total(taken) + remainder === ms`, `total(taken) === min(total(input), ms)`, `taken` is a time-ordered prefix
    - **Validates: Requirements 5.6, 5.7, 9.2, 9.3**

  - [ ] 2.4 Implement `createDayResolver` in `src/lib/server/domain/logical-day.ts`
    - Use `TZDate` from `@date-fns/tz` for DST-correct wall-clock arithmetic
    - Throw when the timezone is not loadable or `startHour` is outside 0..23
    - `bounds(date)` runs from `startHour` on that date to `startHour` on the next; `dateOf(t)` attributes instants before `startHour` to the previous calendar date; `range(from, to)` yields one window per day
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ] 2.5 Write unit tests for the logical day
    - `tests/lib/server/domain/logical-day.test.ts`: `02:30` belongs to the previous date; `03:00` to the current one; `23:59` to the current one
    - Pin the DST dates exactly — with `startHour = 3` in `Europe/Prague` the **day before** each transition is the irregular one: `2026-03-28` is 23 hours, `2026-10-24` is 25 hours, and `2026-03-29` and `2026-10-25` are both 24. Do not assume the transition date itself is short or long.
    - `startHour = 0` behaves as a plain calendar day; a malformed date string is rejected
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ]* 2.6 Write a property test for the logical day
    - `tests/lib/server/domain/logical-day.property.test.ts` generating instants across several years including both transitions
    - **Property 12: Logical day assignment is a partition** — `t` lies inside `bounds(dateOf(t))` and consecutive windows touch without overlapping
    - **Validates: Requirements 10.5, 10.6**

  - [ ] 2.7 Define the shared domain types
    - `WorkSession`, `Project`, `ActivityEntry`, `ActivitySegment` and `ActivityMode` as TypeScript types beside the Drizzle inferred types
    - `ActivityEntry` carries `requestedStartedAt`, `requestedEndedAt` and `requestedDurationMinutes` as the verbatim record of the original request
    - Serialize every timestamp as RFC 3339 in UTC
    - _Requirements: 4.2, 10.1, 10.3_

- [ ] 3. Checkpoint — pure domain proven
  - Run `bun run check && bun run test tests/lib/server/domain tests/lib/server/core` with no database running and ensure everything passes

- [ ] 4. Schema and data layer
  - [ ] 4.1 Write `migrations/001_init.sql`
    - Create `btree_gist`, then `projects`, `work_sessions`, `activity_entries`, `activity_segments`, `auth_sessions` and `schema_migrations` exactly as in the design Data Models section
    - Include `work_sessions_one_open`, both `EXCLUDE USING gist` constraints, `projects_name_unique` on `lower(btrim(name))`, and every check constraint
    - Declare `activity_segments_no_overlap` as `DEFERRABLE INITIALLY DEFERRED`
    - _Requirements: 1.8, 2.5, 3.2, 3.3, 4.5, 4.7, 6.4, 11.8_

  - [ ] 4.2 Write `scripts/migrate.sh`
    - `#!/bin/bash` with `set -euo pipefail` and the Script Portability preamble resolving `PROJECT_DIR`
    - Take the environment name as `$1`, defaulting to the local `.env`
    - Create `schema_migrations` when absent, then apply each unapplied `migrations/*.sql` in filename order inside a transaction, recording the filename
    - Idempotent — a second run applies nothing and exits 0
    - This is the only supported way to apply migrations; `drizzle-kit migrate` is not used, because the exclusion constraints are not expressible in the Drizzle DSL
    - _Requirements: 13.6_

  - [ ] 4.3 Write the Drizzle schema in `src/db/schema/`
    - One file per table plus a barrel `index.ts`, mirroring the SQL for typed queries
    - Do not attempt to express `EXCLUDE` constraints or expression indexes here — `migrations/001_init.sql` is the authority
    - _Requirements: 1.1, 3.1, 4.1, 11.8_

  - [ ] 4.4 Implement the transaction helper in `src/lib/server/store/tx.ts`
    - Build the Drizzle client over `postgres.js` with the configured query timeout
    - `withTx(fn, { dryRun })` opens a transaction, runs `select pg_advisory_xact_lock(4919372001)` as its first statement, runs `fn`, then commits — or rolls back when `dryRun` is set, by throwing a private rollback signal and catching it outside
    - `translateConstraintError` maps the SQLSTATE and constraint names from the design table to `ApiError` codes
    - Register a shutdown handler on the `sveltekit:shutdown` event that closes the `postgres.js` pool, and set `SHUTDOWN_TIMEOUT` so `adapter-node` drains in-flight requests for up to 30 seconds on SIGTERM or SIGINT before exiting 0
    - _Requirements: 6.9, 13.4, 13.5, 14.1, 14.5_

  - [ ] 4.5 Implement `src/lib/server/store/work-sessions.ts`
    - Every function from design component 6 for sessions
    - `trackedIntervals` returns normalized intervals, treating an `Open_Session` as running until the supplied `now`
    - `insertSessions` writes the intervals produced by the `extend` policy
    - _Requirements: 1.1, 1.4, 1.7, 2.1, 2.3, 2.6_

  - [ ] 4.6 Implement `src/lib/server/store/projects.ts`
    - Create, list with `includeArchived`, update name and archived state, delete
    - Uniqueness comes from the database index; translate the violation to `PROJECT_EXISTS`, and a foreign-key violation on delete to `PROJECT_IN_USE` with the referencing entry count
    - `createProject` assigns `color_index` as the lowest value in 0..7 not held by a non-archived project, wrapping when all eight are taken; renaming, archiving and unarchiving never change it
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ] 4.7 Implement `src/lib/server/store/activities.ts`
    - Every function from design component 6 for activities
    - `createEntry` writes the entry and its segments together; `replaceSegments` deletes then reinserts, relying on the deferred constraint
    - `coveredIntervals` accepts an entry to exclude, used when re-clipping that entry
    - `entriesOverlapping` orders by `requestedStartedAt` then `createdAt` so re-clipping is deterministic
    - `listEntriesOverlapping` joins the project name and attaches segments, ordered by earliest segment start
    - _Requirements: 4.1, 7.1, 7.3, 7.4, 7.6, 7.8_

  - [ ] 4.8 Write integration tests for the schema constraints
    - `tests/lib/server/store/schema.test.ts` against PostgreSQL 16 started with plain `docker run` on the sandbox network and reached by container name
    - A second `Open_Session` is rejected; overlapping closed sessions are rejected; sessions touching at one instant are accepted
    - Overlapping segments are rejected; a delete-then-reinsert reshuffle in one transaction succeeds
    - Deleting a referenced `Project` is rejected; project names differing only in case or surrounding whitespace collide
    - Assert every Drizzle column exists in the migrated database with a compatible type, catching drift from `migrations/001_init.sql`
    - _Requirements: 1.8, 2.5, 3.2, 3.7, 4.5, 6.4_

  - [ ] 4.9 Write integration tests for the stores
    - `tests/lib/server/store/work-sessions.test.ts`: start, stop, current when none open, listing by window including partial overlaps, `trackedIntervals` with an open session
    - `tests/lib/server/store/activities.test.ts`: create with several segments, `coveredIntervals` with and without exclusion, `replaceSegments`, `entriesOverlapping` ordering, cascade delete
    - `tests/lib/server/store/tx.test.ts`: `withTx` commits on success, rolls back on throw, and rolls back on `dryRun` while still returning the value
    - Provide a helper truncating every table between tests
    - _Requirements: 1.1, 1.4, 1.7, 2.1, 4.1, 7.1, 7.8, 14.5_

- [ ] 5. Checkpoint — data layer proven against a real database
  - Start PostgreSQL, run `./scripts/migrate.sh`, then `bun run test tests/lib/server/store` and ensure every constraint test passes

- [ ] 6. Reconciliation core
  - [ ] 6.1 Implement `clip` for `Explicit_Mode` in `src/lib/server/domain/clipping.ts`
    - Define `UncoveredPolicy`, `ClipInput` and `ClipResult` per design component 3
    - Compute `inside = intersect(requested, tracked)` and `outside = subtract(requested, tracked)`
    - Set `conflicts = intersect(inside, covered)`; a non-empty value tells the caller to reject
    - Apply the policy: `clip` sets `discarded = outside`; `extend` sets `extend = outside` and `segments` to the whole requested interval; `reject` leaves `outside` for the caller to detect
    - _Requirements: 4.1, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ] 6.2 Implement `resolveAnchor` and `clip` for `Duration_Mode`
    - `resolveAnchor` returns the explicit start when given, else the end of the latest segment of the day, else the start of the earliest session of the day, else throws `NoPlacementAnchorError`
    - Compute `eligible = subtract(clamp(tracked, [anchor, dayBounds.end)), covered)` and call `take(eligible, durationMs)`
    - Under `extend`, append one interval of length `unplacedMs` starting at the later of the anchor and the last tracked instant in the window, return it in `extend`, and reset `unplacedMs` to zero
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ] 6.3 Write unit tests for `clip`
    - `tests/lib/server/domain/clipping.test.ts`
    - Named case `worked example, explicit`: tracked `[08:00–14:48, 15:12–18:00]`, requested `13:00–16:00` → segments `[13:00–14:48, 15:12–16:00]`
    - Named case `worked example, duration`: same frame, anchor `14:00`, `2h` → `[14:00–14:48, 15:12–16:24]` totalling exactly 120 minutes
    - A request wholly inside one session yields one segment; a request wholly outside tracked time yields none and reports the whole request as discarded
    - Each policy exercised in both modes; `conflicts` populated when the request meets an existing segment
    - `resolveAnchor` for all four branches of Requirements 5.2–5.5
    - _Requirements: 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 6.3, 6.5, 6.6, 6.7_

  - [ ]* 6.4 Write property tests for `clip`
    - `tests/lib/server/domain/clipping.property.test.ts` with generators for random frames, requests and policies
    - **Property 1: Segments never cover untracked time** — under `clip` and `reject`, every segment lies within tracked time
    - **Property 2: Duration mode preserves the requested duration** — with enough eligible time, segments total `d` and `unplacedMs` is zero
    - **Property 3: Breaks survive inside an entry** — gaps between consecutive segments contain no eligible tracked time
    - **Property 11: The original request is preserved** — the requested values are unchanged by clipping
    - **Validates: Requirements 4.2, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4**

  - [ ] 6.5 Implement re-clipping in `src/lib/server/domain/reclip.ts`
    - Declare `ReclipPorts` and `ReclipOutcome` per design component 4 so the module stays free of Drizzle
    - `reclipAffected` loads the affected entries in deterministic order, clears their segments, and re-runs `clip` for each with policy `clip`, treating already re-clipped entries as covered
    - Return `before`, `after` and `removedMs` per entry so a `Dry_Run` can report the consequence
    - Keep an entry with zero segments rather than deleting it when nothing survives
    - _Requirements: 2.7, 2.8, 14.2, 14.6_

  - [ ] 6.6 Write tests for re-clipping against a fake `ReclipPorts`
    - `tests/lib/server/domain/reclip.test.ts` with an in-memory fake, no database
    - Shrinking a session splits an entry that spanned it; deleting a session leaves an entry with zero segments; widening a session restores coverage
    - Two entries competing for freed time resolve in `requestedStartedAt` order
    - `removedMs` matches the time actually lost
    - _Requirements: 2.7, 2.8, 14.6_

  - [ ]* 6.7 Write a property test for re-clipping
    - `tests/lib/server/domain/reclip.property.test.ts`
    - **Property 9: Re-clipping is deterministic and idempotent** — applying `reclipAffected` twice yields the same segments as applying it once
    - **Validates: Requirements 2.7, 2.8**

- [ ] 7. Authentication and hooks
  - [ ] 7.1 Implement authentication in `src/lib/server/core/auth.ts`
    - `secretsMatch` compares in constant time; `beginBrowserSession` mints an opaque token from 32 random bytes and stores it with an expiry
    - `authenticate(event)` admits a valid session cookie or a bearer token equal to the `API_Token`, and reports which
    - Never log the token, the passphrase or the session identifier
    - `SESSION_COOKIE` is set with `httpOnly`, `sameSite: 'strict'`, explicit `path` and `maxAge`, and `secure` unless `APP_ENV` is `development`
    - Logout deletes the stored session; expired sessions are purged on access
    - _Requirements: 11.2, 11.3, 11.6, 11.7, 11.8, 11.9, 11.12, 11.13_

  - [ ] 7.2 Implement rate limiting in `src/lib/server/core/rate-limit.ts`
    - Per-address token bucket allowing `RATE_LIMIT_PER_MINUTE` requests per 60 seconds, returning 429 with `Retry-After`
    - A stricter bucket for the login route: 5 attempts per address per 15 minutes
    - Evict idle buckets so memory does not grow without bound
    - _Requirements: 11.11, 12.6_

  - [ ] 7.3 Compose `src/hooks.server.ts`
    - Export each handle individually, then `sequence(handleRequestId, handleRequestLog, handleCors, handleRateLimit, handleAuth)`
    - `handleAuth` is the `Auth_Hook`: it admits a valid `Browser_Session` or `API_Token`, exempts the `Health_Endpoint` and the login route, returns 401 `UNAUTHORIZED` for unauthenticated `/api` paths and redirects other paths to login
    - `handleCors` allows only the configured origins and never reflects an arbitrary `Origin`
    - Cap request bodies at 1 MiB, returning `PAYLOAD_TOO_LARGE`
    - Validate configuration at module load so a misconfigured deployment fails immediately
    - _Requirements: 11.1, 11.4, 11.5, 11.15, 12.5, 12.7, 12.8, 13.6_

  - [ ] 7.4 Implement the login and logout routes
    - A login route accepting a passphrase, comparing it in constant time, creating a session on success and returning a generic failure key otherwise
    - A logout route deleting the stored session and clearing the cookie
    - _Requirements: 11.8, 11.10, 11.12_

  - [ ] 7.5 Write tests for authentication and rate limiting
    - `tests/lib/server/core/auth.test.ts`: missing, malformed and wrong credentials each yield 401 on `/api`; a valid cookie passes; a valid bearer token passes; `/api/health` needs neither; no log line contains a secret; cookie flags are exactly as specified with `secure` off only in development
    - A wrong passphrase returns the same generic key as an empty one; logout invalidates server-side so the old cookie stops working; an expired session is rejected
    - `tests/lib/server/core/rate-limit.test.ts`: requests over the limit return 429 with `Retry-After`; the login bucket trips after 5 attempts in 15 minutes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 11.10, 11.11, 11.12, 11.13, 12.6_

- [ ] 8. REST routes
  - [ ] 8.1 Implement the session routes
    - `src/routes/api/sessions/{start,stop,current}/+server.ts`, `sessions/+server.ts`, `sessions/[id]/+server.ts`
    - Accept an optional explicit `startedAt` or `endedAt`, defaulting to now; return `SESSION_ALREADY_RUNNING` and `NO_SESSION_RUNNING` as specified
    - `current` reports the elapsed seconds of the `Open_Session`, or a null session
    - PATCH and DELETE call `reclipAffected` for the union of the old and new interval inside the same transaction, and honour `dryRun` by returning a `SessionChangePreview` with per-entry before and after segments and the total seconds that would be removed
    - Default the listing range to the current `Logical_Day`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 14.2, 14.3, 14.6, 14.7_

  - [ ] 8.2 Write tests for the session routes
    - `tests/api/sessions.test.ts`: start returns 201, a second start 409, stop 200, stop with none running 409, current with and without an open session
    - A PATCH producing an inverted interval returns 400; one producing an overlap returns 409 carrying the conflicting identifiers
    - DELETE returns 204 and re-clips overlapping entries; the same DELETE with `dryRun` returns the preview and leaves every row untouched
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.7, 2.3, 2.4, 2.5, 2.6, 2.7, 14.2, 14.5_

  - [ ] 8.3 Implement the project routes
    - `src/routes/api/projects/+server.ts` and `projects/[id]/+server.ts`
    - Validate the name as non-empty and at most 200 characters; support `include_archived`
    - Map store errors to `PROJECT_EXISTS` and `PROJECT_IN_USE`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 8.4 Write tests for the project routes
    - `tests/api/projects.test.ts`: create; a duplicate differing only in case rejected; empty and over-long names rejected; listing excludes archived by default and includes them on request; delete in use rejected; delete unused succeeds
    - Colour index: three projects get 0, 1, 2; deleting the second and creating another reuses 1; renaming and archiving leave the index untouched; a ninth project wraps back to 0
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ] 8.5 Implement the activity routes
    - `src/routes/api/activities/+server.ts` and `activities/[id]/+server.ts` with the Zod schemas from design component 9, using `.strict()` so unknown fields are rejected
    - Select the mode per Requirement 4.3 and reject naive timestamps
    - Run each write in one `withTx` call: load tracked and covered intervals, call `clip`, persist the entry, its segments and any extended sessions; pass `dryRun` straight through to `withTx`
    - Return `ACTIVITY_OVERLAP`, `OUTSIDE_TRACKED_TIME` and `NO_PLACEMENT_ANCHOR` as specified, always reporting `discarded`, `extendedSessions`, `unplacedMinutes` and `dryRun`
    - A PATCH touching only description or project skips re-clipping; one touching the interval or duration replaces the segments while ignoring the entry's own segments for overlap
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.5, 5.8, 5.9, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.2, 12.3, 14.1, 14.3, 14.4, 14.7_

  - [ ] 8.6 Write tests for the activity routes
    - `tests/api/activities.test.ts`, seeding the frame `[08:00–14:48, 15:12–18:00]` before each case
    - Explicit `13:00–16:00` returns 201 with two segments and the requested values preserved on the entry
    - Duration `2h` anchored at `14:00` returns 201 with segments totalling exactly 120 minutes
    - Both `endedAt` and `durationMinutes` returns 400 `AMBIGUOUS_MODE`; neither returns 400; a naive timestamp returns 400; an unknown field returns 400
    - An overlapping explicit request returns 409 `ACTIVITY_OVERLAP`; policy `reject` outside tracked time returns 409 and writes nothing; policy `extend` creates the covering session and reports it
    - A duration exceeding the remaining eligible time reports `unplacedMinutes` under the default policy
    - The same create with `dryRun` returns the identical body plus `dryRun: true` and leaves every table unchanged
    - PATCH of description alone leaves segments untouched; PATCH of the interval replaces them; DELETE returns 204
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.8, 6.5, 6.6, 6.7, 6.9, 7.4, 7.5, 7.6, 7.8, 10.2, 12.3, 14.1, 14.3, 14.5_

  - [ ] 8.7 Implement the day, coverage and health routes
    - `days/[date]/+server.ts` returns bounds, sessions, entries with segments, coverage and totals including the per-project breakdown; an empty day returns 200 with zeroes, never 404
    - `days/+server.ts` accepts `from` and `to`, returns one summary per `Logical_Day`, and rejects spans over 366 days with `RANGE_TOO_LARGE`
    - `coverage/+server.ts` returns `tracked`, `covered`, the `Uncovered_Time` intervals and the `Untracked_Time` intervals, computing `uncovered` as `subtract(tracked, covered)` and `untracked` as `gaps(tracked, window)`, honouring `min_gap_seconds` and defaulting the range to the current `Logical_Day`
    - `health/+server.ts` is the `Health_Endpoint`: 200 with status `ok` and the version without a credential, or 503 `degraded` when a short database ping fails
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 13.1, 13.2, 13.3_

  - [ ] 8.8 Write tests for the day, coverage and health routes
    - `tests/api/days.test.ts`: a populated day returns correct totals and per-project seconds; an empty day returns 200 with zeroes; a malformed date returns 400; a 400-day range returns `RANGE_TOO_LARGE`
    - `tests/api/coverage.test.ts`: `covered` and `uncovered` reconstruct `tracked` exactly; `untracked` holds the breaks; `min_gap_seconds` filters short gaps; `from` after `to` returns 400
    - `tests/api/health.test.ts`: 200 with a reachable database, 503 when it is not, and no credential required
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.3, 9.4, 9.5, 9.6, 13.1, 13.2, 13.3_

- [ ] 9. Checkpoint — API complete
  - Run `bun run check && bun run test` with PostgreSQL running and ensure every unit, property, integration and route test passes

- [ ] 10. Guards
  - [ ] 10.1 Write the module boundary test
    - `tests/lib/server/imports.test.ts` walks the import graph of `src/lib/server/`
    - Fail when `domain` imports anything under `store` or `core`, Drizzle, `$env`, `$app` or SvelteKit; when `store` imports from `routes`; when `core` imports `domain` or `store`
    - _Requirements: 6.1, 6.2_

  - [ ]* 10.2 Write property tests for write atomicity
    - `tests/lib/server/store/atomicity.property.test.ts` against a real database, generating request sequences of which many are rejected
    - **Property 10: Rejected writes leave no trace** — after any 4xx the three tables are unchanged
    - **Validates: Requirements 6.9**

  - [ ]* 10.3 Write property tests for the dry run
    - `tests/api/dry-run.property.test.ts` against a real database
    - **Property 13: A dry run predicts the write exactly** — running a request as a dry run and then for real produces the state the dry run reported, with the same status code
    - **Property 14: A dry run changes nothing** — every table is byte-identical before and after a dry run
    - **Validates: Requirements 14.1, 14.3, 14.4, 14.5**

  - [ ]* 10.4 Write property tests for the global invariants
    - `tests/lib/server/store/overlap.property.test.ts` applying random accepted writes
    - **Property 8: Activity segments never overlap globally** — no two rows overlap after any sequence of accepted operations
    - **Property 7: Coverage partitions tracked time** — `covered` and `uncovered` are disjoint and reconstruct `tracked`
    - **Validates: Requirements 4.5, 6.4, 9.3**

- [ ] 11. Packaging and deployment
  - [ ] 11.1 Write the `Dockerfile` and `.dockerignore`
    - Two stages on `oven/bun:1.2.15` then `oven/bun:1.2.15-slim`, with granular COPY layers — `package.json bun.lock` first, then configs, then `project.inlang`, `messages`, `static`, `src`
    - Placeholder env values so build-time config validation passes, `bun x svelte-kit sync && bun run build`, `CMD ["bun", "run", "build/index.js"]`, port 3000, non-root user
    - `.dockerignore` excludes `.git`, `tests/`, `.env*`, `.kiro/`, `build/`, `node_modules/`
    - _Requirements: 13.7_

  - [ ] 11.2 Write `fly.toml`
    - `app = "worklog"`, `primary_region = "fra"`, `internal_port = 3000`, `force_https`, HTTP health check against `/api/health`
    - `[env]` carries only non-secret configuration — `PORT`, `TIMEZONE`, `DAY_START_HOUR`, `APP_ENV`
    - Never place `WORKLOG_API_TOKEN`, `WORKLOG_PASSPHRASE` or `DATABASE_URL` in this file
    - _Requirements: 11.14, 13.1_

  - [ ] 11.3 Write the deployment scripts
    - `scripts/build.sh`, `scripts/start-docker.sh`, `scripts/stop-docker.sh`, `scripts/deploy.sh`, all with `#!/bin/bash`, `set -euo pipefail` and the Script Portability preamble, parsing the app name from the resolved fly config
    - `deploy.sh` takes the environment as `$1` defaulting to `prod`, resolves `.env.<env>` and `fly.<env>.toml` with a `fly.toml` fallback, validates required files before any remote call and exits 2 when one is missing, resolves the org from the config prompting through `/dev/tty` when absent and persisting the choice, creates the app only when missing, sets secrets skipping keys already in `[env]`, then deploys
    - _Requirements: 13.6, 13.7_

  - [ ] 11.4 Write `README.md`
    - Local setup, migrations, and Fly.io deployment in the order the README standard requires
    - Document every environment variable and give a full endpoint table with request and response examples, including a `dryRun` example
    - Include the worked reconciliation example showing `13:00–16:00` over a broken frame becoming two segments
    - _Requirements: 13.6_

- [ ] 12. Checkpoint — deployable service
  - Run `./scripts/start-docker.sh`, apply migrations, exercise the worked example end to end with `curl` using the bearer token, confirm `/api/health` responds, then `./scripts/stop-docker.sh`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.6"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1", "2.4", "2.7", "4.1", "4.2"] },
    { "id": 2, "tasks": ["1.5", "2.2", "2.3", "2.5", "2.6", "4.3", "6.1"] },
    { "id": 3, "tasks": ["4.4", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "6.5", "7.1", "7.2"] },
    { "id": 5, "tasks": ["4.8", "4.9", "6.6", "6.7", "7.3", "7.4"] },
    { "id": 6, "tasks": ["7.5", "8.1", "8.3", "8.5", "8.7"] },
    { "id": 7, "tasks": ["8.2", "8.4", "8.6", "8.8", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Every one of them is a property test; the unit, integration and route tests are not optional.
- **Driver choice**: this project uses `drizzle-orm/postgres-js`, not the workspace-standard `drizzle-orm/neon-http`. The Neon HTTP driver cannot run interactive transactions — the template's own `src/lib/core/audit/writer.ts` documents that `db.transaction()` always throws — and every write here depends on one. Do not "align" this back to `neon-http`.
- **Migrations** are hand-written SQL in `migrations/` at the root, applied only by `scripts/migrate.sh`. `drizzle-kit migrate` is deliberately unused, because `EXCLUDE USING gist` and expression-based partial indexes cannot be expressed in the Drizzle schema DSL. `src/db/schema/` exists for typed queries and is checked against the migrated database by a test.
- **Logical day and DST**: with `DAY_START_HOUR=3` in `Europe/Prague`, the irregular day is the one **before** each transition — `2026-03-28` is 23 hours, `2026-10-24` is 25 hours — while the transition dates themselves are 24. This was measured, not assumed. Do not write tests that expect the transition date to be short or long.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL with plain `docker run` on the sandbox's own network and reach it by container name — a published port on `localhost` will not be reachable from the shell. The `sandbox-docker-net` skill has the details.
- The schema was verified against `postgres:16-alpine` while the design was written: the single-open-session index, both exclusion constraints, acceptance of touching intervals and the deferred reshuffle all behave as specified.
- `Interval` is half-open `[start, end)`. This is what lets one session end at 12:00 and the next begin at 12:00 without overlapping, and it must hold in the TypeScript and in the `tstzrange` columns alike.
- `src/lib/server/domain/` must stay free of Drizzle, `$env`, `$app` and SvelteKit imports. `reclipAffected` takes a `ReclipPorts` object instead of reaching for the store, which is also what makes it testable without a database. Task 10.1 enforces this.
- The advisory lock constant `4919372001` is arbitrary but fixed. Every mutating transaction must take it as its first statement, or the clipping read-modify-write cycle is open to races.
- A `Dry_Run` is the real write rolled back, not a separate code path. Keep it that way — it is what makes Property 13 hold.
- `pause` is not a server concept. The client sends `/api/sessions/stop` to pause and `/api/sessions/start` to resume; the gap between the two sessions is the break that reconciliation later preserves.
- `fast-check` must be a declared dependency here. The workspace template relies on it only transitively, which is a latent break.
- Error `message` fields carry Paraglide message keys, not prose, so both the interface and external callers get something stable.
- Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
