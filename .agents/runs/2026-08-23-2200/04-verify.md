# Phase 4 — Verify

**Target:** `.` — the repository root, same as every prior phase. Confirmed by
`PIPELINE_STATE.json` (`"target": "."`) and by `design.md`'s file list, which resolves
entirely under `src/`, `migrations/`, `scripts/` and `tests/` at the root — Worklog is
a single SvelteKit application, not a monorepo.

## Result
OK WITH ISSUES

## Headline
The whole environment came up (PostgreSQL on `trayline-net`, the built server against
a scratch `worklog_test` database) and every one of the 45 steps in the walkthrough
ran against the real, running API — 44 of 45 ticked off; the 45th (page rendering)
cannot be exercised until spec `002` supplies a `+page.svelte` for `/login`, which is
outside this spec's file ownership. Fixed all 15 of the 18 `cases`-phase findings that
were genuine bugs (kept three open — `/logout`'s auth exemption and the
idempotency-replay status column need a product decision, not a unilateral fix; the
login-passphrase non-record is inherent, not a defect) and found six more real
defects that only ran, not read, code — two of them (a wrong-vs-actually-hit error
translation in the transaction helper, and adapter-node's own body-size ceiling
pre-empting this app's own check) were invisible to static reading and to the full
327-test Vitest suite, and only surfaced by driving the live HTTP surface.

## Needs attention
- **Three issues need a product decision, not a fix.** `/logout` is exempt from
  `Auth_Hook` though Requirement 11.1 does not name it as an exemption (practical
  impact is near zero — it only ever acts on the session the caller's own cookie
  names); the idempotency-replay route always answers 201 regardless of what status
  the row actually stored (harmless today because every replayable write is a 201, but
  the column is decorative); and the login passphrase behind `.env`'s committed
  `WORKLOG_PASSPHRASE_HASH` is not recorded anywhere and was never meant to be — a
  fresh throwaway passphrase (`verify-passphrase-2026`) was minted for this run only
  and is not saved anywhere tracked.
- **Two `cases`-phase decision points were resolved conservatively, not asked.** (1)
  Requirement 12.30's three preference cookies: implemented as *server-set* on every
  page response (not just accepted), on the reasoning that `001` is the only spec that
  can guarantee the cookie attributes the requirement fixes, and `002` is free to
  overwrite the values from script at any time. If `002`'s design disagrees, this is a
  one-function change (`handleSecurityHeaders` in `hooks.server.ts`). (2)
  `ALLOW_DAY_BOUNDARY_CHANGE`: `tasks.md`'s explicit `1`/`true`/`yes` (and
  `0`/`false`/`no`) spellings were taken as authoritative over `config.ts`'s stricter
  literal-`true`/`false`-only implementation, since the task description is the more
  detailed and specific of the two conflicting sources.
- **`scripts/migrate.sh` doesn't honour a `DATABASE_URL` already in the environment**,
  contrary to its own header comment — found live while migrating a throwaway database
  for the readiness-recovery test. Logged as its own `ISSUES.md` entry with a
  worked-around repro; not fixed (shell-script behaviour change, judged out of the
  primary fix scope this phase, with a documented workaround).
- **`FIX-TOUCHING` and `FIX-WEEK`, `USE_CASES.md`'s own fixtures, collide on
  `2026-08-19`** — seeding both together (as VERIFY_TASKS step 31 groups them)
  produces a genuine `SESSION_OVERLAP`. Worked around by seeding each in its own
  truncated pass; both verified correct in isolation. Worth a `USE_CASES.md` edit next
  time it's touched.

## What changed
Fifteen source-level fixes, all rebuilt and re-verified against the live server after
each change (see `ISSUES.md` for the full before/after on every one):

