# Implementation Plan: worklog-domain-api

## Overview

Build the `Worklog_Server` — the server-side half of the Worklog SvelteKit application: the pure reconciliation domain, the PostgreSQL data layer, the `Auth_Hook` and the REST routes under `/api`. Work proceeds bottom-up — the pure `domain` modules first, then the schema and stores against a real database, then reconciliation, authentication, and finally the routes.

The runtime is Bun 1.2.15 with SvelteKit ^2.63 on Svelte 5, Drizzle ORM over `postgres.js`, and Zod at every boundary. Pure logic is covered by Vitest unit tests and `fast-check` property tests that need no database; the schema guarantees and atomicity are covered by integration tests against a PostgreSQL container; routes are covered by direct handler tests. Test tasks follow the implementation task they validate, and four checkpoints mark the phase boundaries.

## Tasks

- [ ] 1. Project scaffolding and server infrastructure
  - [ ] 1.1 Initialize the SvelteKit project
    - Scaffold with Bun 1.2.15; set `packageManager`, `engines.bun`, `.npmrc` with `engine-strict=true`, and `bunfig.toml` with `[run] bun = true`
    - Dependencies: `@sveltejs/kit` ^2.63, `svelte` ^5.56, `vite` ^8, `@sveltejs/adapter-node` ^5.5, `typescript` ^6 strict, `drizzle-orm` ^0.45, `postgres` ^3.4, `zod` ^4, `@date-fns/tz` ^1.5, `@inlang/paraglide-js` ^2.18
    - Dev dependencies: `vitest` ^4, `fast-check` ^4 declared explicitly, `@playwright/test`, `drizzle-kit`, `eslint`, `prettier`
    - Scripts matching the workspace: `dev`, `build`, `preview`, `prepare`, `messages:compile`, `check`, `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:local`, `test:all`, `lint`, `format`
    - Set `version` in `package.json` to `0.1.0` as the single source of truth; nothing else may declare a version
    - Aliases in `svelte.config.js`: `$lib`, `$db`, `$modules`; `compilerOptions.runes: true`
    - Commit `bun.lock`
    - _Requirements: 13.8, 13.9, 13.10_

  - [ ] 1.2 Implement configuration in `src/lib/server/core/config.ts`
    - Define `Config` and `loadConfig()` per design component 11, reading `version` from `package.json`
    - Defaults: `PORT=3000`, `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`, `APP_ENV=production`, `DB_QUERY_TIMEOUT_SECONDS=5`, `RATE_LIMIT_PER_MINUTE=120`, `SESSION_DURATION_HOURS=720`, `MAX_OPEN_SESSION_HOURS=12`, `MIN_INTERVAL_SECONDS=60`, `ALLOW_DAY_BOUNDARY_CHANGE=false`
    - Validate: `DATABASE_URL` non-empty; `WORKLOG_API_TOKEN` at least 32 characters; `WORKLOG_PASSPHRASE_HASH` present and parseable as argon2id; `DAY_START_HOUR` in 0..23; `TIMEZONE` loadable
    - Reject `CORS_ORIGINS=*` unless `APP_ENV` is `development`
    - Throw once listing every problem, not just the first
    - _Requirements: 10.4, 10.5, 10.9, 11.16, 11.17, 13.6, 13.8, 13.9, 13.10_

  - [ ] 1.3 Implement logging and request identity
    - `src/lib/server/core/logger.ts`: JSON lines to stdout carrying `timestamp`, `level`, `message`, `requestId`; a redaction helper used wherever a secret could reach a log call
    - `src/lib/server/core/request-id.ts`: read `X-Request-Id`, generate a UUID when absent, expose it on `locals`, echo it back
    - Declare `App.Locals` in `src/app.d.ts` with `requestId`, `auth` and `cspNonce`
    - _Requirements: 11.9, 12.10, 12.11_

  - [ ] 1.4 Implement the error envelope in `src/lib/server/core/errors.ts`
    - Define the `ErrorCode` union, `ApiError`, `errorResponse()` and `messageKeyFor()` per design component 8
    - Fix the field-naming rule in one place and apply it to every route: JSON bodies use `camelCase`, query parameters use `snake_case`
    - The body carries `error`, an English `message`, a `messageKey`, and optional `details`
    - Map any unknown error to 500 `INTERNAL_ERROR`, logging the real cause with the `requestId`
    - Never place stack traces, SQL text or filesystem paths in a response body
    - _Requirements: 12.1, 12.2, 12.3, 12.5_

  - [ ] 1.5 Implement security headers in `src/lib/server/core/security-headers.ts`
    - Generate a per-request nonce onto `locals`, inject it through `transformPageChunk` into `%sveltekit.nonce%`
    - Set `Content-Security-Policy`, `Strict-Transport-Security` (production only), `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'` exactly as in design component 8
    - The production policy carries neither `unsafe-inline` nor `unsafe-eval`; development relaxes it through configuration, never through a weakened production path
    - _Requirements: 12.12, 12.13_

  - [ ] 1.6 Write unit tests for configuration, errors and headers
    - `tests/lib/server/core/config.test.ts`: defaults applied; missing `DATABASE_URL`, short token and missing passphrase hash each rejected; `DAY_START_HOUR=24` rejected; bad `TIMEZONE` rejected; wildcard CORS rejected outside development; several failures reported together; version comes from the manifest
    - `tests/lib/server/core/errors.test.ts`: envelope carries `error`, `message` and `messageKey`; every `ErrorCode` maps to a distinct key; unknown error becomes `INTERNAL_ERROR` 500; a stack trace never reaches the body
    - `tests/lib/server/core/security-headers.test.ts`: all five headers present; production CSP free of `unsafe-inline` and `unsafe-eval`; the nonce differs between requests
    - _Requirements: 10.9, 11.16, 11.17, 12.2, 12.3, 12.12, 12.13, 13.9_

  - [ ] 1.7 Create `.env.example` and fix `.gitignore`
    - `.env.example` lists every variable `loadConfig` reads, grouped by comments, placeholders for secrets and real defaults elsewhere
    - `.gitignore` covers `.env`, `.env.*`, `!.env.example`, `src/lib/paraglide/`, `build/`, `node_modules/`, `.svelte-kit/` — and no longer mentions the abandoned Go layout
    - _Requirements: 13.8_

- [ ] 2. Pure domain — interval algebra and logical day
  - [ ] 2.1 Implement the interval algebra in `src/lib/server/domain/interval.ts`
    - Define `Interval` as half-open `[start, end)` and implement `isEmpty`, `duration`, `overlaps`, `normalize`, `union`, `intersect`, `subtract`, `clamp`, `total`, `take`, `gaps` per design component 1
    - `normalize` sorts by start, drops empty intervals, merges overlapping **and touching** ones
    - `take` splits the interval in which the requested duration runs out and reports the remainder
    - The module imports nothing from the project, no Drizzle and no SvelteKit
    - _Requirements: 9.2, 9.3_

  - [ ] 2.2 Write unit tests for the interval algebra
    - `tests/lib/server/domain/interval.test.ts`: empty input; single interval; touching merge; overlapping merge; disjoint stay separate
    - `subtract` producing a hole in the middle, at the head, at the tail, and eliminating an interval entirely
    - `take` with zero, less than the first interval, exactly the first interval, spanning two intervals, and exceeding the total
    - `gaps` over a window wider than, narrower than and equal to the input
    - _Requirements: 9.2, 9.3_

  - [ ]* 2.3 Write property tests for the interval algebra
    - `tests/lib/server/domain/interval.property.test.ts` with generators producing unsorted lists with duplicates and zero-length entries
    - **Property 4: Interval algebra is conservative** — `total(intersect(a,b)) + total(subtract(a,b)) === total(normalize(a))`
    - **Property 5: Normalization is idempotent and canonical**
    - **Property 6: Take is exact and order-preserving**
    - **Validates: Requirements 5.8, 5.10, 9.2, 9.3**

  - [ ] 2.4 Implement `createDayResolver` in `src/lib/server/domain/logical-day.ts`
    - Use `TZDate` from `@date-fns/tz` for DST-correct arithmetic
    - Throw when the timezone is not loadable or `startHour` is outside 0..23
    - `bounds(date)` runs from `startHour` to `startHour` the next date; `dateOf(t)` attributes instants before `startHour` to the previous date; `range(from, to)` yields one window per day
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ] 2.5 Write unit tests for the logical day
    - `tests/lib/server/domain/logical-day.test.ts`: `02:30` belongs to the previous date; `03:00` and `23:59` to the current one
    - Pin the DST dates exactly — with `startHour = 3` in `Europe/Prague` the **day before** each transition is the irregular one: `2026-03-28` is 23 hours, `2026-10-24` is 25 hours, and both transition dates are 24. Do not assume the transition date itself is short or long.
    - `startHour = 0` behaves as a plain calendar day; a malformed date string is rejected
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ]* 2.6 Write a property test for the logical day
    - `tests/lib/server/domain/logical-day.property.test.ts` over several years including both transitions
    - **Property 12: Logical day assignment is a partition**
    - **Validates: Requirements 10.5, 10.6**

  - [ ] 2.7 Implement the domain types in `src/lib/server/domain/models.ts`
    - `WorkSession`, `Project`, `ActivityEntry`, `ActivitySegment`, `ActivityMode`, `ProjectTotal` per the design's Domain Types section
    - `ActivityEntry` carries the verbatim requested values and an `orphaned` flag
    - Serialize every timestamp as RFC 3339 in UTC
    - _Requirements: 4.2, 7.3, 10.1, 10.3_

- [ ] 3. Checkpoint — pure domain proven
  - Run `bun run check && bun run test tests/lib/server/domain tests/lib/server/core` with no database running