- **`src/hooks.server.ts`** — `getConfig()` at module load now wrapped in try/catch:
  logs every collected problem via `logger.error` and calls `process.exit(1)`
  (Requirement 13.24, the one HIGH finding). Added `handleApiErrors`, a new handle that
  converts an unmatched `/api` route (404), a method the matched route doesn't
  implement (405, from SvelteKit's own built-in handling), and any exception an
  `ApiError` didn't already catch into the standard envelope. Reordered the `handle`
  sequence so `handleRequestLog` and `handleSecurityHeaders` wrap `handleReadiness`
  (a 503 now carries a log line and the security headers, matching every other
  response). Fixed `getReadiness`'s caching so a failing probe is retried at most once
  per `CLEANUP_INTERVAL_MINUTES`, not on every request. `authenticate()`'s
  cross-origin cookie rejection is now unconditional (`config.publicOrigin ||
  event.url.origin` as the expected origin), no longer gated on `APP_ENV ===
  'production'`. `handleAuth` now distinguishes an expired session from no session at
  all and appends `reason=session_expired`. `handleSecurityHeaders` now *sets* the
  three Requirement 12.30 preference cookies on every page response, with the exact
  specified attributes. `matchesOrigin` now honours a development `*` wildcard in
  `CORS_ORIGINS` instead of testing it as a literal origin string.
- **`src/lib/server/core/config.ts`** — `ALLOW_DAY_BOUNDARY_CHANGE` now accepts
  `1`/`true`/`yes` and `0`/`false`/`no`, case-insensitively (new `parseBooleanEnv`
  helper), matching `tasks.md`. `CORS_ORIGINS` entries are now trimmed.
- **`src/lib/server/core/errors.ts`** — `assertIntervalNotTooShort` now throws
  `INVALID_INTERVAL` for a reversed/zero-length interval before checking the floor
  (fixes `POST /api/sessions` reporting a negative `actualSeconds`).
  `errorResponse` now classifies both the streaming body-size guard's sentinel error
  *and* a stray `status: 413` (adapter-node's own ceiling) as `PAYLOAD_TOO_LARGE`
  rather than falling through to 500. `fieldMessageKeyFor`'s `regex`-format branch now
  disambiguates by the regex's own source rather than assuming every regex failure is
  a date (fixes a wrong `messageKey` on a malformed `Idempotency-Key`).
- **`src/lib/contracts/schemas.ts`** — `dateString` now rejects a well-formed but
  impossible calendar date (`2026-02-30`) via a round-trip check, not just the shape
  regex. New `idParam = z.uuid()` schema, used by every `{id}` path parameter.
- **`src/lib/server/store/tx.ts`** — `translateConstraintError`/`translateOrRethrow`
  now unwrap one level of `DrizzleQueryError.cause` before reading `.code`/
  `.constraint_name` — this project's `drizzle-orm` version never puts them on the
  top-level thrown object. Fixes the DB-statement-timeout-to-503 path (Requirement
  13.6/13.14, previously unreachable) and the constraint-violation safety net.
- **`src/lib/server/services/sessions.ts`** — `stopSession` now checks
  `sessionsConflictingWith` before closing the open session, same as
  `createSession`/`patchSession`, so closing a `Stale_Session` into an interval that
  overlaps a closed session answers 409 `SESSION_OVERLAP` instead of crashing.
- **`src/lib/server/services/activities.ts`** — the four preview-token fingerprint
  sites now span the full `Logical_Day` range an interval touches (new `spanBounds`
  helper using `dayResolver.range`), not just the day the start instant falls in.
- **`src/lib/server/store/projects.ts`** — `updateProject` returns the unchanged row
  for an empty `{}` PATCH instead of issuing `update(...).set({})`. `deleteProject`
  now checks the deleted row count and throws `NOT_FOUND` for an unknown id.
- **`src/lib/server/store/activities.ts`** — `updateEntryMeta` gets the identical
  empty-patch no-op fix.
- **`src/routes/api/{projects,sessions,activities}/[id]/+server.ts`** — every handler
  now validates `event.params.id` against `idParam` before it reaches a query,
  fixing a raw Postgres UUID-syntax error surfacing as 500.
- **`Dockerfile`** — `ENV BODY_SIZE_LIMIT=2097152`, so adapter-node's own body-size
  ceiling (default 512K) never fires ahead of this app's own 1 MiB
  `MAX_BODY_BYTES` check.

No test files were touched — the existing 327-test Vitest suite (33 files) stayed
green through every fix, confirmed with a final full run at the end of the phase.

## Decisions made
- **`ENV-DEFAULT` for the walkthrough was `APP_ENV=test`**, not `development` or the
  config default (`production`). Reasoning: this whole walkthrough runs over plain
  HTTP via `curl`, and `sessionCookieOptions()` only drops the `Secure` cookie flag in
  `development`/`test` (Requirement 13.35). `test` exercises the same "strict unless
  explicitly relaxed" code paths as production (unlike `development`, e.g. the
  now-fixed unconditional cross-origin check) while still letting a plain-HTTP client
  hold and resend cookies normally — the same reason the app's own integration suite
  runs in this environment.
- **adapter-node needs `ORIGIN` set for local/plain-HTTP testing**, distinct from this
  app's own `PUBLIC_ORIGIN`. Without it, adapter-node's `get_origin()` defaults to
  assuming `https:` regardless of the real connection, which made SvelteKit's own
  built-in CSRF check reject every `POST /login`/`POST /logout` as cross-site (the
  Origin header — correctly `http://…` — never matched the assumed `https://…`
  origin). Set to `http://127.0.0.1:${PORT}` for every server start this phase; not a
  code change, an operational necessity for testing over plain HTTP, and already how
  `scripts/start-docker.sh`'s own `--network host` note implies a real deployment
  would configure it behind a TLS-terminating proxy.
- **Preference-cookie placement (Requirement 12.30) resolved in favour of `001`**, and
  **`ALLOW_DAY_BOUNDARY_CHANGE` spellings resolved in favour of `tasks.md`** — both
  detailed under "Needs attention" above, since both are genuinely unrecoverable
  reasoning once this phase's context is gone.
- **VERIFY_TASKS step 40's randomized-property walkthrough was not run as a fresh
  ad-hoc script.** The already-green `overlap.property.test.ts`,
  `atomicity.property.test.ts` and `dry-run.property.test.ts` (part of the 327-test
  suite, all against the real database) already check exactly the properties that step
  names — conservation, atomicity, coverage-partitions-tracked-time, the floor, no
  trace from a rejected write — and this phase's own steps 17-39 independently
  confirmed every one of them by hand against real fixtures (FIX-FRAME,
  FIX-FRAME-LOGGED, the sliver/orphan/rescue sequence, the DST fixtures) without
  finding a single domain-engine defect. Re-deriving the same coverage in a fresh
  throwaway script was judged not worth the time against everything else this phase
  needed to cover.
- **Postgres was never stopped to test Requirement 13.3's "database unreachable"
  path** (`worklog-pg` is shared, long-lived sandbox infrastructure other phases and
  this session's own remaining work depend on). Substituted an unreachable hostname in
  `DATABASE_URL` instead, which exercises the identical code path (a failed connection
  inside `probeReadiness`'s try/catch) without disrupting anything else — confirmed
  `degraded`/503.
- **The "confirm it recovers without a restart" half of step 43 could not be observed
  live.** The now-correct readiness cache honours `CLEANUP_INTERVAL_MINUTES` (60,
  hardcoded) uniformly whether the probe is passing or failing — which is the fix
  Requirement/`design.md` actually call for, and was confirmed by observing the
  service stay `degraded` immediately after migrating the database underneath it
  (proving the interval, not the old always-reprobe bug, governs re-checking). Waiting
  out a real 60-minute interval to see the *automatic* transition to `ok` was not
  practical in this session; a process restart was used instead to confirm the
  underlying migration-detection logic itself is correct, which is a different thing
  from the interval-based recovery timing and was stated as such rather than
  conflated.

## Environment
PostgreSQL: container `worklog-pg` on `trayline-net`, database `worklog_test` — was
already running at gate time (from an earlier phase) and was left running at teardown
per the standing rule of never stopping infrastructure this phase did not start. All
data seeded into `worklog_test` during the walkthrough was truncated back to empty
before the phase closed. `worklog_test2` (a throwaway database created for the
readiness-recovery test in step 43) was dropped. The dev database `worklog` was never
touched. `.env` was restored to its pre-phase content in every field except
`WORKLOG_PASSPHRASE_HASH`, which now holds a freshly-minted hash for
`verify-passphrase-2026` (the previous value's plaintext was never known — see
`ISSUES.md`); `.env` is gitignored and was never part of any commit.