- [ ] 4. Schema and data layer
  - [ ] 4.1 Write `migrations/001_init.sql`
    - Create `btree_gist`, then `projects`, `work_sessions`, `activity_entries`, `activity_segments`, `auth_sessions`, `idempotency_keys`, `day_boundary_config` and `schema_migrations` exactly as in the design Data Models section
    - Include `work_sessions_one_open`, the gist range index on `work_sessions`, both `EXCLUDE USING gist` constraints, `projects_name_unique` on `lower(btrim(name))`, and every check constraint
    - Declare `activity_segments_no_overlap` as `DEFERRABLE INITIALLY DEFERRED`
    - Create `set_updated_at()` and its triggers on `work_sessions` and `activity_entries`
    - _Requirements: 1.9, 2.7, 3.2, 3.3, 4.5, 4.8, 6.4, 11.7, 12.8, 13.7_

  - [ ] 4.2 Write `scripts/migrate.sh`
    - `#!/bin/bash` with `set -euo pipefail` and the Script Portability preamble
    - Take the environment name as `$1`, defaulting to the local `.env`
    - Take a session advisory lock first, so two concurrent runs cannot interleave
    - Create `schema_migrations` when absent, then apply each unapplied `migrations/*.sql` in filename order inside a transaction, recording the filename
    - Idempotent — a second run applies nothing and exits 0
    - This is the only supported way to apply migrations; `drizzle-kit migrate` is not used, because the exclusion constraints are not expressible in the Drizzle DSL. There are no down migrations: a mistake is corrected by a new forward migration.
    - _Requirements: 13.8_

  - [ ] 4.3 Write the Drizzle schema in `src/db/schema/`
    - One file per table plus a barrel `index.ts`, mirroring the SQL for typed queries
    - Do not express `EXCLUDE` constraints, expression indexes or triggers here — the SQL is the authority
    - _Requirements: 1.1, 3.1, 4.1, 11.7_

  - [ ] 4.4 Implement the transaction helper in `src/lib/server/store/tx.ts`
    - Build the Drizzle client over `postgres.js` with the configured query timeout
    - `withTx(fn, { dryRun })` opens a transaction, runs `select pg_advisory_xact_lock(4919372001)` first, runs `fn`, then commits — or rolls back when `dryRun` is set, by throwing a private rollback signal caught outside
    - `translateConstraintError` maps the SQLSTATE and constraint names from the design table to `ApiError` codes
    - Register a shutdown handler on `sveltekit:shutdown` closing the pool, and set `SHUTDOWN_TIMEOUT` so `adapter-node` drains for up to 30 seconds before exiting 0
    - _Requirements: 6.11, 13.5, 13.6, 14.1, 14.5_

  - [ ] 4.5 Implement `src/lib/server/store/work-sessions.ts`
    - Open, close, current, get, list overlapping, create closed, update, delete, insert many
    - `trackedIntervals` returns normalized intervals, treating an `Open_Session` as running until `now` **but never longer than `MAX_OPEN_SESSION_HOURS`**, so an abandoned timer cannot inflate totals
    - _Requirements: 1.1, 1.5, 1.8, 1.10, 1.12, 2.1, 2.2, 2.5, 2.8_

  - [ ] 4.6 Implement `src/lib/server/store/projects.ts`
    - Create, list with `includeArchived`, update name, archived state and colour index, delete
    - Translate the uniqueness violation to `PROJECT_EXISTS`; on a foreign-key violation return `PROJECT_IN_USE` with the referencing entry **ids** from `entryIdsForProject`, not just a count
    - `createProject` assigns `colorIndex` as the lowest value in 0..7 not held by a non-archived project, wrapping when all eight are taken; renaming, archiving and unarchiving never change it
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ] 4.7 Implement `src/lib/server/store/activities.ts`
    - Every function from design component 6, including `orphanedEntriesOverlapping` and `entryIdsForProject`
    - `createEntry` writes the entry and its segments together; `replaceSegments` deletes then reinserts, relying on the deferred constraint
    - `coveredIntervals` accepts an entry to exclude; `entriesOverlapping` orders by `requestedStartedAt` then `createdAt`
    - `listEntriesOverlapping` joins the project name, attaches segments, sets `orphaned`, and unions in the orphans selected by requested interval
    - _Requirements: 4.1, 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.11_

  - [ ] 4.8 Write integration tests for the schema constraints
    - `tests/lib/server/store/schema.test.ts` against PostgreSQL 16 started with plain `docker run` on the sandbox network and reached by container name
    - A second `Open_Session` rejected; overlapping closed sessions rejected; sessions touching at one instant accepted
    - Overlapping segments rejected; a delete-then-reinsert reshuffle in one transaction succeeds
    - Deleting a referenced `Project` rejected; names differing only in case or whitespace collide
    - `updated_at` advances on UPDATE and not on unrelated writes
    - Assert every Drizzle column exists in the migrated database with a compatible type
    - _Requirements: 1.9, 2.7, 3.2, 3.7, 4.5, 6.4, 13.7_

  - [ ] 4.9 Write integration tests for the stores
    - `tests/lib/server/store/work-sessions.test.ts`: start, stop, current when none open, create closed, listing by window with partial overlaps, `trackedIntervals` with an open session, and with a session past `MAX_OPEN_SESSION_HOURS` contributing only the capped part
    - `tests/lib/server/store/activities.test.ts`: create with several segments, `coveredIntervals` with and without exclusion, `replaceSegments`, `entriesOverlapping` ordering, cascade delete, and an emptied entry still returned by `orphanedEntriesOverlapping`
    - `tests/lib/server/store/projects.test.ts`: colour index assignment, reuse after delete, stability across rename and archive, wrap at the ninth project, `PROJECT_IN_USE` carrying entry ids
    - `tests/lib/server/store/tx.test.ts`: commits on success, rolls back on throw, rolls back on `dryRun` while returning the value
    - Provide a helper truncating every table between tests
    - _Requirements: 1.1, 1.5, 1.8, 1.12, 2.1, 3.7, 3.9, 3.10, 4.1, 7.1, 7.2, 7.11, 14.5_

- [ ] 5. Checkpoint — data layer proven against a real database
  - Start PostgreSQL, run `./scripts/migrate.sh`, then `bun run test tests/lib/server/store`

- [ ] 6. Reconciliation core
  - [ ] 6.1 Implement `clip` for `Explicit_Mode` in `src/lib/server/domain/clipping.ts`
    - Define `UncoveredPolicy`, `ClipInput` and `ClipResult` per design component 3
    - Compute `inside = intersect(requested, tracked)` and `outside = subtract(requested, tracked)`
    - Set `conflicts = intersect(inside, covered)`; a non-empty value tells the caller to reject
    - Discard any resulting segment shorter than `MIN_INTERVAL_SECONDS` and report it among the discarded intervals
    - Apply the policy: `clip` sets `discarded`; `extend` sets `extend` and takes the whole requested interval, never reaching into the future; `reject` leaves `outside` for the caller
    - _Requirements: 4.1, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [ ] 6.2 Implement `resolveAnchor` and `clip` for `Duration_Mode`
    - `resolveAnchor` returns the explicit start when given, else the end of the `Target_Day`'s latest segment, else the start of its earliest session, else throws `NoPlacementAnchorError`
    - Compute `eligible = subtract(clamp(tracked, [anchor, dayBounds.end)), covered)` and call `take(eligible, durationMs)`
    - Under `extend`, append one interval of length `unplacedMs` after the last tracked instant in the window, never in the future, and reset `unplacedMs`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12_

  - [ ] 6.3 Implement `Open_Mode`
    - Resolve the start with `resolveAnchor`; the end is now for the current `Logical_Day`, or the end of the `Target_Day`'s last `Work_Session` for a past day — so a morning-after quick log still works
    - Run the `Explicit_Mode` path with the resolved interval; store it as the entry's requested interval with `mode` recording that it was inferred
    - Reject with `NOTHING_TO_LOG` when the resolved start is not before the resolved end
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

  - [ ] 6.4 Write unit tests for `clip`
    - `tests/lib/server/domain/clipping.test.ts`
    - Named case `worked example, explicit`: tracked `[08:00–14:48, 15:12–18:00]`, requested `13:00–16:00` → `[13:00–14:48, 15:12–16:00]`
    - Named case `worked example, duration`: same frame, anchor `14:00`, `2h` → `[14:00–14:48, 15:12–16:24]`, exactly 120 minutes
    - A request wholly inside one session yields one segment; wholly outside yields none and reports everything discarded
    - A clip producing a 20-second sliver discards it and reports it
    - Each policy in every mode; `conflicts` populated on collision; `extend` never produces a future interval
    - `resolveAnchor` for all four branches of Requirements 5.4–5.7
    - _Requirements: 4.1, 5.1, 5.4, 5.5, 5.6, 5.7, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 15.2, 15.3_

  - [ ]* 6.5 Write property tests for `clip`
    - `tests/lib/server/domain/clipping.property.test.ts`
    - **Property 1: Segments never cover untracked time**
    - **Property 2: Duration mode preserves the requested duration**
    - **Property 3: Breaks survive inside an entry**
    - **Property 11: The original request is preserved**
    - **Property 17: No stored interval is shorter than the floor**
    - **Validates: Requirements 1.14, 4.2, 5.8, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5**

  - [ ] 6.6 Implement re-clipping in `src/lib/server/domain/reclip.ts`
    - Declare `ReclipPorts` and `ReclipOutcome` per design component 4 so the module stays free of Drizzle
    - `reclipAffected` loads affected entries in deterministic order, clears their segments, and re-runs `clip` for each with `PolicyClip`, treating already re-clipped entries as covered
    - Return `projectName`, `description`, `before`, `after`, `removedMs` and `orphaned` per entry so a `Dry_Run` can name the consequence
    - Keep an entry with zero segments rather than deleting it
    - _Requirements: 2.9, 2.10, 14.2, 14.6_

  - [ ] 6.7 Write tests for re-clipping against a fake `ReclipPorts`
    - `tests/lib/server/domain/reclip.test.ts` with an in-memory fake, no database
    - Shrinking a session splits an entry; deleting a session leaves it orphaned with `orphaned: true`; widening restores coverage
    - Two entries competing for freed time resolve in `requestedStartedAt` order
    - `removedMs` matches the time actually lost; `projectName` and `description` are carried through
    - _Requirements: 2.9, 2.10, 14.2, 14.6_

  - [ ]* 6.8 Write a property test for re-clipping
    - **Property 9: Re-clipping is deterministic and idempotent**
    - **Validates: Requirements 2.9, 2.10**

- [ ] 7. Authentication and hooks
  - [ ] 7.1 Implement authentication in `src/lib/server/core/auth.ts`
    - `verifyPassphrase` checks the submitted passphrase against `WORKLOG_PASSPHRASE_HASH` with `Bun.password` (argon2id); the plaintext is never stored anywhere
    - `beginBrowserSession` mints a token from 32 random bytes, stores only its hash, and returns the raw token for the cookie
    - `authenticate(event)` admits a valid session cookie or a bearer token equal to the `API_Token` compared in constant time, and reports which
    - Never log the token, the passphrase or the session identifier
    - `SESSION_COOKIE` is set with `httpOnly`, `sameSite: 'strict'`, explicit `path` and `maxAge`, and `secure` unless `APP_ENV` is `development`
    - Reject a session cookie presented on a cross-origin request, so `SameSite=Strict` remains sufficient CSRF protection
    - Logout deletes the stored session; expired sessions are purged on access
    - _Requirements: 11.2, 11.3, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.14, 11.15, 11.18_

  - [ ] 7.2 Implement rate limiting in `src/lib/server/core/rate-limit.ts`
    - Per-address token bucket allowing `RATE_LIMIT_PER_MINUTE` requests per 60 seconds, returning 429 with `Retry-After`
    - A stricter bucket for the login route: 5 attempts per address per 15 minutes
    - Evict idle buckets so memory does not grow without bound
    - _Requirements: 11.13, 12.7_

  - [ ] 7.3 Implement idempotency in `src/lib/server/core/idempotency.ts`
    - On a POST to `/api/activities` carrying `Idempotency-Key`, look the key up first and replay the stored response when present
    - Otherwise store the key with the resulting response inside the same transaction as the write
    - Purge keys older than 24 hours
    - _Requirements: 12.8, 12.9_

  - [ ] 7.4 Compose `src/hooks.server.ts`
    - Export each handle individually, then `sequence(handleRequestId, handleRequestLog, handleSecurityHeaders, handleCors, handleRateLimit, handleAuth)`
    - `handleAuth` is the `Auth_Hook`: it admits a valid `Browser_Session` or `API_Token`, exempts the `Health_Endpoint` and the login route, returns 401 for unauthenticated `/api` paths and redirects other paths to login **carrying the originally requested path**
    - `handleCors` allows only the configured origins and never reflects an arbitrary `Origin`
    - Cap request bodies at 1 MiB, returning `PAYLOAD_TOO_LARGE`
    - Validate configuration at module load, and refuse to serve when migrations are unapplied or `day_boundary_config` disagrees with the environment without `ALLOW_DAY_BOUNDARY_CHANGE`
    - _Requirements: 10.10, 11.1, 11.4, 11.5, 11.17, 12.6, 12.10, 12.11, 13.4, 13.8_

  - [ ] 7.5 Implement the login and logout routes
    - `src/routes/login/+page.server.ts` and `src/routes/logout/+page.server.ts` — the **server halves only**; `002` builds the pages that render them
    - Compare in constant time, create a session on success, redirect to the originally requested path, return a generic failure key otherwise
    - _Requirements: 11.5, 11.6, 11.10, 11.12, 11.14_

  - [ ] 7.6 Write tests for authentication, rate limiting and idempotency
    - `tests/lib/server/core/auth.test.ts`: missing, malformed and wrong credentials each yield 401 on `/api`; a valid cookie passes; a valid bearer token passes; `/api/health` needs neither; no log line contains a secret; cookie flags exactly as specified; a cross-origin request with only a cookie is refused
    - A wrong passphrase returns the same generic key as an empty one; logout invalidates server-side; an expired session is rejected; the stored hash never equals the submitted passphrase
    - `tests/lib/server/core/rate-limit.test.ts`: over the limit returns 429 with `Retry-After`; the login bucket trips after 5 attempts in 15 minutes
    - `tests/lib/server/core/idempotency.test.ts`: a repeated key replays the original response and creates nothing
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.7, 11.8, 11.9, 11.11, 11.12, 11.13, 11.14, 11.15, 11.18, 12.7, 12.8, 12.9_

- [ ] 8. REST routes
  - [ ] 8.1 Implement the session routes
    - `src/routes/api/sessions/{start,stop,current}/+server.ts`, `sessions/+server.ts` (GET list and **POST create closed**), `sessions/[id]/+server.ts`
    - Validate with `startSessionSchema`, `stopSessionSchema`, `createSessionSchema`, `patchSessionSchema` and `deleteSessionSchema`
    - Return `SESSION_ALREADY_RUNNING`, `NO_SESSION_RUNNING`, `SESSION_OVERLAP`, `FUTURE_TIMESTAMP` and `INTERVAL_TOO_SHORT` as specified
    - `current` returns `CurrentSessionResponse` with elapsed seconds and the `stale` flag
    - Create, PATCH and DELETE call `reclipAffected` for the union of the old and new interval inside the same transaction, and honour `dryRun` by returning a `SessionChangePreview`
    - Default the listing range to the current `Logical_Day` and reject spans over 366 days
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.13, 1.14, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 14.2, 14.3, 14.6, 14.9_

  - [ ] 8.2 Write tests for the session routes
    - `tests/api/sessions.test.ts`: start 201, second start 409, stop 200, stop with none running 409, current with and without an open session including `stale`
    - `POST /api/sessions` creates a closed session and re-clips; an inverted interval 400; an overlap 409 with identifiers; a future start 400; a 30-second session 400
    - DELETE 204 and re-clips; the same DELETE with `dryRun` returns the preview naming each affected entry and leaves every row untouched
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.8, 1.10, 1.13, 1.14, 2.1, 2.5, 2.6, 2.7, 2.8, 2.9, 14.2, 14.5_

  - [ ] 8.3 Implement the project routes
    - `src/routes/api/projects/+server.ts` and `projects/[id]/+server.ts` with `createProjectSchema` and `patchProjectSchema`
    - PATCH accepts name, archived state and `colorIndex`
    - Map store errors to `PROJECT_EXISTS` and `PROJECT_IN_USE`, the latter carrying entry ids
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ] 8.4 Write tests for the project routes
    - `tests/api/projects.test.ts`: create; duplicate differing only in case rejected; empty and over-long names rejected; listing excludes archived by default; delete in use rejected with entry ids in the details; delete unused succeeds; PATCH sets a colour index another project already holds
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11_

  - [ ] 8.5 Implement the activity routes
    - `src/routes/api/activities/+server.ts` and `activities/[id]/+server.ts` with `createActivitySchema` and `patchActivitySchema`, both `.strict()`
    - Select the mode from the design's table: `endedAt` alone is `Explicit_Mode`, `durationMinutes` alone is `Duration_Mode`, neither is `Open_Mode`, both is `AMBIGUOUS_MODE`; reject naive timestamps and future instants
    - Resolve the `Target_Day` from `date`, defaulting to the current `Logical_Day`, so yesterday can be filled in the next morning
    - Reject an archived `projectId` with `PROJECT_ARCHIVED`
    - Run each write in one `withTx` call; pass `dryRun` through; honour `Idempotency-Key`; verify `previewToken` and return `STALE_PREVIEW` on mismatch
    - Always report `discarded`, `extendedSessions`, `unplacedMinutes`, `removedSeconds`, `dryRun` and `previewToken`
    - GET returns entries including orphans selected by requested interval, each flagged `orphaned`; range over 366 days rejected
    - A PATCH touching only description or project skips re-clipping; one touching the interval or duration replaces the segments while ignoring the entry's own segments for overlap
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.2, 5.3, 5.7, 5.11, 5.12, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 10.2, 12.4, 12.8, 14.1, 14.3, 14.4, 14.7, 14.8, 14.9, 15.1, 15.6, 15.7, 15.8, 15.9_

  - [ ] 8.6 Write tests for the activity routes
    - `tests/api/activities.test.ts`, seeding the frame `[08:00–14:48, 15:12–18:00]` before each case
    - Explicit `13:00–16:00` returns 201 with two segments and the requested values preserved
    - Duration `2h` anchored at `14:00` totals exactly 120 minutes
    - `Duration_Mode` with `date` set to yesterday places against yesterday's frame, not today's
    - `Open_Mode` with only a `projectId` records from the last segment's end to now; with `date` in the past it ends at that day's last session end; an empty day returns `NO_PLACEMENT_ANCHOR`; a last segment already reaching now returns `NOTHING_TO_LOG`
    - Both `endedAt` and `durationMinutes` 400; neither with no project 400; a naive timestamp 400; an unknown field 400; a future interval 400; an archived project 400
    - An overlapping explicit request returns 409 with conflicting entry ids, project names and descriptions; policy `reject` outside tracked time 409 writing nothing; policy `extend` creates the covering session and reports it
    - A duration exceeding the eligible time reports `unplacedMinutes`
    - The same create with `dryRun` returns the identical body plus `dryRun: true` and the same status, leaving every table unchanged
    - A repeated `Idempotency-Key` creates one entry; a stale `previewToken` returns `STALE_PREVIEW`
    - An entry emptied by a session delete is still returned by GET with `orphaned: true` and can be deleted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.10, 5.1, 5.2, 5.11, 6.6, 6.7, 6.9, 7.2, 7.3, 7.7, 7.8, 7.9, 7.11, 10.2, 12.4, 12.8, 14.1, 14.3, 14.5, 14.8, 15.1, 15.3, 15.7, 15.8_

  - [ ] 8.7 Implement the day, coverage and health routes
    - `days/[date]/+server.ts` returns bounds, sessions and entries with their true bounds, coverage, and totals **clamped to the day**, including orphans and archived projects; an empty day returns 200 with zeroes
    - `days/+server.ts` returns one `DaySummary` per `Logical_Day` carrying its date, totals, per-project breakdown and session count; spans over 366 days rejected
    - `coverage/+server.ts` returns `tracked`, `covered`, `uncovered` and `untracked`; `min_gap_seconds` filters the returned list only and never the totals; range limits as elsewhere
    - `health/+server.ts` is the `Health_Endpoint`: 200 with status `ok`, the version, the effective `TIMEZONE` and `DAY_START_HOUR`, without a credential; 503 `degraded` when the database is unreachable or migrations are unapplied
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.8, 13.1, 13.2, 13.3, 13.4_

  - [ ] 8.8 Write tests for the day, coverage and health routes
    - `tests/api/days.test.ts`: a populated day returns correct totals and per-project seconds; an empty day returns zeroes; a malformed date 400; a 400-day range `RANGE_TOO_LARGE`; **a session spanning the 03:00 boundary appears in both days with its true bounds but contributes its own part to each day's total, and the two parts sum to its full length**
    - `tests/api/coverage.test.ts`: `covered` and `uncovered` reconstruct `tracked`; `untracked` holds the breaks; `min_gap_seconds` filters the list while the totals stay unchanged; `from` after `to` 400
    - `tests/api/health.test.ts`: 200 with a reachable migrated database carrying timezone and day start; 503 when the database is closed; 503 when a migration is pending; no credential required
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 10.7, 10.8, 13.1, 13.2, 13.3, 13.4_

- [ ] 9. Checkpoint — API complete
  - Run `bun run check && bun run test` with PostgreSQL running

- [ ] 10. Guards
  - [ ] 10.1 Write the module boundary test
    - `tests/lib/server/imports.test.ts` walks the import graph of `src/lib/server/`
    - Fail when `domain` imports anything under `store` or `core`, Drizzle, `$env`, `$app` or SvelteKit; when `store` imports from `routes`; when `core` imports `domain` or `store`
    - _Requirements: 6.1, 6.2_

  - [ ]* 10.2 Write property tests for write atomicity and reachability
    - `tests/lib/server/store/atomicity.property.test.ts` against a real database
    - **Property 10: Rejected writes leave no trace**
    - **Property 16: Every entry stays reachable**
    - **Validates: Requirements 2.10, 6.11, 7.2**

  - [ ]* 10.3 Write property tests for the dry run
    - `tests/api/dry-run.property.test.ts`
    - **Property 13: A dry run predicts the write exactly**
    - **Property 14: A dry run changes nothing**
    - **Property 18: Idempotent writes create one record**
    - **Validates: Requirements 12.8, 12.9, 14.1, 14.3, 14.4, 14.5**

  - [ ]* 10.4 Write property tests for the global invariants
    - `tests/lib/server/store/overlap.property.test.ts`
    - **Property 8: Activity segments never overlap globally**
    - **Property 7: Coverage partitions tracked time**
    - **Property 15: Day totals partition the timeline**
    - **Validates: Requirements 4.5, 6.4, 8.3, 9.3, 10.7**

- [ ] 11. Packaging, deployment and documentation
  - [ ] 11.1 Write the `Dockerfile` and `.dockerignore`
    - Two stages on `oven/bun:1.2.15` then `oven/bun:1.2.15-slim`, granular COPY layers — `package.json bun.lock` first, then configs, then `project.inlang`, `messages`, `static`, `src`
    - Install with `bun install --frozen-lockfile`
    - Placeholder env values so build-time validation passes, `bun x svelte-kit sync && bun run build`, `CMD ["bun", "run", "build/index.js"]`, port 3000, non-root user
    - `.dockerignore` excludes `.git`, `tests/`, `.env*`, `.kiro/`, `build/`, `node_modules/`, `.svelte-kit/`, `*.md`, `.vscode/`, `.idea/`
    - _Requirements: 13.10_

  - [ ] 11.2 Write `fly.toml`
    - `app = "worklog"`, `primary_region = "fra"`, `internal_port = 3000`, `force_https`, health check against `/api/health`
    - `[env]` carries only non-secret configuration — `PORT`, `TIMEZONE`, `DAY_START_HOUR`, `APP_ENV`, `MAX_OPEN_SESSION_HOURS`, `MIN_INTERVAL_SECONDS`
    - Never place `WORKLOG_API_TOKEN`, `WORKLOG_PASSPHRASE_HASH` or `DATABASE_URL` in this file
    - _Requirements: 11.16, 13.1_

  - [ ] 11.3 Write the operational scripts
    - `scripts/build.sh`, `start-docker.sh`, `stop-docker.sh`, `deploy.sh`, `backup.sh` and `test-e2e.sh`, all with `#!/bin/bash`, `set -euo pipefail` and the Script Portability preamble, parsing the app name from the resolved fly config
    - `deploy.sh` takes the environment as `$1` defaulting to `prod`, resolves `.env.<env>` and `fly.<env>.toml` with a `fly.toml` fallback, validates required files before any remote call and exits 2 when one is missing, resolves the org prompting through `/dev/tty` when absent and persisting the choice, creates the app only when missing, sets secrets skipping keys already in `[env]`, then deploys
    - `backup.sh` takes the environment as `$1`, runs `pg_dump` into a timestamped file, and prints the restore command — the data becomes invoicing evidence, so a backup path must exist from day one
    - `test-e2e.sh` starts PostgreSQL with plain `docker run`, migrates, runs Playwright and tears everything down
    - _Requirements: 13.8, 13.10_

  - [ ] 11.4 Write `README.md` and `DOCS.md`
    - `README.md` follows the ten required sections in order: title and description, prerequisites, installation, usage, deployment, testing, documentation link, author, show your support, license — no environment table and no endpoint table, those belong in `DOCS.md`
    - Deployment covers `./scripts/start-docker.sh`, `./scripts/stop-docker.sh`, `./scripts/deploy.sh <env>`, `dploy release prod` and the useful Fly commands
    - `DOCS.md` carries environment variables, project structure, full API documentation with request and response examples including `dryRun` and `Idempotency-Key`, testing, and troubleshooting
    - Include the worked reconciliation example showing `13:00–16:00` over a broken frame becoming two segments
    - Note that migrations are forward-only and that changing `TIMEZONE` or `DAY_START_HOUR` regroups history
    - _Requirements: 13.8_

  - [ ] 11.5 Write the project `CLAUDE.md` and register the project
    - `CLAUDE.md` at the project root describing the two specs, the driver deviation, the reconciliation model and the commands
    - Add `worklog` to the project list in `/workspace/CLAUDE.md`
    - _Requirements: 13.8_

- [ ] 12. Checkpoint — deployable service
  - Run `bun audit` and resolve anything it reports
  - Run `./scripts/start-docker.sh`, apply migrations, exercise the worked example end to end with `curl` using the bearer token, confirm `/api/health` reports status, version, timezone and day start, take a backup with `./scripts/backup.sh`, then `./scripts/stop-docker.sh`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.7"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.1", "2.4", "2.7", "4.1", "4.2"] },
    { "id": 2, "tasks": ["1.6", "2.2", "2.3", "2.5", "2.6", "4.3", "6.1"] },
    { "id": 3, "tasks": ["4.4", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "6.6", "7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["4.8", "4.9", "6.7", "6.8", "7.4", "7.5"] },
    { "id": 6, "tasks": ["7.6", "8.1", "8.3", "8.5", "8.7"] },
    { "id": 7, "tasks": ["8.2", "8.4", "8.6", "8.8", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Every one of them is a property test; the unit, integration and route tests are not optional.
- **Driver choice**: this project uses `drizzle-orm/postgres-js`, not the workspace-standard `drizzle-orm/neon-http`. The Neon HTTP driver cannot run interactive transactions — the template's own `src/lib/core/audit/writer.ts` documents that `db.transaction()` always throws — and every write here depends on one. Do not "align" this back to `neon-http`.
- **Migrations** are hand-written SQL in `migrations/` at the root, applied only by `scripts/migrate.sh`, forward-only. `drizzle-kit migrate` is deliberately unused because `EXCLUDE USING gist`, expression indexes and triggers are not expressible in the Drizzle DSL. `src/db/schema/` exists for typed queries and is checked against the migrated database by a test.
- **Logical day and DST**: with `DAY_START_HOUR=3` in `Europe/Prague`, the irregular day is the one **before** each transition — `2026-03-28` is 23 hours, `2026-10-24` is 25 hours — while the transition dates themselves are 24. This was measured, not assumed.
- **A record crossing a day boundary is never split.** It is returned whole and each day counts only its own part. Getting this wrong double-counts night work in the yearly total.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL with plain `docker run` on the sandbox's own network and reach it by container name. The `sandbox-docker-net` skill has the details.
- The schema was verified against `postgres:16-alpine` while the design was written: the single-open-session index, both exclusion constraints, acceptance of touching intervals and the deferred reshuffle all behave as specified.
- `Interval` is half-open `[start, end)`. This is what lets one session end at 12:00 and the next begin at 12:00 without overlapping, in the TypeScript and in the `tstzrange` columns alike.
- `src/lib/server/domain/` must stay free of Drizzle, `$env`, `$app` and SvelteKit imports. `reclipAffected` takes `ReclipPorts` instead of reaching for the store. Task 10.1 enforces this.
- The advisory lock constant `4919372001` is arbitrary but fixed. Every mutating transaction must take it as its first statement.
- A `Dry_Run` is the real write rolled back, not a separate code path. Keep it that way — it is what makes Property 13 hold.
- **An emptied entry is never deleted, so it must stay findable.** Every listing selects orphans by their requested interval; without that they become invisible rows that block project deletion forever.
- `pause` is not a server concept. The client sends `/api/sessions/stop` to pause and `/api/sessions/start` to resume; the gap between the two sessions is the break that reconciliation later preserves.
- JSON bodies are `camelCase`, query parameters are `snake_case`. One rule, applied everywhere.
- Error responses carry both an English `message` and a `messageKey`; the interface renders the key, a shell script shows the sentence.
- `fast-check` must be a declared dependency. The workspace template relies on it only transitively, which is a latent break.
- Dependency updates are their own commit. Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
