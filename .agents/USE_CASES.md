# Use Cases — Worklog

Everything that must be true for Worklog to count as working. Numbers are **stable**:
the walkthrough in `.agents/tmp/VERIFY_TASKS.md` and every later run refer to them.
New cases are appended at the end; an obsolete case is marked `OBSOLETE` in place and
never renumbered away.

The file is in **two parts**, one per specification:

- **Part I — UC-001 … UC-236** covers the `Worklog_Server` (spec
  `.kiro/specs/001-worklog-domain-api/`): the domain, the data layer and the REST API.
  Every case is exercised over the API with `curl` (or the equivalent), except the
  handful marked `Method: inspection`.
- **Part II — UC-237 … UC-508** covers the `Worklog_UI` (spec
  `.kiro/specs/002-worklog-ui/`): the browser interface, driven through a real browser.
  It begins after Part I's requirement-coverage table and carries its own conventions
  and fixtures.

Part I was written when no browser interface existed, so its cases drive the API
directly. That remains correct and they are not superseded: the two parts test two
layers of the same server, and a Part II case failing while its Part I counterpart
passes localises the defect to the interface.

## Conventions — Part I

- `$BASE` — the running server's origin (`http://localhost:3000` for the built Node
  server; `4173` for `bun run preview`, `5173` for `bun run dev`).
- `$TOKEN` — the value of `WORKLOG_API_TOKEN`. Unless a case says otherwise, **every
  request carries `Authorization: Bearer $TOKEN`** and no cookie.
- **Default preconditions**, assumed by every case that does not restate them: the
  server is running against a scratch database (`worklog_test`, migrated), with the
  environment `ENV-DEFAULT` below, and answers `GET /api/health` with `status: "ok"`.
- Times are written as Prague wall clock with an explicit offset (`+02:00` in CEST,
  `+01:00` in CET), which is what the API requires — a timestamp without an offset is
  rejected. Responses are RFC 3339 **UTC**.
- `D` = **2026-08-20**, a plain CEST Thursday in the past. Its `Logical_Day` runs
  `2026-08-20T03:00+02:00` → `2026-08-21T03:00+02:00`.
- `Requirement:` cites `requirements.md` as `<requirement>.<criterion>`; `design
  Property N` cites the Correctness Properties of `design.md`.
- A case's `Expected` is the **specified** behaviour. Where the current implementation
  is known to deviate, the case says so and names the `ISSUES.md` entry — the case
  still fails until the code matches, which is the point.

### ENV-DEFAULT

`TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`, `GAUGE_START=06:00`, `GAUGE_END=00:00`,
`EVENING_HOUR=21`, `MAX_OPEN_SESSION_HOURS=12`, `MIN_INTERVAL_SECONDS=60`,
`SESSION_DURATION_HOURS=720`, `RATE_LIMIT_PER_MINUTE=120`, `TRUSTED_PROXY_HOPS=0`,
`LOG_LEVEL=info`, `APP_ENV=development`, `ALLOW_DAY_BOUNDARY_CHANGE=false`,
`CORS_ORIGINS=` (empty), `WORKLOG_API_TOKEN` (≥ 32 chars), `WORKLOG_PASSPHRASE_HASH`
(argon2id, passphrase known to the runner), `DATABASE_URL` → the scratch database.

Fixed constants the cases rely on: `MAX_RANGE_DAYS=366`, `MAX_INTERVAL_RANGE_DAYS=62`,
`ACTIVITY_PAGE_SIZE=200`, `ERROR_DETAIL_SAMPLE_SIZE=10`, `FUTURE_TOLERANCE_SECONDS=300`,
`SUGGESTED_WINDOW_COVERAGE=0.9`, `LOGIN_ATTEMPT_LIMIT=5`,
`LOGIN_ATTEMPT_WINDOW_MINUTES=15`, `IDEMPOTENCY_RETENTION_HOURS=24`,
`MAX_BODY_BYTES=1048576`, `SERVICE_RETRY_AFTER_SECONDS=5`.

## Fixtures — Part I

Named data sets. A `Data needed` line names one and adds whatever else the case wants.
Every fixture starts from `FIX-CLEAN` and is built **through the API** unless the
fixture says otherwise.

- **FIX-CLEAN** — `TRUNCATE projects, work_sessions, activity_entries,
  activity_segments, auth_sessions, idempotency_keys CASCADE`. `day_boundary_config`
  is left alone (the server writes it) and must agree with `ENV-DEFAULT`.
- **FIX-PROJECTS** — FIX-CLEAN, then `POST /api/projects` `Alpha`, then `Beta`, then
  `Gamma`; `Gamma` is then archived with `PATCH {"archived": true}`. Expected colour
  indices 0, 1, 2.
- **FIX-FRAME** — FIX-PROJECTS plus two closed sessions created with
  `POST /api/sessions`, the worked example of `design.md`:
  S1 `2026-08-20T08:00+02:00 → 2026-08-20T14:48+02:00` (6 h 48 min),
  S2 `2026-08-20T15:12+02:00 → 2026-08-20T18:00+02:00` (2 h 48 min).
  `Tracked_Time` of day D = 34 560 s; the break is 14:48–15:12 (24 min).
- **FIX-FRAME-LOGGED** — FIX-FRAME plus one `Explicit_Mode` entry on `Alpha`,
  `2026-08-20T13:00+02:00 → 2026-08-20T16:00+02:00`, description `spec work`. Its
  segments are 13:00–14:48 and 15:12–16:00 (9 360 s), and 24 min are `discarded`.
- **FIX-NIGHT** — FIX-PROJECTS plus one closed session
  `2026-08-21T22:00+02:00 → 2026-08-22T01:30+02:00`. It belongs to `Logical_Day`
  2026-08-21; 5 400 s of it is `Overtime` and all 12 600 s is after the `Evening_Hour`.
- **FIX-TOUCHING** — FIX-PROJECTS plus three closed sessions on 2026-08-19:
  09:00–11:00, 11:00–12:00 (touching, one block of 3 h) and 14:00–15:00, all `+02:00`.
- **FIX-WEEK** — FIX-PROJECTS plus one closed session `09:00+02:00 → 17:00+02:00` on
  each of 2026-08-17, 2026-08-18 and 2026-08-19.
- **FIX-NIGHTOWL** — FIX-PROJECTS plus one closed session
  `22:00+02:00 → 04:00+02:00 (next date)` starting on each of 2026-08-10, 2026-08-11
  and 2026-08-12. No 24-hour-clock window satisfies both the 90 % rule and the
  `DAY_START_HOUR=3` gap rule.
- **FIX-DST-SPRING** — FIX-PROJECTS plus one closed session
  `2026-03-28T10:00+01:00 → 2026-03-28T14:00+01:00`. `Logical_Day` 2026-03-28 is
  **23 hours** long (the transition falls at 02:00 on 2026-03-29).
- **FIX-DST-AUTUMN** — FIX-PROJECTS plus one closed session
  `2025-10-25T10:00+02:00 → 2025-10-25T14:00+02:00`. `Logical_Day` 2025-10-25 is
  **25 hours** long. A past year is used deliberately: the 2026 autumn transition
  (2026-10-25) is in the future and every write there is refused as `FUTURE_TIMESTAMP`.
- **FIX-OPEN** — FIX-PROJECTS plus one `Open_Session` started 2 h before now
  (`POST /api/sessions/start` with an explicit `startedAt`).
- **FIX-STALE** — FIX-PROJECTS plus one `Open_Session` started 13 h before now, i.e.
  past `MAX_OPEN_SESSION_HOURS`.
- **FIX-ORPHAN** — FIX-FRAME-LOGGED, then `DELETE` both sessions. The entry survives
  with no segment and `orphaned: true`.
- **FIX-PAGE** — FIX-PROJECTS plus one closed session
  `2026-08-18T04:00+02:00 → 2026-08-18T08:00+02:00` and 201 `Explicit_Mode` entries of
  exactly 60 s each, back to back from 04:00:00. Seeded by script (SQL or a loop of
  `POST /api/activities`), because 201 hand-written requests is not a test.

---

## UC-001 — Health answers without a credential and publishes the configuration
- Area: health
- Requirement: 13.1, 13.2, 13.9, 8.14, 10.8
- Preconditions: server running
- Data needed: none (FIX-CLEAN)
- Steps: `GET $BASE/api/health` with **no** `Authorization` header
- Expected: 200 with `status: "ok"`, `version` equal to `package.json`'s (`0.1.0`),
  `timezone: "Europe/Prague"`, `dayStartHour: 3`, `gaugeStart: "06:00"`,
  `gaugeEnd: "00:00"`, `eveningHour: 21`, `maxOpenSessionHours: 12`

## UC-002 — Health reports degraded when the database is unreachable
- Area: health
- Requirement: 13.3
- Preconditions: server running, then PostgreSQL stopped (or `DATABASE_URL` pointed at
  a dead port)
- Data needed: none
- Steps: `GET $BASE/api/health`
- Expected: 503 with `status: "degraded"`; the process is still alive and answers again
  once the database returns

## UC-003 — An unmigrated database answers 503 everywhere except health
- Area: health
- Requirement: 13.4, 13.31, 13.32, 12.14
- Preconditions: server pointed at a database with no schema applied
- Data needed: an empty database (no `schema_migrations`, no tables)
- Steps: `GET $BASE/api/health`, then `GET $BASE/api/projects`
- Expected: health answers 503 `status: "degraded"`; `/api/projects` answers 503 with
  `error: "SERVICE_UNAVAILABLE"`, `details.retryAfterSeconds: 5` and a `Retry-After: 5`
  header; running `./scripts/migrate.sh` repairs it **without restarting the process**.
  The 503 also carries the standard security headers and produces a request log line.
  Known deviation: the readiness gate runs before both handles, so it does neither —
  see ISSUES.md "A readiness 503 carries no security headers and writes no log line"

## UC-004 — Health is exempt from rate limiting
- Area: health
- Requirement: 11.26
- Preconditions: `RATE_LIMIT_PER_MINUTE=120`
- Data needed: none
- Steps: issue 130 `GET /api/health` from one address inside 60 s
- Expected: every one answers 200; no 429

## UC-005 — A Day_Boundary_Config mismatch degrades the service without killing it
- Area: health
- Requirement: 10.10, 13.31
- Preconditions: `ALLOW_DAY_BOUNDARY_CHANGE` unset
- Data needed: a migrated database whose `day_boundary_config` row is
  `Europe/Prague` / `3`; restart the server with `DAY_START_HOUR=4`
- Steps: `GET /api/health`, then `GET /api/sessions/current`
- Expected: the process keeps running; health 503 `degraded`; the other route 503
  `SERVICE_UNAVAILABLE`

## UC-006 — ALLOW_DAY_BOUNDARY_CHANGE overwrites the stored config and warns
- Area: health
- Requirement: 10.12
- Preconditions: as UC-005 but with `ALLOW_DAY_BOUNDARY_CHANGE=true`
- Data needed: `day_boundary_config` = `Europe/Prague` / `3`, env `DAY_START_HOUR=4`
- Steps: start the server, `GET /api/health`, then read `day_boundary_config`
- Expected: 200 `ok`; the row now reads `4`; a warning-level JSON log line records the
  change

## UC-007 — The first run writes the Day_Boundary_Config
- Area: health
- Requirement: 10.11
- Preconditions: none
- Data needed: a migrated database with `day_boundary_config` empty
- Steps: start the server, `GET /api/health`, read `day_boundary_config`
- Expected: exactly one row, matching the configured `TIMEZONE` and `DAY_START_HOUR`;
  requests are served normally

## UC-008 — Missing required configuration refuses to start and lists every problem
- Area: config
- Requirement: 13.8, 13.24, 11.16
- Preconditions: none
- Data needed: none
- Steps: start the process with `DATABASE_URL`, `WORKLOG_API_TOKEN` and
  `WORKLOG_PASSPHRASE_HASH` all unset
- Expected: non-zero exit before any connection is accepted; one log listing **all
  three** problems, not just the first; nothing listening on `PORT`.
  **Known deviation, applying to UC-008 through UC-022:** nothing catches the
  configuration error, so the process neither logs the collected problem list nor exits
  deliberately — see ISSUES.md "A bad configuration never logs its problem list or
  exits non-zero". Each of those cases still asserts the specified behaviour

## UC-009 — A short API token or an unparseable passphrase hash refuses to start
- Area: config
- Requirement: 11.16
- Preconditions: none
- Data needed: none
- Steps: start with `WORKLOG_API_TOKEN` of 31 characters; separately, start with
  `WORKLOG_PASSPHRASE_HASH=not-a-hash`
- Expected: both exit non-zero with an error naming the offending variable

## UC-010 — An unloadable TIMEZONE or an out-of-range DAY_START_HOUR refuses to start
- Area: config
- Requirement: 10.9
- Preconditions: none
- Data needed: none
- Steps: start with `TIMEZONE=Mars/Olympus`; separately with `DAY_START_HOUR=24`
- Expected: both log an error and exit non-zero

## UC-011 — A day boundary that does not exist or occurs twice refuses to start
- Area: config
- Requirement: 10.13
- Preconditions: `TIMEZONE=Europe/Prague`
- Data needed: none
- Steps: start with `DAY_START_HOUR=2`
- Expected: error logged (the hour is skipped in March and repeated in October) and a
  non-zero exit

## UC-012 — A Gauge_Window outside 1–24 hours refuses to start
- Area: config
- Requirement: 13.12
- Preconditions: none
- Data needed: none
- Steps: start with `GAUGE_START=06:00 GAUGE_END=06:30` (30 min)
- Expected: error logged, non-zero exit

## UC-013 — GAUGE_END at or before GAUGE_START wraps to the next date
- Area: config
- Requirement: 13.13
- Preconditions: defaults
- Data needed: none
- Steps: start with the default `GAUGE_START=06:00`, `GAUGE_END=00:00`; `GET /api/health`
- Expected: the server starts and reports the window verbatim; the window is treated as
  18 hours (UC-184 shows the arithmetic), never as zero

## UC-014 — A DAY_START_HOUR inside the Gauge_Window refuses to start
- Area: config
- Requirement: 13.14, 13.15
- Preconditions: none
- Data needed: none
- Steps: start with `GAUGE_START=00:00 GAUGE_END=22:00 DAY_START_HOUR=10`
- Expected: error logged, non-zero exit — the window would be split across two
  `Logical_Day` values

## UC-015 — A Gauge_Window containing a DST transition hour refuses to start
- Area: config
- Requirement: 13.22
- Preconditions: `TIMEZONE=Europe/Prague`
- Data needed: none
- Steps: start with `GAUGE_START=00:00 GAUGE_END=22:00 DAY_START_HOUR=23` — legal by
  13.12 and 13.14, and still contains 02:00
- Expected: error logged, non-zero exit

## UC-016 — An EVENING_HOUR outside 0–23 refuses to start
- Area: config
- Requirement: 13.16, 13.17
- Preconditions: none
- Data needed: none
- Steps: start with `EVENING_HOUR=25`
- Expected: error logged, non-zero exit; with `EVENING_HOUR` unset the server starts and
  `/api/health` reports `21`

## UC-017 — Every numeric variable is range-checked at startup
- Area: config
- Requirement: 13.29
- Preconditions: none
- Data needed: none
- Steps: start once per variable with a value one step outside its range: `PORT=0`,
  `DB_QUERY_TIMEOUT_SECONDS=61`, `DB_POOL_MAX=101`, `RATE_LIMIT_PER_MINUTE=10001`,
  `SESSION_DURATION_HOURS=8761`, `MAX_OPEN_SESSION_HOURS=25`, `MIN_INTERVAL_SECONDS=0`,
  `TRUSTED_PROXY_HOPS=9`
- Expected: each refuses to start with an error naming that variable

## UC-018 — LOG_LEVEL accepts only the four levels
- Area: config
- Requirement: 13.26
- Preconditions: none
- Data needed: none
- Steps: start with `LOG_LEVEL=trace`; then with `LOG_LEVEL` unset
- Expected: the first refuses to start; the second starts and logs at `info`

## UC-019 — APP_ENV accepts only development, test and production and defaults to production
- Area: config
- Requirement: 13.33
- Preconditions: none
- Data needed: none
- Steps: start with `APP_ENV=staging`; then with `APP_ENV` unset and `PUBLIC_ORIGIN` set
- Expected: the first refuses to start; the second starts in production mode (a `Secure`
  session cookie, HSTS present)

## UC-020 — PUBLIC_ORIGIN is required in production
- Area: config
- Requirement: 13.34
- Preconditions: none
- Data needed: none
- Steps: start with `APP_ENV=production` and `PUBLIC_ORIGIN` unset
- Expected: error logged, non-zero exit

## UC-021 — CORS_ORIGINS defaults to nothing and rejects a wildcard outside development
- Area: config
- Requirement: 13.28, 11.17
- Preconditions: none
- Data needed: none
- Steps: start with `CORS_ORIGINS` unset and send a preflight from
  `Origin: https://example.com`; then start with `APP_ENV=production CORS_ORIGINS=*`
- Expected: the preflight gets no `Access-Control-Allow-Origin`; the wildcard start
  refuses to boot

## UC-022 — Every optional variable falls back to its documented default
- Area: config
- Requirement: 13.10, 13.11, 13.16, 13.18, 13.19, 13.20, 13.21, 13.23, 13.27
- Preconditions: none
- Data needed: none
- Steps: start with only the required variables set; `GET /api/health`; check the port
- Expected: listening on 3000; health reports `06:00`/`00:00`, `21`, `12`; a 59-second
  session is refused (`MIN_INTERVAL_SECONDS=60`); the 121st request in a minute is
  rate-limited (`RATE_LIMIT_PER_MINUTE=120`)

## UC-023 — Configuration is read from a .env file as well as the environment
- Area: config
- Requirement: 13.8
- Preconditions: none
- Data needed: a `.env` holding the required variables
- Steps: start the server with those variables absent from the shell environment
- Expected: it starts and `/api/health` reports the `.env` values

## UC-024 — APP_ENV=test omits Secure from cookies and relaxes nothing else
- Area: config
- Requirement: 13.35
- Preconditions: `APP_ENV=test`
- Data needed: FIX-CLEAN, the login passphrase
- Steps: log in over plain HTTP and inspect `Set-Cookie`; then send an unauthenticated
  `GET /api/projects`
- Expected: the session cookie carries `HttpOnly`, `SameSite=Strict`, `Path=/` and
  `Max-Age` but **not** `Secure`; the unauthenticated request is still 401

## UC-025 — SIGTERM and SIGINT shut down gracefully
- Area: ops
- Requirement: 13.5
- Preconditions: server running
- Data needed: FIX-FRAME
- Steps: start a request, send `SIGTERM` while it is in flight, watch the process
- Expected: the in-flight request completes, new connections are refused, the database
  pool closes and the process exits with status 0 inside 30 s

## UC-026 — A query past DB_QUERY_TIMEOUT_SECONDS answers 503, not 500
- Area: ops
- Requirement: 13.6, 12.14, 12.21
- Preconditions: `DB_QUERY_TIMEOUT_SECONDS=1`
- Data needed: FIX-FRAME plus a competing transaction holding the advisory lock or a
  row lock long enough to exceed the timeout
- Steps: issue a write that must wait on that lock
- Expected: 503 `SERVICE_UNAVAILABLE` with `Retry-After: 5`, never 500; the statement is
  actually cancelled server-side rather than merely abandoned

## UC-027 — updatedAt moves on every modified row
- Area: ops
- Requirement: 13.7
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: note `updatedAt` on the project, the session and the entry; `PATCH` each;
  read them back
- Expected: each `updatedAt` is later than before while `createdAt` is unchanged;
  `Activity_Segment` rows carry no such field (they are replaced, not updated)

## UC-028 — The reported version comes from package.json
- Area: ops
- Requirement: 13.9
- Preconditions: none
- Data needed: none
- Steps: compare `GET /api/health`'s `version` with `package.json`'s `version`
- Expected: identical; no second copy of the version string exists in the source
- Method: request plus inspection

## UC-029 — Rate-limit state is per process and is lost on restart
- Area: ops
- Requirement: 13.25
- Preconditions: `RATE_LIMIT_PER_MINUTE=5`
- Data needed: none
- Steps: exhaust the bucket, confirm 429, restart the process, repeat one request
- Expected: the request after the restart succeeds — the state was in memory, which is
  why the service runs as a single instance

## UC-030 — The cleanup sweep purges expired sessions and old idempotency keys
- Area: ops
- Requirement: 13.30, 11.21, 11.15, 12.9
- Preconditions: `CLEANUP_INTERVAL_MINUTES` is 60 and is not configurable
- Data needed: an `auth_sessions` row already expired and an `idempotency_keys` row
  older than `IDEMPOTENCY_RETENTION_HOURS`, inserted directly
- Steps: trigger the sweep (wait for it, or restart and wait for the first run) without
  presenting either record
- Expected: both rows are gone; a key younger than 24 h survives
- Method: request plus SQL inspection

## UC-031 — An /api request with no credential is refused
- Area: auth
- Requirement: 11.4
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET $BASE/api/projects` with no header and no cookie
- Expected: 401 with `error: "UNAUTHORIZED"`, `messageKey: "errors_unauthorized"` and a
  `requestId`

## UC-032 — A valid bearer token admits the request
- Area: auth
- Requirement: 11.3
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `GET $BASE/api/projects` with `Authorization: Bearer $TOKEN`
- Expected: 200 with the two non-archived projects

## UC-033 — A wrong bearer token is refused
- Area: auth
- Requirement: 11.3, 11.4, 11.8
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/projects` with a token of the right length but the wrong value, and
  again with a token that shares a long prefix with the real one
- Expected: 401 both times; the comparison is constant-time (see UC-044)

## UC-034 — A non-API path without a session redirects to the login route
- Area: auth
- Requirement: 11.5
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET $BASE/some/page` with no cookie, without following redirects
- Expected: a 3xx to `/login?next=/some/page`, not a 401 and not a rendered page

## UC-035 — Logging in with the correct passphrase sets a hardened session cookie
- Area: auth
- Requirement: 11.10, 11.11
- Preconditions: `APP_ENV=development`
- Data needed: FIX-CLEAN, `WORKLOG_PASSPHRASE_HASH` for a known passphrase
- Steps: `POST $BASE/login` as a form with `passphrase=<known>`
- Expected: 303 to `/`; `Set-Cookie: worklog_session=…` carrying `HttpOnly`,
  `SameSite=Strict`, an explicit `Path` and `Max-Age`, and `Secure` whenever `APP_ENV`
  is `production` (11.11 read together with 13.35, which exempts `test`); one row in
  `auth_sessions`

## UC-036 — The session cookie authenticates API requests
- Area: auth
- Requirement: 11.2
- Preconditions: logged in as UC-035
- Data needed: FIX-PROJECTS
- Steps: `GET $BASE/api/projects` with the cookie and no `Authorization` header
- Expected: 200 with the project list

## UC-037 — A wrong passphrase fails without revealing anything
- Area: auth
- Requirement: 11.12
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `POST /login` with `passphrase=wrong`
- Expected: a failure carrying `messageKey: "errors_login_failed"`; no cookie set; the
  response says nothing about whether any credential exists

## UC-038 — An empty passphrase fails identically to a wrong one
- Area: auth
- Requirement: 11.12
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `POST /login` with `passphrase=`
- Expected: byte-identical failure to UC-037 apart from the `requestId`

## UC-039 — The login bucket stops the sixth attempt in fifteen minutes
- Area: auth
- Requirement: 11.13
- Preconditions: `LOGIN_ATTEMPT_LIMIT` is 5 and is not exposed as configuration
- Data needed: FIX-CLEAN
- Steps: `POST /login` with a wrong passphrase six times from one address
- Expected: the sixth answers 429 with `details.scope: "login"` and a `Retry-After`; no
  environment variable can widen the limit
- Method: request plus inspection of `config.ts`

## UC-040 — Logging out deletes the stored session
- Area: auth
- Requirement: 11.14
- Preconditions: logged in as UC-035
- Data needed: FIX-CLEAN
- Steps: `POST $BASE/logout` with the cookie, then reuse the same cookie on
  `GET /api/projects`
- Expected: the `auth_sessions` row is gone; the reused cookie no longer authenticates
  (401 for `/api`)

## UC-041 — A session expires on an absolute lifetime and is not extended by use
- Area: auth
- Requirement: 11.15, 11.27
- Preconditions: `SESSION_DURATION_HOURS=1` (or an `auth_sessions` row back-dated past
  its expiry)
- Data needed: one `auth_sessions` row whose `expires_at` is in the past
- Steps: present the cookie on `GET /api/projects`; then check the table
- Expected: 401; the expired row is deleted on presentation; a live session's
  `expires_at` does **not** move forward when it is used

## UC-042 — The passphrase exists only as an argon2id hash
- Area: auth
- Requirement: 11.6
- Preconditions: none
- Data needed: none
- Steps: inspect `WORKLOG_PASSPHRASE_HASH`, the source and every table
- Expected: the stored value begins `$argon2id$v=19$m=65536,t=3`; the plaintext appears
  nowhere in the code, the database or the logs
- Method: inspection

## UC-043 — Only a hash of the session identifier is stored
- Area: auth
- Requirement: 11.7
- Preconditions: logged in as UC-035
- Data needed: FIX-CLEAN
- Steps: compare the `worklog_session` cookie value with `auth_sessions.token_hash`
- Expected: the column holds lowercase-hex `sha256` of the cookie value; the raw token
  is not stored anywhere
- Method: request plus SQL inspection

## UC-044 — The API token is compared in constant time
- Area: auth
- Requirement: 11.8
- Preconditions: none
- Data needed: none
- Steps: read the comparison in `src/lib/server/core/auth.ts`
- Expected: a length-independent, early-exit-free comparison (e.g. `timingSafeEqual`),
  never `===` on the secrets
- Method: inspection

## UC-045 — No credential ever reaches the logs
- Area: auth
- Requirement: 11.9, 12.10
- Preconditions: `LOG_LEVEL=debug`
- Data needed: FIX-CLEAN
- Steps: log in, make a bearer-authenticated request, make a failing one; grep the
  captured log for the token, the passphrase and the cookie value
- Expected: none of the three appears in any line

## UC-046 — A CORS preflight is answered before authentication
- Area: auth
- Requirement: 11.19, 11.24
- Preconditions: `CORS_ORIGINS=https://shortcut.example`
- Data needed: none
- Steps: `OPTIONS $BASE/api/activities` with `Origin: https://shortcut.example` and
  `Access-Control-Request-Method: POST`, carrying no credential
- Expected: a 2xx (not 401) carrying `Access-Control-Allow-Origin` naming that exact
  origin, `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`,
  `Access-Control-Allow-Headers` including `Authorization, Content-Type,
  Idempotency-Key, X-Request-Id`, `Access-Control-Max-Age: 600` and
  `Access-Control-Allow-Credentials: false`

## UC-047 — An origin is matched exactly, scheme host and port together
- Area: auth
- Requirement: 11.23
- Preconditions: `CORS_ORIGINS=https://shortcut.example`
- Data needed: none
- Steps: preflight from `http://shortcut.example`, from
  `https://shortcut.example:8443`, and from `https://evil.example`
- Expected: none of the three receives an `Access-Control-Allow-Origin`, and no value is
  reflected back

## UC-048 — A session cookie is never accepted on a cross-origin request
- Area: auth
- Requirement: 11.18
- Preconditions: logged in; `CORS_ORIGINS=https://shortcut.example`
- Data needed: FIX-PROJECTS
- Steps: `GET /api/projects` carrying the session cookie and
  `Origin: https://shortcut.example`
- Expected: the cookie does not authenticate the request (401 unless a bearer token is
  also present), in **every** `APP_ENV`. Known deviation: the check is currently gated
  on `APP_ENV === 'production'`, so `development` and `test` accept the cookie
  cross-origin — see ISSUES.md "Cross-origin session-cookie rejection is
  production-only"

## UC-049 — Login redirects only to a local path
- Area: auth
- Requirement: 11.22
- Preconditions: none
- Data needed: FIX-CLEAN, the known passphrase
- Steps: `POST /login?next=//evil.example/x`, then with `next=https://evil.example`,
  then with `next=/day/2026-08-20`
- Expected: the first two redirect to `/`; the third redirects to `/day/2026-08-20`

## UC-050 — The login route accepts next and reason
- Area: auth
- Requirement: 11.25
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /login?next=/x&reason=session_expired`; then `POST /login` with the
  `passphrase` field and a `next` form field
- Expected: both parameters are accepted; the form field name is exactly `passphrase`;
  the `next` **field** wins over the `next` query parameter when both are present; and
  an expired session redirects to `/login?reason=session_expired`. Known deviation:
  nothing ever sets `reason=session_expired` — see ISSUES.md "reason=session_expired is
  never produced"

## UC-051 — The rate-limit identity discards exactly TRUSTED_PROXY_HOPS entries
- Area: auth
- Requirement: 11.20
- Preconditions: `TRUSTED_PROXY_HOPS=1`, `RATE_LIMIT_PER_MINUTE=5`
- Data needed: none
- Steps: send six requests all carrying `X-Forwarded-For: 9.9.9.9, 203.0.113.7`, then
  six more where only the leftmost entry differs each time
- Expected: both runs are counted against `203.0.113.7` and both are limited — a caller
  cannot mint a fresh identity by prepending an address; with
  `TRUSTED_PROXY_HOPS=0` the header is ignored entirely and the socket address is used

## UC-052 — Health, the login route, preflights and static assets are the only exemptions
- Area: auth
- Requirement: 11.1
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: unauthenticated `GET /api/health`, `GET /login`, `POST /logout`,
  `OPTIONS /api/activities`, `GET /_app/<any built asset>`, and `GET /api/days`
- Expected: the first five are served; the last is 401. `/logout` is exempt too, which
  is safe (it only destroys a session named by the cookie the caller already holds) but
  is not in 11.1's list — noted in ISSUES.md rather than treated as a failure

## UC-053 — Every failure uses one envelope
- Area: errors
- Requirement: 12.2
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: provoke one 400, one 401, one 404 and one 409
- Expected: each body carries `error` in UPPER_SNAKE_CASE, an English `message`, a
  `messageKey` matching the design's catalogue (`errors_*`), the `requestId` of the
  request, and `details` where the code defines one

## UC-054 — No internals leak in an error body
- Area: errors
- Requirement: 12.3
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: provoke a validation failure, a constraint failure and an unhandled failure
- Expected: no stack trace, no SQL text, no filesystem path and no dependency version
  in any body; a 500 carries `INTERNAL_ERROR` and the `requestId` only

## UC-055 — Malformed JSON and unknown fields are rejected
- Area: errors
- Requirement: 12.4
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/projects` with `{`; then with `{"name":"X","colour":"red"}`
- Expected: 400 `VALIDATION_ERROR` both times; the second names `colour` in
  `details.fields` with `fields_unknown`

## UC-056 — An unknown path identifier is a 404
- Area: errors
- Requirement: 12.5
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/activities/<random uuid>`; `PATCH /api/sessions/<random uuid>`;
  `PATCH /api/projects/<random uuid>`; `DELETE /api/projects/<random uuid>`
- Expected: 404 `NOT_FOUND` with `details.resource` and `details.id` for **all four**.
  Known deviation: `DELETE /api/projects/{id}` currently answers 204 for an id that
  matches no row — see ISSUES.md "DELETE /api/projects/{id} answers 204 for an unknown
  id"

## UC-057 — A body over 1 MiB is refused, with or without Content-Length
- Area: errors
- Requirement: 12.6, 12.15
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/activities` with a 2 MiB body and a correct `Content-Length`; then
  the same body sent `Transfer-Encoding: chunked` with no `Content-Length`
- Expected: 413 `PAYLOAD_TOO_LARGE` with `details.maxBytes: 1048576` both times, and the
  stream is cut rather than buffered whole. Known deviation: the chunked path currently
  surfaces as 500 `INTERNAL_ERROR` — see ISSUES.md "Streaming body-size limit answers
  500 instead of 413"

## UC-058 — Exceeding the request bucket answers 429 with an exact Retry-After
- Area: errors
- Requirement: 12.7, 12.21
- Preconditions: `RATE_LIMIT_PER_MINUTE=5`
- Data needed: FIX-CLEAN
- Steps: issue six `GET /api/sessions/current` inside one minute from one address
- Expected: the sixth answers 429 `RATE_LIMITED` with `details.scope: "request"`,
  `details.retryAfterSeconds` equal to the seconds left in the current fixed window, and
  a `Retry-After` header carrying the same number

## UC-059 — An Idempotency-Key replays the first answer
- Area: errors
- Requirement: 12.8, 12.16; design Property 18
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` (explicit, 13:00–16:00 on `Alpha`) with
  `Idempotency-Key: uc059`, then repeat the identical request with the same key
- Expected: both answer 201 with byte-identical bodies apart from nothing at all
  (identifiers included); `activity_entries` holds exactly one row

## UC-060 — The same key with a different body is refused
- Area: errors
- Requirement: 12.22; design Property 18
- Preconditions: UC-059 has run
- Data needed: FIX-FRAME plus the entry from UC-059
- Steps: `POST /api/activities` with `Idempotency-Key: uc059` and a different
  description
- Expected: 409 `IDEMPOTENCY_KEY_REUSED` with `details.key`; nothing is created

## UC-061 — An idempotency key outlives the entry it created
- Area: errors
- Requirement: 12.17
- Preconditions: UC-059 has run
- Data needed: FIX-FRAME plus the entry from UC-059
- Steps: `DELETE` that entry, then repeat the original `POST` with the same key
- Expected: no second entry is created; the stored response is replayed (or the reuse is
  refused) — never a fresh write

## UC-062 — An Idempotency-Key is validated for shape
- Area: errors
- Requirement: 12.23
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with a 201-character key; then with a key containing `/`
- Expected: 400 `VALIDATION_ERROR` both times

## UC-063 — Idempotency keys are retained for at least 24 hours
- Area: errors
- Requirement: 12.9
- Preconditions: none
- Data needed: an `idempotency_keys` row created 23 h ago and one created 25 h ago
- Steps: run the cleanup sweep
- Expected: the 23-hour row survives, the 25-hour row is purged

## UC-064 — One structured log line per request
- Area: errors
- Requirement: 12.10
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: issue one request and capture stdout
- Expected: exactly one JSON line carrying `timestamp`, `level`, `message`, `requestId`,
  the method, the path, the status and the duration

## UC-065 — X-Request-Id is propagated, or generated when absent
- Area: errors
- Requirement: 12.11
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: send a request with `X-Request-Id: uc065`; then one without the header
- Expected: the first echoes `uc065` in the response header, the log line and the error
  envelope; the second carries a generated identifier that is the same in all three

## UC-066 — Security headers on every response, CSP only on rendered HTML
- Area: errors
- Requirement: 12.12, 12.33
- Preconditions: `APP_ENV=production` for the HSTS half
- Data needed: FIX-CLEAN
- Steps: inspect the headers of `GET /api/health` and of `GET /login`
- Expected: both carry `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` and (in production)
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`; only the HTML
  response carries `Content-Security-Policy`, and it denies framing and names an
  explicit `font-src 'self'` with no external font host

## UC-067 — The production CSP carries neither unsafe-inline nor unsafe-eval
- Area: errors
- Requirement: 12.13
- Preconditions: a production build served with `APP_ENV=production`
- Data needed: FIX-CLEAN
- Steps: read the `Content-Security-Policy` of a rendered page
- Expected: no `unsafe-inline`, no `unsafe-eval`; the page still hydrates (the nonce is
  stamped by the framework)

## UC-068 — A dead database answers 503, not 500
- Area: errors
- Requirement: 12.14, 12.21
- Preconditions: server running, PostgreSQL stopped
- Data needed: none
- Steps: `GET /api/sessions/current`
- Expected: 503 `SERVICE_UNAVAILABLE` with `details.retryAfterSeconds: 5` and
  `Retry-After: 5`

## UC-069 — An unimplemented method on an existing path answers 405 in the envelope
- Area: errors
- Requirement: 12.24
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `DELETE $BASE/api/health`; `POST $BASE/api/coverage`; `PUT $BASE/api/projects`
- Expected: 405 `METHOD_NOT_ALLOWED` in the standard envelope with `details.allowed[]`
  and a matching `Allow` header. Known deviation: nothing currently throws this code —
  see ISSUES.md "METHOD_NOT_ALLOWED is never produced"

## UC-070 — Bodies are camelCase and query parameters are snake_case
- Area: errors
- Requirement: 12.1
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: exercise `startedAt`/`endedAt`/`durationMinutes`/`projectId` in bodies and
  `from`/`to`/`include_archived`/`project_id`/`min_gap_seconds`/`dry_run`/
  `preview_token` in query strings
- Expected: each spelling is accepted in its own place; a body field in snake_case and a
  query parameter in camelCase are both rejected as unknown

## UC-071 — Error details always name the obstacle
- Area: errors
- Requirement: 12.18
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus a project referenced by an entry
- Steps: provoke `ACTIVITY_OVERLAP`, `PROJECT_IN_USE`, `SESSION_OVERLAP`,
  `RANGE_TOO_LARGE` and `PROJECT_ARCHIVED`
- Expected: each `details` payload carries what the design's error table promises —
  conflicting records with project names and descriptions, the sample of blocking
  entries, the limit that was exceeded — so no client has to fetch a second resource

## UC-072 — NOTHING_TO_LOG says which of the four causes applied
- Area: errors
- Requirement: 12.19, 6.12
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: provoke each cause: an empty resolved interval, a request wholly outside
  `Tracked_Time` with policy `clip`, a request wholly inside `Covered_Time`, and a
  request whose every produced segment is under 60 s
- Expected: 409 `NOTHING_TO_LOG` each time with `details.reason` equal to
  `empty-interval`, `no-tracked-time`, `already-covered` and `all-slivers`
  respectively, plus `anchor` and `requested`, and `slivers` for the last

## UC-073 — STALE_PREVIEW reports both tokens
- Area: errors
- Requirement: 12.20, 14.8
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: take a `previewToken` from a dry run, change the frame (add a session), then
  submit the confirming write with the old token
- Expected: 409 `STALE_PREVIEW` with `details.submittedToken` and `details.currentToken`

## UC-074 — %lang% and %theme% are substituted before the page ships
- Area: errors
- Requirement: 12.25, 12.31, 12.32
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /login` with no cookies; then with `worklog_theme=light`; then with
  `worklog_theme=system` and `worklog_theme_resolved=light`
- Expected: the served HTML never contains `%lang%` or `%theme%`; `data-theme` is
  `dark` (the default render theme), then `light`, then `light`; it is never the literal
  `system`

## UC-075 — The locale is resolved in one place and in one order
- Area: errors
- Requirement: 12.26, 12.27
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /login` with `worklog_locale=en`; then with no cookie and
  `Accept-Language: en-GB,en;q=0.9`; then with neither
- Expected: `<html lang>` is `en`, `en`, `cs` respectively, and the rendered text agrees
  with the attribute in each case

## UC-076 — The three preference cookies are script-readable and long-lived
- Area: errors
- Requirement: 12.28, 12.29, 12.30
- Preconditions: `APP_ENV=development`
- Data needed: FIX-CLEAN
- Steps: inspect any `Set-Cookie` for `worklog_locale`, `worklog_theme` and
  `worklog_theme_resolved`; send an unrecognised `worklog_theme=purple`
- Expected: all three carry `SameSite=Lax`, an explicit `Path`, `Max-Age=31536000` and
  no `HttpOnly` (and `Secure` outside development); the unrecognised value is treated as
  `system`, never as an error. Known deviation: the server only **reads** the three
  cookies and never sets them, so there is no `Set-Cookie` to inspect — see ISSUES.md
  "The three preference cookies are read but never set"

## UC-077 — A field error carries its own message key
- Area: errors
- Requirement: 12.34
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `POST /api/activities` with `projectId: "not-a-uuid"`; with
  `description` of 2001 characters; with `startedAt` but no `endedAt` on a PATCH; with
  `durationMinutes` and no `date` on a PATCH
- Expected: 400 `VALIDATION_ERROR` whose `details.fields` maps each failing field to a
  key drawn from the enumerated `fields_*` catalogue (`fields_invalid_id`,
  `fields_too_long`, `fields_bounds_together`, `fields_date_required_for_duration`),
  never a raw English schema sentence

## UC-078 — Creating a project assigns the lowest free colour index
- Area: projects
- Requirement: 3.1, 3.9
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `POST /api/projects {"name":"Alpha"}`, then `{"name":"Beta"}`, then
  `{"name":"Gamma"}`
- Expected: 201 each, with `colorIndex` 0, 1, 2 and `archived: false`

## UC-079 — A duplicate name is refused, ignoring case and surrounding whitespace
- Area: projects
- Requirement: 3.2
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/projects {"name":"  alpha "}`
- Expected: 409 `PROJECT_EXISTS` with `details.projectId` and `details.projectName` of
  the existing `Alpha`, so the caller can offer to use it

## UC-080 — An empty or over-long project name is refused
- Area: projects
- Requirement: 3.3
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `POST /api/projects {"name":"   "}`; then with a 201-character name; then the
  same two as a `PATCH`
- Expected: 400 `VALIDATION_ERROR` in all four cases

## UC-081 — Listing returns non-archived projects by name ascending
- Area: projects
- Requirement: 3.4
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `GET /api/projects`
- Expected: 200 with a bare array holding `Alpha` and `Beta` in that order; `Gamma` is
  absent; each item carries `id`, `name`, `colorIndex`, `archived`, `archivedAt`,
  `createdAt`, `updatedAt`

## UC-082 — include_archived=true adds the archived projects
- Area: projects
- Requirement: 3.5
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `GET /api/projects?include_archived=true`
- Expected: 200 with all three, still by name ascending, `Gamma` carrying
  `archived: true` and a non-null `archivedAt`

## UC-083 — A project's name, archived state and colour can be patched together
- Area: projects
- Requirement: 3.6
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `PATCH /api/projects/{Beta} {"name":"Beta II","archived":true,"colorIndex":5}`
- Expected: 200 with all three applied; a `PATCH` of any single field works too; an
  empty `{}` body is a no-op 200 or a 400, never a 500. Known deviation: `{}` currently
  produces 500 `INTERNAL_ERROR` — see ISSUES.md "An empty PATCH body on a project
  answers 500"

## UC-084 — The colour index survives a rename, an archive and an unarchive
- Area: projects
- Requirement: 3.10
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: note `Alpha`'s `colorIndex`; rename it, archive it, unarchive it, reading it
  back each time
- Expected: `colorIndex` is unchanged throughout

## UC-085 — An explicitly supplied colour index may duplicate another project's
- Area: projects
- Requirement: 3.11
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `PATCH /api/projects/{Beta} {"colorIndex":0}` while `Alpha` holds 0
- Expected: 200 and both projects hold 0; a `colorIndex` of 8 or −1 is 400
  `VALIDATION_ERROR`

## UC-086 — With all eight slots taken, the least-used index wins, lowest on a tie
- Area: projects
- Requirement: 3.12
- Preconditions: none
- Data needed: FIX-CLEAN plus eight non-archived projects holding indices 0–7, then a
  ninth patched to `colorIndex: 3` so 3 is held twice
- Steps: `POST /api/projects {"name":"Tenth"}`
- Expected: 201 with the lowest index held by the fewest non-archived projects — `0`
  here, since 0–2 and 4–7 are each held once and the tie breaks low

## UC-087 — Deleting an unreferenced project succeeds
- Area: projects
- Requirement: 3.8
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `DELETE /api/projects/{Gamma}`
- Expected: 204 with an empty body; the row is gone

## UC-088 — Deleting a referenced project names the records that block it
- Area: projects
- Requirement: 3.7
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus eleven more entries on `Alpha` (so the count
  exceeds `ERROR_DETAIL_SAMPLE_SIZE`)
- Steps: `DELETE /api/projects/{Alpha}`
- Expected: 409 `PROJECT_IN_USE` with `details.entryCount: 12` and `details.entries` of
  exactly 10 items, each carrying `entryId`, `description`, `requestedStartedAt` and
  `requestedEndedAt`; nothing is deleted

## UC-089 — Starting the timer creates an open session
- Area: timer
- Requirement: 1.1
- Preconditions: no `Open_Session`
- Data needed: FIX-PROJECTS
- Steps: `POST /api/sessions/start {}`
- Expected: 201 with `session.startedAt` at the current second, `session.endedAt: null`,
  `session.stale: false` and `discarded: false`

## UC-090 — Starting twice is refused and creates nothing
- Area: timer
- Requirement: 1.2, 1.9
- Preconditions: none
- Data needed: FIX-OPEN
- Steps: `POST /api/sessions/start {}`
- Expected: 409 `SESSION_ALREADY_RUNNING` with `details.sessionId` and
  `details.startedAt` of the running one; `work_sessions` still holds exactly one open
  row (the partial unique index makes a second unrepresentable)

## UC-091 — Start accepts an explicit startedAt
- Area: timer
- Requirement: 1.3
- Preconditions: no `Open_Session`
- Data needed: FIX-CLEAN
- Steps: `POST /api/sessions/start {"startedAt":"<now − 90 min, RFC 3339 + offset>"}`
- Expected: 201 with exactly that instant (truncated to the whole second) rather than
  the current time

## UC-092 — A start overlapping an existing session is refused
- Area: timer
- Requirement: 1.4
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/sessions/start {"startedAt":"2026-08-20T09:00:00+02:00"}`
- Expected: 409 `SESSION_OVERLAP` with `details.conflicts[]` naming S1's `sessionId`,
  its `interval` and `open: false`; nothing is created

## UC-093 — Stopping closes the running session
- Area: timer
- Requirement: 1.5
- Preconditions: none
- Data needed: FIX-OPEN
- Steps: `POST /api/sessions/stop {}`
- Expected: 200 with `session.endedAt` at the current second, `discarded: false`; the
  row is now closed and `GET /api/sessions/current` reports `session: null`

## UC-094 — Stopping with nothing running is refused
- Area: timer
- Requirement: 1.6
- Preconditions: no `Open_Session`
- Data needed: FIX-CLEAN
- Steps: `POST /api/sessions/stop {}`
- Expected: 409 `NO_SESSION_RUNNING`

## UC-095 — Stop accepts an explicit endedAt
- Area: timer
- Requirement: 1.7
- Preconditions: none
- Data needed: FIX-OPEN
- Steps: `POST /api/sessions/stop {"endedAt":"<now − 10 min>"}`
- Expected: 200 with exactly that instant as `endedAt`

## UC-096 — The current-session endpoint answers in both states
- Area: timer
- Requirement: 1.8
- Preconditions: none
- Data needed: FIX-OPEN, then FIX-CLEAN
- Steps: `GET /api/sessions/current` with a session open, and again with none
- Expected: first 200 with the session, `elapsedSeconds` ≈ 7200 and `stale: false`; then
  200 with `session: null`, `elapsedSeconds: 0`, `stale: false`

## UC-097 — A stale session is flagged everywhere and is never closed automatically
- Area: timer
- Requirement: 1.10, 1.11
- Preconditions: `MAX_OPEN_SESSION_HOURS=12`
- Data needed: FIX-STALE
- Steps: `GET /api/sessions/current`, `GET /api/sessions`, `GET /api/days/{its date}`
- Expected: `stale: true` on the session in **every** response that carries it; the row
  still has `endedAt: null` after all three reads and after waiting

## UC-098 — A stale session's tail is excluded from Tracked_Time
- Area: timer
- Requirement: 1.12
- Preconditions: `MAX_OPEN_SESSION_HOURS=12`
- Data needed: FIX-STALE (open for 13 h)
- Steps: `GET /api/coverage` over the range covering that session
- Expected: `totals.trackedSeconds` counts 12 h, not 13; the last hour is `untracked`;
  `Uncovered_Time` is not inflated by it

## UC-099 — The elapsed clock is reported uncapped
- Area: timer
- Requirement: 1.17
- Preconditions: `MAX_OPEN_SESSION_HOURS=12`
- Data needed: FIX-STALE (open for 13 h)
- Steps: `GET /api/sessions/current`
- Expected: `elapsedSeconds` ≈ 46 800 (13 h), **not** 43 200 — only the contribution to
  `Tracked_Time` is capped

## UC-100 — A write into a stale session's tail is refused as an overlap
- Area: timer
- Requirement: 1.15, 1.16
- Preconditions: `MAX_OPEN_SESSION_HOURS=12`
- Data needed: FIX-STALE (open since `now − 13 h`)
- Steps: `POST /api/sessions` for `now − 30 min → now − 10 min`, which lies inside the
  uncapped span but outside the capped one
- Expected: 409 `SESSION_OVERLAP` with `details.conflicts[]` carrying `open: true`; the
  guard runs inside the writing transaction (the exclusion constraint cannot see an open
  row), and the subsequent `POST /api/sessions/stop` therefore still succeeds

## UC-101 — A timestamp too far in the future is refused
- Area: timer
- Requirement: 1.13
- Preconditions: `FUTURE_TOLERANCE_SECONDS=300`
- Data needed: FIX-CLEAN
- Steps: `POST /api/sessions/start {"startedAt":"<now + 10 min>"}`; then
  `POST /api/sessions` ending `<now + 10 min>`
- Expected: 400 `FUTURE_TIMESTAMP` with `details.field`, `details.value` and
  `details.maxAllowed`; a timestamp `now + 60 s` is accepted (inside the tolerance)

## UC-102 — A session shorter than the floor is refused
- Area: timer
- Requirement: 1.14
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: FIX-CLEAN
- Steps: `POST /api/sessions` for a 45-second interval; then `PATCH` an existing session
  down to 45 seconds
- Expected: 400 `INTERVAL_TOO_SHORT` with `details.minSeconds: 60` and
  `details.actualSeconds: 45`; nothing is written

## UC-103 — Stopping a timer that ran under a minute deletes it and still answers 200
- Area: timer
- Requirement: 1.18
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: FIX-PROJECTS plus a session started 20 s ago
- Steps: `POST /api/sessions/stop {}`
- Expected: 200 with `session: null` and `discarded: true` — never an error; the row is
  gone, so a timer the user started is always stoppable

## UC-104 — A forgotten session can be added after the fact
- Area: sessions
- Requirement: 2.1
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/sessions {"startedAt":"2026-08-20T08:00:00+02:00",
  "endedAt":"2026-08-20T14:48:00+02:00"}`
- Expected: 201 with the closed session, `stale: false`, `discarded: false`

## UC-105 — Sessions are listed for a range, by start ascending
- Area: sessions
- Requirement: 2.2
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `GET /api/sessions?from=2026-08-20T03:00:00%2B02:00&to=2026-08-21T03:00:00%2B02:00`
- Expected: 200 with a bare array of both sessions, S1 first; a session merely
  overlapping the range is included with its true bounds

## UC-106 — A range-less session listing defaults to the current Logical_Day
- Area: sessions
- Requirement: 2.3
- Preconditions: none
- Data needed: FIX-PROJECTS plus one session earlier today and one three days ago
- Steps: `GET /api/sessions`
- Expected: 200 with today's session only

## UC-107 — A session range over 366 days is refused
- Area: sessions
- Requirement: 2.4
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/sessions?from=…&to=…` spanning 368 `Logical_Day` values
- Expected: 400 `RANGE_TOO_LARGE` with `details.maxDays: 366` and
  `details.requestedDays`

## UC-108 — A session's bounds can be corrected
- Area: sessions
- Requirement: 2.5
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `PATCH /api/sessions/{S2} {"endedAt":"2026-08-20T17:00:00+02:00"}`; then a
  patch changing both bounds; then one setting `endedAt: null`
- Expected: 200 each; the last re-opens the session (and is refused with
  `SESSION_ALREADY_RUNNING` if another is already open)

## UC-109 — A session whose start is not before its end is refused
- Area: sessions
- Requirement: 2.6
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/sessions` with `endedAt` before `startedAt`; then the same as a
  `PATCH`
- Expected: 400 `INVALID_INTERVAL` with `details.start` and `details.end` in both cases.
  Known deviation: the `POST` path checks the length before the ordering and answers
  400 `INTERVAL_TOO_SHORT` with a negative `actualSeconds` — see ISSUES.md
  "POST /api/sessions reports reversed bounds as INTERVAL_TOO_SHORT"

## UC-110 — A session write overlapping another session is refused
- Area: sessions
- Requirement: 2.7
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/sessions` for 14:00–16:00 on day D; then `PATCH` S2 back to 14:00
- Expected: 409 `SESSION_OVERLAP` in both cases, `details.conflicts[]` naming the
  conflicting session ids and intervals; two sessions that merely **touch** at one
  instant are accepted (intervals are half-open)

## UC-111 — A session can be deleted
- Area: sessions
- Requirement: 2.8
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `DELETE /api/sessions/{S2}`
- Expected: 204 with an empty body; the row is gone

## UC-112 — A frame change re-clips by segment overlap and by requested-interval overlap
- Area: sessions
- Requirement: 2.9
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH /api/sessions/{S1} {"endedAt":"2026-08-20T14:00:00+02:00"}`, then
  `GET /api/activities/{entry}`
- Expected: the entry's segments become 13:00–14:00 and 15:12–16:00; and after the
  reverse patch (S1 back to 14:48) the 13:00–14:48 segment returns — an entry the first
  change emptied is reconsidered because its **requested** interval still overlaps

## UC-113 — An entry reconciliation empties survives as an Orphaned_Entry
- Area: sessions
- Requirement: 2.10
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `DELETE` both sessions, then `GET /api/activities/{entry}`
- Expected: 200 with the entry still present, `segments: []`, `orphaned: true`, and its
  `requestedStartedAt`/`requestedEndedAt` untouched — it is not deleted

## UC-114 — A duration entry re-clips over its frozen interval, never re-anchored
- Area: sessions
- Requirement: 2.11; design Property 11
- Preconditions: none
- Data needed: FIX-FRAME plus a `Duration_Mode` entry of 120 min anchored at 14:00
  (resolved to 14:00–16:24)
- Steps: `PATCH /api/sessions/{S1} {"startedAt":"2026-08-20T07:00:00+02:00"}` — a
  morning change that leaves the afternoon alone
- Expected: the entry's segments stay inside 14:00–16:24; the `Placement_Anchor` is
  **not** resolved again, so the entry does not move to the new earliest eligible time,
  and `requestedStartedAt`/`requestedEndedAt`/`requestedDurationMinutes` are unchanged

## UC-115 — Extending and creating in one request runs in a fixed order
- Area: sessions
- Requirement: 2.12, 6.13
- Preconditions: none
- Data needed: FIX-ORPHAN (an orphan whose requested interval is 13:00–16:00 on day D,
  with no session left on that day)
- Steps: `POST /api/activities` on `Beta` for 13:00–16:00 of day D with
  `untrackedPolicy: "extend"`
- Expected: the extending `Work_Session` is created first, the orphan is re-clipped
  second and reclaims its time, and the new entry is placed last against what remains —
  so the new request reports the reclaimed stretch as `discarded` rather than stealing
  it, and the outcome does not depend on write order

## UC-116 — An explicit entry is clipped around the break (the worked example)
- Area: activities-explicit
- Requirement: 4.1, 6.1, 6.3; design Property 24
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities {"projectId":"<Alpha>","description":"spec work",
  "startedAt":"2026-08-20T13:00:00+02:00","endedAt":"2026-08-20T16:00:00+02:00"}`
- Expected: 201 with exactly two segments, `13:00–14:48` and `15:12–16:00` (in UTC on
  the wire), `discarded` holding the 24-minute break, `slivers: []`,
  `unplacedMinutes: 0`, `removedSeconds: 0`, `anchor: null`, `dryRun: false` and a
  `previewToken`

## UC-117 — The originally requested interval is stored unchanged
- Area: activities-explicit
- Requirement: 4.2; design Property 11
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/activities/{entry}`
- Expected: `requestedStartedAt` = 13:00 and `requestedEndedAt` = 16:00 in UTC, even
  though no segment covers 14:48–15:12; `mode: "explicit"`,
  `requestedDurationMinutes: null`

## UC-118 — An end and a duration together name two modes and are refused
- Area: activities-explicit
- Requirement: 4.3
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` carrying both `endedAt` and `durationMinutes`
- Expected: 400 `AMBIGUOUS_MODE`

## UC-119 — An explicit interval whose start is not before its end is refused
- Area: activities-explicit
- Requirement: 4.4
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `endedAt` equal to, then earlier than, `startedAt`
- Expected: 400 `INVALID_INTERVAL` both times; a request whose sub-second bounds
  truncate to the same whole second is the same answer

## UC-120 — An entry overlapping another entry's segments is refused and names it
- Area: activities-explicit
- Requirement: 4.5; design Property 8
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `POST /api/activities` on `Beta` for 14:00–14:30 on day D
- Expected: 409 `ACTIVITY_OVERLAP` with `details.conflictCount` and
  `details.conflicts[]` carrying `entryId`, `projectName`, `colorIndex`, `description`
  and the overlapping `interval`, at most 10 of them; nothing is written

## UC-121 — An unknown project is refused
- Area: activities-explicit
- Requirement: 4.6
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with a well-formed but unused `projectId`
- Expected: 400 `VALIDATION_ERROR` naming `projectId` in `details.fields`

## UC-122 — An archived project is refused with its own code
- Area: activities-explicit
- Requirement: 4.7
- Preconditions: none
- Data needed: FIX-FRAME (project `Gamma` is archived)
- Steps: `POST /api/activities` on `Gamma` for 13:00–14:00 of day D
- Expected: 400 `PROJECT_ARCHIVED` with `details.projectId` and `details.projectName` —
  distinguishable from an unknown project

## UC-123 — Descriptions are bounded above and may be empty
- Area: activities-explicit
- Requirement: 4.8, 4.9
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with a 2001-character description; then with
  `"description": ""`; then with the field omitted
- Expected: 400 `VALIDATION_ERROR` for the first; 201 for the other two, the omitted
  case defaulting to `""`

## UC-124 — An explicit interval reaching into the future is refused
- Area: activities-explicit
- Requirement: 4.10
- Preconditions: `FUTURE_TOLERANCE_SECONDS=300`
- Data needed: FIX-OPEN
- Steps: `POST /api/activities` for `now − 30 min → now + 10 min`
- Expected: 400 `FUTURE_TIMESTAMP` with `details.field`, `value` and `maxAllowed`

## UC-125 — An end without a start is refused
- Area: activities-explicit
- Requirement: 4.11
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `endedAt` and no `startedAt`
- Expected: 400 `VALIDATION_ERROR` — `Explicit_Mode` has no rule for inferring a start

## UC-126 — A bare duration is walked forward through eligible time
- Area: activities-duration
- Requirement: 5.1, 5.8, 5.10; design Property 2
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities {"projectId":"<Alpha>","description":"deep work",
  "date":"2026-08-20","startedAt":"2026-08-20T14:00:00+02:00","durationMinutes":120}`
- Expected: 201 with segments `14:00–14:48` and `15:12–16:24`, totalling exactly
  120 minutes; `unplacedMinutes: 0`; `discarded: []` (a duration states no interval)

## UC-127 — The target day comes from `date`, or defaults to the current Logical_Day
- Area: activities-duration
- Requirement: 5.2, 5.3
- Preconditions: none
- Data needed: FIX-FRAME plus one closed session earlier today
- Steps: `POST /api/activities` with `durationMinutes: 30` and `date: "2026-08-20"`;
  then the same request without `date`
- Expected: the first is placed inside day D, the second inside today; neither reaches
  into the other day

## UC-128 — An explicit start is used as the placement start
- Area: activities-duration
- Requirement: 5.4, 5.16
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `startedAt: 2026-08-20T15:30:00+02:00`,
  `durationMinutes: 60`, `date: "2026-08-20"`
- Expected: 201 with a single segment 15:30–16:30 and
  `anchor: {"at":"…13:30:00Z","source":"explicit"}`

## UC-129 — Without a start, the anchor is the end of the day's last segment
- Area: activities-duration
- Requirement: 5.5, 5.16
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED (last segment ends 16:00)
- Steps: `POST /api/activities` on `Beta` with `durationMinutes: 60`,
  `date: "2026-08-20"`
- Expected: 201 with a segment starting at 16:00, and
  `anchor: {"at":"…14:00:00Z","source":"last-segment"}`

## UC-130 — With no segment yet, the anchor is the day's earliest session start
- Area: activities-duration
- Requirement: 5.6, 5.16
- Preconditions: none
- Data needed: FIX-FRAME (no entries)
- Steps: `POST /api/activities` with `durationMinutes: 60`, `date: "2026-08-20"`
- Expected: 201 with a segment 08:00–09:00 and
  `anchor: {"at":"…06:00:00Z","source":"first-session"}`

## UC-131 — A day with neither a segment nor a session has no anchor
- Area: activities-duration
- Requirement: 5.7
- Preconditions: none
- Data needed: FIX-PROJECTS (no sessions at all)
- Steps: `POST /api/activities` with `durationMinutes: 60`, `date: "2026-08-20"`
- Expected: 409 `NO_PLACEMENT_ANCHOR` with `details.date` and `details.dayBounds`

## UC-132 — The forward walk stops at the end of the target day
- Area: activities-duration
- Requirement: 5.9, 5.11
- Preconditions: none
- Data needed: FIX-FRAME plus a session on the **next** day, 2026-08-21 09:00–17:00
- Steps: `POST /api/activities` with `date: "2026-08-20"`, `durationMinutes: 900`
  (15 h — more than day D holds)
- Expected: the segments stay inside day D; the next day's session is never consumed;
  the shortfall is reported as `unplacedMinutes`

## UC-133 — A shortfall is reported in minutes, rounded up
- Area: activities-duration
- Requirement: 5.11, 5.14
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `startedAt: 17:30+02:00`, `date: "2026-08-20"`,
  `durationMinutes: 60` (only 30 min of tracked time remains)
- Expected: 201 with a 30-minute segment and `unplacedMinutes: 30`; a 20-second
  remainder would report `1`, never `0`

## UC-134 — A non-positive or fractional duration is refused
- Area: activities-duration
- Requirement: 5.12
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `durationMinutes` of `0`, `-30` and `12.5` in turn
- Expected: 400 `VALIDATION_ERROR` each time

## UC-135 — The resolved interval and the requested duration are both stored
- Area: activities-duration
- Requirement: 5.13; design Property 11
- Preconditions: none
- Data needed: the entry created in UC-126
- Steps: `GET /api/activities/{entry}`
- Expected: `mode: "duration"`, `requestedDurationMinutes: 120`,
  `requestedStartedAt` = 14:00 and `requestedEndedAt` = 16:24 (what the walk resolved
  to) — so the entry can be ordered, re-clipped and found again when emptied

## UC-136 — Time refused by the floor is reported, not lost
- Area: activities-duration
- Requirement: 5.14, 5.15, 6.5; design Property 2, Property 6
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: FIX-PROJECTS plus two closed sessions on day D,
  `11:00:00–11:59:40+02:00` and `13:00:00–16:00:00+02:00`
- Steps: `POST /api/activities` with `date: "2026-08-20"`,
  `startedAt: "2026-08-20T11:00:00+02:00"`, `durationMinutes: 60`
- Expected: 201 with a single segment `11:00:00–11:59:40` (3 580 s) and
  `unplacedMinutes: 1` — the 20-second tail is below the floor, so it is refused rather
  than emitted, and `3580 s + 20 s` is exactly the 60 minutes asked for. Second case,
  same fixture with a covering entry over `13:00–13:00:30`: the walk **skips** a
  below-floor fragment in the middle of the eligible list and carries on past it rather
  than stopping there. No stored segment is ever shorter than 60 s

## UC-137 — The resolved anchor is reported on success, not only on failure
- Area: activities-duration
- Requirement: 5.16
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: any successful `Duration_Mode` or `Open_Mode` write
- Expected: the 201 body carries `anchor: {at, source}` with `source` one of
  `explicit`, `last-segment`, `first-session`; an `Explicit_Mode` write carries
  `anchor: null`

## UC-138 — Every stored segment lies inside Tracked_Time
- Area: clipping
- Requirement: 6.1, 6.2; design Property 1
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/coverage` for day D and compare every `covered` interval against
  `tracked`
- Expected: `covered` is a subset of `tracked` with no part touching `untracked`; the
  14:48–15:12 break is `untracked` and carries no segment

## UC-139 — A break survives inside a logged interval
- Area: clipping
- Requirement: 6.3, 6.4; design Property 3
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/activities/{entry}`
- Expected: two segments rather than one spanning block, ordered by start ascending,
  neither overlapping nor touching the other, one per overlapped `Work_Session`

## UC-140 — A sub-floor segment is reported apart from the discarded parts
- Area: clipping
- Requirement: 6.5
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: FIX-PROJECTS plus sessions `09:00:00–09:00:30+02:00` (30 s, inserted by
  SQL to bypass the write-time floor) and `10:00–12:00+02:00` on day D
- Steps: `POST /api/activities` for `09:00–12:00+02:00` with policy `clip`
- Expected: 201 with one segment 10:00–12:00; the 30-second stretch appears in
  `slivers`, the untracked 09:00:30–10:00 appears in `discarded`; the two lists are
  never merged, because policy `reject` must fail on the second and not on the first

## UC-141 — Policy clip is the default and reports what it removed
- Area: clipping
- Requirement: 6.6, 6.10
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` for 13:00–16:00 on day D with no `untrackedPolicy`
- Expected: identical to UC-116 — the break lands in `discarded` and the write succeeds;
  the absent field behaves exactly as `"untrackedPolicy":"clip"`

## UC-142 — Policy extend lengthens the frame and reports the sessions it wrote
- Area: clipping
- Requirement: 6.7
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` for `2026-08-20T18:00–19:00+02:00` (wholly untracked,
  in the past) with `untrackedPolicy: "extend"`
- Expected: 201 with a segment covering the whole hour, `extendedSessions[]` naming the
  created or lengthened `Work_Session` rows, `discarded: []` and `unplacedMinutes: 0`;
  `GET /api/sessions` now shows the frame reaching 19:00

## UC-143 — Extend never reaches into the future
- Area: clipping
- Requirement: 6.8; design Property 20
- Preconditions: none
- Data needed: FIX-PROJECTS plus a closed session `now − 2 h → now − 1 h`
- Steps: `POST /api/activities` for `now − 90 min → now + 30 min` with policy `extend`
- Expected: the request is refused earlier as `FUTURE_TIMESTAMP`; and for a request
  ending exactly at `now`, no created session ends after `now` — every interval in
  `extendedSessions` ends at or before the current second

## UC-144 — Policy reject fails when any part of a stated interval is untracked
- Area: clipping
- Requirement: 6.9
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` for 13:00–16:00 on day D with
  `untrackedPolicy: "reject"`
- Expected: 409 `OUTSIDE_TRACKED_TIME` with `details.outside[]` holding the
  14:48–15:12 break and `details.outsideSeconds: 1440`; **nothing** is created

## UC-145 — Policy reject behaves as clip in Duration_Mode
- Area: clipping
- Requirement: 6.9
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with `durationMinutes: 900`, `date: "2026-08-20"` and
  `untrackedPolicy: "reject"`
- Expected: 201, not 409 — a duration states no interval, so nothing lies outside
  anything; the shortfall is reported as `unplacedMinutes` and `OUTSIDE_TRACKED_TIME` is
  never raised in this mode

## UC-146 — A rejected write leaves nothing behind
- Area: clipping
- Requirement: 6.11; design Property 10
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: snapshot every table; provoke a 409 from a `policy: "extend"` write that fails
  on an overlap; snapshot again
- Expected: `work_sessions`, `activity_entries`, `activity_segments`, `projects` and
  `idempotency_keys` are byte-identical — no half-written extending session, no claimed
  idempotency key

## UC-147 — A write producing no segment is refused in every mode
- Area: clipping
- Requirement: 6.12
- Preconditions: none
- Data needed: FIX-PROJECTS plus one session 09:00–10:00 on day D
- Steps: `POST /api/activities` for 13:00–14:00 of day D (explicit, policy `clip`); then
  a `Duration_Mode` request whose eligible time is zero; then an `Open_Mode` request
  whose resolved interval is untracked
- Expected: 409 `NOTHING_TO_LOG` all three times with the appropriate
  `details.reason`; no `Activity_Entry` is created, so a write never manufactures an
  orphan

## UC-148 — Extend never reaches outside what the request asked for
- Area: clipping
- Requirement: 6.13
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: an `Explicit_Mode` extend for 18:00–19:00 on day D; then a `Duration_Mode`
  extend of 600 minutes on day D
- Expected: the explicit case creates nothing outside 18:00–19:00; the duration case
  creates nothing outside the `Logical_Day` of D (and nothing past `now`)

## UC-149 — Extend leaves an interval that would overlap an existing session uncreated
- Area: clipping
- Requirement: 6.14, 6.15
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` for 14:00–16:00 on day D with policy `extend` — the
  14:48–15:12 gap is free but the flanks are already tracked
- Expected: 201; only the gap becomes a new session; the request does **not** fail on an
  overlap; in `Explicit_Mode` any time `extend` could not lawfully cover is reported in
  `discarded`, and in `Duration_Mode` the equivalent raises `unplacedMinutes` — never
  silently dropped

## UC-150 — Extend clears the remainder only by what it actually placed
- Area: clipping
- Requirement: 6.15
- Preconditions: none
- Data needed: FIX-OPEN (the last tracked instant is `now`)
- Steps: `POST /api/activities` with `durationMinutes: 120` and policy `extend` on a day
  whose eligible time after the anchor is 30 minutes and where nothing lawful can be
  added
- Expected: `unplacedMinutes: 90`, not `0`; the counter is reduced by the placed 30
  minutes alone

## UC-151 — Explicit and open modes always report a zero remainder
- Area: clipping
- Requirement: 6.16
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: any `Explicit_Mode` or `Open_Mode` write, including one where `clip` discarded
  time and one where `extend` could not cover it
- Expected: `unplacedMinutes: 0` in every such response; the lost time is reported by
  interval instead, in `discarded` and `slivers`

## UC-152 — Extend never creates a session shorter than the floor
- Area: clipping
- Requirement: 6.17; design Property 17
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: FIX-PROJECTS plus sessions `11:00–12:00` and `12:00:30–14:00+02:00` on
  day D (a 30-second untracked gap)
- Steps: `POST /api/activities` for 11:00–14:00 with policy `extend`
- Expected: 201; no 30-second `Work_Session` is created; that time is reported by the
  rule of 6.14; every stored session is still at least 60 s long

## UC-153 — Extend never writes inside an Open_Session's uncapped span
- Area: clipping
- Requirement: 6.18
- Preconditions: `MAX_OPEN_SESSION_HOURS=12`
- Data needed: FIX-STALE (open since `now − 13 h`, so the last hour is outside
  `Tracked_Time` yet inside the row's span)
- Steps: `POST /api/activities` for `now − 45 min → now − 15 min` with policy `extend`
- Expected: no session is created inside the tail; the time is reported rather than
  filled; the subsequent `POST /api/sessions/stop` still succeeds instead of colliding
  with a session the fill would have written

## UC-154 — Activities are listed for a range in one total order
- Area: activities-crud
- Requirement: 7.1
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus two more entries on day D with the same
  `requestedStartedAt` but different creation times
- Steps: `GET /api/activities?from=…&to=…` over day D
- Expected: 200 with `{entries, nextCursor}`; every entry holding a segment inside the
  range is present, each with its `segments`, ordered by `requestedStartedAt`, then
  `createdAt`, then `id`

## UC-155 — Orphans are reachable by their requested interval and are flagged
- Area: activities-crud
- Requirement: 7.2, 7.3; design Property 16
- Preconditions: none
- Data needed: FIX-ORPHAN
- Steps: `GET /api/activities?from=…&to=…` over day D
- Expected: the emptied entry is returned with `segments: []` and `orphaned: true`,
  selected by its requested interval alone; a non-orphan carries `orphaned: false`

## UC-156 — A range-less activity listing defaults to the current Logical_Day
- Area: activities-crud
- Requirement: 7.4
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus one entry earlier today
- Steps: `GET /api/activities`
- Expected: 200 with today's entry only

## UC-157 — An activity range over 366 days is refused
- Area: activities-crud
- Requirement: 7.5
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/activities` for a 368-day range
- Expected: 400 `RANGE_TOO_LARGE` with `details.maxDays` and `details.requestedDays`

## UC-158 — Listing can be filtered by project
- Area: activities-crud
- Requirement: 7.6
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus one entry on `Beta` in the same day
- Steps: `GET /api/activities?from=…&to=…&project_id=<Beta>`
- Expected: 200 with the `Beta` entry only

## UC-159 — A single entry can be fetched by id
- Area: activities-crud
- Requirement: 7.7
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/activities/{entry}`
- Expected: 200 with the bare entry and its `segments`

## UC-160 — Patching only the description or the project does not re-clip
- Area: activities-crud
- Requirement: 7.8
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: note the segment ids; `PATCH /api/activities/{entry}
  {"description":"revised","projectId":"<Beta>"}`; read back
- Expected: 200; the description and project change; the segment **bounds** are
  unchanged and no re-clipping ran; `anchor: null` and the interval lists are empty

## UC-161 — Patching the interval or the duration replaces every segment
- Area: activities-crud
- Requirement: 7.9
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH /api/activities/{entry} {"startedAt":"2026-08-20T09:00:00+02:00",
  "endedAt":"2026-08-20T10:00:00+02:00"}`
- Expected: 200; the old segments are gone and a single 09:00–10:00 segment replaces
  them

## UC-162 — An entry never blocks or displaces itself while being patched
- Area: activities-crud
- Requirement: 7.10, 7.22
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH` the entry to 13:30–15:30 — an interval overlapping its own current
  segments; separately `PATCH` it with `durationMinutes` and a `date`
- Expected: 200 both times, no `ACTIVITY_OVERLAP` against itself; the
  `Placement_Anchor` resolved for the duration patch ignores this entry's own segments

## UC-163 — Deleting an entry removes its segments too
- Area: activities-crud
- Requirement: 7.11
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `DELETE /api/activities/{entry}`, then query `activity_segments`
- Expected: 204 with an empty body; no segment of that entry remains (`ON DELETE
  CASCADE`)

## UC-164 — Patching an entry onto an archived project is refused
- Area: activities-crud
- Requirement: 7.12
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED (`Gamma` archived)
- Steps: `PATCH /api/activities/{entry} {"projectId":"<Gamma>"}`
- Expected: 400 `PROJECT_ARCHIVED` with `details.projectId` and `details.projectName`;
  the entry is unchanged

## UC-165 — Listing is paged with a cursor
- Area: activities-crud
- Requirement: 7.13, 7.14
- Preconditions: `ACTIVITY_PAGE_SIZE=200`
- Data needed: FIX-PAGE (201 entries in one day)
- Steps: `GET /api/activities?from=…&to=…`, then repeat with the returned `cursor`
- Expected: the first page holds exactly 200 entries and a non-null `nextCursor`; the
  second holds the 201st and `nextCursor: null`; no entry is skipped or repeated; a
  cursor that does not decode to `requestedStartedAt|createdAt|id` is 400
  `VALIDATION_ERROR`, never silently ignored

## UC-166 — Every entry carries its project's name and colour
- Area: activities-crud
- Requirement: 7.15
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/activities?from=…&to=…`
- Expected: each entry carries `projectName` and `colorIndex` alongside `projectId`, so
  no caller has to fetch the project list to draw it

## UC-167 — An orphan can be rescued by rewriting its time
- Area: activities-crud
- Requirement: 7.16, 7.18
- Preconditions: none
- Data needed: FIX-ORPHAN plus a session 09:00–12:00 on day D
- Steps: `PATCH /api/activities/{orphan} {"startedAt":"2026-08-20T10:00:00+02:00",
  "endedAt":"2026-08-20T11:00:00+02:00"}`
- Expected: 200; the entry gains a 10:00–11:00 segment and is reported with
  `orphaned: false`; the patch is accepted on the same terms as for any other entry,
  even though the entry owned no segment

## UC-168 — Supplying both bounds makes the entry explicit and clears its duration
- Area: activities-crud
- Requirement: 7.17
- Preconditions: none
- Data needed: the `Duration_Mode` entry from UC-126
- Steps: `PATCH` it with `startedAt` and `endedAt`
- Expected: 200 with `mode: "explicit"`, `requestedDurationMinutes: null` and the
  requested interval replaced by the two supplied bounds

## UC-169 — A failed rescue leaves the entry exactly as it was
- Area: activities-crud
- Requirement: 7.19
- Preconditions: none
- Data needed: FIX-ORPHAN (no sessions on day D)
- Steps: `PATCH /api/activities/{orphan}` with a new interval that is still wholly
  untracked
- Expected: 409 `NOTHING_TO_LOG`; the entry keeps its **original** requested interval,
  its mode and its emptiness — a failed rescue never destroys the record

## UC-170 — One bound without the other is refused
- Area: activities-crud
- Requirement: 7.20
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH` with only `startedAt`; then with only `endedAt`
- Expected: 400 `VALIDATION_ERROR` both times, with
  `details.fields` naming `fields_bounds_together`

## UC-171 — A patched duration must name its target day
- Area: activities-crud
- Requirement: 7.21
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH` with `durationMinutes` and no `date`
- Expected: 400 `VALIDATION_ERROR` with `fields_date_required_for_duration` — the target
  day cannot be guessed from the entry being replaced

## UC-172 — Listing supports descending order and a smaller limit
- Area: activities-crud
- Requirement: 7.23, 7.24
- Preconditions: none
- Data needed: FIX-PAGE
- Steps: `GET /api/activities?from=…&to=…&order=desc&limit=5`; then with `limit=500`
- Expected: the first returns the five most recent by the same total order reversed; the
  second returns at most `ACTIVITY_PAGE_SIZE` (200), the cap applying silently or as a
  400, never returning more

## UC-173 — A patch carrying both an end and a duration is refused
- Area: activities-crud
- Requirement: 7.25
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH` with `endedAt` and `durationMinutes` together
- Expected: 400 `AMBIGUOUS_MODE`, exactly as a create answers

## UC-174 — A patched duration re-walks inside the named target day
- Area: activities-crud
- Requirement: 7.26
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH /api/activities/{entry} {"durationMinutes":60,"date":"2026-08-20"}`
- Expected: 200 with `mode: "duration"`, `requestedDurationMinutes: 60`, the anchor
  resolved inside day D by the rules of 5.5–5.7 while ignoring this entry's own
  segments, and the requested interval replaced by the one the walk resolved to

## UC-175 — The day endpoint returns everything the day page needs in one call
- Area: days
- Requirement: 8.1
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/days/2026-08-20`
- Expected: 200 carrying `date`, `bounds` (`03:00`→`03:00` in UTC), `sessions`,
  `entries` with their segments, `coverage` holding `tracked`, `covered`, `uncovered`
  and `untracked`, `totals` and `quickLog`

## UC-176 — Records are returned unclipped but counted clamped
- Area: days
- Requirement: 8.2, 8.3, 10.7; design Property 15
- Preconditions: none
- Data needed: FIX-NIGHT (a session crossing the 03:00 boundary)
- Steps: `GET /api/days/2026-08-21` and `GET /api/days/2026-08-22`
- Expected: both days return the session with its **true** bounds
  (22:00 → 01:30), so a client can see it continues; but `trackedSeconds` counts only
  the part inside each day, and the two figures sum to the session's full length — it is
  neither split nor double counted

## UC-177 — The day totals and the per-project breakdown agree
- Area: days
- Requirement: 8.4, 8.5; design Property 23
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus one entry on the archived `Gamma`
- Steps: `GET /api/days/2026-08-20`
- Expected: `totals.trackedSeconds: 34560`, `totals.coveredSeconds` equal to the sum of
  the day's clamped segment durations, `uncoveredSeconds = tracked − covered`, and
  `byProject` summing to exactly `coveredSeconds` while including the archived project
  with its `colorIndex` and `archived: true`

## UC-178 — Orphans appear in the day response
- Area: days
- Requirement: 8.6
- Preconditions: none
- Data needed: FIX-ORPHAN
- Steps: `GET /api/days/2026-08-20`
- Expected: the emptied entry is in `entries` with `orphaned: true`, `segments: []` and
  its requested interval — the data the "mimo výkaz" panel renders

## UC-179 — An invalid date is refused
- Area: days
- Requirement: 8.7
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/days/20-08-2026`; then `GET /api/days/2026-13-45`
- Expected: 400 `VALIDATION_ERROR` for both. Known deviation: the second passes the
  format regex and answers 200 for an impossible date — see ISSUES.md
  "/api/days/{date} accepts an impossible but well-formatted date"

## UC-180 — An empty day answers 200 with zeros, not 404
- Area: days
- Requirement: 8.8
- Preconditions: none
- Data needed: FIX-PROJECTS (nothing on that date)
- Steps: `GET /api/days/2026-08-19`
- Expected: 200 with empty `sessions`, `entries` and interval lists, every total zero,
  `quickLog: null`

## UC-181 — A day range returns one summary per Logical_Day
- Area: days
- Requirement: 8.9, 10.15
- Preconditions: none
- Data needed: FIX-WEEK
- Steps: `GET /api/days?from=2026-08-17T03:00:00%2B02:00&to=2026-08-20T03:00:00%2B02:00`
- Expected: 200 with exactly three summaries (17th, 18th, 19th) — a `to` landing on a
  day boundary adds no empty trailing day; each carries `date`, the totals, `byProject`
  and `sessionCount`, which counts `Work_Session` **rows that began** in that day

## UC-182 — A day range over 366 days is refused
- Area: days
- Requirement: 8.10
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: `GET /api/days` for a 368-day range
- Expected: 400 `RANGE_TOO_LARGE`

## UC-183 — The longest block merges sessions that touch
- Area: days
- Requirement: 8.11
- Preconditions: none
- Data needed: FIX-TOUCHING
- Steps: `GET /api/days?from=…&to=…` over 2026-08-19
- Expected: `longestBlockSeconds: 10800` (09:00–12:00 as one block), not 7200 — the
  measurement runs over the normalized intervals, not over the longest row;
  `sessionCount: 3`

## UC-184 — Overtime is tracked time outside the Gauge_Window
- Area: days
- Requirement: 8.12; design Property 19
- Preconditions: `GAUGE_START=06:00`, `GAUGE_END=00:00`
- Data needed: FIX-NIGHT
- Steps: `GET /api/days?from=…&to=…` over 2026-08-21
- Expected: `overtimeSeconds: 5400` (00:00–01:30 of the following calendar date, which
  belongs to this `Logical_Day`); and for every day,
  `overtimeSeconds + total(tracked ∩ gaugeWindowOfDay) === trackedSeconds`

## UC-185 — The suggested window fits the range's real habits, or is absent
- Area: days
- Requirement: 8.13, 8.21, 8.22; design Property 21
- Preconditions: `SUGGESTED_WINDOW_COVERAGE=0.9`
- Data needed: FIX-WEEK; then FIX-NIGHTOWL; then FIX-PROJECTS with no sessions
- Steps: `GET /api/days?from=…&to=…` over each range
- Expected: FIX-WEEK yields the shortest 24-hour-clock arc holding at least 90 % of the
  tracked time — `{"start":"09:00","end":"17:00"}`; FIX-NIGHTOWL yields
  `suggestedWindow: null`, because no arc both covers 90 % and leaves `DAY_START_HOUR=3`
  in the gap; the empty range also yields `null`. Any non-null answer is itself a window
  the server would accept at startup: 1–24 hours, day start in the gap, no DST
  transition hour inside it

## UC-186 — The gauge window is published to clients
- Area: days
- Requirement: 8.14
- Preconditions: none
- Data needed: none
- Steps: `GET /api/health`
- Expected: `gaugeStart` and `gaugeEnd` are returned; no client has to infer them from
  returned data

## UC-187 — include=intervals adds the shape of each day
- Area: days
- Requirement: 8.15, 8.16, 8.17
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/days?from=…&to=…&include=intervals` over day D
- Expected: `intervalsIncluded: true`; each summary carries `tracked` (bare intervals,
  clamped to the day), `covered` (each carrying `projectId` and `colorIndex`) and
  `uncovered` (sent, not left to the caller to derive), all clamped to the day bounds

## UC-188 — A long range drops the intervals rather than failing
- Area: days
- Requirement: 8.18
- Preconditions: `MAX_INTERVAL_RANGE_DAYS=62`
- Data needed: FIX-WEEK
- Steps: `GET /api/days?from=…&to=…&include=intervals` over 90 days
- Expected: 200 with the summaries, no `tracked`/`covered`/`uncovered` on any of them,
  and `intervalsIncluded: false` reported in the body — a yearly statistics page must
  not fail because one panel does not apply

## UC-189 — Evening time is counted from the first Evening_Hour after the day starts
- Area: days
- Requirement: 8.19
- Preconditions: `EVENING_HOUR=21`
- Data needed: FIX-NIGHT
- Steps: `GET /api/days?from=…&to=…` over 2026-08-21
- Expected: `eveningSeconds: 12600` — the whole 22:00 → 01:30 session, measured from
  2026-08-21T21:00 (the first occurrence of 21:00 at or after the day's 03:00 start)

## UC-190 — A range-less day query defaults to the current Logical_Day
- Area: days
- Requirement: 8.20
- Preconditions: none
- Data needed: FIX-PROJECTS plus one session earlier today
- Steps: `GET /api/days`
- Expected: 200 with exactly one summary, today's

## UC-191 — Without include=intervals the interval lists are absent
- Area: days
- Requirement: 8.23
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/days?from=…&to=…` over day D
- Expected: `intervalsIncluded: false` and no `tracked`, `covered` or `uncovered` key on
  any summary — absent, not empty arrays

## UC-192 — The single-day response carries the shape-of-day figures too
- Area: days
- Requirement: 8.24
- Preconditions: none
- Data needed: FIX-TOUCHING
- Steps: `GET /api/days/2026-08-19` and compare with the matching entry from
  `GET /api/days`
- Expected: `totals.sessionCount`, `totals.longestBlockSeconds` and
  `totals.eveningSeconds` are present and equal to the range endpoint's figures for the
  same day, so the day page never calls a second endpoint

## UC-193 — quickLog names the interval and project a one-touch write would use
- Area: days
- Requirement: 8.25, 8.26
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED, plus the same fixture shifted to today for the
  current-day half
- Steps: `GET /api/days/{today}`; then `GET /api/days/2026-08-20` (a past day)
- Expected: for today, `quickLog.start` is the `Placement_Anchor` and `quickLog.end` is
  **now**; for the past day, `end` is that day's last `Work_Session` end;
  `anchorSource` is `last-segment` or `first-session`; `projectId`, `projectName` and
  `colorIndex` name the project of the day's most recent entry, or of the most recent
  entry of any day when that day has none. Sending that interval to
  `POST /api/activities` records exactly what was offered

## UC-194 — quickLog is absent when a one-touch write is impossible
- Area: days
- Requirement: 8.27
- Preconditions: none
- Data needed: FIX-PROJECTS (no entries anywhere); then a day holding neither a segment
  nor a session
- Steps: `GET /api/days/{that date}`
- Expected: `quickLog: null` in both cases — a one-touch write needs a project and an
  anchor, and neither can be invented

## UC-195 — Coverage returns the four interval sets for a range
- Area: coverage
- Requirement: 9.1
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/coverage?from=…&to=…` over day D
- Expected: 200 with `from`, `to`, `tracked`, `covered`, `uncovered`, `untracked` and
  `totals`

## UC-196 — Every returned list is normalized
- Area: coverage
- Requirement: 9.2; design Property 5
- Preconditions: none
- Data needed: FIX-TOUCHING
- Steps: `GET /api/coverage` over 2026-08-19
- Expected: each list is sorted by start ascending with adjacent and overlapping
  intervals merged — the two touching sessions appear as one 09:00–12:00 interval

## UC-197 — Covered and uncovered reconstruct tracked exactly
- Area: coverage
- Requirement: 9.3; design Property 7
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `GET /api/coverage` over day D and compute `covered ∪ uncovered`
- Expected: the union equals `tracked` exactly, the two are pairwise disjoint, and
  `untracked` is the complement of `tracked` within the queried window

## UC-198 — min_gap_seconds filters the list without touching the totals
- Area: coverage
- Requirement: 9.4, 9.8
- Preconditions: none
- Data needed: FIX-FRAME plus two entries leaving one 10-minute and one 90-second
  uncovered stretch
- Steps: `GET /api/coverage?from=…&to=…&min_gap_seconds=300`
- Expected: the 90-second stretch is absent from `uncovered` but its seconds are still
  inside `totals.uncoveredSeconds`; every total describes the whole range

## UC-199 — Coverage validates its range like every other range route
- Area: coverage
- Requirement: 9.5, 9.6, 9.7
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `GET /api/coverage` with no parameters; then over 368 days; then with `from`
  equal to `to`
- Expected: the current `Logical_Day`; 400 `RANGE_TOO_LARGE`; 400 `INVALID_INTERVAL`
  with `details.start` and `details.end`

## UC-200 — An absent min_gap_seconds omits nothing
- Area: coverage
- Requirement: 9.9
- Preconditions: none
- Data needed: as UC-198
- Steps: `GET /api/coverage?from=…&to=…` with the parameter absent
- Expected: both uncovered stretches are listed — the default is `0`

## UC-201 — Timestamps are stored and returned in UTC
- Area: logical-day
- Requirement: 10.1, 10.3
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: create a session with `+02:00` bounds, read it back over the API and read the
  row with SQL
- Expected: the response carries RFC 3339 **UTC** strings (`…Z`), the column holds the
  same instant, and no wall-clock offset is stored anywhere

## UC-202 — A timestamp without an offset is refused
- Area: logical-day
- Requirement: 10.2
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/sessions` with `"startedAt":"2026-08-20T08:00:00"`
- Expected: 400 `VALIDATION_ERROR` with `fields_invalid_timestamp`; a value carrying
  milliseconds is **accepted** and truncated toward the past to a whole second

## UC-203 — The Logical_Day begins at DAY_START_HOUR in TIMEZONE
- Area: logical-day
- Requirement: 10.4, 10.5, 10.6; design Property 12
- Preconditions: `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`
- Data needed: FIX-PROJECTS plus a session `2026-08-21T02:00–02:30+02:00`
- Steps: `GET /api/days/2026-08-20` and `GET /api/days/2026-08-21`
- Expected: `bounds` of 2026-08-20 are `2026-08-20T01:00:00Z → 2026-08-21T01:00:00Z`;
  the 02:00 session belongs to **2026-08-20**, not to the 21st; consecutive day windows
  touch without overlapping

## UC-204 — A record crossing a day boundary is attributed to both days by part
- Area: logical-day
- Requirement: 10.7
- Preconditions: none
- Data needed: FIX-PROJECTS plus a session `2026-08-21T02:00+02:00 →
  2026-08-21T04:00+02:00`
- Steps: `GET /api/days/2026-08-20` and `GET /api/days/2026-08-21`
- Expected: one row, returned whole in both responses; 3 600 s counted in each day's
  `trackedSeconds`; it is never split into two rows

## UC-205 — The timezone and day start are published to clients
- Area: logical-day
- Requirement: 10.8
- Preconditions: none
- Data needed: none
- Steps: `GET /api/health`
- Expected: `timezone` and `dayStartHour` are returned, so the interface parses and
  renders wall-clock times in the same zone the server groups by

## UC-206 — A range is half-open and days are counted by the same rule
- Area: logical-day
- Requirement: 10.15, 10.16
- Preconditions: none
- Data needed: FIX-WEEK
- Steps: `GET /api/days` with `to` exactly on a day boundary; then a range one second
  longer
- Expected: the first returns three summaries, the second four — the same rule counts
  days when enforcing `MAX_RANGE_DAYS` and `MAX_INTERVAL_RANGE_DAYS`

## UC-207 — DST produces a 23-hour and a 25-hour Logical_Day without breaking anything
- Area: logical-day
- Requirement: 10.13, 10.14; design Property 12, Property 15
- Preconditions: `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`
- Data needed: FIX-DST-SPRING, then FIX-DST-AUTUMN
- Steps: `GET /api/days/2026-03-28`, `GET /api/days/2026-03-29`,
  `GET /api/days/2025-10-25` and `GET /api/days/2025-10-26`
- Expected: the bounds of 2026-03-28 span 23 hours and those of 2025-10-25 span 25
  hours, while both **transition** dates span 24; every session lies inside
  `bounds(dateOf(t))`; the day totals still sum to the range's tracked time; the
  ambiguous wall-clock hour resolves to the same side everywhere

## UC-208 — The current Logical_Day is recomputed for every request
- Area: logical-day
- Requirement: 10.17
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: start the server, then move the clock (or the server's `TZ` reference) across a
  `DAY_START_HOUR` boundary and issue a range-less request
- Expected: the defaulted range follows the new `Logical_Day`; a server started before
  the boundary never keeps serving the previous day
- Method: request plus inspection of `handleLocals`

## UC-209 — A half-stated range is refused on every range route
- Area: logical-day
- Requirement: 10.18
- Preconditions: none
- Data needed: FIX-CLEAN
- Steps: send `?from=…` with no `to` to `/api/sessions`, `/api/activities`, `/api/days`
  and `/api/coverage`; then `?to=…` with no `from`
- Expected: 400 `VALIDATION_ERROR` in all eight cases — never a half-open range and
  never a silent fall back to the default day

## UC-210 — A dry-run activity write returns the outcome and stores nothing
- Area: dry-run
- Requirement: 14.1, 14.3, 14.5, 14.9; design Property 13, Property 14
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: snapshot the tables; `POST /api/activities` for 13:00–16:00 on day D with
  `"dryRun": true`; snapshot again; then repeat without the flag
- Expected: the dry run answers **201** with the same body shape plus `dryRun: true`,
  naming the same two segments and the same 24 minutes discarded; every table is
  byte-identical afterwards; the real write then produces exactly the state the preview
  described (compared by interval bounds and totals, not by identifiers)

## UC-211 — A dry-run session change lists every entry it would re-clip
- Area: dry-run
- Requirement: 14.2, 14.6
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `PATCH /api/sessions/{S1} {"endedAt":"2026-08-20T14:00:00+02:00",
  "dryRun":true}`
- Expected: 200 with `reclipped[]` carrying, per affected entry, its `entryId`,
  `projectName`, `colorIndex`, `description`, its segments `before` and `after`, its
  `removedMs` and whether it would become `orphaned`; plus `removedSeconds` totalling
  the described time that would disappear

## UC-212 — A dry run applies exactly the same validation
- Area: dry-run
- Requirement: 14.4
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: repeat UC-118, UC-120, UC-122, UC-144 and UC-147 with `"dryRun": true`
- Expected: the same status and the same error code each time, with the same `details`;
  a dry run that succeeds guarantees the real write will, because the deferred
  `activity_segments_no_overlap` constraint is forced immediate before the rollback

## UC-213 — Every dry run reports the time it would remove from existing segments
- Area: dry-run
- Requirement: 14.6
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: dry-run a session shortening that costs an entry 48 minutes
- Expected: `removedSeconds: 2880`; the figure is never negative and is exactly zero
  when the change only grows the frame

## UC-214 — The preview token fingerprints rows, not the clock
- Area: dry-run
- Requirement: 14.7
- Preconditions: none
- Data needed: FIX-OPEN (a timer running, so `now` moves every second)
- Steps: take a `previewToken` from a dry run, wait several seconds, take another with
  no write in between; then create a session and take a third
- Expected: the first two are identical — a running timer does not invalidate a preview;
  the third differs, because a row changed

## UC-215 — Confirming a preview after the frame moved is refused
- Area: dry-run
- Requirement: 14.8, 12.20
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: dry-run a write; add a session; submit the real write carrying the stale
  `previewToken`
- Expected: 409 `STALE_PREVIEW` with `details.submittedToken` and
  `details.currentToken`; nothing is written; omitting `previewToken` entirely skips the
  check and performs the write

## UC-216 — Omitting dryRun performs the write
- Area: dry-run
- Requirement: 14.9
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities` with no `dryRun` field
- Expected: 201 and the entry is stored — the default is `false`, never a preview

## UC-217 — A session preview names the uncovered time that would disappear
- Area: dry-run
- Requirement: 14.10
- Preconditions: none
- Data needed: FIX-FRAME plus one entry covering only part of the frame, so some tracked
  time is uncovered
- Steps: `DELETE /api/sessions/{S2}?dry_run=true`
- Expected: the preview carries `lostUncoveredSeconds` **and** `lostUncovered[]` — the
  worked-but-undescribed stretch that vanishes without any entry losing a segment, so
  the caller never has to intersect intervals to reconstruct it

## UC-218 — A preview of a 204 write answers 200 with a body
- Area: dry-run
- Requirement: 14.11; design Property 13
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `DELETE /api/sessions/{S1}?dry_run=true`; then
  `DELETE /api/activities/{entry}?dry_run=true`
- Expected: 200 with the preview body in both cases, not 204 — every other status is
  identical between a dry run and the write it previews

## UC-219 — DELETE takes its dry-run flags as query parameters
- Area: dry-run
- Requirement: 14.12
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `DELETE /api/sessions/{id}?dry_run=true&preview_token=…`; then the same
  attempted with a JSON body
- Expected: the query form works (a DELETE body is not carried reliably by every
  client); the parameters are snake_case; a `dry_run` value other than `true`/`false` is
  400 `VALIDATION_ERROR`

## UC-220 — A one-call quick log records everything since the last entry
- Area: activities-open
- Requirement: 15.1, 15.2, 15.5, 15.6
- Preconditions: none
- Data needed: FIX-PROJECTS plus a session started 3 h ago and still running, and one
  entry ending 1 h ago
- Steps: `POST /api/activities {"projectId":"<Alpha>","description":"code review"}` —
  no `endedAt`, no `durationMinutes`
- Expected: 201 with `mode: "open"`, the interval from the `Placement_Anchor` (the last
  segment's end) to **now**, clipped exactly as an `Explicit_Mode` request would be, and
  that resolved interval stored as `requestedStartedAt`/`requestedEndedAt`

## UC-221 — An open-mode entry for a past day ends at that day's last session end
- Area: activities-open
- Requirement: 15.3
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `POST /api/activities {"projectId":"<Beta>","date":"2026-08-20"}`
- Expected: 201 with the interval running from the anchor (16:00, the last segment's
  end) to 18:00, the end of day D's last `Work_Session` — not to `now`

## UC-222 — An explicit start overrides the anchor in open mode
- Area: activities-open
- Requirement: 15.4
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: `POST /api/activities` with `projectId`, `date: "2026-08-20"` and
  `startedAt: "2026-08-20T17:00:00+02:00"`
- Expected: 201 with the interval 17:00–18:00 and
  `anchor.source: "explicit"`

## UC-223 — Open mode adds no reconciliation rules of its own
- Area: activities-open
- Requirement: 15.5
- Preconditions: none
- Data needed: FIX-FRAME (anchor 08:00, last session end 18:00, break at 14:48–15:12)
- Steps: `POST /api/activities {"projectId":"<Alpha>","date":"2026-08-20"}`
- Expected: 201 with two segments split at the break, the break in `discarded`,
  `unplacedMinutes: 0` — identical to the `Explicit_Mode` treatment of 08:00–18:00

## UC-224 — A resolved interval that is not strictly forward is refused
- Area: activities-open
- Requirement: 15.7
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus a segment ending exactly at day D's last session
  end
- Steps: `POST /api/activities {"projectId":"<Beta>","date":"2026-08-20"}` when the
  anchor already equals the end
- Expected: 409 `NOTHING_TO_LOG` with `details.reason: "empty-interval"` — "nothing has
  passed since your last entry"

## UC-225 — An empty target day has no anchor in open mode either
- Area: activities-open
- Requirement: 15.8
- Preconditions: none
- Data needed: FIX-PROJECTS
- Steps: `POST /api/activities {"projectId":"<Alpha>","date":"2026-08-19"}`
- Expected: 409 `NO_PLACEMENT_ANCHOR` with `details.date` and `details.dayBounds`

## UC-226 — Open mode supports dryRun on the same terms
- Area: activities-open
- Requirement: 15.9
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: repeat UC-221 with `"dryRun": true`
- Expected: 201 with `dryRun: true` and the same resolved interval and segments; nothing
  is stored

## UC-227 — A target day in the future is refused
- Area: activities-open
- Requirement: 15.10
- Preconditions: none
- Data needed: FIX-FRAME
- Steps: `POST /api/activities {"projectId":"<Alpha>","date":"<tomorrow>"}`
- Expected: 400 `VALIDATION_ERROR` — a day that has not begun has no anchor and no end
  to log up to

## UC-228 — Stored segments stay inside tracked time through any sequence of operations
- Area: properties
- Requirement: 2.9, 6.1, 6.2; design Property 22
- Preconditions: none
- Data needed: FIX-PROJECTS as a starting point; the sequence generates its own data
- Steps: apply a randomized sequence of accepted operations — create, patch and delete
  `Work_Session` rows; create, patch and delete `Activity_Entry` rows in all three modes
  and all three policies — then read `/api/coverage` over the whole affected range
- Expected: every `activity_segments` row lies entirely inside the `Tracked_Time` the
  database then holds; this is the invariant the whole application exists to maintain
- Method: property test (`tests/lib/server/store/overlap.property.test.ts`) plus a
  scripted API sequence

## UC-229 — Described time is conserved across all three aggregations
- Area: properties
- Requirement: 8.4, 8.5; design Property 23
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED plus entries on several projects, one archived
- Steps: for each `Logical_Day`, compare the sum of the day's clamped segment durations,
  the day's `coveredSeconds`, and the sum of `byProject[].coveredSeconds`
- Expected: all three are **exactly** equal — every stored bound is a whole second, so
  no rounding can separate them

## UC-230 — Day totals partition the timeline
- Area: properties
- Requirement: 8.3, 10.7; design Property 15
- Preconditions: none
- Data needed: FIX-NIGHT plus FIX-WEEK in one range
- Steps: sum `trackedSeconds` over a consecutive run of days covering every record and
  compare with `/api/coverage`'s `totals.trackedSeconds` for the same span
- Expected: identical — no interval crossing a boundary is counted twice or dropped

## UC-231 — A dry run predicts the write exactly and changes nothing
- Area: properties
- Requirement: 14.1, 14.3, 14.4, 14.5; design Property 13, Property 14
- Preconditions: none
- Data needed: FIX-FRAME plus a randomized set of requests spanning all three modes,
  all three policies and every rejection path
- Steps: for each request, run it as a dry run, snapshot, run it for real, snapshot
- Expected: identical status codes (except a 204 write, whose preview is 200), identical
  reported outcomes, no table change from the dry run, and a post-write state matching
  what the preview described by interval bounds and totals
- Method: property test (`tests/api/dry-run.property.test.ts`) plus spot checks over
  HTTP

## UC-232 — Coverage partitions tracked time for any range
- Area: properties
- Requirement: 9.3; design Property 7
- Preconditions: none
- Data needed: any populated range
- Steps: for a randomized set of ranges, check `covered` and `uncovered` from
  `/api/coverage`
- Expected: pairwise disjoint, and their union equals the returned `tracked` exactly

## UC-233 — No stored interval is shorter than the floor
- Area: properties
- Requirement: 1.14, 6.5; design Property 17
- Preconditions: `MIN_INTERVAL_SECONDS=60`
- Data needed: any database reached by a sequence of accepted writes, including
  `extend` writes
- Steps: query `work_sessions` and `activity_segments` for any row under 60 s
- Expected: none — including sessions that policy `extend` created

## UC-234 — Duration mode conserves what was asked for
- Area: properties
- Requirement: 5.8, 5.10, 5.14, 5.15, 6.15; design Property 2, Property 6
- Preconditions: none
- Data needed: randomized frames and durations
- Steps: for each accepted `Duration_Mode` write, compare
  `total(segments) + unplacedMs` with `durationMinutes × 60000`
- Expected: equal exactly, and every produced segment lasts at least
  `MIN_INTERVAL_SECONDS`

## UC-235 — Overtime and the suggested window satisfy their identities
- Area: properties
- Requirement: 8.12, 8.13, 8.21, 8.22; design Property 19, Property 21
- Preconditions: several `Gauge_Window` configurations, including one that is not the
  default
- Data needed: randomized session frames spanning both DST transition dates
- Steps: for each day summary check
  `overtimeSeconds + total(tracked ∩ gaugeWindowOfDay) === trackedSeconds`; for each
  non-null `suggestedWindow` check that at least 90 % of the range's tracked time falls
  inside it and that the window itself passes the startup checks
- Expected: both identities hold, including on the 23-hour and the 25-hour day. Known
  gap: the property test for this (`tests/api/days.property.test.ts`, task 10.5) was
  never written — see ISSUES.md "Task 10.5 … not written"

## UC-236 — An accepted write never leaves a partial state
- Area: properties
- Requirement: 6.11, 2.10, 7.2; design Property 10, Property 16
- Preconditions: none
- Data needed: FIX-FRAME-LOGGED
- Steps: provoke rejections at each stage — validation, overlap, constraint violation,
  stale preview — and snapshot every table before and after; then confirm that every
  `Activity_Entry` in the database is returned by `/api/activities` for some range
- Expected: no rejected request leaves a row, a renamed project or a claimed idempotency
  key; and no entry, orphan included, is unreachable through the API

---

## Requirement coverage — `001-worklog-domain-api`

Every acceptance criterion of `requirements.md`, and the use case (or cases) that
exercise it. Nothing in the specification is left without a home.

**Requirement 1 — Timer Session Control**
1.1 UC-089 · 1.2 UC-090 · 1.3 UC-091 · 1.4 UC-092 · 1.5 UC-093 · 1.6 UC-094 ·
1.7 UC-095 · 1.8 UC-096 · 1.9 UC-090 · 1.10 UC-097 · 1.11 UC-097 · 1.12 UC-098 ·
1.13 UC-101 · 1.14 UC-102, UC-233 · 1.15 UC-100 · 1.16 UC-100 · 1.17 UC-099 ·
1.18 UC-103

**Requirement 2 — Session Creation, Listing and Correction**
2.1 UC-104 · 2.2 UC-105 · 2.3 UC-106 · 2.4 UC-107 · 2.5 UC-108 · 2.6 UC-109 ·
2.7 UC-110 · 2.8 UC-111 · 2.9 UC-112, UC-228 · 2.10 UC-113, UC-236 · 2.11 UC-114 ·
2.12 UC-115

**Requirement 3 — Project Management**
3.1 UC-078 · 3.2 UC-079 · 3.3 UC-080 · 3.4 UC-081 · 3.5 UC-082 · 3.6 UC-083 ·
3.7 UC-088 · 3.8 UC-087 · 3.9 UC-078 · 3.10 UC-084 · 3.11 UC-085 · 3.12 UC-086

**Requirement 4 — Explicit Mode**
4.1 UC-116 · 4.2 UC-117 · 4.3 UC-118 · 4.4 UC-119 · 4.5 UC-120 · 4.6 UC-121 ·
4.7 UC-122 · 4.8 UC-123 · 4.9 UC-123 · 4.10 UC-124 · 4.11 UC-125

**Requirement 5 — Duration Mode**
5.1 UC-126 · 5.2 UC-127 · 5.3 UC-127 · 5.4 UC-128 · 5.5 UC-129 · 5.6 UC-130 ·
5.7 UC-131 · 5.8 UC-126, UC-234 · 5.9 UC-132 · 5.10 UC-126, UC-234 · 5.11 UC-133 ·
5.12 UC-134 · 5.13 UC-135 · 5.14 UC-136 · 5.15 UC-136 · 5.16 UC-137

**Requirement 6 — Clipping**
6.1 UC-138 · 6.2 UC-138 · 6.3 UC-139 · 6.4 UC-139 · 6.5 UC-140 · 6.6 UC-141 ·
6.7 UC-142 · 6.8 UC-143 · 6.9 UC-144, UC-145 · 6.10 UC-141 · 6.11 UC-146 ·
6.12 UC-147 · 6.13 UC-148 · 6.14 UC-149 · 6.15 UC-150 · 6.16 UC-151 · 6.17 UC-152 ·
6.18 UC-153

**Requirement 7 — Activity Listing, Modification and Deletion**
7.1 UC-154 · 7.2 UC-155 · 7.3 UC-155 · 7.4 UC-156 · 7.5 UC-157 · 7.6 UC-158 ·
7.7 UC-159 · 7.8 UC-160 · 7.9 UC-161 · 7.10 UC-162 · 7.11 UC-163 · 7.12 UC-164 ·
7.13 UC-165 · 7.14 UC-165 · 7.15 UC-166 · 7.16 UC-167 · 7.17 UC-168 · 7.18 UC-167 ·
7.19 UC-169 · 7.20 UC-170 · 7.21 UC-171 · 7.22 UC-162 · 7.23 UC-172 · 7.24 UC-172 ·
7.25 UC-173 · 7.26 UC-174

**Requirement 8 — Day Overview**
8.1 UC-175 · 8.2 UC-176 · 8.3 UC-176, UC-230 · 8.4 UC-177 · 8.5 UC-177 · 8.6 UC-178 ·
8.7 UC-179 · 8.8 UC-180 · 8.9 UC-181 · 8.10 UC-182 · 8.11 UC-183 · 8.12 UC-184 ·
8.13 UC-185 · 8.14 UC-186, UC-001 · 8.15 UC-187 · 8.16 UC-187 · 8.17 UC-187 ·
8.18 UC-188 · 8.19 UC-189 · 8.20 UC-190 · 8.21 UC-185 · 8.22 UC-185 · 8.23 UC-191 ·
8.24 UC-192 · 8.25 UC-193 · 8.26 UC-193 · 8.27 UC-194

**Requirement 9 — Coverage and Gaps**
9.1 UC-195 · 9.2 UC-196 · 9.3 UC-197, UC-232 · 9.4 UC-198 · 9.5 UC-199 · 9.6 UC-199 ·
9.7 UC-199 · 9.8 UC-198 · 9.9 UC-200

**Requirement 10 — Logical Day and Time Zone**
10.1 UC-201 · 10.2 UC-202 · 10.3 UC-201 · 10.4 UC-203 · 10.5 UC-203 · 10.6 UC-203 ·
10.7 UC-204, UC-176 · 10.8 UC-205, UC-001 · 10.9 UC-010 · 10.10 UC-005 · 10.11 UC-007 ·
10.12 UC-006 · 10.13 UC-011, UC-207 · 10.14 UC-207 · 10.15 UC-181, UC-206 ·
10.16 UC-206 · 10.17 UC-208 · 10.18 UC-209

**Requirement 11 — Authentication**
11.1 UC-052 · 11.2 UC-036 · 11.3 UC-032, UC-033 · 11.4 UC-031 · 11.5 UC-034 ·
11.6 UC-042 · 11.7 UC-043 · 11.8 UC-044 · 11.9 UC-045 · 11.10 UC-035 · 11.11 UC-035 ·
11.12 UC-037, UC-038 · 11.13 UC-039 · 11.14 UC-040 · 11.15 UC-041, UC-030 ·
11.16 UC-008, UC-009 · 11.17 UC-021 · 11.18 UC-048 · 11.19 UC-046 · 11.20 UC-051 ·
11.21 UC-030 · 11.22 UC-049 · 11.23 UC-047 · 11.24 UC-046 · 11.25 UC-050 ·
11.26 UC-004 · 11.27 UC-041

**Requirement 12 — Validation, Errors and Rate Limiting**
12.1 UC-070 · 12.2 UC-053 · 12.3 UC-054 · 12.4 UC-055 · 12.5 UC-056 · 12.6 UC-057 ·
12.7 UC-058 · 12.8 UC-059 · 12.9 UC-063, UC-030 · 12.10 UC-064 · 12.11 UC-065 ·
12.12 UC-066 · 12.13 UC-067 · 12.14 UC-068, UC-003, UC-026 · 12.15 UC-057 ·
12.16 UC-059 · 12.17 UC-061 · 12.18 UC-071 · 12.19 UC-072 · 12.20 UC-073, UC-215 ·
12.21 UC-058, UC-068 · 12.22 UC-060 · 12.23 UC-062 · 12.24 UC-069 · 12.25 UC-074 ·
12.26 UC-075 · 12.27 UC-075 · 12.28 UC-076 · 12.29 UC-076 · 12.30 UC-076 ·
12.31 UC-074 · 12.32 UC-074 · 12.33 UC-066 · 12.34 UC-077

**Requirement 13 — Operational Behavior**
13.1 UC-001 · 13.2 UC-001 · 13.3 UC-002 · 13.4 UC-003 · 13.5 UC-025 · 13.6 UC-026 ·
13.7 UC-027 · 13.8 UC-008, UC-023 · 13.9 UC-028, UC-001 · 13.10 UC-022 ·
13.11 UC-013, UC-022 · 13.12 UC-012 · 13.13 UC-013 · 13.14 UC-014 · 13.15 UC-014 ·
13.16 UC-016 · 13.17 UC-016 · 13.18 UC-022 · 13.19 UC-022 · 13.20 UC-022 ·
13.21 UC-022 · 13.22 UC-015 · 13.23 UC-022 · 13.24 UC-008 · 13.25 UC-029 ·
13.26 UC-018 · 13.27 UC-022 · 13.28 UC-021 · 13.29 UC-017 · 13.30 UC-030 ·
13.31 UC-003, UC-005 · 13.32 UC-003 · 13.33 UC-019 · 13.34 UC-020 · 13.35 UC-024

**Requirement 14 — Dry Run**
14.1 UC-210, UC-231 · 14.2 UC-211 · 14.3 UC-210 · 14.4 UC-212 · 14.5 UC-210 ·
14.6 UC-213, UC-211 · 14.7 UC-214 · 14.8 UC-215 · 14.9 UC-216 · 14.10 UC-217 ·
14.11 UC-218 · 14.12 UC-219

**Requirement 15 — Open Mode**
15.1 UC-220 · 15.2 UC-220 · 15.3 UC-221 · 15.4 UC-222 · 15.5 UC-223 · 15.6 UC-220 ·
15.7 UC-224 · 15.8 UC-225 · 15.9 UC-226 · 15.10 UC-227

**Correctness Properties of `design.md`**
P1 UC-138 · P2 UC-234 · P3 UC-139 · P4 UC-197 · P5 UC-196 · P6 UC-234, UC-136 ·
P7 UC-232 · P8 UC-120, UC-228 · P9 UC-112 · P10 UC-146, UC-236 ·
P11 UC-114, UC-117, UC-135 · P12 UC-203, UC-207 · P13 UC-210, UC-231 ·
P14 UC-210, UC-231 · P15 UC-230 · P16 UC-155, UC-236 · P17 UC-233 ·
P18 UC-059, UC-060 · P19 UC-184, UC-235 · P20 UC-143 · P21 UC-185, UC-235 ·
P22 UC-228 · P23 UC-229 · P24 UC-116 · P25 UC-162, UC-112
---

# Part II — Use Cases for `Worklog_UI` (spec `002-worklog-ui`)

Everything that must be true for the **browser interface** to count as working. Part I
above drives the REST API directly and stays valid; this part drives the same server
through the screens a person actually uses — the timer, the day timeline, the projects
page, the statistics, the dialogs, both themes, both viewport classes.

Numbering continues from Part I and is equally **stable**: UC-237 onwards. The
walkthrough in `.agents/tmp/VERIFY_TASKS.md` refers to these numbers.

## Conventions for Part II

- `$APP` — the running application's origin. `bun run dev` → `http://localhost:5173`,
  `bun run preview` → `4173`, the built Node server / Docker image → `3000`. Unless a
  case says otherwise it may be any of them; cases that depend on the production
  `Content-Security-Policy` say so and require the **built** server.
- **Every case is driven through a real browser** — Chromium at
  `/opt/playwright-browsers` (already installed; never run `playwright install` here).
  Three exceptions are marked on the case itself:
  - `Method: inspection` — a property of the source, the compiled CSS or the rendered
    HTML that no interaction can observe (an absent `style=` attribute, a message key
    that exists in both catalogues, a cookie flag).
  - `Method: artboard` — a visual comparison against `.design/screens/<Name>.png` at the
    artboard's own frame size, taken from `.design/artboards/canvas.json`. Arrangement,
    relative proportion and palette are compared; **exact pixel heights, copy and
    example data are not** (Requirement 17.16).
  - `Method: screen reader` — needs an actual screen reader or an accessibility-tree
    dump; a DOM assertion alone does not prove the announcement.
- **The user is logged in** on every case unless the case is about authentication.
  Log in once at `$APP/login` with the passphrase behind `WORKLOG_PASSPHRASE_HASH`.
- **Viewports.** Three, and they are named rather than restated:
  - `VP-DESKTOP` — 1440 × 900. The desktop artboards are drawn at 1440 wide.
  - `VP-MOBILE` — 390 × 844. Every mobile artboard is drawn at this size.
  - `VP-NARROW` — 320 × 720. The floor Requirement 14.1 names; no artboard exists.
  The single breakpoint is **768 px** (Requirement 14.12); `VP-DESKTOP` is above it and
  both others below.
- **Themes.** `dark` ("Midnight") is what a first visit renders; `light` ("Daylight") is
  reached through the `Settings_Menu`. A case that does not name a theme runs in `dark`.
- **Locale.** `cs` is the default. A case that does not name a locale runs in Czech, and
  quotes the Czech string from the design's Message Catalogue.
- **Cookies** the interface reads or writes, and the only four that exist:
  `worklog_theme` (`system|light|dark`, written **only** by the `Theme_Switcher`),
  `worklog_theme_resolved` (`light|dark`, written by the client from
  `prefers-color-scheme`), `worklog_locale` (`cs|en`) and `worklog_viewport`
  (`<width>x<height>`). Nothing that decides the first paint is in `localStorage`.
- `Requirement:` cites `.kiro/specs/002-worklog-ui/requirements.md` as
  `<requirement>.<criterion>`. `design Property N` cites that spec's Correctness
  Properties. `Design_Contract:` cites `.design/DESIGN.md` by section or an artboard by
  name.
- **`TODAY`** is the current `Logical_Day` as the server reports it on
  `event.locals.today` — never a date computed in the browser, and never a date typed
  into a fixture. Cases needing a past day use `D` = 2026-08-20 as Part I does.
- Times are Prague wall clock. The interface renders every time in the **server's** zone.
- A case's `Expected` is the **specified** behaviour. Where the current implementation is
  known to deviate, the case says so and names the `ISSUES.md` entry — the case still
  fails until the code matches, which is the point.

## Fixtures for Part II

Built on Part I's fixtures. Every one is seeded **through the API** (bearer token) or by
the E2E `resetDb` helper, never by clicking through the interface — a fixture built by
hand is a test of the thing under test.

Where a fixture says a wall-clock time it means that time **on the current
`Logical_Day`**, so that the timer page, the `Day_Gauge` and the day page all have
something to draw. A fixture on a fixed past date says the date explicitly.

- **FIX-UI-EMPTY** — `FIX-CLEAN`. No `Project`, no `Work_Session`, no `Activity_Entry`.
  This is the state every empty state is checked against.
- **FIX-UI-DAY** — `FIX-PROJECTS` (Alpha 0, Beta 1, Gamma 2 archived) plus two closed
  sessions on `TODAY`: `08:00 → 12:30` and `13:15 → 17:00`; plus two `Explicit_Mode`
  entries — Alpha `08:00 → 10:15` ("Oprava filtrů ve flotile") and Beta
  `13:15 → 14:00` ("Worklog"). Leaves three stretches of `Uncovered_Time`
  (10:15–12:30, 14:00–17:00) and a 45-minute break. The everyday day.
- **FIX-UI-SPLIT** — `FIX-UI-DAY` plus one Alpha entry requested `12:00 → 14:00`, which
  the server clips into two `Activity_Segment` records around the 12:30–13:15 break.
  The `Split_Marker` case.
- **FIX-UI-RUNNING** — `FIX-UI-DAY` plus an `Open_Session` started 90 minutes ago.
- **FIX-UI-STALE** — `FIX-PROJECTS` plus an `Open_Session` started 13 hours ago, past
  `MAX_OPEN_SESSION_HOURS` (12).
- **FIX-UI-NIGHT** — `FIX-PROJECTS` plus one closed session `21:30 → 01:00` on `TODAY`
  (crossing the `Evening_Hour` and midnight, still one `Logical_Day`).
- **FIX-UI-OVERRUN** — `FIX-PROJECTS` plus two closed sessions on `TODAY`:
  `05:00 → 06:30` (before `GAUGE_START`) and `23:00 → 01:30` (past `GAUGE_END`). Two
  `Overtime_Arc` stretches, one at each end of the `Gauge_Track`.
- **FIX-UI-NONSTOP** — `FIX-PROJECTS` plus closed sessions covering the whole of a past
  `Logical_Day` (`D`), so the gauge closes into a complete circle.
- **FIX-UI-CONTINUES** — `FIX-PROJECTS` plus one closed session
  `2026-08-19T22:00+02:00 → 2026-08-20T05:00+02:00`, which belongs to `Logical_Day`
  2026-08-19 and continues past its end.
- **FIX-UI-ORPHAN** — `FIX-ORPHAN` moved onto `TODAY`: an `Activity_Entry` whose
  sessions were deleted, so it holds no `Activity_Segment` and is `orphaned: true`.
- **FIX-UI-WEEK** — seven consecutive `Logical_Day` values ending on `TODAY`: five with
  work across Alpha, Beta and a third project, one of them with a session after the
  `Evening_Hour`, one with work but no description at all, and one with nothing. The
  statistics range fixture.
- **FIX-UI-MANY** — `FIX-PROJECTS` plus one closed session `08:00 → 16:00` on `TODAY`
  holding fifty `Activity_Entry` records of about nine minutes each. Forces every
  `Segment_Block` to the `MIN_BLOCK_PX` floor and the page to scroll.
- **FIX-UI-NINE** — `FIX-CLEAN` plus nine projects, so `colorIndex` 8 wraps to
  `Palette_Slot` 0 and two projects share a hue.

---

## UC-237 — The root path shows the timer page
- Area: shell
- Requirement: 1.9
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/`
- Expected: the timer page renders — hero readout, `Day_Gauge`, three figures — without
  a redirect to another path. The URL stays `/`.

## UC-238 — The desktop top bar is a three-column grid with the navigation centred
- Area: shell
- Requirement: 1.1, 1.2, 1.6
- Design_Contract: `DESIGN.md` § 6; artboards `Main`, `DayCollapsed`, `Stats`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/` and inspect the top bar's computed `grid-template-columns`, then
  visit `/day/<TODAY>`, `/projects` and `/stats`
- Expected: `1fr auto 1fr` on every page. The brand `Worklog` sits left, the four
  navigation targets — `Timer`, `Den`, `Projekty`, `Statistiky` — are centred as one
  group, and the right cell holds the `Running_Indicator` (when a session is open)
  followed by the `Settings_Menu` gear chip. Bar height 84 on every page including the
  day page, whose artboard draws 88 as a drawing slip.

## UC-239 — Below 768 the navigation collapses into a four-tab bottom bar
- Area: shell
- Requirement: 1.3, 14.12
- Design_Contract: artboards `TimerMobile`, `DayMobile`
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/`; then widen the viewport past 768 and back
- Expected: at 390 px the top bar carries only the brand, the `Running_Indicator` and the
  gear chip, and a bottom bar of four tabs appears — each an SVG icon above its label,
  bar height 66–68 with a 1 px top divider. Above 768 the bottom bar disappears and the
  centred desktop navigation returns. There is exactly one breakpoint and it is 768.

## UC-240 — The active navigation target is marked, and marked differently on each width
- Area: shell
- Requirement: 1.4
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at `VP-DESKTOP` visit each of the four pages and read the navigation items'
  attributes and computed colour; repeat at `VP-MOBILE`
- Expected: on every width the current page's item carries `aria-current`. On the desktop
  top bar it is drawn in full-strength `--text` at weight 500 while the others are
  `--text-faint`; on the mobile bottom bar it is drawn in `--accent`. The two treatments
  are deliberately different and neither may be used on the other width.

## UC-241 — The mobile create button offers a choice on the day page and acts directly elsewhere
- Area: shell
- Requirement: 1.5, 8.1
- Design_Contract: artboard `DayMobile` — FAB 54 px, 18 from the right, 12 above the bar,
  halo `0 0 0 10px`
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: open `/day/<TODAY>` and activate the round button at the bottom right; dismiss;
  then open `/projects` and activate its create button
- Expected: on the day page the FAB opens a two-item sheet — `Přidat úkol` and
  `Přidat úsek timeru` — because one button cannot mean two things; choosing either
  opens the matching dialog. On the projects page the FAB performs the single create
  action directly with no sheet. The FAB is 54 px and sits above the bottom bar, never
  under it.

## UC-242 — The Running_Indicator rides every page except the timer page
- Area: shell
- Requirement: 1.7, 1.8
- Design_Contract: `DESIGN.md` § 6 — the timer pages omit it because their hero *is* the
  elapsed time
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-RUNNING
- Steps: visit `/day/<TODAY>`, `/projects`, `/stats`, then `/`
- Expected: on the first three the top bar's right cell carries a 6 px round `--accent`
  dot beside the elapsed time in tabular figures at 13 px `--text-dim`, and the figure
  advances at least once per second. On the timer page there is no indicator at all —
  only the gear chip. Repeat at `VP-MOBILE`: the same rule holds.

## UC-243 — Moving between pages never reloads the document
- Area: shell
- Requirement: 1.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window` (or watch for a `load` event), then click through
  Timer → Den → Projekty → Statistiky → Timer using the navigation
- Expected: the marker survives every transition and no document `load` fires — every
  move is a client-side navigation. The URL changes each time and the back button walks
  the same path in reverse.

## UC-244 — An unknown route renders the error page with a way back
- Area: shell
- Requirement: 1.10
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `$APP/nope/nowhere`
- Expected: the interface's own error page renders — `Tady nic není` over
  `Stránka, kterou hledáš, neexistuje.` — with a filled accent pill `Zpět na timer`
  that navigates to `/`. Not a framework stack trace, not a blank page.

## UC-245 — Times render in the server's zone, and the interface says so when they differ
- Area: shell
- Requirement: 1.12, 1.13
- Preconditions: logged in; the browser's zone set to something other than
  `Europe/Prague` (for example `America/New_York`)
- Data needed: FIX-UI-DAY
- Steps: open `/day/<TODAY>` with the device zone matching the server's, note the block
  head times; then reopen with the device zone changed and compare
- Expected: the rendered times are identical in both runs — they follow the server's
  `timezone`, never the device's. In the second run one line at 12 px `--text-faint`
  appears directly under the top bar, centred:
  `Časy jsou v pásmu Europe/Prague, ne v pásmu tvého zařízení`. In the first run that
  line is absent.

## UC-246 — No Logical_Day boundary is ever computed in the browser
- Area: shell
- Requirement: 1.25, 3.18
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: search `src/` outside `src/lib/server/` and `src/routes/api/` for arithmetic on
  `DAY_START_HOUR`, for a locally constructed day boundary, and for any time-zone
  conversion of one; confirm the current day and its bounds arrive from
  `event.locals.today` through `+layout.server.ts` into context
- Expected: the browser reads the day and its bounds from the server payload and derives
  none of them. A helper that adds `dayStartHour` to a local `Date` is a defect even if
  it currently returns the right answer, because it reimplements the server's zone and
  DST rules.

## UC-247 — A failed page load goes to /offline; a later failure stays in place
- Area: shell · errors
- Requirement: 1.14, 15.7
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: (a) stop PostgreSQL (or point `DATABASE_URL` at a dead port) and navigate to
  `/stats`; (b) restore it, reload, open the `Activity_Dialog`, type a description, then
  stop the server and let the debounced `Dry_Run` fire
- Expected: (a) the browser lands on `/offline?next=/stats` showing
  `Server neodpovídá` over `Zkus to za chvíli znovu. Nic, co jsi napsal, se neztratilo.`
  with a retry action that navigates back to `/stats`. (b) the dialog stays open with the
  typed description intact and the failure surfaces as a retryable message in place —
  the browser does **not** navigate to `/offline`, because that would discard the input
  Requirement 15.7 protects.

## UC-248 — User-supplied text is escaped everywhere it is drawn
- Area: shell · security
- Requirement: 1.15
- Preconditions: logged in
- Data needed: FIX-UI-DAY plus a project named `<img src=x onerror=alert(1)>Alpha` and an
  `Activity_Entry` whose description is `"><script>alert(1)</script>`, both created
  through the API
- Steps: open `/day/<TODAY>`, `/projects`, `/stats` and the timer page; open the
  `Activity_Dialog` on that entry and the `Project_Picker`
- Expected: the markup is displayed as literal text on every surface — timeline block,
  project row, legend, breakdown, picker option, dialog field, tooltip and `aria-label`
  alike. No dialog fires, no element is injected. A source search confirms no `{@html}`
  is applied to a project name or an entry description anywhere.

## UC-249 — The Settings_Menu opens as a 268 px anchored menu on desktop
- Area: shell · settings
- Requirement: 1.16, 1.6
- Design_Contract: artboards `Settings`, `SettingsLight`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: activate the gear chip at the right end of the top bar
- Expected: a 268 px wide surface opens anchored under the chip at the page's right
  padding — `--dialog` at radius 14, a 1 px `--menu-border` outline, the menu shadow,
  16 px padding, 16 px gaps. It is not full-width, not centred and not a sheet.

## UC-250 — The mobile Settings_Menu is a modal bottom sheet, dimmed only by its scrim
- Area: shell · settings
- Requirement: 1.17, 1.19, 1.20, 14.24
- Design_Contract: artboards `SettingsMobile`, `SettingsMobileLight`; `DESIGN.md` § 6a —
  the stacking-context trap
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: activate the gear chip; then read the computed `opacity` of the page content
  container and of the bottom navigation, try to scroll the page behind the sheet, and
  Tab repeatedly
- Expected: the same content opens as a bottom sheet with a 38 × 4 grabber centred at its
  top edge, radius `20px 20px 0 0`. A scrim covers the page content **and** the bottom
  navigation, and the sheet paints above both. Neither the page content nor the tab bar
  carries an `opacity` of its own — any value below 1 creates a stacking context and the
  tab bar then paints over the sheet whatever its `z-index`. The document beneath does
  not scroll and is `inert`, so Tab never leaves the sheet.

## UC-251 — The Settings_Menu holds exactly four rows in a fixed order
- Area: shell · settings
- Requirement: 1.18
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open the menu at `VP-DESKTOP` and read it top to bottom; repeat at `VP-MOBILE`
- Expected: in this order — the caps label `MOTIV` over the three-way `Theme_Switcher`
  (`Systém` / `Světlý` / `Tmavý`), the caps label `JAZYK` over the two-way
  `Locale_Switcher` (`Čeština` / `English`), a 1 px `--divider` hairline, and
  `Odhlásit se` drawn in `--destructive` with a 15 px exit icon. Nothing else is in the
  menu, and the order is identical on both widths.

## UC-252 — The Settings_Menu closes three ways and always returns focus to its chip
- Area: shell · settings
- Requirement: 1.21, 14.23
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at each width, open the menu and (a) press Escape, (b) reopen and activate a
  point outside it, (c) reopen and choose `Odhlásit se`
- Expected: all three close it. After (a) and (b) focus is back on the gear chip that
  opened it — verified through `document.activeElement`, not by eye. After (c) the menu
  closes and the logout form action is submitted.

## UC-253 — Logging out is offered from the Settings_Menu and nowhere else
- Area: shell · settings · auth
- Requirement: 1.22, 2.5
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: sweep every page at both widths for any control naming logout outside the menu;
  then choose `Odhlásit se` inside it
- Expected: the menu is the only place the interface offers logging out — no header
  button, no footer link, no keyboard shortcut. Choosing it closes the menu, submits the
  logout form action, and the login page follows with no authenticated view state left
  behind (the back button does not restore a rendered day).

## UC-254 — app.html carries the two placeholders the server substitutes
- Area: shell · theming · i18n
- Requirement: 1.23, 13.14, 17.8
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: read `src/app.html`; then request a page with `curl` carrying
  `worklog_locale=en` and `worklog_theme=light` and read the first bytes of the response
- Expected: the file declares `<html lang="%lang%" data-theme="%theme%">` alongside
  `%sveltekit.head%`, `%sveltekit.body%` and `%sveltekit.nonce%`. The served HTML has
  both substituted — `lang="en"` and `data-theme="light"` — in the first bytes, before
  any script runs. `002` writes the placeholders; `001`'s hook fills them.

## UC-255 — The Inter Tight faces are served from this origin
- Area: shell · typography
- Requirement: 1.24, 14.7
- Preconditions: the **built** server, so the production CSP is in force
- Data needed: none
- Steps: load any page with the network panel recording; read the `@font-face` rules and
  the `Content-Security-Policy` response header
- Expected: four `woff2` files are requested from `$APP` itself (`static/fonts/`), none
  from `fonts.googleapis.com` or `fonts.gstatic.com`, and the policy carries
  `font-src 'self'` with no third-party host. No font request is blocked, and the
  rendered body text is Inter Tight rather than the `system-ui` fallback.

## UC-256 — An unauthenticated navigation lands on login carrying where it was going
- Area: auth
- Requirement: 2.1
- Preconditions: no session cookie
- Data needed: FIX-UI-DAY
- Steps: open `$APP/stats` with no cookie jar
- Expected: the login page renders at `/login?next=/stats`, and the form carries a hidden
  field named `next` with the same value. No session-ended message is shown (see
  UC-261).

## UC-257 — The login form takes a passphrase and returns the visitor where they were going
- Area: auth
- Requirement: 2.2, 2.4
- Preconditions: no session cookie
- Data needed: FIX-UI-DAY
- Steps: open `/login?next=/projects`, type the correct passphrase into the single field
  and submit; then repeat from `/login` with no `next`
- Expected: the page offers exactly one field, named `passphrase`, submitted as a form
  action (it works with JavaScript disabled). The first run lands on `/projects`, the
  second on `/`. The field is marked required and is 44 px tall (48 on `VP-MOBILE`).

## UC-258 — A wrong passphrase says nothing about what exists
- Area: auth
- Requirement: 2.3, 13.8
- Preconditions: no session cookie
- Data needed: FIX-UI-EMPTY
- Steps: submit a wrong passphrase
- Expected: one generic message renders — `Nesprávné heslo.`, the translation of
  `errors_login_failed` — and nothing distinguishes a wrong passphrase from an
  unconfigured one. The typed value is not echoed back into the field, and the raw error
  code never appears on screen.

## UC-259 — Logging out leaves no authenticated view state behind
- Area: auth
- Requirement: 2.5
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: log out from the `Settings_Menu`, then press the browser's back button, then
  open `/day/<TODAY>` directly
- Expected: the login page renders after logout. Back does not restore a rendered day —
  it lands on login again — and the direct navigation redirects to
  `/login?next=/day/<TODAY>`. No day data is left in the document.

## UC-260 — A browser-issued request that is refused sends the user to login with a reason
- Area: auth · errors
- Requirement: 2.6, 15.9
- Preconditions: logged in on `/day/<TODAY>` with the `Activity_Dialog` open
- Data needed: FIX-UI-DAY
- Steps: delete the session cookie from the browser without navigating, then change a
  time field so the debounced `Dry_Run` fires
- Expected: the `Dry_Run` receives `UNAUTHORIZED` and the interface itself navigates to
  `/login?next=/day/<TODAY>&reason=session_expired`, rendering
  `Přihlášení vypršelo, přihlas se znovu`. This is the **only** source of that message.

## UC-261 — The login page stays silent when it was reached by a plain redirect
- Area: auth
- Requirement: 2.7
- Preconditions: no session cookie
- Data needed: FIX-UI-EMPTY
- Steps: open `$APP/projects` and let the `Auth_Hook` redirect; read the page
- Expected: `/login?next=/projects` renders with **no** session-ended message, because a
  hook-issued redirect carries the requested path only and cannot tell an expired session
  from a first visit. The message appears only with `reason=session_expired` in the URL.

## UC-262 — At rest the timer offers start and puts the day's total in the hero
- Area: timer
- Requirement: 3.1, 3.19, 3.20
- Design_Contract: artboard `GaugeNormal` — the resting state
- Preconditions: logged in, `VP-DESKTOP`, no `Open_Session`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/`; then compare against the same page under FIX-UI-EMPTY
- Expected: the `Timer_Control` shows a single start action with the start icon and its
  accessible name is `Spustit timer`. The hero readout is the day's total `Tracked_Time`
  in the same 68/300 face the running clock uses, under the caption
  `zastaveno v <time>` naming when the last session stopped. Under FIX-UI-EMPTY the
  caption reads `timer neběží`. The `Day_Gauge` draws the day's arcs unchanged — the
  resting page differs from the running one only in the hero figure, the caption and the
  icon.

## UC-263 — While a session is open the hero clock ticks and the control stops it
- Area: timer
- Requirement: 3.2, 3.3
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-RUNNING (open session started 90 min ago)
- Steps: open `$APP/`, read the hero readout, wait three seconds and read it again
- Expected: the `Timer_Control` shows a single stop action named `Zastavit timer`. The
  hero shows the elapsed time of the open session as a running clock (`1:30:04` form)
  advancing at least once per second, under the caption `běží od <time>` naming when it
  started. The figure is drawn above the gauge, never inside it.

## UC-264 — The three figures sit side by side in order, and only the third is accent
- Area: timer
- Requirement: 3.4, 3.5, 3.6, 3.7, 10.6
- Design_Contract: `DESIGN.md` § 6 — three figures at `gap: 56`, 26/300 tabular
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/` and read the row beneath the gauge; repeat at `VP-MOBILE`
- Expected: exactly three figures in this order, each under an uppercase caps label —
  `odpracováno` (`Tracked_Time`), `popsáno` (`Covered_Time`), `chybí popis`
  (`Uncovered_Time`). Only the third is drawn in `--accent`; the first two are `--text`.
  All three are tabular. On `VP-MOBILE` they spread across the full width at 19/300 with
  the short labels (`odprac.` / `popsáno` / `chybí`) and the unit-less duration form.
  The third figure matches the day page's `Chybí popis` row exactly.

## UC-265 — The Project_Legend names every project on the gauge plus the uncovered entry
- Area: timer
- Requirement: 3.8, 11.11, 16.19
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open `$APP/` and read the row beneath the gauge
- Expected: one legend item per `Project` drawn on the inner arc — an 8 × 8 swatch of
  radius 2 in that project's `Palette_Slot` beside the project's **name** at 12 px
  `--text-faint`, `gap: 22` — closing with a 14 px dashed accent rule labelled
  `bez popisu`. No project appears as a swatch without its name; the legend is what
  carries project identity in text for the gauge, so it is never optional.

## UC-266 — The timer page's elements appear in the specified order
- Area: timer
- Requirement: 3.9
- Design_Contract: artboard `Main`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-RUNNING
- Steps: open `$APP/` and read the centred column top to bottom, in DOM order
- Expected: hero elapsed readout → caption naming when the running session started →
  `Day_Gauge` with the `Timer_Control` at its exact centre → the three figures →
  `Quick_Log` control → `Project_Legend`. Nothing else sits between them and nothing is
  reordered on `VP-MOBILE` (`TimerMobile` draws the same order at a smaller size).

## UC-267 — The timer state comes from the server, never from the browser
- Area: timer
- Requirement: 3.10
- Preconditions: logged in
- Data needed: FIX-UI-RUNNING
- Steps: open `$APP/`; stop the session through the API from another client; reload the
  page; then inspect `localStorage` and `sessionStorage`
- Expected: after the reload the page shows the resting state — the browser held no
  cached timer to contradict the server. Neither storage holds any timer state at all.

## UC-268 — The tab title carries the running elapsed time
- Area: timer
- Requirement: 3.11, 15.15
- Preconditions: logged in
- Data needed: FIX-UI-RUNNING
- Steps: open `$APP/`, read `document.title`, wait two seconds and read it again; then
  stop the timer and read it once more
- Expected: while a session is open the title carries the running clock and it advances.
  After the stop the ticking value is gone from the title. The title is written from the
  same elapsed store as the on-screen readout, so the two can never disagree.

## UC-269 — Regaining focus refreshes the timer and the page data together
- Area: timer
- Requirement: 3.12
- Preconditions: logged in on `$APP/`
- Data needed: FIX-UI-RUNNING
- Steps: with the tab open, from another client stop the session **and** add an
  `Activity_Entry` to the same day; then switch away from the tab and back
- Expected: on `visibilitychange` back to visible the interface refetches
  `GET /api/sessions/current` **and** invalidates the page's loaded data, so the resting
  timer and the new entry appear together. A fresh timer beside a stale day is exactly
  the failure this criterion exists to prevent.

## UC-270 — A failed start or stop rolls back and says why
- Area: timer · errors
- Requirement: 3.13, 15.4
- Preconditions: logged in on `$APP/`
- Data needed: FIX-UI-DAY
- Steps: make the start action fail — stop PostgreSQL, or start a session from another
  client first — then press start
- Expected: the optimistic change is rolled back and the control returns to its previous
  state rather than showing a running timer that does not exist. The reason is shown
  through the interface's error surface, as the translation of the server's `messageKey`,
  never as a raw error code.

## UC-271 — The Quick_Log control is offered on the timer page
- Area: timer
- Requirement: 3.14, 6.13
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open `$APP/` and locate the pill between the three figures and the legend
- Expected: a 50 px fully-rounded pill on `--field` with a 34 px round icon box, reading
  `Zapsat <from> → teď` at 14 px `--text-dim`, with the outstanding `Uncovered_Time` at
  13 px `--text-faint` beside it (dropped on `VP-MOBILE`). It states the interval **and**
  the project it will send before it is pressed.

## UC-272 — The Timer_Control is fully operable from the keyboard
- Area: timer · accessibility
- Requirement: 3.15, 14.5
- Preconditions: logged in on `$APP/`, no pointer used at any point
- Data needed: FIX-UI-DAY
- Steps: Tab until the `Timer_Control` has focus, press Enter; Tab back to it and press
  Space
- Expected: the control is reachable by Tab, shows the focus ring, and **both** Enter and
  Space activate it. Its accessible name changes between `Spustit timer` and
  `Zastavit timer` — that change is what a screen reader hears, since the digits are
  hidden (UC-453).

## UC-273 — A stale session is announced with a prefilled way to close it
- Area: timer
- Requirement: 3.16
- Design_Contract: design.md *Stale-session notice* — no dismiss action
- Preconditions: logged in
- Data needed: FIX-UI-STALE (open session started 13 h ago, cap is 12 h)
- Steps: open `$APP/` and read the area above the hero readout; then use the offered
  action
- Expected: a `--panel` box at radius 14 with a `1px solid rgba(209,138,106,0.28)` border
  sits **above** the hero, carrying a 15 px warning icon and
  `Timer běží od <start> a už se nezapočítává`, a 44 px time field prefilled with
  `startedAt + MAX_OPEN_SESSION_HOURS` (the instant counting stopped, read from the
  `Health_Endpoint`, not guessed), and one filled accent pill
  `Zastavit v tomto čase`. There is **no** dismiss action. Using the pill closes the
  session at that time and the notice disappears.

## UC-274 — Starting a timer that is already running explains what is in the way
- Area: timer · errors
- Requirement: 3.17, 15.5
- Preconditions: logged in on `$APP/` showing the resting state (a stale page)
- Data needed: FIX-UI-RUNNING, with the session started after the page was loaded
- Steps: press start
- Expected: the write is refused and the interface names the session in the way —
  `Timer už běží od <startedAt>` (the translation of `errors_session_already_running`) —
  then resyncs from the server so the control shows the true state. It does not fail
  silently and it does not leave the control claiming a second running timer.

## UC-275 — A day rollover while the page is open re-resolves the day
- Area: timer · shell
- Requirement: 3.18, 1.25
- Preconditions: logged in on `$APP/`, the server's `DAY_START_HOUR` temporarily moved to
  a minute or two ahead of the current time so the boundary is reachable in a test
- Data needed: FIX-UI-RUNNING
- Steps: leave the page open across the boundary and watch without touching it
- Expected: at the boundary the interface re-resolves the current `Logical_Day` from the
  server and invalidates the page data, so the totals become the new day's while the
  running session keeps counting. It does not keep showing yesterday's figures beside a
  running timer, and it does not compute the boundary itself.

## UC-276 — The day is one column of Work_Block groups with collapsed breaks between them
- Area: day timeline
- Requirement: 4.1, 4.18, 7.1
- Design_Contract: artboard `DayCollapsed`; `DESIGN.md` § 6
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (two sessions, one 45-minute break)
- Steps: open `/day/<TODAY>` and read the timeline top to bottom in DOM order
- Expected: exactly two `Work_Block` sections in chronological order, and between them
  exactly one `Break_Marker` — a single fixed-height row with `role="separator"`, a
  centred label naming the break's duration and its bounds
  (`pauza 45 min · 12:30 – 13:15`) between two dashed `--hairline` rules indented to
  clear the rail. The break is **not** drawn as proportional empty space, and there is no
  second list of the same records beside the timeline.

## UC-277 — Each block has its own axis and its segments are proportional within it
- Area: day timeline
- Requirement: 4.2, 4.3; design Property 2
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: measure the rendered height of each `Segment_Block` and compare the ratios
  within one `Work_Block`, then across the break
- Expected: within a block, heights are in proportion to the segments' durations (modulo
  the `MIN_BLOCK_PX` floor and the 2 px quantisation). Across a break they are **not** —
  the second block's scale is its own. Distance equals time inside a block and nowhere
  else; that is the trade the `Day_Gauge` exists to compensate for.

## UC-278 — The Session_Rail stands for the session at the block's left edge
- Area: day timeline
- Requirement: 4.4, 14.3
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at `VP-DESKTOP` measure the rail's width and height against its segment column;
  repeat at `VP-MOBILE`
- Expected: a rounded vertical bar in `--rail` at the left edge of each `Work_Block`,
  spanning the full height of that block's segment column — 8 px wide on desktop, 6 px on
  mobile. It is a container of three sibling buttons (two 12 px edges and the middle),
  never a button wrapping other buttons, and the edges are omitted entirely below a block
  height of 60 px.

## UC-279 — A Segment_Block is tinted and bordered in its project's colour
- Area: day timeline
- Requirement: 4.5, 11.9, 17.14
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (Alpha slot 0, Beta slot 1)
- Steps: read each segment's class list and computed background and left border
- Expected: each block carries one `pj-<n>` class matching the `colorIndex` the server
  returned for that entry, a background of `var(--pj-tint)` (0.16 alpha dark, 0.13 light)
  and a 3 px left border of `var(--pj)` at full strength. No `style=` attribute is used
  to carry the colour, and no project colour is resolved by joining the projects list in
  the browser.

## UC-280 — A split entry carries the marker on every one of its parts, three ways
- Area: day timeline
- Requirement: 4.6, 7.2
- Design_Contract: design.md *The Split Marker* — counter, notch, linked hover
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-SPLIT (one entry clipped into two segments around the break)
- Steps: read both blocks' text and `aria-label`; hover one of them and observe the
  other; read the SVG/notch on each
- Expected: all three mechanisms are present on **both** parts — (1) `část 1 ze 2` and
  `část 2 ze 2` in the meta line at 12 px `--text-faint`, and in the `aria-label`
  (`· 1/2` on a collapsed block); (2) a 7 px `--pj` triangle on the edge facing the
  break — bottom edge of every part but the last, top edge of every part but the first;
  (3) hovering or focusing either part raises the `--pj-tint` of **both** by half again
  and outlines each in 1 px `--pj`. The parts share a `data-entry-id`, which is what the
  linked state keys on.

## UC-281 — Uncovered stretches inside a block carry the Uncovered_Marker
- Area: day timeline
- Requirement: 4.7, 10.2
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (10:15–12:30 and 14:00–17:00 uncovered)
- Steps: read the blocks that stand for those stretches
- Expected: each is drawn in place, in chronological position among the described
  segments, with the `Uncovered_Marker` treatment — fill
  `rgba(209,138,106,0.06)`, a `1px dashed rgba(209,138,106,0.45)` border (light theme
  0.52) and an accent title — carrying its own times and duration. There is no separate
  list of uncovered stretches anywhere on the page.

## UC-282 — An open session's block runs to now and says it is running
- Area: day timeline
- Requirement: 4.8
- Design_Contract: design.md *Running, Capped and Continuing Blocks*
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-RUNNING
- Steps: open `/day/<TODAY>` and read the last `Work_Block`
- Expected: the block extends to the current time. Its rail is `--accent` instead of
  `--rail` with a **square** bottom end (the block has no end yet), a 6 px accent dot
  precedes the head time, and `běží` renders at the head's right in 12/500 `--accent`.
  The state is carried in text as well as in colour.

## UC-283 — A stale session's block stops where the server stopped counting
- Area: day timeline
- Requirement: 4.9
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-STALE
- Steps: open `/day/<TODAY>` and read the block's head and rail
- Expected: the block is drawn only as far as `startedAt + MAX_OPEN_SESSION_HOURS` — the
  cap the `Health_Endpoint` reports, not a value reconstructed from the day's totals —
  and the head time is that cap instant rather than `now`. The rail is `--accent` down to
  the cap, then `--rail` at `opacity: 0.5`, the two divided by a 1 px `--hairline`. The
  text `timer běží, ale už se nezapočítává` replaces the `v kuse` phrase in 12 px accent.
  The drawn block and the figure beside it agree, because both stop at the same instant.

## UC-284 — Hovering or focusing a segment reveals its times, project and description
- Area: day timeline
- Requirement: 4.10
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-MANY (every block at the 36 px floor, so descriptions are dropped)
- Steps: hover a collapsed block and wait out the 400 ms delay; then reach the same block
  by keyboard and observe
- Expected: a tooltip appears above the block, centred on it with an 8 px offset,
  `--dialog` at radius 9 with a 1 px `--menu-border`, naming the project, the description
  and the times. Focus opens one with **no** delay. It is `role="tooltip"` referenced by
  `aria-describedby`, never the accessible name — everything it says is already in the
  DOM or in the block's `aria-label`, so a touch device that has no hover loses nothing.

## UC-285 — Activating a segment opens the Activity_Dialog for its entry
- Area: day timeline
- Requirement: 4.11, 7.4
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: click the Alpha segment; then repeat by focusing it and pressing Enter
- Expected: the `Activity_Dialog` opens in edit mode for that `Activity_Entry`, prefilled
  with its current project, description and times. Activating either part of a split
  entry opens the same single entry, not one dialog per segment.

## UC-286 — Activating the rail or the block head opens the Session_Dialog
- Area: day timeline
- Requirement: 4.12
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: activate the middle of a `Session_Rail`; close; activate the `Work_Block` head
- Expected: both open the `Session_Dialog` for that `Work_Session`, with neither time
  field focused (the edges are what focus a field — UC-340). The head is a `<button>`
  inside the head row and the rail's parts are sibling buttons, so no button nests inside
  another.

## UC-287 — Activating an uncovered stretch opens the dialog prefilled with exactly it
- Area: day timeline
- Requirement: 4.13, 10.3
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (10:15–12:30 uncovered)
- Steps: activate the uncovered block and read the dialog's fields
- Expected: the `Activity_Dialog` opens in `Explicit_Mode` with `od` = `10:15` and
  `do` = `12:30` — exactly that stretch, to the minute — the day field on the displayed
  day, and focus on the description field. Nothing is written yet.

## UC-288 — The timeline is vertical at every width
- Area: day timeline · responsiveness
- Requirement: 4.14, 14.12
- Design_Contract: `DESIGN.md` § 9 row 4 — the difference is density, not orientation
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open `/day/<TODAY>` at `VP-DESKTOP`, `VP-MOBILE` and `VP-NARROW`
- Expected: one vertical column of blocks at all three widths. What changes is density —
  block floor 36 → 26, rail 8 → 6, head 13/500 → 12/500, padding `9px 13px` → `8px 11px`,
  the description dropped entirely, and the break label losing its bounds. The layout
  never becomes horizontal and the side panels move below the timeline rather than
  disappearing.

## UC-289 — The timeline is navigable by keyboard in chronological order
- Area: day timeline · accessibility
- Requirement: 4.15, 14.5
- Preconditions: logged in, `VP-DESKTOP`, no pointer used
- Data needed: FIX-UI-DAY
- Steps: Tab from the top of the timeline through to the bottom, recording each focused
  element
- Expected: focus visits the blocks in chronological order — head, rail parts, then each
  `Segment_Block` in the `<ol>`'s order — matching what is drawn top to bottom. Every
  stop shows the focus ring. A `Break_Marker` is **not** a stop: it is a
  `role="separator"` with a label, and there is nothing to activate on a break.

## UC-290 — An empty day invites the user to start the timer
- Area: day timeline · empty states
- Requirement: 4.16, 15.10
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `/day/<TODAY>`
- Expected: the timeline is replaced entirely by a centred empty state — a 20 px icon in
  `--text-faint`, `Zatím nic` and `Spusť timer a den se začne plnit sám.` at 14 px
  `--text-dim`, and one filled accent pill as the next step. Not an empty frame, not a
  zero-height column.

## UC-291 — A session continuing past the day is drawn to the block's end and named
- Area: day timeline
- Requirement: 4.17
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-CONTINUES (session 22:00 → 05:00 next date, on `Logical_Day`
  2026-08-19)
- Steps: open `/day/2026-08-19` and read the last block's rail, head and meta line
- Expected: the block reaches the end of its own column rather than being clipped
  mid-segment; its rail's bottom end is square with a 7 px `--rail` triangle centred on
  the bottom edge; and `pokračuje do 05:00` renders on the meta line at 12 px
  `--text-faint`, naming the session's **true** end in the head. Known deviation:
  `timeline-geometry.ts` derives `continues` from a UTC-midnight approximation rather
  than from `DAY_START_HOUR` and the server's zone, so a session near the real boundary
  can be flagged wrongly — see ISSUES.md "`timeline-geometry.ts`'s `continues` flag uses
  a UTC-midnight approximation".

## UC-292 — A break of an hour or more is drawn more heavily than a short one
- Area: day timeline
- Requirement: 4.19
- Design_Contract: `LONG_BREAK_SECONDS = 3600`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (45-minute break) and a variant with a four-hour evening break
- Steps: compare the two `Break_Marker` rows
- Expected: the 45-minute break renders at 11.5 px / 400 in `--text-faint` with 11 px
  vertical padding; the four-hour break renders at 12 px / 500 in `--text-dim` with 13 px
  padding. The threshold is exactly one hour — a break of 59 minutes takes the short
  treatment and one of 60 takes the long one.

## UC-293 — No Segment_Block is ever drawn below the floor
- Area: day timeline
- Requirement: 4.20, 14.3; design Property 2
- Preconditions: logged in
- Data needed: FIX-UI-MANY (fifty entries of about nine minutes in one session)
- Steps: at `VP-DESKTOP` measure every rendered block height; repeat at `VP-MOBILE`
- Expected: every block is at least 36 px on desktop and 26 px on mobile, however short
  its segment. A two-minute segment is drawn at the floor, not as a sliver, and it is
  still clickable.

## UC-294 — The description appears only on a desktop block of at least 60 pixels
- Area: day timeline
- Requirement: 4.21
- Preconditions: logged in
- Data needed: FIX-UI-DAY (tall blocks) and FIX-UI-MANY (floor blocks)
- Steps: at `VP-DESKTOP` compare a block above 60 px with one at the floor; then view the
  same day at `VP-MOBILE`
- Expected: a desktop block of 60 px or more carries project name 14/500 → description
  12.5 `--text-dim` → times 12 `--text-faint`. Below 60 px it collapses to one row — name
  13/500 and times side by side, no description. At **every** mobile height the
  description is absent, and the tooltip (UC-284) is what supplies it.

## UC-295 — Every block head names its start, its end and its total
- Area: day timeline
- Requirement: 4.22
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read both block heads
- Expected: `08:00 – 12:30` at 13/500 tabular beside `4 h 30 min v kuse` at 12 px
  `--text-faint`, and the same for the second block. The head is also the block's
  accessible name, so a screen reader gets the same three facts.

## UC-296 — When the floor cannot fit the budget, the page scrolls
- Area: day timeline
- Requirement: 4.23; design Property 2
- Preconditions: logged in, `VP-DESKTOP` with a deliberately short viewport (900 tall)
- Data needed: FIX-UI-MANY
- Steps: open `/day/<TODAY>` and measure the timeline column's height against
  `availablePx`, then scroll
- Expected: the column exceeds the available height — every block pinned at the floor —
  and the page scrolls vertically. No block is squeezed below 36 px to make the day fit:
  a block too small to read is worse than a page that scrolls. The mobile artboard's
  `overflow: hidden` on the column is a drawing convenience, not the contract.

## UC-297 — A block touching the Evening_Hour is marked as a night block
- Area: day timeline
- Requirement: 4.24
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-NIGHT (session 21:30 → 01:00, `EVENING_HOUR=21`)
- Steps: open `/day/<TODAY>` and read the head; then check a 06:00–09:00 block on another
  day
- Expected: the 21:30 block's head carries `· noční`. The 06:00–09:00 block does not,
  whatever date it started on — crossing midnight is not the test, reaching the
  `Evening_Hour` is. The hour comes from the server, so a configuration of 20 moves the
  marker with it, and a block called `noční` here is a block contributing to
  `Po 21:00` in the statistics.

## UC-298 — A stretch under five minutes gets no block but still counts
- Area: day timeline
- Requirement: 4.25, 10.4
- Design_Contract: `MIN_UNCOVERED_SECONDS = 300`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY plus one entry leaving a 3-minute uncovered gap and one leaving
  a 7-minute gap
- Steps: read the timeline, the `souhrn dne` panel, the timer page's third figure and the
  statistics `Bez popisu` row
- Expected: the 7-minute stretch is drawn; the 3-minute one is not drawn and is not named
  anywhere. Its duration nevertheless stays in the proportional division of its block's
  height — absorbed by the segment that follows it, so the drawn blocks still sum to the
  session — and it is counted in every total on all four surfaces. One threshold,
  applied everywhere.

## UC-299 — A day is addressed by its date and survives a reload
- Area: day navigation
- Requirement: 5.1
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: navigate to a past day through the previous-day control, copy the URL, open it
  in a fresh tab
- Expected: the URL is `/day/YYYY-MM-DD` and reopening it renders the same day. The date
  is in the path, so a particular day can be bookmarked, shared and reloaded.

## UC-300 — Previous, next and a date picker are all offered
- Area: day navigation
- Requirement: 5.2
- Design_Contract: design.md — desktop puts the two 34 px round buttons in the heading
  line, left of the date, matching the mobile treatment
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at `VP-DESKTOP` locate all three controls in the heading line and use each;
  repeat at `VP-MOBILE` in the 44 px date row
- Expected: `Předchozí den` and `Následující den` move the displayed day by one and
  update the URL; `Vybrat datum` opens a date picker that navigates to the chosen day.
  All three exist at both widths — the desktop artboards draw no date navigation, which
  is a gap in the drawing, not permission to omit the controls.

## UC-301 — The next-day control is disabled on the current day
- Area: day navigation
- Requirement: 5.3
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open `/day/<TODAY>`, inspect the next-day control, try to activate it; then go
  back one day and inspect it again
- Expected: on `TODAY` it is disabled, carries `aria-disabled`, is drawn at reduced
  opacity (0.3), shows no pointer cursor and does nothing when activated. On a past day
  it is enabled and moves forward. There is nothing after today to navigate to.

## UC-302 — The current day is labelled as today, not only by its date
- Area: day navigation
- Requirement: 5.4, 13.7
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read the heading on `/day/<TODAY>`, then on the previous day, then on a day
  further back
- Expected: today reads `dnes`, the previous day `včera`, and anything earlier falls
  through to the long form (`pátek 21. srpna`). The label comes from `formatDayLabel`
  with `form: 'relative'` and the server's `today`, never from a date compared in the
  browser.

## UC-303 — A malformed date in the URL shows the error page
- Area: day navigation · errors
- Requirement: 5.5
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `/day/2026-13-45`, then `/day/yesterday`, then `/day/20260820`
- Expected: each renders the interface's error page rather than an empty day, a crash or
  a redirect. The date parameter is validated against `YYYY-MM-DD` on the server before
  anything is loaded.

## UC-304 — The day's heading line states the date, its bounds and its total
- Area: day navigation
- Requirement: 5.6
- Design_Contract: artboard `DayCollapsed`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read the heading line
- Expected: the date at 20/500 beside `08:00 – 17:00 · odpracováno 8 h 15 min` at 13 px
  `--text-faint` — the day's first tracked instant, its last, and its total
  `Tracked_Time`, in one line. On `VP-MOBILE` the same three facts sit under the centred
  date at 10 px.

## UC-305 — The day page offers an action that opens the Activity_Dialog
- Area: activity creation
- Requirement: 6.1
- Design_Contract: artboard `DayCollapsed` — `+ Přidat úkol` as a filled accent pill,
  34 tall, radius 9999, 13.5/600 in `--ink-on-accent`, at the heading line's right end
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at `VP-DESKTOP` activate `+ Přidat úkol` in the heading line; at `VP-MOBILE`
  reach the same dialog through the create action
- Expected: the `Activity_Dialog` opens in create mode on both widths. Known deviation:
  on mobile the create pills render only in the desktop branch and the FAB has no
  content mechanism, so there is currently **no** mobile entry point for creating an
  activity or a session — see ISSUES.md "Mobile FAB two-item create sheet still has no
  entry point" and "No FAB-content mechanism exists between the shell and pages".

## UC-306 — The dialog offers three modes and all three are first class
- Area: activity creation
- Requirement: 6.2, 14.18
- Design_Contract: `DESIGN.md` § 7 and § 9 row 2 — the third mode is settled, design wins
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open the dialog, read the mode control, and reach it by keyboard
- Expected: a segmented control of exactly three items — `Přesně od–do`, `Jen délka`,
  `Od posledního` — items 36 tall at radius 9 inside a radius-12 group on `--group`, the
  active one on `--segment-active` with accent 13/500 text. It is exposed as a
  `radiogroup` of `radio` items, so Tab reaches the group once and the arrow keys move
  between the options. No mode is hidden, secondary or reached through a different
  control.

## UC-307 — Explicit_Mode requires a start and an end
- Area: activity creation · validation
- Requirement: 6.3, 14.13, 6.10
- Preconditions: logged in, dialog open in `Přesně od–do`
- Data needed: FIX-UI-DAY
- Steps: leave `od` empty and try to save; then fill `od` and leave `do` empty and try
  again; then give an end before the start
- Expected: both fields are marked required. Each empty field is refused with
  `Vyplň tohle pole.` rendered directly beneath it at 12 px `--destructive`, the field
  taking `inset 0 0 0 1px var(--destructive)` in place of its resting ring and **keeping
  what was typed**. An end before the start renders
  `Konec musí být po začátku.` beside the time fields and nothing is saved.

## UC-308 — Duration_Mode requires a duration and leaves the start optional
- Area: activity creation
- Requirement: 6.4, 6.19
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: switch to `Jen délka` and read the field row; save with a duration and no start
- Expected: the row shows day, duration and project (`1fr 1fr 1.2fr`) — no `od`, no `do`.
  The duration is marked required; the start is not offered as a field at all in this
  mode, and the server resolves it from the `Placement_Anchor`. The save succeeds.

## UC-309 — The Placement_Anchor is shown as an inference, and comes from the Dry_Run
- Area: activity creation · preview
- Requirement: 6.5, 9.1
- Preconditions: logged in, dialog open in `Jen délka`
- Data needed: FIX-UI-DAY
- Steps: type a duration, wait for the debounced `Dry_Run`, read the note; then record the
  network traffic and confirm where the value came from; then switch to `Od posledního`
- Expected: a tinted note with an info icon renders
  `Začne se od 14:00 — konec posledního záznamu. Do 2 h se počítá jen čistá práce, pauzy
  se přeskakují.` — the instant carried by the **successful** `Dry_Run` response's
  `anchor` field, labelled as an inference rather than offered as an input. The same in
  `Od posledního`. The browser computes no anchor of its own and does not read one out of
  an error payload; blocking the `Dry_Run` leaves the note absent rather than guessed.

## UC-310 — Open_Mode asks for neither an end nor a duration
- Area: activity creation
- Requirement: 6.6, 6.19
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: switch to `Od posledního` and read the field row; save with a project alone
- Expected: the row shows day and project only (`1fr 1.6fr`). No end field, no duration
  field. The submitted body carries the project, the description and the date; the server
  resolves both ends of the interval. The write succeeds and one segment appears on the
  timeline.

## UC-311 — A project is required and a description is optional
- Area: activity creation · validation
- Requirement: 6.7, 14.13
- Preconditions: logged in, dialog open in `Přesně od–do`
- Data needed: FIX-UI-DAY
- Steps: fill valid times, clear the project, save; then choose a project, clear the
  description, save
- Expected: the project field is marked required and its absence is refused with
  `Vyplň tohle pole.` beside it, the typed times intact. With a project and no
  description the save succeeds and the resulting `Segment_Block` shows the project name
  with no description line.

## UC-312 — The Project_Picker searches and creates without leaving the dialog
- Area: activity creation · projects
- Requirement: 6.8, 11.13
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: open the picker, type `Bet`, choose the match; reopen, type a name that matches
  nothing, choose the create row; then check the dialog's other fields
- Expected: the picker is a `combobox` over non-archived projects with substring search
  and keyboard navigation. With no match it offers `Vytvořit „<name>"`, which POSTs to
  `/api/projects` and inserts the result as the selected value **without closing the
  surrounding dialog** and without losing anything already typed into it. Each option
  shows its `Palette_Slot` swatch next to the name, never the swatch alone. When no
  project exists at all it offers creating the first one rather than an empty control.

## UC-313 — A new entry defaults to the day's most recent entry
- Area: activity creation
- Requirement: 6.9
- Preconditions: logged in
- Data needed: FIX-UI-DAY (most recent entry: Beta, "Worklog")
- Steps: open the dialog in create mode with no prefill and read the project and
  description fields
- Expected: the project is Beta and the description is `Worklog` — the values of the most
  recent `Activity_Entry` of the **displayed** day. Prefill precedence is: an explicit
  prefill from a clicked gap first, then this, then empty. Opening the dialog from an
  uncovered stretch therefore overrides both (UC-287).

## UC-314 — Validation happens in the browser without clearing what was typed
- Area: activity creation · validation
- Requirement: 6.10, 15.4, 15.12
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: type a description, then a malformed time such as `25:99`, and submit
- Expected: the message renders beside the time field before any request is issued —
  `Zadej čas ve tvaru HH:MM` — and every other field keeps its value, the description
  included. Focus moves to the first bad field. The message is the translation of the
  catalogue key the shared schema maps the issue to; the Zod validator's own English
  sentence never reaches the screen.

## UC-315 — The Change_Preview renders live beneath the form, not as a separate step
- Area: activity creation · preview
- Requirement: 6.11, 9.16
- Design_Contract: `DESIGN.md` § 7 — live under the form for the activity dialog
- Preconditions: logged in, dialog open in `Přesně od–do`
- Data needed: FIX-UI-DAY
- Steps: type times spanning the break, wait, then change the end by fifteen minutes and
  wait again
- Expected: a panel of radius 14 on `--panel` renders beneath the fields, headed by an eye
  icon and the caps label `uloží se takto` in accent, showing the resulting segments as
  miniature blocks. It **updates in place** as the input changes — there is no
  "preview" button and no intermediate confirmation screen. The save action stays enabled
  throughout unless the `Dry_Run` returned a rejection. The footer states
  `Počítá to server, ne prohlížeč — co vidíš, to se stane`.

## UC-316 — Quick_Log submits in Open_Mode and lets the server resolve the interval
- Area: activity creation · quick log
- Requirement: 6.12
- Preconditions: logged in on `$APP/`
- Data needed: FIX-UI-RUNNING
- Steps: record the outgoing request, press the `Quick_Log` pill, then read the created
  entry through `GET /api/days/<TODAY>`
- Expected: the pill posts an `Open_Mode` write carrying the project (and the date) and
  **no** start, end or duration. The server resolves the start from the
  `Placement_Anchor` and the end from the current time. The browser computes neither.

## UC-317 — Quick_Log names the interval and project it will send before it is pressed
- Area: activity creation · quick log
- Requirement: 6.13, 6.17
- Preconditions: logged in on `$APP/`
- Data needed: FIX-UI-DAY
- Steps: read the pill's label; compare it with `DayResponse.quickLog` from
  `GET /api/days/<TODAY>`; then use the pill's alternative action
- Expected: the pill reads `Zapsat 14:00 → teď` and names the project it will use, both
  taken verbatim from `DayResponse.quickLog` — the project of the most recent
  `Activity_Entry` of the displayed `Logical_Day`, or of any day when that day holds
  none. Nothing is recomputed in the browser. The pill also offers
  `Otevřít dialog`, which opens the full `Activity_Dialog` instead of posting.

## UC-318 — A created entry appears on the timeline with no page reload
- Area: activity creation
- Requirement: 6.14
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window`, create an entry through the dialog, watch the timeline
- Expected: the new `Segment_Block` appears, the uncovered stretch it filled shrinks or
  disappears, and the `souhrn dne` figures update — all without a document reload, so the
  marker survives. The dialog closes and a brief success confirmation appears.

## UC-319 — Escape closes the dialog and hands focus back
- Area: activity creation · accessibility
- Requirement: 6.15, 14.22
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: note which control opens the dialog, open it, press Escape, read
  `document.activeElement`
- Expected: the dialog closes and focus returns to the exact control that opened it —
  the `+ Přidat úkol` pill, the `Segment_Block`, or the uncovered block, whichever it
  was. This holds for the `Session_Dialog` and every confirmation dialog too.

## UC-320 — The dialog footer says nothing is written until confirmed
- Area: activity creation
- Requirement: 6.16, 9.11
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: read the footer
- Expected: `Esc zavře · nic se neuloží, dokud nepotvrdíš` at 12 px `--text-faint` in the
  footer band, beside the ghost pill and the primary pill (both 42 tall). Closing the
  dialog at any point before confirming writes nothing — verified by re-reading the day
  through the API.

## UC-321 — With no project at all, Quick_Log opens the dialog instead of posting
- Area: activity creation · quick log · empty states
- Requirement: 6.18, 11.13
- Preconditions: logged in on `$APP/`
- Data needed: FIX-UI-EMPTY (no project exists)
- Steps: read the pill, then activate it
- Expected: `DayResponse.quickLog` is `null`, so the pill does not post. It reads
  `Nejdřív vytvoř projekt` and activating it opens the `Activity_Dialog` in
  `Od posledního` with focus already on the `Project_Picker`, which is also where the
  first project gets created. No request is issued and no error is shown.

## UC-322 — The field row's column count follows the active mode
- Area: activity creation
- Requirement: 6.19
- Design_Contract: artboard `AddTask` draws the `Duration_Mode` layout
- Preconditions: logged in, dialog open, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read the field row's computed `grid-template-columns` in each of the three modes
- Expected: `Explicit_Mode` `1fr 0.8fr 0.8fr 1.4fr` (day, from, to, project);
  `Duration_Mode` `1fr 1fr 1.2fr` (day, duration, project); `Open_Mode` `1fr 1.6fr`
  (day, project). The **day field appears in all three**. Fields are 44 tall at radius 11
  on `--field`, `gap: 12`, and the field the active mode derives is drawn with
  `--field-active-bg` and `--field-active-ring`. On `VP-MOBILE` the grid collapses to one
  field per row at 48 px and 15 px type.

## UC-323 — The timeline is the day's list; there is no second one
- Area: activity editing
- Requirement: 7.1
- Design_Contract: design.md — there is no `ActivityList` and no `UncoveredList`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read the whole day page and look for any list repeating the day's entries or its
  uncovered stretches
- Expected: every `Activity_Segment` of the day is drawn as a `Segment_Block` carrying its
  project, its description where the height allows, its times and its duration, and no
  list of the same records is rendered beside it. The side column holds only
  `souhrn dne`, `tvar dne` and — when the day has one — the `Orphan_Panel`.

## UC-324 — A split entry's segments carry their own times and say they were split
- Area: activity editing
- Requirement: 7.2, 4.6
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-SPLIT
- Steps: read both parts of the split entry
- Expected: each part shows its own start, end and duration — `12:00 – 12:30` and
  `13:15 – 14:00`, not the requested `12:00 – 14:00` on both — and each states through
  the `Split_Marker` that the entry was split around a break. The break stays visible
  between them rather than being smoothed over.

## UC-325 — When stored differs from requested, the dialog says so
- Area: activity editing
- Requirement: 7.3
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-SPLIT (requested 12:00 – 14:00, stored as two segments)
- Steps: open the `Activity_Dialog` on that entry and read above the field row
- Expected: one line at 12.5 px `--text-faint` —
  `žádáno 12:00 – 14:00 · uloženo ve 2 částech` — built from `requestedStartedAt` /
  `requestedEndedAt` (or `requestedDurationMinutes`). It is a statement, not a field:
  editing the times replaces it. This is the only place the difference is shown, because
  it is the only place it can be acted on.

## UC-326 — Opening an entry for editing prefills its current values
- Area: activity editing
- Requirement: 7.4
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: activate the Alpha segment and read every field
- Expected: the mode, the day, the times, the project and the description all carry the
  entry's current values, and the dialog title reads `Upravit úkol` rather than
  `Přidat úkol`. Nothing is blank and nothing is defaulted from another entry.

## UC-327 — Changing only the description or project saves without a preview
- Area: activity editing · preview
- Requirement: 7.5
- Design_Contract: design.md — the `Editing → Saving` shortcut
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open an entry, change only the description, save; repeat changing only the
  project
- Expected: no `Change_Preview` is requested or rendered, and the save goes straight
  through — a change that cannot move a segment has nothing to preview. The timeline
  updates in place.

## UC-328 — Changing the interval or the duration shows a preview first
- Area: activity editing · preview
- Requirement: 7.6, 9.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open an entry, move its end by thirty minutes, wait for the debounce
- Expected: the `Change_Preview` renders beneath the form showing the segments as they
  would be stored, and nothing is written until the user confirms. Re-reading the day
  through the API before confirming shows the original values unchanged.

## UC-329 — Deleting an entry is confirmed by naming what goes
- Area: activity editing
- Requirement: 7.7, 15.8
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open an entry, choose delete, read the confirmation, cancel; then repeat and
  confirm
- Expected: a confirmation dialog of `max-width: 420` opens headed `Smazat úkol?` with a
  body naming the record and the duration —
  `Alpha, 08:00 – 10:15 · 2 h 15 min. Zmizí z výkazu.` — never a bare "are you sure".
  Its confirm pill is filled in `--destructive` with `--ink-on-accent` text. Cancelling
  writes nothing; confirming removes the entry.

## UC-330 — A deleted entry leaves the timeline without a page reload
- Area: activity editing
- Requirement: 7.8
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window`, delete an entry, watch the timeline and the side panel
- Expected: the `Segment_Block` disappears, the stretch it occupied becomes an
  `Uncovered_Marker`, and the `souhrn dne` figures and meter update — with no document
  reload, so the marker survives. A brief `Smazáno` confirmation appears.

## UC-331 — Orphaned entries get their own panel, because they have nowhere to be drawn
- Area: activity editing · orphans
- Requirement: 7.9
- Design_Contract: artboard `DayCollapsed` — the `mimo výkaz` panel
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-ORPHAN
- Steps: open `/day/<TODAY>` and read the third panel of the side column
- Expected: a panel headed `mimo výkaz` listing one row per emptied entry, each naming
  its `Project` and its **originally requested** interval
  (`žádáno 13:00 – 16:00 · zbylo 0 min`), above the sentence
  `Zápisy, kterým po úpravě timeru nezbyl žádný čas. Na ose je nevidíš, protože nikde
  neleží.` The entries are absent from the timeline, which is correct — an entry with no
  `Activity_Segment` has no position to be drawn at.

## UC-332 — With no orphans the panel is not rendered at all
- Area: activity editing · orphans
- Requirement: 7.10
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (no orphaned entry)
- Steps: read the side column
- Expected: exactly two panels — `souhrn dne` and `tvar dne`. There is no `mimo výkaz`
  heading, no empty panel and no placeholder occupying the space.

## UC-333 — The Orphan_Panel offers recovery and deletion from one shared pair of actions
- Area: activity editing · orphans
- Requirement: 7.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-ORPHAN (at least two orphaned entries)
- Steps: select a row, use `Přepsat čas` and give the entry a new interval inside
  `Tracked_Time`; then select another row and delete it
- Expected: the two actions are drawn **once at the foot of the panel**, not repeated per
  row, and they act on the selected row — at 290 px a pair of pills per row costs more
  height than the rows themselves. Re-entering the times places the entry back on the
  timeline as real segments; deleting removes it. An `Orphaned_Entry` can never become a
  record the user cannot reach.

## UC-334 — Adding a Work_Session is offered in the heading line and the mobile menu
- Area: frame editing
- Requirement: 8.1, 1.5
- Design_Contract: artboard `DayCollapsed` — `+ úsek` as a ghost pill on `--chip` in
  `--text-dim`, 34 tall, beside the filled `+ Přidat úkol`
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: at `VP-DESKTOP` activate `+ úsek`; at `VP-MOBILE` reach the same through the
  create action
- Expected: the `Session_Dialog` opens in create mode with empty start and end fields on
  the displayed day, and saving adds a `Work_Session` for a stretch that was never
  tracked. The task is the everyday action and gets the filled treatment; adding a timer
  block is a repair and stays quiet. Known deviation on mobile — see UC-305.

## UC-335 — Editing a session shows the new value beside the old one struck through
- Area: frame editing
- Requirement: 8.2
- Design_Contract: artboard `SessionEdit`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open the `Session_Dialog` on the first session and change the end from `12:30`
  to `11:30`
- Expected: two 44 px time fields, start and end, both editable. The changed one carries
  the new value with the previous one beside it struck through at 12 px `--text-faint`,
  so what is being replaced stays visible while the change is considered.

## UC-336 — Deleting a session is an inline destructive control behind a confirmation
- Area: frame editing
- Requirement: 8.3, 15.8
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open the `Session_Dialog`, activate the delete control, read the confirmation
- Expected: deletion is offered as an inline `--destructive` text link
  (`Smazat celý úsek 08:00 – 12:30`), not as a footer button, and it opens a confirmation
  headed `Smazat úsek timeru?` whose body names the interval that will be removed and how
  many entries lose time — `Úsek 08:00 – 12:30 · 4 h 30 min zmizí. Jeden záznam přijde o
  čas.` Cancelling writes nothing.

## UC-337 — A session change that costs recorded time becomes a confirmation state
- Area: frame editing · preview
- Requirement: 8.4, 9.11
- Design_Contract: `DESIGN.md` § 7 — the two dialogs use different preview patterns
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: shorten the first session's end from `12:30` to `09:00` — which cuts into the
  Alpha entry — and submit
- Expected: the preview does **not** sit under the form as it does in the
  `Activity_Dialog`. It takes over the dialog body as a distinct confirmation state: the
  save action is replaced by `Potvrdit a uložit` beside `Zpět k úpravě`, and the body
  shows what disappears. Going back returns to editing with the typed values intact;
  confirming performs the write.

## UC-338 — A session change that would overlap another names the conflict and refuses
- Area: frame editing · errors
- Requirement: 8.5, 15.5
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (two sessions, 08:00–12:30 and 13:15–17:00)
- Steps: open the second session and move its start back to `11:00`
- Expected: the preview reports a rejection naming the conflicting session —
  `Překrývá se s úsekem 08:00 – 12:30` — the confirm action stays disabled, and nothing
  is written. Where the conflict is with the running timer the message is
  `Překrývá se s běžícím timerem od <from>` instead. Re-reading the day confirms both
  sessions are unchanged.

## UC-339 — A start that is not before its end is refused beside the field
- Area: frame editing · validation
- Requirement: 8.6
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open a session and set the end earlier than the start, then equal to it
- Expected: `Konec musí být po začátku.` renders beside the time fields, the fields keep
  their values, and the write is refused in both cases. An interval is half-open, so an
  end equal to the start is empty and equally invalid.

## UC-340 — A rail edge opens the dialog with that end's field focused and selected
- Area: frame editing
- Requirement: 8.7, 14.21
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY (blocks taller than 60 px, so the edges are rendered)
- Steps: activate the top 12 px of a `Session_Rail`, note focus and selection; close;
  activate the bottom 12 px
- Expected: the top edge opens the `Session_Dialog` with `začátek` focused **and its
  content selected**, ready to be typed over or stepped; the bottom edge does the same
  for `konec`. Their accessible names are `Upravit začátek úseku, 08:00` and
  `Upravit konec úseku, 12:30`. Every boundary change therefore goes through a field with
  a `Change_Preview` behind it.

## UC-341 — No session edge can be dragged
- Area: frame editing
- Requirement: 8.8, 14.3
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: press and drag a `Session_Rail` edge vertically by fifty pixels and release;
  then search the source for a pointer-move handler on the rail
- Expected: nothing moves, no ghost is drawn, no time is changed and no write is issued —
  the drag is simply not a gesture the interface implements. A block's height is
  proportional only within its block and is clamped at `MIN_BLOCK_PX`, so no
  pixel-to-minute mapping exists that would not misreport the time being set.

## UC-342 — A changed or removed session updates the timeline without a reload
- Area: frame editing
- Requirement: 8.9
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window`; shorten a session and confirm; then delete the other
  one and confirm
- Expected: the `Work_Block` resizes and the affected `Segment_Block` elements re-clip in
  place; the deleted session's block and every segment inside it disappear and the
  `Break_Marker` between them goes with it. No document reload — the marker survives.

## UC-343 — Deleting a session previews every entry that loses time
- Area: frame editing · preview
- Requirement: 8.10, 9.5, 9.8
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open the first session, choose delete, and read the preview before confirming
- Expected: the `Change_Preview` names each `Activity_Entry` that would lose time and the
  duration it would lose, and describes in prose any entry that would be emptied
  completely — becoming an `Orphaned_Entry` — rather than showing it as a
  before-and-after pair. The confirmation is not offered until that preview has been
  computed.

## UC-344 — Every figure in a preview comes from the server
- Area: preview
- Requirement: 9.1, 9.16
- Method: browser plus inspection
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: record the network traffic while a `Dry_Run` runs, and compare every number the
  panel prints against the response body; then search `src/modules/day/` for any
  arithmetic over the day's loaded `uncovered` or `segments` used to build a preview
  figure
- Expected: every printed value — the resulting segments, `removedSeconds`,
  `lostUncoveredSeconds`, `unplacedMinutes`, `slivers`, `discarded`, the anchor — appears
  verbatim in the `Dry_Run` response. `lostUncoveredSeconds` in particular is **not**
  derived by intersecting the loaded intervals in the browser, even though it could be:
  that would be the one figure in the report computed on the client, and the whole
  preview rests on the rule that none is.

## UC-345 — A split preview shows each resulting segment and how many parts there will be
- Area: preview
- Requirement: 9.2
- Preconditions: logged in, dialog open in `Přesně od–do`
- Data needed: FIX-UI-DAY
- Steps: enter `12:00 – 14:00`, spanning the 12:30–13:15 break, and wait for the preview
- Expected: the panel renders two miniature blocks — `12:00 – 12:30` and `13:15 – 14:00`
  — above `Uloží se 2 části kolem pauzy.`, using the Czech plural form. The count and
  the drawn segments agree.

## UC-346 — A request reaching outside Tracked_Time says which part and how long
- Area: preview
- Requirement: 9.3, 9.10
- Preconditions: logged in, dialog open in `Přesně od–do`
- Data needed: FIX-UI-DAY
- Steps: enter `17:00 – 18:00`, an hour after the last session ended
- Expected: the preview names the stretch that falls outside `Tracked_Time` and its
  duration, drawn as a dashed accent warning, and offers the `Untracked_Policy` control
  (`Se zbytkem:` / `Zahodit` / `Prodloužit timer`) with `Zahodit` selected. Changing the
  choice re-runs the `Dry_Run`, so the consequence of each option is visible before one
  is picked.

## UC-347 — A duration that cannot be placed in full reports the remainder
- Area: preview
- Requirement: 9.4
- Preconditions: logged in, dialog open in `Jen délka`
- Data needed: FIX-UI-DAY
- Steps: ask for a duration longer than the tracked time left after the anchor — for
  example six hours with two hours of frame remaining
- Expected: the preview states how many minutes would remain unplaced —
  `2 h 00 min se nevejde.` — with the reason beneath:
  `Po 17:00 už timer neběžel, takže z 6 h 00 min se zapíše 4 h 00 min.` The figures are
  the server's `unplacedMinutes` and the sum of the preview's own segments.

## UC-348 — A session preview names each affected entry and shows now beside after
- Area: preview
- Requirement: 9.5
- Design_Contract: artboard `SessionEdit`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: shorten the first session so the Alpha entry loses thirty minutes, and read the
  consequence panel
- Expected: a panel of radius 14 on `rgba(209,138,106,0.07)` with a
  `1px solid rgba(209,138,106,0.28)` border, holding one row per affected entry inside a
  radius-11 `--panel` box — a 3 × 18 slot-coloured tick, the project name at 13.5/500,
  the loss at 12.5 accent (`−30 min`), and beneath it a `1fr 20px 1fr` grid of `teď` →
  `po úpravě` with an arrow between, showing the entry's segments as they are now beside
  what they would become.

## UC-349 — The preview states one total, split into its two parts, counting entries only
- Area: preview
- Requirement: 9.6
- Design_Contract: `DESIGN.md` § 7 — the two numbers count different things
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY, with a session change that removes 30 min from one entry and
  pushes 1 h 30 of `Uncovered_Time` outside the frame
- Steps: read the headline, the line beneath it and the closing count
- Expected: the headline duration is `removedSeconds + lostUncoveredSeconds` — the
  combined `2 h 00 min` — at 15/500 accent. Directly beneath it,
  `Z toho 30 min ze záznamů a 1 h 30 min nepopsaného času.` names the two parts, so no
  reader has to work out why the headline exceeds the entries listed under it. The
  closing count counts **`Activity_Entry` records only** — one entry, not two — because
  uncovered time is not a record. The `SessionEdit` artboard says *2 záznamy* over one
  entry and one uncovered row; the artboard is wrong and this rule holds.

## UC-350 — Lost uncovered time is its own row, in prose, marked as uncovered
- Area: preview
- Requirement: 9.7
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: as UC-349
- Steps: read the last row of the consequence panel
- Expected: a row rendered **last**, labelled `Zatím bez popisu`, described in prose
  rather than as a before-and-after pair, with its tick drawn in
  `rgba(209,138,106,0.6)` rather than any `Palette_Slot`, naming the stretch and its
  duration. It refreshes with the rest of the preview on every recomputation. It is not
  counted among the affected entries. Known deviation: `SessionDialog`'s
  `Editing → Saving` shortcut ignores `lostUncoveredSeconds`, so a change that **only**
  loses uncovered time saves with no confirmation at all — see ISSUES.md "SessionDialog's
  Editing→Confirming shortcut ignores `lostUncoveredSeconds`".

## UC-351 — An entry that would be emptied is described in prose
- Area: preview
- Requirement: 9.8
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: delete the session that wholly contains the Alpha entry and read the preview
- Expected: that entry is described as
  `Úsek 08:00 – 10:15 zmizí celý — po zkrácení už nebude uvnitř běhu timeru.` — prose,
  not a `teď` → `po úpravě` pair, because there is no "after" to draw. It will become an
  `Orphaned_Entry` and appear in the `Orphan_Panel` afterwards.

## UC-352 — A rejected request shows the reason and disables the confirm action
- Area: preview · errors
- Requirement: 9.9, 9.13
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: enter times overlapping an existing entry and wait for the preview
- Expected: the rejection replaces the whole preview body with the translated
  `messageKey` — `Překrývá se se záznamem Alpha (08:00 – 10:15).` — and the confirm
  action is disabled. A non-2xx `Dry_Run` response is treated as a **rejection to
  display**, not as a transport failure: no retry toast, no offline page, and the dialog
  keeps every value that was typed.

## UC-353 — The Untracked_Policy choice is offered where it applies, defaulting to clip
- Area: preview
- Requirement: 9.10
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: enter a range partly outside `Tracked_Time`, read the control's default, choose
  `Prodloužit timer`, wait, then save
- Expected: the segmented control appears only when the preview reports `discarded`
  intervals, with `Zahodit` (`clip`) selected by default. Choosing `Prodloužit timer`
  (`extend`) re-runs the `Dry_Run`; the new preview shows the session extended and
  nothing discarded, and saving produces exactly what that preview showed.

## UC-354 — Nothing is written until the preview is confirmed
- Area: preview
- Requirement: 9.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open each of the five previewed writes in turn — create activity, edit activity,
  create session, edit session, delete session — let each preview settle, then close the
  dialog with Escape; after each, re-read the day through `GET /api/days/<TODAY>`
- Expected: the day is byte-for-byte unchanged after all five. A `Dry_Run` is evaluated in
  full, including every rejection, and rolled back inside the same transaction — it never
  leaves a row, an extended session or a claimed key behind.

## UC-355 — While a Dry_Run is in flight the panel loads and confirm stays disabled
- Area: preview · loading
- Requirement: 9.12, 15.2
- Preconditions: logged in, dialog open, the server's response artificially delayed
- Data needed: FIX-UI-DAY
- Steps: change a time field and watch the panel and the footer during the round trip
- Expected: the panel shows a loading state (a skeleton of its own shape, never a
  spinner) and carries `aria-busy`, and the confirm action is disabled for the whole
  flight. It re-enables only when a response settles, and stays disabled if that response
  is a rejection.

## UC-356 — A non-2xx Dry_Run is a rejection, not a transport failure
- Area: preview · errors
- Requirement: 9.13
- Preconditions: logged in, dialog open
- Data needed: FIX-UI-DAY
- Steps: provoke a 400 (`INVALID_INTERVAL`), then a 409 (`ACTIVITY_OVERLAP`), then a 422
  (`OUTSIDE_TRACKED_TIME`)
- Expected: each renders inside the preview panel as the translation of its `messageKey`
  with confirm disabled. None produces a retry toast, an offline redirect or a blank
  panel, and none closes the dialog. A network failure — a different thing entirely —
  does produce a retryable message, and still keeps the dialog and its input (UC-445).

## UC-357 — A stale preview is recomputed and confirmed again
- Area: preview
- Requirement: 9.14
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: open the `Session_Dialog`, shorten a session, let the preview settle, then from
  another client change the timer frame; now press confirm
- Expected: the write returns `STALE_PREVIEW`, the interface renders
  `Mezitím se něco změnilo — tady je nový náhled.`, recomputes the preview against the
  new frame and asks the user to confirm again. What the user finally confirmed is always
  what happens. Nothing is written on the refused attempt.

## UC-358 — Typing does not exhaust the request budget
- Area: preview
- Requirement: 9.15
- Preconditions: logged in, dialog open, network panel recording
- Data needed: FIX-UI-DAY
- Steps: type `1`, `3`, `:`, `0`, `0` into a time field in quick succession, then pause
- Expected: no `Dry_Run` is issued while the keystrokes are still arriving; one fires
  about 400 ms after the last one. Any request still in flight when a new keystroke
  arrives is aborted. Five keystrokes produce one request, not five.

## UC-359 — The preview says the server computed it
- Area: preview
- Requirement: 9.16
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read the footer of the `Session_Dialog` while a preview is shown, and the
  preview panel's heading in the `Activity_Dialog`
- Expected: the session dialog's footer reads
  `Počítá to server, ne prohlížeč — co vidíš, to se stane`, and the activity dialog's
  panel is headed by the caps label `uloží se takto` in accent. It is explicit that what
  is shown is what will happen, not an estimate.

## UC-360 — The day summary panel states the four figures, a meter and the share
- Area: uncovered guidance
- Requirement: 10.1
- Design_Contract: artboard `DayCollapsed` — the `souhrn dne` panel
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: read the first panel of the 290 px side column
- Expected: label-value rows at 13 px `--text-dim` against 15/500 tabular —
  `Odpracováno` (`Tracked_Time`), `Popsáno` (`Covered_Time`) and `Chybí popis`
  (`Uncovered_Time`, the value in `--accent`) — then a 4 px meter on `--meter-track`
  filled to the described share, then that share as a percentage in words:
  `81 % odpracovaného času má popis` at 12 px `--text-faint`. The three figures reconcile
  (`covered + uncovered = tracked`) and match the timer page's three figures for the same
  day.

## UC-361 — A fully described day says so
- Area: uncovered guidance
- Requirement: 10.5
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY with every stretch described (or the gap-filling of UC-287
  carried through)
- Steps: describe every uncovered stretch, then read the side panel and the timeline
- Expected: `Chybí popis` reads `0 min`, the meter is full, and the panel states
  `Celý den je popsaný.` No `Uncovered_Marker` remains on the timeline. The user is told
  they are finished rather than being left to infer it from a zero.

## UC-362 — The Uncovered_Marker takes the right one of its four variants
- Area: uncovered guidance
- Requirement: 10.7
- Design_Contract: design.md *Uncovered_Marker* — four variants, one treatment
- Preconditions: logged in
- Data needed: FIX-UI-DAY (a tall uncovered stretch) plus FIX-UI-MANY (stretches at the
  floor)
- Steps: at `VP-DESKTOP` compare a stretch of at least 60 px with one at 36 px; at
  `VP-MOBILE` compare one above 44 px with one at the 26 px floor
- Expected: all four share the same fill, the same dashed border and the same accent
  title, and differ only as follows. Desktop tall: `Zatím bez popisu` 13/500 accent over
  `01:30 – 03:00 · 1 h 30 min — klikni a doplň` at 12 px `--text-faint`. Desktop short:
  `Bez popisu` 13/500 accent · the times · a flexible gap · `doplnit` at 12 px accent
  against the right edge. Mobile tall: title 12.5/500 accent over times 10.5 px, with
  `doplnit` as a rounded 11 px accent pill on `rgba(209,138,106,0.14)`. Mobile short (at
  26 px): title and times on one row and **no** `doplnit` pill — the whole block is the
  target, so a pill would be a second affordance for the same tap.
  **Resolved (run 2026-08-24-0659, verify phase):** the criterion's 44 px threshold and
  `design.md`'s "above the floor" wording were in tension; `design.md`'s four-variant
  table now states the 44 px threshold explicitly, matching Requirement 10.7 and the
  already-shipped `SegmentBlock.svelte` implementation (`heightPx >= 44` on mobile) —
  see ISSUES.md "The mobile `Uncovered_Marker` threshold is 44 px in the requirement
  and the floor in the design" (now RESOLVED). No band remains undefined; this case's
  steps (above 44 px, at the 26 px floor) both still hold under the resolved reading.

## UC-363 — The shape-of-the-day panel reads three figures from the day response
- Area: uncovered guidance
- Requirement: 10.8
- Preconditions: logged in, `VP-DESKTOP`, network panel recording
- Data needed: FIX-UI-NIGHT plus a second session, so all three figures are non-trivial
- Steps: read the second panel of the side column and count the requests the page issued
- Expected: a panel headed `tvar dne` giving `Bloky práce` (`sessionCount`),
  `Nejdelší v kuse` (`longestBlockSeconds`) and `Po 21:00` (`eveningSeconds`), all three
  taken from `DayResponse.totals` — the page issues **no** second request for them. The
  evening label carries the `Evening_Hour` the server reports, so a configuration of 20
  renders `Po 20:00`.

## UC-364 — The projects page lists every project with its thirty-day total
- Area: projects
- Requirement: 11.1
- Design_Contract: artboard `Projects` — content max 940, rows `padding: 16px 18px`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK (work spread across several projects)
- Steps: open `/projects` and read each row
- Expected: one row per non-archived project, each with a 32 px icon box of radius 9
  tinted from its slot carrying a 13 px rounded swatch, the project name, its total
  `Covered_Time` over the last thirty `Logical_Day` values — summed from the per-project
  totals the server returns for that range, not recomputed — a share bar, and the row's
  actions. The heading meta line counts the active projects.

## UC-365 — A project can be created by name
- Area: projects
- Requirement: 11.2
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `/projects`, type `Delta` into the create field and submit
- Expected: the project is created through a form action, appears in the list
  immediately, and is assigned the first free `Palette_Slot` by the server. The field
  clears and a brief `Uloženo` confirmation appears.

## UC-366 — A duplicate name is refused beside the field
- Area: projects · validation
- Requirement: 11.3
- Preconditions: logged in
- Data needed: FIX-PROJECTS (Alpha exists)
- Steps: try to create `alpha`, then `  Alpha  `, then `ALPHA`
- Expected: each is refused with `Projekt Alpha už existuje.` rendered beside the name
  field, and no duplicate is created — the comparison ignores case and surrounding
  whitespace. The typed value stays in the field.

## UC-367 — A project can be renamed
- Area: projects
- Requirement: 11.4
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: rename `Alpha` to `Alpha CRM`; then open `/day/<TODAY>` and the timer page
- Expected: the rename saves through a form action and the row updates. Every surface
  that names that project follows — the `Segment_Block` elements, the `Project_Legend`,
  the `Project_Picker` and the statistics breakdown — because all of them read the name
  from the server rather than caching it. Renaming to an existing name is refused as in
  UC-366.

## UC-368 — Archiving hides a project from the list by default, and unarchiving returns it
- Area: projects
- Requirement: 11.5
- Preconditions: logged in
- Data needed: FIX-PROJECTS (Gamma already archived)
- Steps: read the default list; use `Zobrazit archivované`; archive `Beta`; unarchive
  `Gamma`
- Expected: archived projects are absent from the default list — Gamma is not shown until
  `Zobrazit archivované` is chosen, and then it carries the `archivovaný` badge. Archiving
  Beta removes it from the default list without deleting it or its entries; unarchiving
  Gamma returns it to the default list and to the `Project_Picker`.

## UC-369 — The Project_Picker offers only non-archived projects
- Area: projects
- Requirement: 11.6
- Preconditions: logged in, `Activity_Dialog` open
- Data needed: FIX-PROJECTS (Gamma archived)
- Steps: open the picker with an empty search, then search for `Gamma`
- Expected: Alpha and Beta are offered; Gamma is not, under either search. The only way
  an archived project appears in the picker is as the current value of an entry that
  already references it (UC-375).

## UC-370 — A project no entry references can be deleted
- Area: projects
- Requirement: 11.7, 15.8
- Preconditions: logged in
- Data needed: FIX-PROJECTS plus an unused project `Delta`
- Steps: delete `Delta`, read the confirmation, confirm
- Expected: a confirmation headed `Smazat projekt?` with the body
  `Delta nemá žádný záznam, takže po smazání nic nezmizí.` Confirming removes the row and
  the project is gone from the picker and the statistics.

## UC-371 — Deleting a referenced project explains and offers archiving instead
- Area: projects · errors
- Requirement: 11.8
- Preconditions: logged in
- Data needed: FIX-UI-DAY (Alpha carries entries)
- Steps: read the delete control's state on the `Alpha` row, activate it, confirm, and
  read the response
- Expected: the delete control is **enabled** before the attempt — the list carries no
  reference count to disable it from, and disabling it on a guess would be wrong. The
  attempt is refused with
  `Alpha má 1 záznam, takže ho nejde smazat. Archivace ho schová z nabídky.` and the
  interface offers archiving as the alternative. Nothing is deleted.

## UC-372 — A project's colour is changed from inside its own row
- Area: projects
- Requirement: 11.10
- Design_Contract: artboard `Projects` — the artboard's standalone strip is a
  presentation of the control, not its placement
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: activate the swatch on the `Alpha` row, read the strip, choose a different slot;
  repeat at `VP-MOBILE`
- Expected: a strip of the **eight** `Palette_Slot` swatches expands **inside that row**,
  each 38 tall at radius 11, the current one ringed with
  `0 0 0 2px var(--bg), 0 0 0 4px var(--text)`. Choosing one saves and collapses the
  strip; the new colour appears on the timeline, the gauge, the picker and the statistics
  at once. On mobile the same strip expands inside the row as two rows of four, reached
  through the row's overflow control. A page-level picker would have no way of saying
  which project it is about, so the control never leaves the row.

## UC-373 — colorIndex comes from the server on every surface
- Area: projects · theming
- Requirement: 11.9
- Method: browser plus inspection
- Preconditions: logged in
- Data needed: FIX-UI-DAY plus one archived project holding time in the range
- Steps: read the `pj-*` class on a `Segment_Block`, the swatch on the legend, the picker
  option and the statistics breakdown row for the same project, and compare all four with
  the `colorIndex` the API returns; then search `src/` for a lookup that joins a project
  id against the projects list to find a colour
- Expected: all four surfaces use the same slot, taken from the `colorIndex` each read
  shape carries (`ActivityEntry.colorIndex`, `ProjectTotal.colorIndex`, the interval
  attribution of a `DaySummary`). No client-side join exists — a join would be wrong for
  an archived project missing from the list and stale for one recoloured in another tab.

## UC-374 — A project's name is shown wherever its colour is
- Area: projects · accessibility
- Requirement: 11.11, 14.11
- Preconditions: logged in
- Data needed: FIX-UI-NINE (nine projects, so `colorIndex` 8 wraps to slot 0)
- Steps: sweep every surface that draws a project colour — timeline blocks, gauge legend,
  picker options, projects rows, statistics breakdown, rhythm strip legend
- Expected: each shows the project's name beside the colour. The one surface that cannot
  — a `Day_Gauge` arc — is covered by its hover and focus label (UC-467) and by the
  `Project_Legend` beneath it. With nine projects two share a hue, which is exactly why
  the name is never optional. No text is placed on a filled slot anywhere.

## UC-375 — An archived project stays selectable on an entry that already uses it
- Area: projects
- Requirement: 11.12
- Preconditions: logged in
- Data needed: FIX-UI-DAY plus an entry on a project that is then archived
- Steps: open that entry's `Activity_Dialog` and read the `Project_Picker`'s value and
  option list
- Expected: the archived project is offered as the **current** value, marked with the
  `archivovaný` badge, so the entry can be edited without silently changing its project.
  It still does not appear among the choices for a different entry. Known deviation: the
  badge offers no unarchive action from inside the picker — see the phase-1 report's
  MEDIUM findings.

## UC-376 — With no project, both the page and the picker offer creating the first
- Area: projects · empty states
- Requirement: 11.13, 15.10
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `/projects`; then open the `Activity_Dialog` and its picker
- Expected: the page shows an empty state — `Zatím žádný projekt` over
  `Založ první projekt a začni k němu psát čas.` — with one filled accent pill as the
  next step, not an empty table. The picker likewise offers creating the first project
  rather than an empty control with no options.

## UC-377 — A project row's bar is its share of the range's covered time
- Area: projects
- Requirement: 11.14, 12.4
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: measure each row's bar width as a fraction of its track and compare with that
  project's share of the thirty-day total `Covered_Time`; then compare the same project's
  bar on `/stats`
- Expected: each bar is the project's share of the **range's total** `Covered_Time`, so a
  full track means the whole range and the printed figures reconcile. It is not scaled to
  the largest project — that reading is superseded — and it draws the same quantity the
  statistics breakdown draws.

## UC-378 — Statistics offers exactly three ranges, anchored on today
- Area: statistics
- Requirement: 12.1
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: read the range control, choose each of the three, and read the resolved range
  beside it; check the URL
- Expected: a segmented control of exactly three items — `Den`, `Týden`, `Měsíc` — each
  anchored on the current `Logical_Day`, the week beginning on **Monday** and the month
  being the calendar month of today. The resolved date range is named beside the control.
  No fourth range and nothing longer than a month is offered anywhere. The choice rides
  the URL as `?range=day|week|month`, and an unrecognised value falls back to `week`.

## UC-379 — The KPI_Row states four figures
- Area: statistics
- Requirement: 12.2
- Design_Contract: artboard `Stats` — `repeat(4, 1fr)`, panels radius 14, figures 30/300
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: read the four panels
- Expected: `odpracováno` (`Tracked_Time`), `popsáno` (`Covered_Time`),
  `podíl popsaného` (the described share as a percentage over a 4 px meter) and
  `mimo obvyklé hodiny` (`Overtime`, summed from `overtimeSeconds`, with its share of
  `Tracked_Time` at 11.5 px `--text-faint` beneath it). Each is a caps label over a
  tabular figure. The `Evening_Hour` figure is **not** here — it lives in the rhythm
  panel.

## UC-380 — The breakdown lists projects descending with swatch, name, duration and share
- Area: statistics
- Requirement: 12.3
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: read the breakdown rows in order
- Expected: one row per project with `Covered_Time` in the range, sorted **descending** by
  duration — a 9 × 9 swatch, the name at 14 px, the duration at 14/300 tabular, and the
  share at 12 px `--text-faint` in a 42 px gutter. The shares sum to 100 % of the range's
  `Covered_Time`.

## UC-381 — Each breakdown bar draws the same quantity its percentage prints
- Area: statistics
- Requirement: 12.4
- Design_Contract: `DESIGN.md` § 8 — the artboard's 100/54/14 % reading is superseded
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: measure each 8 px bar against its track and compare with the printed share
- Expected: the bar is the project's share of the range's total `Covered_Time`, matching
  the printed percentage to the point. The top project's bar is **not** automatically
  full; a full track means the whole range. Two scales in one row is a misreading waiting
  to happen, and the share is the number the reader is being given.

## UC-382 — Uncovered time is stated beneath the bars and is never one of them
- Area: statistics
- Requirement: 12.5
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: read below the breakdown's divider
- Expected: `Bez popisu` renders as a plain figure in `--accent`, separated from the
  project rows by a divider, with **no** bar of its own. It is not a project and must not
  appear among them; adding it as a bar would make the shares stop summing to the covered
  total.

## UC-383 — The Day_Rhythm_Strip draws where in the day the work actually fell
- Area: statistics
- Requirement: 12.6
- Design_Contract: artboard `Stats`
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: choose `Týden`, read the panel and compare one day's segments with that day's
  covered intervals from `GET /api/days?include=intervals`
- Expected: a panel headed `Kam v čase práce padla` with one 22 px strip of radius 5 per
  `Logical_Day` on a shared axis running `DAY_START_HOUR → DAY_START_HOUR`, each strip in
  a 58 px day-label gutter with the day's total in a 62 px right gutter. Each covered
  interval is drawn as an SVG `<rect>` at the position the work actually fell, in the
  `Palette_Slot` of the `projectId` that interval carries — not in a colour looked up in
  the browser. The strip is inline SVG rather than positioned `<div>` elements, because
  percentage offsets would be inline styles the CSP forbids.

## UC-384 — The strip's axis is read from the server's DAY_START_HOUR
- Area: statistics
- Requirement: 12.7
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK, run once with `DAY_START_HOUR=3` and once with `5`
- Steps: read the sub-line and the five axis labels in each configuration
- Expected: with 3 the sub-line reads `každý řádek je jeden logický den, 03:00 → 03:00`
  and the axis reads `03:00 · 09:00 · 15:00 · 21:00 · 03:00`; with 5 it reads
  `05:00 → 05:00` and `05:00 · 11:00 · 17:00 · 23:00 · 05:00`. Both ends carry the
  configured hour and the three interior ticks are even divisions of the span. The
  artboard's `08:00 / 14:00 / 20:00` interior labels are a drawing convenience; even
  divisions is the rule.

## UC-385 — Today is marked, and a day with no work is an empty strip with an em dash
- Area: statistics
- Requirement: 12.8
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK (includes one day with no work, and today)
- Steps: read the row for today and the row for the idle day
- Expected: today's day label is drawn in `--accent` and its strip carries
  `inset 0 0 0 1px rgba(209,138,106,0.30)`. The idle day's strip is empty — no segments,
  no hatch — and its total gutter shows an em dash rather than `0 min`.

## UC-386 — Activating a strip opens that day
- Area: statistics
- Requirement: 12.9
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: activate a strip by pointer, then reach another by keyboard and press Enter
- Expected: both navigate to `/day/<that date>` as a client-side navigation. Each strip is
  a control with the accessible name `<date>, odpracováno <worked>`, so the target and its
  figure are readable without seeing the picture.

## UC-387 — The rhythm panel gives five figures for a multi-day range
- Area: statistics
- Requirement: 12.10
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: choose `Týden` and read the panel
- Expected: `Dnů s prací`, `Průměr na pracovní den` (averaged over days holding at least
  one `Work_Session`, not over every day in the range), `Nejdelší den`,
  `Nejdelší blok v kuse` (`max(longestBlockSeconds)`) and `Bloků práce celkem`
  (`Σ sessionCount`). Every figure comes from the range payload's summary fields.

## UC-388 — The evening figure lives in the rhythm panel and names the configured hour
- Area: statistics
- Requirement: 12.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK (includes a session after 21:00)
- Steps: read the panel's evening row; then restart the server with `EVENING_HOUR=20` and
  read it again
- Expected: `Po 21:00` over `Σ eveningSeconds` for the range, and after the change
  `Po 20:00` with a figure that grew accordingly. The hour is taken from the server, never
  assumed, and it is the same hour that marks a `noční` block on the day page.

## UC-389 — An empty range shows an empty state rather than an empty chart
- Area: statistics · empty states
- Requirement: 12.12
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-EMPTY
- Steps: open `/stats` and try each of the three ranges
- Expected: a centred empty state — `V tomhle období nic není` over
  `Vyber jiný rozsah nebo spusť timer.` with one filled accent pill — replaces the
  panels. Not a zero-height bar chart, not an axis with nothing on it, not a strip of
  empty rows.

## UC-390 — Every chart's numbers are present as text
- Area: statistics · accessibility
- Requirement: 12.13, 14.11
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: render the page in greyscale (or read only its text content) and try to answer:
  how long was each project, what share, how long was each day, what is the described
  share
- Expected: every one of those answers is available as text — the breakdown prints
  duration and share beside each bar, each rhythm row prints its day total in its gutter
  and carries an accessible name, the coverage meter is accompanied by its percentage.
  No information depends on reading a colour or a length.

## UC-391 — Archived projects holding time in the range are included
- Area: statistics
- Requirement: 12.14
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK with one of the projects archived after its work was logged
- Steps: read the breakdown and check the per-project figures against the range total
- Expected: the archived project appears with its duration and share, so the per-project
  figures reconcile with the `Covered_Time` total. Excluding it would make the rows sum
  to less than the total with no explanation on the page.

## UC-392 — A suggested window is shown when it differs from the configured one
- Area: statistics
- Requirement: 12.15, 12.19
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK replaced by a night-owl pattern (work 22:00 → 04:00 daily), so
  the server's `suggestedWindow` differs from `GAUGE_START`/`GAUGE_END` by more than
  30 minutes at an end
- Steps: read the panel, and look for any control that would apply the suggestion
- Expected: the suggestion renders as
  `Podle posledních týdnů sedí okno 22:00 – 04:00. Nastav GAUGE_START a GAUGE_END v
  konfiguraci serveru a restartuj ho.` — the two values to put in the configuration,
  followed by a restart. There is **no** button that applies it, because the
  `Gauge_Window` has no write endpoint and a control that looked applicable would break
  the moment it was pressed. When the difference is 30 minutes or less at both ends, or
  `suggestedWindow` is `null`, nothing is shown.

## UC-393 — An omitted interval list is a success, not a failure
- Area: statistics
- Requirement: 12.16
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK; the branch is provoked by requesting a range wider than
  `MAX_INTERVAL_RANGE_DAYS` (62 days) directly, since the interface never asks for more
  than a month
- Steps: force a response carrying `intervalsIncluded: false` and load the page
- Expected: the `KPI_Row`, the breakdown and the rhythm panel render in full from the
  summary fields; **no** `Day_Rhythm_Strip` is drawn and its absence is explained in
  place (`Pás se kreslí do 62 dnů.`); and the response is treated as a success — no
  error page, no toast, no retry. The page owns this branch, so `DayRhythm` never has to
  defend itself against missing intervals.

## UC-394 — Uncovered intervals are hatched, so a described day looks different
- Area: statistics
- Requirement: 12.17
- Design_Contract: artboard `Stats` — a 6 × 6 SVG pattern rotated 45°, one 3 px accent
  bar at `fill-opacity: 0.5`, **with no fill beneath it**
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK (one day worked but never described)
- Steps: compare that day's strip with a fully described day's
- Expected: the undescribed day's intervals are drawn in the same geometry with a 45°
  hatch — 3 px of accent, 3 px bare — and the bare half is what makes it read as partly
  described. A solid fill under the hatch closes the texture back up and is wrong. It is
  an SVG `<pattern>` rather than a CSS gradient because the strip is inline SVG.

## UC-395 — The rhythm panel closes with exactly one observation line, or none
- Area: statistics
- Requirement: 12.18
- Design_Contract: `DESIGN.md` § 10 — three templates, first match wins
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: three variants of FIX-UI-WEEK — (a) at least one day with
  `eveningSeconds > 0`; (b) no night work but a `longestBlockSeconds` of at least two
  hours; (c) neither, but at least one day with `trackedSeconds === 0`; (d) none of the
  three
- Steps: read the last line of the rhythm panel in each variant
- Expected: (a) `Práce po 21:00 padla na 2 dny z 5.`; (b)
  `Nejdelší nepřerušený úsek: 4 h 30 min, pátek.`; (c) `Bez práce: 1 den.`; (d) the line
  is **omitted entirely** — not replaced with filler text and not left as blank space
  where it would have been. Exactly one line renders in (a) to (c), never two. Each
  countable noun goes through the Czech plural form and no template puts a verb after a
  number.

## UC-396 — A one-day range drops both rhythm panels and collapses to one column
- Area: statistics
- Requirement: 12.20
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: choose `Den` and read the whole page
- Expected: the `Day_Rhythm_Strip` and the rhythm panel are both absent — a one-row strip
  says nothing the day page does not, and *days worked*, *average per working day* and
  the observation line have nothing to compare. The remaining panels — the `KPI_Row` and
  the project breakdown — lay out in a single column. Both return when `Týden` or
  `Měsíc` is chosen.

## UC-397 — Statistics never offers a range the strip cannot draw
- Area: statistics
- Requirement: 12.1, 12.16
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: try to reach a longer range through the control, through the URL
  (`?range=year`, `?range=quarter`) and through the browser history
- Expected: the control offers only the three; an unrecognised `range` value falls back to
  `week` rather than erroring or requesting a year. The interface therefore never trips
  `MAX_INTERVAL_RANGE_DAYS` itself, and never trips `RANGE_TOO_LARGE`. Known deviation:
  because no range picker can produce one, `RANGE_TOO_LARGE` is unreachable through this
  interface — noted in the phase-1 report as a MEDIUM finding, and handled in one place
  anyway because `/api/days` is a public route with other callers.

## UC-398 — Every user-facing string exists in both languages
- Area: i18n
- Requirement: 13.1
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: compare the key sets of `messages/cs.json` and `messages/en.json`; compare both
  against the Message Catalogue in `design.md`; confirm every key `messageKeyFor` and
  `fieldMessageKeyFor` can emit is present in both
- Expected: identical key sets, no key in one file only, and no key the server can emit
  that is missing from either. The catalogue is the source: a string that is not in it
  does not appear on screen. `fields_invalid` in particular must exist, being the
  fallback an unmapped issue falls through to.

## UC-399 — No user-facing literal text lives outside the message files
- Area: i18n
- Requirement: 13.2
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: search every `.svelte` file under `src/` for a user-facing string literal outside
  a message call
- Expected: none. Every visible label, heading, button, placeholder, `aria-label`,
  `title` and error string comes from `m.<key>()`. A literal that happens to be English
  is the same defect as a literal that happens to be Czech.

## UC-400 — The language is resolved by the server, and the interface never negotiates
- Area: i18n
- Requirement: 13.3
- Preconditions: no cookies
- Data needed: FIX-UI-DAY
- Steps: request a page with `Accept-Language: en-GB` and no `worklog_locale`; then with
  `Accept-Language: de-DE`; then with `worklog_locale=cs` and `Accept-Language: en-GB`;
  then search `src/` outside `src/hooks.server.ts` for any language negotiation
- Expected: English in the first case, **Czech** in the second (the final fallback is
  Czech, not the base locale), Czech in the third — the cookie wins over the header. The
  interface seeds its rune from `locals.locale` and runs no negotiation of its own
  anywhere, `+layout.server.ts` included; two negotiations would disagree and the one
  filling `lang` would not be the interface's.

## UC-401 — Switching language is instant, keeps the scroll, and persists
- Area: i18n
- Requirement: 13.4, 13.5
- Preconditions: logged in on `/day/<TODAY>`, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window`, scroll a few hundred pixels down, open the
  `Settings_Menu`, choose `English`; check the marker, the scroll position, the URL and
  the cookie; then close the browser, reopen and load the page again
- Expected: the text changes to English with no document reload (the marker survives), no
  visible flash, and the scroll position unchanged. The URL is unchanged — no locale
  prefix is added. `worklog_locale=en` is written (a year, `SameSite=Lax`, not
  `HttpOnly`), and the next visit renders English server-side from the first bytes.
  Resolved (run 2026-08-24-0659, verify phase): the `scrollY = 0` reading was a test
  setup bug, not a regression against this criterion — `/projects` at the test's
  default viewport had zero scrollable overflow with this run's seed data, so
  `window.scrollTo(0, 120)` was a no-op regardless of what the locale switch did.
  Fixed by pinning a short viewport (`1280x700` height reduced to 400) before the
  scroll, guaranteeing real overflow; the locale switch itself was not touched. See
  ISSUES.md "`locale.spec.ts`'s scroll-position assertion fails (scrollY reads 0)"
  (RESOLVED).

## UC-402 — The document's lang attribute follows the active language
- Area: i18n · accessibility
- Requirement: 13.6, 13.14
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read `document.documentElement.lang` on load with `worklog_locale=cs`; switch to
  English and read it again without reloading; then reload and read the raw HTML
- Expected: `cs`, then `en` immediately after the switch, and the reloaded document's
  first bytes already carry `lang="en"` — server-rendered from the language the server
  resolved, so hydration never switches the language visibly. A screen reader is told the
  right language for the whole SSR pass, not only after hydration.

## UC-403 — Dates, times and durations are formatted for the active language
- Area: i18n · formatting
- Requirement: 13.7
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read the hero readout, a block's duration, the mobile hero, a preview delta and a
  day heading, in Czech and then in English
- Expected: four duration forms, each used only where the specification names it — the
  running clock (`5:12:08`) on the hero and the tab title; the full duration
  (`2 h 14 min`, under a minute as `< 1 min`) everywhere else; the unit-less short form
  (`14 h 15`) on the mobile hero and the three mobile timer figures only; and the compact
  signed form (`−2 h 00 min`) in the `Change_Preview` only. Day labels take the right one
  of `relative` / `long` / `short` for their surface. The clock form is the only one that
  is not localised.

## UC-404 — A server error renders as the translation of its message key
- Area: i18n · errors
- Requirement: 13.8, 13.11
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: provoke `ACTIVITY_OVERLAP`, `PROJECT_EXISTS` and `SESSION_OVERLAP` in Czech, then
  repeat the same three in English
- Expected: each renders the translation of the `messageKey` the envelope carried, with
  its placeholders filled from `details` — `Překrývá se se záznamem Alpha (08:00 –
  10:15).` and `This overlaps Alpha (08:00 – 10:15).` The raw `error` code never appears
  on screen in either language, and neither does the envelope's English `message` field,
  which exists for shell output.

## UC-405 — No URL carries a language prefix
- Area: i18n
- Requirement: 13.9
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: in each language, visit every page and read the URL; then check for a `reroute`
  hook or a `deLocalizeUrl` call in the source
- Expected: `/`, `/day/<date>`, `/projects`, `/stats`, `/login`, `/offline` — identical in
  both languages, with no `/cs` or `/en` segment. There is no `src/hooks.ts`, no
  `reroute` and no locale prefix: the language lives in a cookie, and a prefix would be a
  second source of truth that could disagree with it.

## UC-406 — The Locale_Switcher shows which language is active
- Area: i18n
- Requirement: 13.10, 14.18
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open the `Settings_Menu` in Czech, read the switcher; switch to English and read
  it again; then reach it by keyboard
- Expected: two items, `Čeština` and `English`, the active one drawn on
  `--segment-active` with accent text at 500 and marked as the checked `radio` of a
  `radiogroup` — so the state is exposed to assistive technology and not carried by
  colour alone. Tab reaches the group once; the arrow keys move between the two.

## UC-407 — Czech plural forms are selected correctly at one, few and many
- Area: i18n
- Requirement: 13.12
- Preconditions: logged in
- Data needed: variants producing counts of 1, 2, 3, 5 and 0 for each counting message
- Steps: exercise `preview_total` (1 / 2 / 5 entries), `preview_parts` (2 / 5 parts),
  `day_segment_part` (part 2 of 3), `projects_meta` (1 / 3 / 8 active),
  `errors_project_in_use` (1 / 3 / 7 entries), `session_delete_body` (0 / 1 / 2 / 5),
  `stats_observation_nights` and `stats_observation_idle` (1 / 3 / 6 days)
- Expected: Czech selects one / few (2–4) / other (5+) correctly for every one —
  `1 záznam`, `2 záznamy`, `5 záznamů`; `část 2 ze 3`; `6 ze 7 dnů`. English takes its
  trivial two-way case. This breaks silently if only English is checked, which is why
  Czech is the language the case is written in.

## UC-408 — No message puts a verb after a number
- Area: i18n
- Method: inspection
- Requirement: 13.13
- Preconditions: none
- Data needed: none
- Steps: read every message in `messages/cs.json` carrying a `{n, plural, …}` selector and
  check what follows the interpolated count
- Expected: every one is a noun phrase — `Nejdelší nepřerušený úsek: {duration}`, never
  `Nejdelší úsek trval {duration}`. A verb after a number makes Czech agreement depend on
  the count as well as the noun, turning one plural choice into two coupled ones. A new
  message that breaks this is a defect even if it reads correctly at the value it was
  written against.

## UC-409 — A boolean-selected message picks the right branch
- Area: i18n
- Requirement: 13.12, 15.15
- Preconditions: logged in
- Data needed: FIX-UI-RUNNING and FIX-UI-SPLIT
- Steps: read the `Day_Gauge`'s `aria-label` with the timer running and with it stopped;
  read a split segment's `aria-label` and an unsplit one's
- Expected: with the timer running the gauge label ends `· timer běží`; stopped, it does
  not. A split segment's label ends `· část 2 ze 3`; an unsplit one's does not. Known
  deviation: these `select` messages were converted to Paraglide's native array form and
  their selectors now compare against the **string** `"true"`, so a call site passing a
  JavaScript boolean falls silently through to the other branch — see ISSUES.md
  "Paraglide plural/select messages use the plugin's native array form".

## UC-410 — Both languages fit every surface they are drawn on
- Area: i18n · layout
- Requirement: 13.1, 14.1
- Preconditions: logged in
- Data needed: FIX-UI-WEEK
- Steps: walk every page in English at `VP-DESKTOP`, `VP-MOBILE` and `VP-NARROW`, then
  repeat in Czech, looking for clipped, wrapped-badly or ellipsised text
- Expected: nothing is truncated with an ellipsis and nothing overflows its surface in
  either language. English is usually shorter but not always — `not described` against
  `bez popisu`, `Longest unbroken block` against `Nejdelší blok v kuse` — so a surface
  too narrow for one of them uses its own short key in **both** languages rather than
  relying on one happening to fit.

## UC-411 — The language survives a logout and a new session
- Area: i18n
- Requirement: 13.5
- Preconditions: logged in with `worklog_locale=en`
- Data needed: FIX-UI-DAY
- Steps: log out, read the login page, log back in
- Expected: the login page renders in English, and the application returns in English
  after logging back in. The locale cookie is independent of the session cookie, so
  logging out does not reset the language.

## UC-412 — Nothing scrolls horizontally from 320 pixels upwards
- Area: responsiveness
- Requirement: 14.1
- Preconditions: logged in, `VP-NARROW` (320 × 720)
- Data needed: FIX-UI-WEEK, FIX-UI-DAY, FIX-UI-ORPHAN
- Steps: at 320 px visit `/`, `/day/<TODAY>`, `/projects`, `/stats`, `/login` and
  `/offline`, in both themes and both languages, and compare
  `document.documentElement.scrollWidth` with `clientWidth`; open each dialog and the
  settings sheet and repeat
- Expected: `scrollWidth <= clientWidth` everywhere — no page scrolls sideways at any
  width from 320 up. Wide content (the rhythm strip, a long project name, a preview's
  before-and-after grid) scrolls inside its own container or wraps.
  Resolved (run 2026-08-24-0659, verify phase): `/` (330px) and `/day/<date>` (362px)
  both fixed — root cause and fix in ISSUES.md "Horizontal overflow at 320px" (RESOLVED).
  Confirmed clean via `tests/e2e/a11y.spec.ts`'s automated sweep (`/`, `/day`,
  `/projects`, `/stats`, dark+light) and, for the parts that sweep doesn't reach, a
  direct check of `/login` (no cookie), `/offline`, and the settings sheet open, in
  both themes, all at exactly 320x700 — all measured `scrollWidth === clientWidth ===
  320`. Not separately re-checked: the English locale specifically (no reason to
  expect it differs — the fix is layout/density-level, not copy-length-dependent) and
  every individual dialog (`AddTask`/`SessionDialog` etc.) at 320px, which the
  automated sweep also doesn't cover.

## UC-413 — Every control has a 44 by 44 activation area, whatever it is drawn at
- Area: accessibility · interaction
- Requirement: 14.2
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: for every interactive control on every page, measure the **activation** area —
  the bounding box including padding and any transparent pseudo-element — not the drawn
  shape
- Expected: at least 44 × 44 for every one. The drawn shape may be smaller and the
  `Design_Contract` deliberately draws chips at 30, close and icon buttons at 32, day
  controls and segmented items at 34, and dialog buttons at 42 — each of those must reach
  44 through padding or a pseudo-element. The two exceptions are the `Segment_Block`
  elements and the `Session_Rail` edges, which take criterion 14.3 instead.

## UC-414 — The timeline's two exceptions are exceptions, and are bounded
- Area: accessibility · day timeline
- Requirement: 14.3, 4.20
- Design_Contract: `DESIGN.md` § 9 row 5 — an explicit exception, not an oversight
- Preconditions: logged in
- Data needed: FIX-UI-MANY
- Steps: measure a floored `Segment_Block` at both densities; measure a `Session_Rail`
  edge; then reduce a block below 60 px and look for the edges
- Expected: a `Segment_Block` is at least `MIN_BLOCK_PX` (36 desktop, 26 mobile) tall and
  spans the **full width** of its column, so the target is wide even where it is short.
  The rail edges take the same exception. **Below a block height of 60 px the edges are
  not rendered at all** and the rail is one target — three stacked targets inside 36 px is
  a lottery, and the `Session_Dialog` is one activation away on the block itself. At
  44 px a fourteen-hour day would stretch past any viewport, which is why the exception
  exists.

## UC-415 — Hover, active and disabled follow one rule across the whole interface
- Area: interaction
- Requirement: 14.4
- Design_Contract: design.md *Interaction States* — the rule is binding because the
  artboards draw resting states only
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: sample a chip, a ghost pill, a panel row, a `Segment_Block` and a filled accent
  control; measure the resting, hover and active surface values and the text token
- Expected: hover raises the surface alpha by **+0.03** and moves the text one level
  brighter (`faint → dim → text`); active raises it by **+0.06** and the element takes
  `transform: none`; a disabled control is the whole element at `opacity: 0.4` with no
  hover, no pointer cursor and `aria-disabled`. On a filled accent control hover is
  `--accent-hover` and active is `--accent-hover` with the halo dropped to 0.06 — there is
  no alpha to raise. On a `Segment_Block` hover raises `--pj-tint` by half again. Every
  interactive element shows the pointer cursor. Known deviation: the alpha derivation is
  implemented two ways — named tokens in `theme.css` and inline `rgb(from … / calc(…))` in
  `src/lib/ui/elements/` — see ISSUES.md "Two different mechanisms for hover/active
  surface-alpha derivation".

## UC-416 — Everything is reachable by keyboard and the focus ring is always visible
- Area: accessibility
- Requirement: 14.5
- Design_Contract: design.md *The Focus Ring* —
  `0 0 0 2px var(--focus-gap), 0 0 0 4px var(--accent)`
- Preconditions: logged in, no pointer used at any point
- Data needed: FIX-UI-DAY
- Steps: Tab through every page in both themes; specifically check the `Timer_Control`,
  the FAB, a primary pill, a `Segment_Block` and a `Palette_Slot` swatch
- Expected: every action is reachable and operable by keyboard alone, and each focused
  element shows an inner ring of its **surrounding** background before the accent ring —
  so the indicator stays visible on an accent-filled control and on a `--pj-tint` in both
  themes. `--focus-gap` is set per surface: `--bg` on the page, `--dialog` inside a dialog
  or the settings menu, `--panel` inside a panel, and the block's own tint on a
  `Segment_Block`.

## UC-417 — Every icon is an inline SVG taken from the artboards
- Area: interaction · design
- Requirement: 14.6, 14.19
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: list every icon the interface renders and compare its geometry with the artboard
  that draws it; check for any icon font, sprite sheet or icon package dependency
- Expected: every icon is inline SVG from the project's own registry, and no icon package
  is installed or imported. The artboards are the source of truth for geometry and no
  icon set is substituted. Known deviation: four glyphs — `search`, `sun`, `moon`,
  `check` — were drawn as fallbacks because no artboard contains them, which contradicts
  this criterion and needs a `.design/` decision rather than a local one; see ISSUES.md
  "Four `Icon.svelte` glyphs have no artboard source".

## UC-418 — Spacing, sizes and radii come from the Design_Contract
- Area: design
- Requirement: 14.7
- Method: inspection plus browser
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: sample the computed radius of every rounded surface and compare against the
  closed list; sample the heights of a field, a dialog button, a segmented item, the
  quick-log pill, the header, the bottom nav, the FAB, a rhythm strip, a meter and a
  breakdown bar; check the day-page side column and the projects content width
- Expected: every radius is one of 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 20, 9999 — **the
  list is closed and a radius outside it is a defect**. Heights are field 44, dialog
  button 42, segmented item 36, quick-log pill 50, header 84 desktop / 56–60 mobile,
  bottom nav 66–68, FAB 54, rhythm strip 22, meter 4, breakdown bar 8. Widths are side
  column 290 and projects content max 940. The contract's off-scale values — 7, 9, 11, 13,
  14, 18, 22, 26, 30, 56, 84, 290, 940 — win wherever it speaks; the 4/8/12/16/24/32/48/64
  scale governs only surfaces the artboards do not cover.

## UC-419 — Hover animates over about 200 ms and panels over about 300 ms
- Area: motion
- Requirement: 14.8
- Preconditions: logged in, `VP-DESKTOP`, reduced motion **not** requested
- Data needed: FIX-UI-DAY
- Steps: read the computed `transition-duration` and `transition-timing-function` of a
  hover state, a dialog entrance, the scrim, the settings sheet, a toast, a coverage
  meter and the gauge's arc sweep
- Expected: colour, background, border, shadow and tint transition over `--dur-hover`
  (200 ms) with `--ease-standard`; anything changing size or position over `--dur-panel`
  (300 ms), leaving with `--ease-exit`; the press scale of the FAB and `Timer_Control` at
  100 ms; the skeleton shimmer at 1.2 s linear. Two curves and three durations, and
  nothing else. The gauge sweeps its arcs once per page load and **never** on the
  per-second tick. The theme swap is deliberately unanimated.

## UC-420 — Reduced motion removes everything that moves or repeats
- Area: motion · accessibility
- Requirement: 14.9
- Preconditions: logged in with `prefers-reduced-motion: reduce` emulated
- Data needed: FIX-UI-DAY
- Steps: open every dialog, the settings sheet and a toast; trigger a skeleton, a meter
  change and a page load with the gauge; press the FAB and the `Timer_Control`; then
  check that hover colour changes still happen
- Expected: every `transform`- and `opacity`-based entrance and exit becomes an instant
  state change with a duration of `0s` and no transform; the skeleton shimmer becomes a
  flat `--panel` fill; the gauge draws its arcs at full length with no sweep; meter and
  bar widths jump; the press scale is dropped. What **survives** is colour — the
  `--dur-hover` transitions of hover, active and focus — because those signal state
  rather than movement, and removing them makes the interface feel broken rather than
  calm. Verify across surfaces, not on one panel.

## UC-421 — Body text clears 4.5 to 1 in both themes
- Area: accessibility · theming
- Requirement: 14.10, 17.3
- Preconditions: logged in
- Data needed: FIX-UI-WEEK
- Steps: run an automated contrast pass over `/`, `/day/<TODAY>`, `/projects` and `/stats`
  in both themes, then hand-measure `--text-dim` and `--text-faint` against `--bg` and
  against `--dialog` in each
- Expected: every body-text surface reaches at least 4.5:1. The measured token pairs are
  dark 0.62 → 6.44:1 and 0.50 → 4.63:1 on `#0F1319`; light 0.78 → 6.84:1 and 0.66 →
  4.69:1 on `#F3EEE6`. The one deliberate exception is the `Day_Gauge`'s numerals, which
  are specified below body-text contrast (UC-466) — everything else must clear it.
  Resolved (run 2026-08-24-0659, verify phase): the "three violations" were actually a
  wider `--text-faint`-on-`--pj-tint` gap across all 8 `Palette_Slot` hues in both
  themes, plus the accent-on-tint pairing used by the `Uncovered_Marker`,
  `Settings_Menu`, `ChangePreview`, `DataTable` and `DayRhythm` — see ISSUES.md "Three
  real WCAG contrast violations were actually a systemic --text-faint/--pj-tint gap"
  (RESOLVED) for the full scope and the token-level fix (`--text-faint` 0.5/0.66 →
  0.56/0.7; new `--accent-on-tint` token). `tests/e2e/a11y.spec.ts`'s axe sweep over
  all four pages in both themes now passes with zero `color-contrast` violations.

## UC-422 — No information is carried by colour alone
- Area: accessibility
- Requirement: 14.11, 17.12
- Preconditions: logged in
- Data needed: FIX-UI-SPLIT, FIX-UI-RUNNING, FIX-UI-NINE
- Steps: render every page in greyscale and answer: which project is which; which stretch
  is undescribed; which block is running, capped or continuing; which entry is split;
  which control is destructive; which segmented item is selected; which day is today
- Expected: every one is answerable from text or shape. Projects carry names; uncovered
  time is a **dashed outline** against a primary action's **filled** shape, both in
  accent; running / capped / continuing each carry their own string as well as their rail
  treatment; a split entry carries `část 2 ze 3`; a segmented item is a checked radio;
  today's rhythm row carries an inset outline as well as an accent label. Nothing needs a
  hue to be read.

## UC-423 — The interface is mobile-first with exactly one breakpoint
- Area: responsiveness
- Method: inspection
- Requirement: 14.12
- Preconditions: none
- Data needed: none
- Steps: search the stylesheets for every media query width and confirm which direction
  they are written in
- Expected: one width appears — 768 px — and the queries are `min-width` (mobile-first),
  not a scatter of `max-width` breakpoints. There is no tablet tier, no 1024 and no 1280.
  The single breakpoint is what makes `VP-MOBILE` and `VP-NARROW` behave identically
  apart from available width.

## UC-424 — Required fields are marked required
- Area: forms · accessibility
- Requirement: 14.13
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: inspect every field of the `Activity_Dialog` in all three modes, the
  `Session_Dialog`, the project create and rename fields, and the login passphrase field
- Expected: each required field carries the `required` attribute (or `aria-required`) and
  is marked visibly, and the marking follows the active mode — `od` and `do` are required
  in `Explicit_Mode` and not offered at all in the other two, and the duration is
  required only in `Duration_Mode`. The description is never required.

## UC-425 — Leaving a form with unsaved input asks first
- Area: forms
- Requirement: 14.14
- Preconditions: logged in on `/day/<TODAY>`
- Data needed: FIX-UI-DAY
- Steps: open the `Activity_Dialog`, type a description, then try to navigate away using
  the top-bar navigation; cancel; try again and accept
- Expected: a confirmation appears — `Zahodit rozepsané?` over
  `Máš rozepsaný formulář, který se neuložil.` — before the navigation happens.
  Cancelling leaves the dialog open with the typed text intact; accepting navigates and
  discards it. This is the criterion the scrim rule (UC-435) exists to protect.

## UC-426 — Below 768 the write dialogs fill the screen
- Area: dialogs · responsiveness
- Requirement: 14.15
- Design_Contract: artboard `AddTaskMobile` (390 × 844)
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: open the `Activity_Dialog` and the `Session_Dialog` and measure the header, the
  body, the fields, the segmented items and the footer
- Expected: the dialog **is** the viewport — no scrim behind it and no radius, because
  nothing shows through. Header 58 px tall with `padding: 0 20px` and a 34 px close
  button; body `0 20px`, scrolling; fields one per row at 48 px and 15 px type,
  `gap: 14`; caps labels 10; segmented items 40 at 12.5 px; description field 62; footer
  pinned to the bottom edge at `padding: 14px 20px 24px` over a `--divider` hairline,
  with its buttons **stacked** — primary 50 px on top, `Zrušit` 46 px beneath,
  `gap: 10`. The `Change_Preview` keeps its **full** form, policy control included: it is
  the reason the dialog exists.

## UC-427 — The viewport cookie makes the server-rendered day deterministic
- Area: responsiveness · day timeline
- Requirement: 14.16
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: request `/day/<TODAY>` with no `worklog_viewport` cookie and read the rendered
  density and block heights from the HTML **before** any script runs; then repeat with
  `worklog_viewport=390x844`
- Expected: with no cookie the server assumes **1440 × 900**, resolving to
  `density: 'desktop'` and `availablePx = 900 − 84 − 56 − 48 = 712`, and the served HTML
  already carries desktop block heights from the `tl-h-*` ladder. With the mobile cookie
  it serves mobile density. The first paint is decided on the server in both cases, not
  corrected afterwards.

## UC-428 — The client relays out only when its measurement differs
- Area: responsiveness
- Requirement: 14.17
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: load `/day/<TODAY>` at exactly 1440 × 900 with the matching cookie and watch for
  a relayout or a cookie write; then load at 1280 × 800 with the same cookie and watch
  again
- Expected: at the matching size **nothing happens** — no cookie write, no second layout
  pass, no visible shift; a returning desktop user sees no relayout at all. At the
  differing size the client writes `worklog_viewport=1280x800` (path `/`, one year,
  `SameSite=Lax`) and lays the page out again with the new budget.

## UC-429 — Every segmented control is a radio group
- Area: accessibility · forms
- Requirement: 14.18
- Preconditions: logged in
- Data needed: FIX-UI-WEEK
- Steps: inspect the `Theme_Switcher`, the `Locale_Switcher`, the activity mode control,
  the `Untracked_Policy` control and the statistics range control; reach each by keyboard
- Expected: each is `role="radiogroup"` holding `role="radio"` items with `aria-checked`.
  Tab reaches the group **once** and the arrow keys move between its options — not one
  tab stop per option. The selected item is exposed as checked, so its state does not
  depend on the `--segment-active` fill being seen.

## UC-430 — Every dialog declares itself a modal dialog labelled by its own heading
- Area: accessibility · dialogs
- Requirement: 14.20
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: inspect the `Activity_Dialog`, the `Session_Dialog`, the delete-entry
  confirmation, the delete-session confirmation, the unsaved-changes confirmation and the
  mobile `Settings_Menu` sheet
- Expected: each carries `role="dialog"`, `aria-modal="true"` and an `aria-labelledby`
  pointing at its own heading element. This is asserted here rather than inherited: the
  ported `Modal` happens to implement most of it, which is a fact about the template and
  not a contract — without an assertion it can be lost silently.

## UC-431 — Opening a dialog moves focus into it and Tab stays inside
- Area: accessibility · dialogs
- Requirement: 14.21
- Preconditions: logged in, no pointer used
- Data needed: FIX-UI-DAY
- Steps: open the dialog five ways — from `+ Přidat úkol`, from a `Segment_Block`, from a
  rail **start** edge, from an `Uncovered_Marker`, and from `Quick_Log` with no project —
  and read `document.activeElement` each time; then Tab and Shift+Tab past both ends
- Expected: focus lands on the field the action named — the first control for a plain
  open, `začátek` (selected) from a start edge, the description from an uncovered
  stretch, the `Project_Picker` from a projectless `Quick_Log` — and otherwise on the
  first focusable control. Tab and Shift+Tab wrap **inside** the dialog and never reach
  the page beneath, in either direction.

## UC-432 — Escape closes every dialog and returns focus to its opener
- Area: accessibility · dialogs
- Requirement: 14.22, 6.15
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: for each of the two write dialogs, each confirmation and the `Settings_Menu`,
  note the opener, open it, press Escape, read `document.activeElement`
- Expected: all of them close on Escape and focus returns to the exact control that
  opened them. A dialog that closes but drops focus to `document.body` fails this case.

## UC-433 — The scrim dismisses a confirmation but never a write dialog
- Area: dialogs
- Requirement: 14.23, 14.14
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: open the `Activity_Dialog`, type a description, click the scrim; open the
  `Session_Dialog`, change a time, click the scrim; open a delete confirmation and click
  the scrim; open the `Settings_Menu` and click outside it
- Expected: the two **write** dialogs do nothing at all on a scrim activation — they hold
  unsaved input and criterion 14.14 forbids losing it to a stray click. The confirmation
  and the `Settings_Menu` both close, because neither holds anything.

## UC-434 — While a modal surface is open, everything beneath it is unreachable
- Area: accessibility · dialogs
- Requirement: 14.24
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: with each of a write dialog, a confirmation and the mobile settings sheet open,
  try to scroll the page behind, Tab past the surface's last control, click a control
  behind the scrim, and inspect the page root's attributes
- Expected: `document.body` carries `overflow: hidden` so nothing scrolls behind; the page
  root carries `inert`, so pointer, keyboard **and** screen reader all reach only that
  surface. The `inert` is also what stops the bottom navigation being tabbable underneath
  a sheet, which no `z-index` can fix.

## UC-435 — Statistics and projects have their own mobile layouts
- Area: responsiveness
- Requirement: 14.25
- Design_Contract: design.md *Statistics and Projects, Mobile* — binding in place of an
  artboard, because neither page has one
- Preconditions: logged in, `VP-MOBILE`
- Data needed: FIX-UI-WEEK
- Steps: read `/stats` and `/projects` at 390 px, then at 320 px
- Expected: on `/stats` the `KPI_Row` becomes `repeat(2, 1fr)` with `gap: 12`, panels
  padded `14px 16px`, the figure at 22/300 and the caps label at 10; the range control
  spans the full width with 36 px items; the breakdown and rhythm panel **stack** at one
  column; a breakdown row wraps onto two lines with its 8 px bar beneath both; and the
  `Day_Rhythm_Strip` axis carries **three** labels — the day-start hour at each end plus
  one interior tick at 50 % — rather than five, keeping the same even-division rule. On
  `/projects` each row is two lines inside `padding: 12px 14px` — icon box, name and any
  archived badge on the first; the thirty-day total, the share bar and a single 32 px
  overflow control on the second — with the three row actions behind that control, and
  the colour strip still expanding inside the row it changes, as two rows of four.

## UC-436 — Both densities are reachable from one build without a reload
- Area: responsiveness
- Requirement: 14.12, 14.17
- Preconditions: logged in on `/day/<TODAY>` at `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: resize the window across 768 in both directions without reloading, watching the
  navigation, the timeline density, the side panels and the create actions
- Expected: crossing 768 downwards swaps the centred navigation for the bottom bar, moves
  the side panels below the timeline and switches the timeline to mobile density; crossing
  upwards reverses it. No reload happens, no layout is left half-converted, and the
  `worklog_viewport` cookie is updated once per settled size rather than on every resize
  frame.

## UC-437 — A client-side navigation shows a skeleton shaped like the content
- Area: feedback · loading
- Requirement: 15.1
- Preconditions: logged in, the server's response artificially delayed
- Data needed: FIX-UI-WEEK
- Steps: navigate between two days with the previous-day control; switch the statistics
  range; trigger an `invalidate` by writing an entry; then reload the page from scratch
  and watch the first paint
- Expected: the first three show a skeleton in the **shape and radius** of the block it
  stands in, on `--panel`, with a 1.2 s shimmer sweeping left to right — never a spinner.
  The full reload shows **no** skeleton at all: a server-rendered first load arrives
  complete, and nothing renders a skeleton on mount. Skeletons have exactly three callers
  and those are they.

## UC-438 — A submitted action disables its control and shows progress on it
- Area: feedback · loading
- Requirement: 15.2
- Preconditions: logged in, the server's response artificially delayed
- Data needed: FIX-UI-DAY
- Steps: submit the `Activity_Dialog`, the `Session_Dialog`'s confirm, a project rename
  and the start action, watching each control during the flight
- Expected: the submit control is disabled for the whole flight and shows progress on
  itself, so a second press cannot double-submit. It re-enables when the action settles,
  in success or failure.

## UC-439 — A success is confirmed briefly and dismisses itself
- Area: feedback
- Requirement: 15.3
- Design_Contract: design.md *Toast* — bottom right on desktop, bottom centre on mobile
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: save an entry, delete an entry, rename a project; watch each confirmation
- Expected: a toast appears — `--dialog` at radius 14 with the dialog shadow,
  `padding: 12px 16px`, text 13.5, a 15 px leading icon, `max-width: 420` — carrying
  `Uloženo` or `Smazáno`, with **no** action and no close button, and it dismisses itself
  after about four seconds. The user is never made to acknowledge a success.

## UC-440 — A failure shows the reason, keeps the input, and stays until dismissed
- Area: feedback · errors
- Requirement: 15.4
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: submit a write that the server refuses; read the message, the form and the toast;
  wait ten seconds
- Expected: the reason renders as the translation of the server's `messageKey`, every
  field keeps what was typed, and focus moves to the field concerned when the failure
  names one. A failure toast carries a text action in `--accent` and **never**
  auto-dismisses — a message the user did not see is the same as no message.

## UC-441 — An overlap conflict names the records and offers to open one
- Area: feedback · errors
- Requirement: 15.5, 8.5
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: create an entry overlapping the Alpha entry and submit; then make a session
  change that overlaps another session
- Expected: the conflicting record is named — the project and the interval for an
  activity, the interval for a session — and the interface offers `Otevřít záznam`, which
  opens the conflicting entry so the user can resolve it. Nothing is written in either
  case.

## UC-442 — A write that lost part of itself says so rather than claiming success
- Area: feedback
- Requirement: 15.6
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: save a `Duration_Mode` entry longer than the tracked time available, with the
  policy left at `Zahodit`; then save an entry whose remainder falls under
  `MIN_INTERVAL_SECONDS`
- Expected: the confirmation is qualified, not plain — `Uloženo, ale 2 h 00 min se
  nevešlo` — naming what did not fit and offering to open the affected range. A write
  reporting `discarded` intervals, `unplacedMinutes` or dropped `slivers` is never shown
  as an unqualified success.

## UC-443 — An unreachable server says so and lets the user retry without losing anything
- Area: feedback · errors
- Requirement: 15.7
- Preconditions: logged in, `Activity_Dialog` open with a description typed
- Data needed: FIX-UI-DAY
- Steps: stop the server, submit, read what happens; restart it and use the retry
- Expected: the failure surfaces where the user is — a toast with a retry action, the
  dialog still open and every typed value intact. The retry re-submits the same input and
  succeeds. The interface does **not** navigate to `/offline` from here; that is reserved
  for a page `load` that fails, where there is no input to lose.

## UC-444 — Every destructive action is confirmed by naming what is lost
- Area: feedback
- Requirement: 15.8
- Preconditions: logged in
- Data needed: FIX-UI-DAY, FIX-UI-ORPHAN, FIX-PROJECTS
- Steps: attempt to delete an `Activity_Entry`, a `Work_Session`, an `Orphaned_Entry` and
  a `Project`; read each confirmation
- Expected: each names the record **and** what disappears with it — the entry's project,
  interval and duration; the session's interval and how many entries lose time; the
  project's name and that nothing disappears with it. Never a bare "are you sure". Every
  confirm pill for a destructive action is filled in `--destructive` with
  `--ink-on-accent` text, never in the accent.

## UC-445 — Every error code the server can emit has a defined behaviour
- Area: errors
- Requirement: 15.9
- Preconditions: logged in
- Data needed: whatever provokes each code
- Steps: provoke each code the interface can reach and record where it surfaces:
  `VALIDATION_ERROR`, `INVALID_INTERVAL`, `ACTIVITY_OVERLAP`, `SESSION_OVERLAP`,
  `OUTSIDE_TRACKED_TIME`, `NO_PLACEMENT_ANCHOR`, `SESSION_ALREADY_RUNNING`,
  `NO_SESSION_RUNNING`, `PROJECT_EXISTS`, `PROJECT_IN_USE`, `PROJECT_ARCHIVED`,
  `FUTURE_TIMESTAMP`, `INTERVAL_TOO_SHORT`, `STALE_PREVIEW`, `NOTHING_TO_LOG`,
  `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `UNAUTHORIZED`,
  `SERVICE_UNAVAILABLE`, `RANGE_TOO_LARGE`
- Expected: each surfaces where the design's error table says and behaves as it says —
  field-level messages beside the field with the input kept; `ACTIVITY_OVERLAP` naming
  the conflict and offering to open it; `OUTSIDE_TRACKED_TIME` shown with the
  `Untracked_Policy` choice; `STALE_PREVIEW` recomputing and re-asking;
  `PROJECT_IN_USE` offering archiving; `RATE_LIMITED` as a toast carrying the retry
  delay; `INTERNAL_ERROR` as a toast with a retry action that keeps the input and quotes
  the `requestId`; `UNAUTHORIZED` navigating to login with `reason=session_expired`;
  `SERVICE_UNAVAILABLE` sending a page load to `/offline` and a later request to a
  retryable toast carrying `Retry-After`. `AMBIGUOUS_MODE`, `METHOD_NOT_ALLOWED` and
  `IDEMPOTENCY_KEY_REUSED` cannot occur through this interface and are treated as
  internal errors if they do; `RANGE_TOO_LARGE` is likewise unreachable (UC-397) and is
  handled anyway.

## UC-446 — The projects page has an empty state
- Area: feedback · empty states
- Requirement: 15.10
- Preconditions: logged in
- Data needed: FIX-UI-EMPTY
- Steps: open `/projects`
- Expected: as UC-376 — a centred empty state with an icon, a line and one filled accent
  pill as the next step. Every empty state in this interface has a next step: start the
  timer, create the first project, pick another range.

## UC-447 — An uncaught client error uses the same surface as a failed request
- Area: errors
- Requirement: 15.11
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: force a client-side exception during rendering or in an event handler
- Expected: `hooks.client.ts` catches it and the interface's own error page renders,
  never a blank page and never an unhandled console trace with a broken layout. The page
  shows no stack trace, no file path and no framework internals.

## UC-448 — A field rejection renders the server's key, not the validator's English
- Area: errors · forms
- Requirement: 15.12
- Preconditions: logged in with the interface in Czech
- Data needed: FIX-UI-DAY
- Steps: submit a description over the length limit, a malformed date, a malformed time
  and an unknown field; read each message
- Expected: each renders the translation of the key the server supplied in
  `details.fields[name]` — `Nejvíc 500 znaků.`, `Zadej datum ve tvaru RRRR-MM-DD.`,
  `Zadej čas ve tvaru HH:MM.`, `Tohle pole sem nepatří.` The shared Zod schema's own
  English sentence — written deliberately for a REST caller's shell output — never
  reaches the screen. An issue with no mapping falls back to `Tahle hodnota nesedí.`
  rather than rendering nothing.

## UC-449 — The toast container is a live region before any toast exists
- Area: accessibility · feedback
- Requirement: 15.13
- Method: browser plus screen reader
- Preconditions: logged in with a screen reader running
- Data needed: FIX-UI-DAY
- Steps: load the page and inspect the DOM **before** any toast is triggered; then trigger
  a success and then a failure, listening each time
- Expected: two containers are present and empty at first paint in the root layout —
  `role="status"` with `aria-live="polite"` for success and `role="alert"` with
  `aria-live="assertive"` for failure, each toast `aria-atomic="true"`. Both messages are
  announced. A live region created at the moment its first message arrives is not
  announced by most screen readers, which is the failure this criterion exists to
  prevent, and it is invisible unless a screen reader is actually running.

## UC-450 — The Change_Preview announces its outcome once, and not its intermediate states
- Area: accessibility · preview
- Requirement: 15.14
- Method: browser plus screen reader
- Preconditions: logged in with a screen reader running, dialog open
- Data needed: FIX-UI-DAY
- Steps: type a time in five quick keystrokes and listen through the debounce and the
  round trip
- Expected: the preview body is `aria-live="polite"` and carries `aria-busy` while the
  `Dry_Run` is in flight, so the intermediate renders of the debounced sequence are
  suppressed. Exactly **one** polite announcement of the settled headline outcome is
  heard, not one per keystroke.

## UC-451 — No ticking value is ever announced
- Area: accessibility · timer
- Requirement: 15.15
- Method: browser plus screen reader
- Preconditions: logged in with a screen reader running
- Data needed: FIX-UI-RUNNING
- Steps: sit on the timer page for thirty seconds and listen; then move to the day page
  and listen to the `Running_Indicator`; then stop the timer and listen
- Expected: silence while the digits advance. The hero readout, the `Running_Indicator`
  and the tab title sit in **no** live region and have their digits `aria-hidden="true"`;
  none has a live-region ancestor. The state of the timer is carried instead by the
  `Timer_Control`'s accessible name and by the `Day_Gauge`'s text alternative, both of
  which change only when the timer starts or stops — and that change **is** announced.

## UC-452 — Twenty-four hours map onto the full circle at a fixed fifteen degrees an hour
- Area: gauge
- Requirement: 16.1, 16.18; design Property 1
- Preconditions: logged in
- Data needed: FIX-UI-DAY and FIX-UI-NIGHT
- Steps: read the drawn angle of a known instant on two different days and compare;
  compute the angular difference between two instants an hour apart, and between two a
  full day apart
- Expected: `angle(t) = 45 + minutesSinceMidnight × 0.25` — one hour is exactly 15°, the
  mapping is strictly increasing and uniform, and 06:00 lands at 135°, 09:00 at 180°,
  15:00 at the top and 21:00 at the right on **every** day. Two days can therefore be
  compared by shape alone. Note the wording trap: `design.md`'s Property 1 says a 24-hour
  difference "SHALL equal exactly 360", while the DST-safe implementation returns 0 —
  see ISSUES.md "design.md's Property 1 wording contradicts `angleOf`'s required
  periodicity". The code is right and the sentence is the defect.

## UC-453 — The track covers the window and the gap carries nothing at all
- Area: gauge
- Requirement: 16.2, 16.9; design Property 3
- Design_Contract: `DESIGN.md` § 5
- Preconditions: logged in
- Data needed: FIX-UI-DAY, with `GAUGE_START=06:00` and `GAUGE_END=00:00`
- Steps: read every graduation, numeral and groove the gauge emits and test each against
  `((angle − trackStart) mod 360) ≤ ((trackEnd − trackStart) mod 360)`; repeat with a
  window that crosses midnight differently, such as `08:00 → 02:00`
- Expected: a 270° track and a 90° bare gap with the default window. Every mark and label
  lies on the track; **nothing** — no groove, no tick, no numeral — falls inside the gap,
  under any window the server can report. The wrapping test is the correct one: a naive
  `trackStart ≤ angle ≤ trackEnd` describes an empty interval whenever the window crosses
  midnight.

## UC-454 — The gap sits at the bottom of the circle
- Area: gauge
- Requirement: 16.3
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read where the track begins and ends on screen
- Expected: with the default window the opening is centred on 03:00 at the bottom, so the
  reading runs from a visible start on one side to a visible end on the other rather than
  wrapping through a hidden seam.

## UC-455 — Two arcs at fixed radii, the inner one coloured by project
- Area: gauge
- Requirement: 16.4
- Design_Contract: artboards `GaugeNormal`, `GaugeOverrun`, `GaugeNonstop` — geometry is
  read from these three and placement from `Main`; `Demo` and `DemoSideBySide` shrink the
  gauge for a teaching layout and are **not** geometric references
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read the emitted SVG attributes of the outer and inner arcs
- Expected: box 340 × 340 (mobile 300), `viewBox="-22 -22 364 364"`, centre 160/160. The
  outer arc for `Work_Session` records is at radius **138** with a stroke of **10**; the
  inner arc for `Activity_Segment` records is at radius **118** with a stroke of **6**,
  each in the `--pj` of its project's slot. Both grooves are drawn over the window only —
  `--groove-outer` at 10 and `--groove-inner` at 6, round-capped.

## UC-456 — The accent marks a running timer, not overtime
- Area: gauge
- Requirement: 16.5
- Preconditions: logged in
- Data needed: FIX-UI-DAY (all closed) then FIX-UI-RUNNING
- Steps: read the outer arc colours in both fixtures
- Expected: every closed `Work_Session` draws in `--arc-closed`
  (`rgba(230,234,242,0.34)` dark). Only the `Open_Session` draws in `--accent`, and it is
  emitted **after** the closed arcs so it is never painted over. With no session open —
  `GaugeNormal`'s state — no accent appears on the outer ring at all, however much
  overtime the day holds.

## UC-457 — Uncovered time is a dashed accent stroke on the inner arc
- Area: gauge
- Requirement: 16.6
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read the emitted stroke, dash pattern and cap of the uncovered arcs, and their
  paint order
- Expected: `--uncovered-dash` (accent at 65 %, light theme 75 %) at a 6 px stroke with
  `stroke-dasharray="3 6"` and `stroke-linecap="round"`. The dashes are emitted **last of
  all** on the inner ring, so a floored segment can never hide undescribed time — which
  is the thing the page exists to surface.

## UC-458 — The dial is graduated at three levels, each with its own weight
- Area: gauge
- Requirement: 16.7
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: measure every graduation's length, width and ink
- Expected: three levels, not two — hourly at length 4, width 1.1, `--dial-hour`;
  three-hourly (09, 15, 21) at 8, 1.3, `--dial-3h`; six-hourly (06, 12, 18, 00) at 10,
  1.5, `--dial-6h`. All run outward from r = 146, to 150, 154 and 156 respectively.

## UC-459 — Numerals are two-digit hours, every third hour, and 03 is never drawn
- Area: gauge
- Requirement: 16.8
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: read every text element the gauge emits
- Expected: exactly `06 09 12 15 18 21 00` — two-digit hours with no minutes, outside the
  graduations, three-hourly at r = 166 and six-hourly at r = 168 (tick end plus 12 in both
  cases), each baseline-shifted by +0.35 em. `03` is **never** drawn, because it falls in
  the gap.

## UC-460 — Work outside the window hangs in the gap without rescaling anything
- Area: gauge
- Requirement: 16.10
- Design_Contract: artboard `GaugeOverrun`
- Preconditions: logged in
- Data needed: FIX-UI-OVERRUN (05:00–06:30 before the window, 23:00–01:30 past it)
- Steps: read the arcs and compare the position of a 09:00 instant with the same instant
  under FIX-UI-DAY
- Expected: **two** `Overtime_Arc` stretches are drawn in the gap — one before
  `GAUGE_START` and one after `GAUGE_END` — at the same stroke widths as the track's
  arcs. Nothing is clipped, nothing is rescaled and no graduation is added: the 09:00
  instant sits at exactly the same angle in both fixtures. Work in the gap reads as
  leaving the expected window rather than continuing along a scale.

## UC-461 — Each overtime arc marks where it left the track and labels its far end
- Area: gauge
- Requirement: 16.11
- Preconditions: logged in
- Data needed: FIX-UI-OVERRUN
- Steps: read the dots and the labels
- Expected: a filled `r=4` accent dot at each `Gauge_Track` end an arc left, and one
  12/500 accent label at r = 162 on each arc's far end — the earlier arc labels its
  **start**, the later one its **end**, since those are the two instants the gap cannot
  be read against. One dot and one label per arc, so a two-overrun day carries two of
  each.

## UC-462 — A full day closes the circle and the gap stays bare
- Area: gauge
- Requirement: 16.12
- Design_Contract: artboard `GaugeNonstop` — redrawn for exactly this, `DESIGN.md` § 9
  row 8 is the one row where the spec won
- Preconditions: logged in
- Data needed: FIX-UI-NONSTOP
- Steps: read the outer ring's emitted element and every graduation
- Expected: the outer arc is emitted as a `<circle>`, not an arc back to its own start
  point — that path is degenerate and paints nothing. The ring is complete, and the gap
  still carries no groove, no graduation and no numeral. The reason the gap is bare does
  not stop applying when the day happens to be full. Known deviation: `arc()` is scoped to
  single-day spans and silently floors a ≥24 h span to 1.5°, so the component must detect
  the degenerate case itself rather than delegating — see ISSUES.md
  "`gauge-geometry.ts`'s `arc()` is scoped to single-day spans".

## UC-463 — The control sits at the exact centre with clear space around it
- Area: gauge
- Requirement: 16.13
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: measure the control's centre against the arc centre, its diameter against the
  gauge box, its icon and its halo, at both densities
- Expected: the control's centre coincides with the arc centre (160/160 in `viewBox`
  units). It is **104 px with a 42 px icon** on desktop and **98 / 40** on mobile, with a
  halo at **11 % of its own diameter** in `rgba(accent,0.09)` — `0 0 0 12px` and
  `0 0 0 11px`. The rule is a **ratio, not a distance**: the diameter stays at or below
  **0.31 of the gauge box** (104/340 and 98/300). The clear space that leaves — about
  66 px at 340 and about 48 px at 300 — is a consequence of the box size, and quoting 66
  as an absolute would make the correct mobile gauge look broken. The control was
  deliberately reduced from 132 and must not be enlarged past the ratio.

## UC-464 — The elapsed time is above the circle, never inside it
- Area: gauge
- Requirement: 16.14
- Preconditions: logged in
- Data needed: FIX-UI-RUNNING
- Steps: locate the hero readout relative to the gauge's bounding box
- Expected: the readout sits above the circle in the page's flow, outside the SVG. The
  centre of the circle holds the `Timer_Control` and nothing else — no digits, no
  caption, no second figure.

## UC-465 — The dial reads as background orientation, not as data
- Area: gauge · design
- Requirement: 16.15
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: measure the numerals' contrast against the page ground in both themes, and their
  rendered CSS size
- Expected: `--dial-numeral` measures about **1.5:1** — deliberately far below the 4.5:1
  demanded of body text — and a 12-unit numeral renders at about **11.2 CSS px** on
  desktop and **9.9** on mobile, because the 364-unit box is painted into 340 and 300.
  This is the one place the interface is required **not** to reach AA, and an automated
  contrast pass must be told so rather than "fixed".

## UC-466 — Hovering an inner arc names its project and its times
- Area: gauge
- Requirement: 16.16
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: hover an inner arc and read the label; check where it is anchored
- Expected: a tooltip naming the `Project` and the arc's times, anchored at
  `pointAt(midAngle, 118)` in the gauge's coordinate space converted to page coordinates
  — an SVG `<path>` has no layout box, so the component positions it itself. This is an
  **enhancement over** the `Project_Legend`, which is what carries project identity in
  text; on a touch device with no hover, nothing is lost.

## UC-467 — The Gauge_Window comes from the server
- Area: gauge
- Requirement: 16.17
- Preconditions: logged in
- Data needed: FIX-UI-DAY, run once with `GAUGE_START=06:00 GAUGE_END=00:00` and once
  with `08:00 → 22:00`
- Steps: read the track's extent, the graduations and the numerals in each configuration
- Expected: the track, the gap, the graduations and the numerals all follow the
  configured window, which the interface reads from the `Health_Endpoint` and never
  assumes. With `08:00 → 22:00` the track is 210°, the gap is 150°, and `06:00` is no
  longer numbered because it now falls in the gap.

## UC-468 — The gauge is one image with a summary, and its arcs are decorative
- Area: gauge · accessibility
- Requirement: 16.19
- Preconditions: logged in with a screen reader running
- Data needed: FIX-UI-RUNNING then FIX-UI-DAY
- Steps: read the gauge's role and label; Tab through the page; read each arc's
  attributes
- Expected: the whole gauge is a single `role="img"` whose `aria-label` summarises the
  day — `Den <date>: odpracováno <worked>, popsáno <covered>, chybí popis <uncovered> ·
  timer běží` — with the running clause present only while a session is open. Every arc
  inside carries `aria-hidden`, and no arc is a tab stop: an SVG `<path>` is not focusable
  and thirty individually announced arcs would be unusable even if it were. Project
  identity is carried by the `Project_Legend` below, which is why the legend is not
  optional.

## UC-469 — A one-minute segment is still visible on the inner arc
- Area: gauge
- Requirement: 16.4, 16.6
- Preconditions: logged in
- Data needed: FIX-UI-DAY plus one `Activity_Entry` of exactly two minutes
- Steps: read the emitted arc for that segment and compare its sweep with the true
  duration; then compare the durations printed in the legend and the three figures
- Expected: an arc whose true sweep is under **1.5°** (six minutes) is drawn *at* 1.5°,
  centred on its true midpoint, so a round-capped 6 px stroke does not swallow the mark
  it caps. `MIN_INTERVAL_SECONDS` defaults to 60, so this case is reachable rather than
  theoretical. The floor is **cosmetic and never changes a number**: the legend, the three
  figures and the gauge's text alternative all report the true duration. Floored arcs may
  overlap, and paint order settles it — inner arcs in chronological order of their
  interval start, uncovered dashes last.

## UC-470 — The gauge draws the same picture the day page draws
- Area: gauge · day timeline
- Requirement: 16.1, 4.1
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY
- Steps: put the timer page and `/day/<TODAY>` side by side and reconcile: the number of
  sessions, their bounds, which project covers what, and the three totals
- Expected: the two readings agree on every fact even though they give up different
  things — the gauge keeps time proportional everywhere and sacrifices legibility of
  short entries; the timeline keeps entries legible and sacrifices proportionality across
  breaks. Neither may be "fixed" by making it behave like the other, but a disagreement
  about **what happened** is a defect in one of them.

## UC-471 — Both themes define the complete token set
- Area: theming
- Requirement: 17.1
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: read the `[data-theme='dark']` and `[data-theme='light']` blocks in
  `theme.css` and compare their key sets against each other and against the design's
  token tables
- Expected: both define every token — background, text, dim text, faint text, accent,
  accent hover, ink on accent, panel, dialog, scrim, field, active field, divider and
  destructive — plus every surface token (`--chip`, `--menu-border`, `--menu-shadow`,
  `--dialog-shadow`, `--grabber`, `--group`, `--segment-active`, `--footer`, `--row`,
  `--track`, `--meter-track`, `--hairline`) and every gauge token (`--rail`,
  `--arc-closed`, the two grooves, the three dial levels, `--dial-numeral`,
  `--uncovered-dash`). No key exists in one theme only, and every value matches the
  design table exactly.

## UC-472 — Every colour is drawn from a custom property, never from a literal
- Area: theming
- Requirement: 17.2
- Method: inspection
- Preconditions: none
- Data needed: none
- Steps: search every `.svelte` and `.css` file under `src/` for a hex, `rgb()` or
  `hsl()` literal outside `theme.css` and the generated `palette.css`
- Expected: none. Every colour the interface draws resolves through a custom property, so
  a theme swap is one attribute write. A literal at a point of use is a defect even when
  it happens to equal the dark theme's value — it will be wrong the moment the light
  theme renders.

## UC-473 — The light theme uses its own higher dim and faint opacities
- Area: theming · accessibility
- Requirement: 17.3, 14.10
- Method: inspection plus measurement
- Preconditions: none
- Data needed: none
- Steps: read the four values and measure each against its own ground
- Expected: dark 0.62 / 0.50 on `#0F1319` → 6.44:1 and 4.63:1; light **0.78 / 0.66** on
  `#F3EEE6` → 6.84:1 and 4.69:1. The light pair is **not** the dark pair, and neither set
  may be copied onto the other or "unified". Both started lower and were raised after
  measurement — the light pair computed to 4.17 and 2.99, and dark faint sat at 3.38:1
  while carrying every block time, break label and caps label.

## UC-474 — The Theme_Switcher offers three values and defaults to system
- Area: theming
- Requirement: 17.4
- Preconditions: logged in with no `worklog_theme` cookie
- Data needed: FIX-UI-DAY
- Steps: open the `Settings_Menu` and read the switcher's checked item
- Expected: three items — `Systém`, `Světlý`, `Tmavý` — with `Systém` checked, because
  that is the default `Theme_Preference`. What is persisted is the **preference**, not the
  theme it resolves to.

## UC-475 — While the preference is system, the theme follows the browser live
- Area: theming
- Requirement: 17.5
- Preconditions: logged in with `worklog_theme=system`
- Data needed: FIX-UI-DAY
- Steps: emulate `prefers-color-scheme: dark`, read `data-theme`; flip to `light` without
  reloading and read it again; then emulate *no preference* and read it once more
- Expected: `dark`, then `light` immediately and with no reload, then `dark` again —
  when the browser expresses no preference the resolution is `dark`. The store listens to
  `matchMedia('(prefers-color-scheme: dark)')` and re-resolves when the browser flips at
  dusk, which a stored `dark` would not do.

## UC-476 — Choosing a theme swaps it instantly and writes exactly one cookie
- Area: theming
- Requirement: 17.6
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: set a marker on `window`; choose `Světlý`; check the marker, `data-theme`, both
  theme cookies and whether anything animated
- Expected: `data-theme` becomes `light` with no reload — the marker survives — and
  `worklog_theme=light` is written. `worklog_theme_resolved` is **not** touched: the
  switcher is the only writer of the preference cookie and it writes nothing else, ever.
  The swap is deliberately unanimated: a 300 ms colour transition across every surface at
  once reads as a fault, and the gauge's SVG presentation attributes would not follow it
  anyway, so half the page would fade and half would jump.

## UC-477 — The resolved theme is written back while the preference is system
- Area: theming
- Requirement: 17.7
- Preconditions: logged in with `worklog_theme=system`
- Data needed: FIX-UI-DAY
- Steps: load with `prefers-color-scheme: light` and read `worklog_theme_resolved`; flip
  the media query and read it again; then set the preference to `Tmavý` and flip the
  media query once more
- Expected: `light`, then `dark` — rewritten by the client on every change of the media
  query while the preference is `system`. With the preference set to `dark` the media
  query no longer drives anything and the preference cookie stays `dark`. Two cookies
  exist precisely because one cannot hold both: writing a resolved `light` into the
  preference would lose `system` and stop the browser's dusk switch being followed.

## UC-478 — The server renders the right theme in the first bytes
- Area: theming
- Requirement: 17.8
- Preconditions: none
- Data needed: none
- Steps: `curl` a page four times — with `worklog_theme=light`; with `worklog_theme=dark`;
  with `worklog_theme=system` and `worklog_theme_resolved=light`; with
  `worklog_theme=system` and `worklog_theme_resolved=dark` — and read the raw HTML
- Expected: `data-theme` is `light`, `dark`, `light`, `dark` respectively, present in the
  first bytes before any script runs. The server prefers the preference cookie and
  consults the resolved one **only** when the preference says `system`.

## UC-479 — A first visit takes the one permitted flash and never repeats it
- Area: theming
- Requirement: 17.9
- Preconditions: a browser with no cookies at all and `prefers-color-scheme: light`
- Data needed: FIX-UI-DAY
- Steps: load a page and watch the first paint; then reload and watch again
- Expected: the first load renders `DEFAULT_RENDER_THEME` (`dark`) and hydration corrects
  it to light once — this is the only flash the interface permits, and there is no way
  around it, because a server cannot know a system preference the browser has never
  reported. That same hydration writes `worklog_theme_resolved`, so the **second** load is
  correct in its first byte with no flash at all.

## UC-480 — Nothing that decides the first paint lives in localStorage
- Area: theming
- Requirement: 17.10
- Method: browser plus inspection
- Preconditions: logged in, having exercised every setting
- Data needed: FIX-UI-DAY
- Steps: set a theme, a language and a viewport, then dump `localStorage` and
  `sessionStorage`; search the source for either API
- Expected: both are empty of anything affecting the first paint. The
  `Theme_Preference`, the resolved `Theme`, the active language and the viewport width
  are all **cookies** — `worklog_theme`, `worklog_theme_resolved`, `worklog_locale`,
  `worklog_viewport` — because the server has to read them to render `<html lang>`,
  `data-theme` and the timeline's density and budget. A pre-paint script could not repaint
  the gauge's SVG attributes anyway.

## UC-481 — Destructive and the pink palette slot are never confused
- Area: theming
- Requirement: 17.11
- Method: browser plus inspection
- Preconditions: logged in
- Data needed: FIX-UI-DAY with a project on `Palette_Slot` 1 (pink)
- Steps: read the computed colour of every destructive control — `Odhlásit se`, the
  session delete link, every destructive confirm pill — and of the pink project's swatch,
  tint and border; then recolour that project and re-read the destructive controls
- Expected: destructive controls resolve to `--destructive` (`#E06A5E` dark, `#A8321F`
  light) and never to a `Palette_Slot`; the pink swatch resolves to slot 1 and never to
  `--destructive`. Recolouring a project changes nothing about any delete control — the
  bug this separation exists to prevent. A project that happens to be pink is not a
  warning.

## UC-482 — The accent's two jobs are told apart by shape
- Area: theming
- Requirement: 17.12, 14.11
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: put a primary action and an `Uncovered_Marker` side by side and compare, in both
  themes and in greyscale
- Expected: both draw from `--accent`, and both are legitimate. A primary action is a
  **filled** pill or circle in `--accent` with `--ink-on-accent` text; uncovered time is a
  **dashed outline** with an accent title on a 6 % accent fill. The two are never told
  apart by colour, and the distinction survives greyscale.

## UC-483 — There is no inline style attribute anywhere
- Area: theming · security
- Requirement: 17.13
- Method: inspection plus browser
- Preconditions: the **built** server, so the production CSP is in force
- Data needed: FIX-UI-WEEK
- Steps: search every `.svelte` file under `src/` for a `style=` attribute; then load
  every page, open every dialog and switch every theme with the console open, watching
  for CSP violations
- Expected: no `style=` attribute exists in the source and no CSP violation is reported at
  runtime. The production policy carries `style-src 'self' 'nonce-…'` with no
  `unsafe-inline`, and a nonce does **not** cover an inline attribute — it is simply
  forbidden. SVG presentation attributes (`d`, `stroke`, `stroke-width`,
  `stroke-dasharray`, `fill`, `x`, `y`) are not CSS and are unaffected, which is why the
  gauge may compute its geometry per render.

## UC-484 — Colours and block heights are applied through precompiled classes
- Area: theming
- Requirement: 17.14
- Method: inspection plus browser
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-DAY and FIX-UI-MANY
- Steps: read the class list of several `Segment_Block` elements; check that
  `palette.css` and `timeline-heights.css` are committed and regenerate without a diff;
  find a block taller than 320 px and read its class
- Expected: each block carries one `pj-<n>` class and one `tl-h-<n>` class from the 2 px
  ladder — `tl-h-26` … `tl-h-320`, of which every drawn height (26, 36, 38, 44, 48, 58,
  60, 62, 74, 96, 98, 106) is a member by construction. A block taller than 320 px takes
  **`tl-h-fill`** instead and absorbs what the flex column has left; a block column
  contains at most one such block and `layOutDay` marks it. `layOutDay` does the
  quantising and returns a height already on the ladder — the component only picks the
  class, so rounding happens in one place. Both stylesheets are generated from
  `palette.ts` and the ladder constants, committed, and `bun run check` fails if
  regenerating produces a diff.

## UC-485 — Every text style and every numeric readout matches the contract
- Area: typography
- Requirement: 17.15
- Preconditions: logged in, `VP-DESKTOP`
- Data needed: FIX-UI-WEEK
- Steps: measure family, weight, size, letter spacing, case and line height for each role
  in the design's two typography tables; then check `font-variant-numeric` on every
  numeric readout
- Expected: hero 68/300/`-0.035em` at line height 1 (mobile 56); stats KPI 30/300/`-0.03em`
  at 1.1; timer figure 26/300/`-0.02em` (mobile 19); page heading 20/500 at 1.3 (mobile
  15); dialog heading 17/500; brand 15/600; summary value 15/500; nav, fields and project
  rows 14 at 1.4; project name in a block 14/500 (mobile 13); buttons 13.5 with primary
  at 600; block head time 13/500 (mobile 12); description and preview prose 12.5 at 1.55;
  times, legend and gauge numerals 12 (mobile 10.5–11); short break label 11.5/400
  `--text-faint`; long break label 12/500 `--text-dim`; caps label 11 with
  `letter-spacing: 0.16em`, uppercase, `--text-faint` (mobile 10). **Every** numeric
  readout carries `font-variant-numeric: tabular-nums`, so digits do not jitter as the
  timer ticks. Line height is part of the contract because `layOutDay` budgets against
  it: changing a head's size or leading changes `BLOCK_HEAD_PX` and must change that
  constant with it.

## UC-486 — Artboard conformance: `Main` (timer, dark, 1440 × 940)
- Area: visual conformance
- Requirement: 17.16, 14.7
- Method: artboard
- Preconditions: logged in, `dark`, Czech, viewport 1440 wide
- Data needed: FIX-UI-RUNNING
- Steps: render `$APP/` at the artboard's frame size and put it beside
  `.design/screens/Main.png`
- Expected: the arrangement matches — top bar, hero, caption, gauge with the control at
  its centre, three figures, quick-log pill, legend — and so do the relative proportions
  and the palette. Copy, example data and exact pixel heights are **not** compared. Any
  deviation is recorded as a defect against this spec or against the `Design_Contract`,
  never resolved as a local decision. Note this artboard is the reference for the gauge's
  **placement**; its geometry comes from the three gauge artboards.

## UC-487 — Artboard conformance: `TimerLight` (timer, light, 1440 × 940)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `light`, Czech, viewport 1440 wide
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/TimerLight.png`
- Expected: the same arrangement as `Main` in the light palette — `#F3EEE6` ground,
  `#2B2420` text, `#A5522E` accent — with the light theme's own dim and faint opacities
  rather than the dark theme's.

## UC-488 — Artboard conformance: `TimerMobile` (timer, mobile, 390 × 844)
- Area: visual conformance
- Requirement: 17.16, 14.25
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-MOBILE`
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/TimerMobile.png`
- Expected: top bar 56–60 with brand and gear chip and **no** `Running_Indicator`; gauge
  at 300 with a 98 px control and an `0 0 0 11px` halo; three figures spread full width at
  19/300 with short labels; quick-log pill without its remaining-time suffix; bottom
  navigation of four tabs with the active one in `--accent`.

## UC-489 — Artboard conformance: `DayCollapsed` (day, dark, 1440 × 1260)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `dark`, Czech, viewport 1440 wide
- Data needed: FIX-UI-DAY plus an orphaned entry, so all three side panels are drawn
- Steps: as UC-486 against `.design/screens/DayCollapsed.png`
- Expected: heading line with date, meta and the two create pills; timeline left with
  rail, blocks and a collapsed `Break_Marker`; a **290 px** side column holding
  `souhrn dne`, `tvar dne` and `mimo výkaz`. The artboard draws its top bar at 88 and its
  `.sesshead` with no line height — both are drawing slips: **84** is the bar height and
  `BLOCK_HEAD_PX` is the computed 29. Block heights illustrate the algorithm and are not
  compared.

## UC-490 — Artboard conformance: `DayCollapsedLight` (day, light, 1440 × 1080)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `light`, Czech, viewport 1440 wide
- Data needed: FIX-UI-DAY
- Steps: as UC-486 against `.design/screens/DayCollapsedLight.png`
- Expected: the same arrangement in the light palette, with the break rule at
  `rgba(0,0,0,0.20)` — deliberately **higher** than the dark theme's 0.14, exactly as the
  text tokens are — and the uncovered border at 0.52 rather than 0.45.

## UC-491 — Artboard conformance: `DayMobile` (day, mobile, 390 × 844)
- Area: visual conformance
- Requirement: 17.16, 1.5
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-MOBILE`
- Data needed: FIX-UI-DAY
- Steps: as UC-486 against `.design/screens/DayMobile.png`
- Expected: a 44 px date row — 34 px back button, date 15/500 centred over the meta at
  10 px, forward button at `opacity: 0.3` on today; blocks at radius 9, `padding: 8px
  11px`, rail 6; the two side panels **below** the timeline; and a 54 px accent FAB 18
  from the right and 12 above the bottom bar with its own `0 0 0 10px` halo. Known
  deviation: the FAB has no entry point in the current build (UC-305), so this artboard
  cannot pass until that is closed.

## UC-492 — Artboard conformance: `AddTask` (activity dialog, dark, 820 × 780)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-DESKTOP`, dialog open in `Jen délka`
- Data needed: FIX-UI-DAY
- Steps: as UC-486 against `.design/screens/AddTask.png`
- Expected: scrim over the page; dialog at radius 20 on `--dialog` with
  `0 28px 70px rgba(0,0,0,0.6)`; header `22px 26px 18px` with a 17/500 title and a 32 px
  close button; the three-mode segmented control; the field row at `1fr 1fr 1.2fr` (the
  layout the artboard draws); the tinted inference note; the live preview panel headed by
  an eye icon and `uloží se takto`; the `Untracked_Policy` control; footer `16px 26px` on
  `--footer` with the hint and two 42 px pills.

## UC-493 — Artboard conformance: `AddTaskLight` (activity dialog, light, 820 × 780)
- Area: visual conformance
- Requirement: 17.16, 17.1
- Method: artboard
- Preconditions: logged in, `light`, Czech, `VP-DESKTOP`, dialog open
- Data needed: FIX-UI-DAY
- Steps: as UC-486 against `.design/screens/AddTaskLight.png`
- Expected: the same dialog on `#FBF7F1`. This artboard is why **no token is derived any
  more** — dialog, scrim, field, active field, divider and destructive are painted values
  measured on the surface they sit on. Check each against the light table:
  `--scrim rgba(43,36,32,0.38)`, `--field rgba(0,0,0,0.05)`, active field
  `rgba(165,82,46,0.10)` with an inset `1px rgba(165,82,46,0.45)`,
  `--divider rgba(0,0,0,0.07)`, `--destructive #A8321F` at 6.26:1 on this ground.

## UC-494 — Artboard conformance: `AddTaskMobile` (activity dialog, mobile, 390 × 844)
- Area: visual conformance
- Requirement: 17.16, 14.15
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-MOBILE`, dialog open
- Data needed: FIX-UI-DAY
- Steps: as UC-486 against `.design/screens/AddTaskMobile.png`
- Expected: the dialog **is** the viewport — no scrim, no radius. Header 58 tall with a
  34 px close button; fields one per row at 48 / 15 px; segmented items 40 at 12.5 px with
  the shortened label `Od–do`; description 62; the `Change_Preview` at **full** form,
  policy control included; footer pinned with the primary 50 px above `Zrušit` at 46,
  `gap: 10`.

## UC-495 — Artboard conformance: `SessionEdit` (session dialog, 820 × 720)
- Area: visual conformance
- Requirement: 17.16, 9.6
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-DESKTOP`, session dialog in its
  confirmation state
- Data needed: FIX-UI-DAY with a change removing 30 min from one entry and pushing 1 h 30
  of uncovered time out of the frame
- Steps: as UC-486 against `.design/screens/SessionEdit.png`
- Expected: two 44 px time fields with the changed one showing the old value struck
  through; the consequence panel at radius 14 on `rgba(209,138,106,0.07)` with a
  `1px solid rgba(209,138,106,0.28)` border; one headline total at 15/500 accent
  (`−2 h 00 min`) with `preview_total_split` directly beneath it; one row per affected
  entry with a 3 × 18 slot tick and a `1fr 20px 1fr` *teď* → *po úpravě* grid; the
  uncovered row last, in prose, with a `rgba(209,138,106,0.6)` tick; an inline
  `--destructive` delete link; the server-computed footer hint. **The artboard's closing
  count is wrong** — it says *2 záznamy* over one entry plus one uncovered row, and the
  rule is entries only. The implementation must say *1 záznam*, and the artboard is the
  thing being corrected.

## UC-496 — Artboard conformance: `Projects` (1440 × 900)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `dark`, Czech, viewport 1440 wide
- Data needed: FIX-UI-WEEK
- Steps: as UC-486 against `.design/screens/Projects.png`
- Expected: content capped at **940**; rows of `padding: 16px 18px` separated by 1 px
  dividers, each with a 32 px icon box of radius 9 tinted from the slot carrying a 13 px
  rounded swatch, the name, the thirty-day total, a share bar and the row actions. The
  artboard draws the eight-swatch strip as a standalone panel to show all eight at once —
  that is a presentation of the control, **not** its placement: in the implementation the
  strip expands inside the row it changes.

## UC-497 — Artboard conformance: `Stats` (1440 × 980)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `dark`, Czech, viewport 1440 wide, range `Týden`
- Data needed: FIX-UI-WEEK
- Steps: as UC-486 against `.design/screens/Stats.png`
- Expected: heading row with the range control and the resolved range; a four-panel
  `KPI_Row`; the `Day_Rhythm_Strip` panel with its sub-line, 58 px label gutter, 22 px
  strips, hatched uncovered intervals, accent-marked today and a five-label axis; then
  breakdown and rhythm panel at `1.4fr 1fr`, closing with the observation line. Two known
  corrections to the drawing: the bars are **shares of the range total** (59/32/9 %), not
  scaled to the largest project (100/54/14 %); and the interior axis labels are even
  divisions (`09:00 · 15:00 · 21:00`), not the drawn `08:00 / 14:00 / 20:00`. Known
  deviation: the strip's heading carries no project legend in the current build, which
  `design.md` asks for — recorded in the phase-1 report as a deliberate simplification.

## UC-498 — Artboard conformance: `Settings` (settings menu, desktop dark, 1440 × 560)
- Area: visual conformance
- Requirement: 17.16, 1.16
- Method: artboard
- Preconditions: logged in, `dark`, Czech, viewport 1440 wide, menu open
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/Settings.png`
- Expected: a 30 px round gear chip on `--chip` holding a 16 px gear at
  `stroke-width: 1.7`; a 268 px menu anchored under it with `padding: 16`, `gap: 16`,
  radius 14 and the menu border and shadow; the four rows in order with 34 px items at
  radius 9 inside radius-11 groups. The artboard draws the `Running_Indicator` beside the
  chip because it is demonstrating the menu, **not** because the timer page carries one.

## UC-499 — Artboard conformance: `SettingsLight` (settings menu, desktop light, 1440 × 560)
- Area: visual conformance
- Requirement: 17.16, 17.1
- Method: artboard
- Preconditions: logged in, `light`, Czech, viewport 1440 wide, menu open
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/SettingsLight.png`
- Expected: the same menu with the painted light values this artboard confirms — chip
  `rgba(0,0,0,0.06)`, menu border `rgba(0,0,0,0.08)`, shadow
  `0 18px 44px rgba(43,36,32,0.18)`, group `rgba(0,0,0,0.04)`, active segment
  `rgba(165,82,46,0.14)` (lower than the dark theme's 0.16, because the light accent is
  the darker colour), divider `rgba(0,0,0,0.07)`, surface `#FBF7F1`.

## UC-500 — Artboard conformance: `SettingsMobile` (settings sheet, mobile dark, 390 × 844)
- Area: visual conformance
- Requirement: 17.16, 1.17, 1.19
- Method: artboard
- Preconditions: logged in, `dark`, Czech, `VP-MOBILE`, sheet open
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/SettingsMobile.png`
- Expected: a 32 px chip; a sheet at radius `20px 20px 0 0` with `padding: 10px 22px 26px`
  and `gap: 20`, opened by a 38 × 4 grabber of radius 9999 in `rgba(255,255,255,0.14)`
  centred at the top; rows at 44 tall with radius-10 items in radius-13 groups, the
  logout icon at 17 and its label at 14.5. The scrim covers the bottom navigation and the
  sheet paints above it, with no `opacity` on either layer.

## UC-501 — Artboard conformance: `SettingsMobileLight` (settings sheet, mobile light, 390 × 844)
- Area: visual conformance
- Requirement: 17.16
- Method: artboard
- Preconditions: logged in, `light`, Czech, `VP-MOBILE`, sheet open
- Data needed: FIX-UI-RUNNING
- Steps: as UC-486 against `.design/screens/SettingsMobileLight.png`
- Expected: the light half of UC-500, on `#FBF7F1`. `--grabber` is the one value in this
  whole surface with no light drawing — `rgba(0,0,0,0.16)` follows the same ladder and is
  binding as written.

## UC-502 — A description at and beyond the length limit behaves predictably
- Area: edge cases · validation
- Requirement: 15.12, 6.7, 1.15
- Preconditions: logged in, `Activity_Dialog` open
- Data needed: FIX-UI-DAY
- Steps: paste a description of exactly the limit and save; then one of ten thousand
  characters and save; then read the resulting block, its tooltip and its `aria-label`
- Expected: the first saves. The second is refused with `Popis je moc dlouhý.` beside the
  description field (or `Nejvíc {max} znaků.` from the field namespace), with the text
  kept so it can be trimmed. A long description that did save wraps inside its block or is
  clipped by the block's own overflow — it never widens the timeline column or the page.

## UC-503 — A very long project name does not break any surface that draws it
- Area: edge cases · layout
- Requirement: 14.1, 11.11
- Preconditions: logged in
- Data needed: FIX-UI-DAY plus a project whose name is 120 characters with no spaces
- Steps: view that project on the projects page, the `Project_Legend`, a `Segment_Block`,
  the `Project_Picker`, the statistics breakdown and the rhythm legend, at `VP-DESKTOP`
  and `VP-NARROW`
- Expected: every surface wraps, truncates within its own box, or scrolls inside its own
  container. Nothing widens the page, and `document.scrollWidth` never exceeds
  `clientWidth` at 320 px. The name remains readable in full somewhere — a tooltip or the
  projects page — since colour cannot carry identity on its own.

## UC-504 — Rate limiting surfaces as a toast carrying the delay
- Area: edge cases · errors
- Requirement: 15.9
- Preconditions: logged in
- Data needed: FIX-UI-DAY
- Steps: drive enough requests past `RATE_LIMIT_PER_MINUTE` to be limited — for example by
  typing continuously in a previewed field with the debounce defeated — and read what
  appears; then repeat with failed logins past `LOGIN_ATTEMPT_LIMIT`
- Expected: a toast rendering `Moc požadavků. Zkus to za {n} s.` with the delay from the
  envelope, and on the login page `Moc pokusů o přihlášení. Zkus to za {n} s.` — two
  different keys chosen from `details.scope`, never a sentence composed in the browser.
  Nothing is lost and the action can be repeated after the delay.

## UC-505 — The interface works with JavaScript disabled as far as it claims to
- Area: edge cases · progressive enhancement
- Requirement: 2.2, 1.11
- Preconditions: JavaScript disabled in the browser
- Data needed: FIX-UI-DAY
- Steps: log in at `/login`; start and stop the timer; open `/day/<TODAY>`, `/projects`
  and `/stats`; try a project rename; visit `/logout` directly
- Expected: the login form, the timer's start and stop, the project form actions and the
  logout confirmation all work, because each is a real form action — that is why reads are
  load functions and writes are form actions rather than `fetch`. What needs JavaScript —
  the `Change_Preview`, the `Project_Picker`'s inline creation, the ticking clock, the
  theme and locale switchers — degrades to an inert or absent control rather than to a
  broken page or a silent no-op.

## UC-506 — Two tabs on the same day do not show contradictory state
- Area: edge cases · consistency
- Requirement: 3.12, 9.14
- Preconditions: logged in, the same day open in two tabs
- Data needed: FIX-UI-DAY
- Steps: in tab A start the timer and add an entry; switch to tab B and back to it
- Expected: tab B refreshes on `visibilitychange` and shows the running timer and the new
  entry together. A write attempted in tab B against its stale view is refused with
  `STALE_PREVIEW` and recomputed rather than silently overwriting tab A's work.

## UC-507 — A day spanning a DST transition renders without a shifted dial
- Area: edge cases · time
- Requirement: 16.1, 1.12
- Preconditions: logged in
- Data needed: FIX-DST-SPRING (a 23-hour `Logical_Day`) and FIX-DST-AUTUMN (25 hours)
- Steps: open each day's page and the gauge for it, and read the block times, the
  graduations and the numerals
- Expected: not a single graduation moves in either case, because the mapping is a
  function of the wall clock and the transition falls between 02:00 and 03:00 — inside the
  bare gap. Block times render in the server's zone with the correct offset on each side
  of the transition, and the day's totals match what the API reports for it.

## UC-508 — The E2E suite runs on a machine that is not this one
- Area: test infrastructure
- Requirement: — (process, not a criterion)
- Method: inspection
- Preconditions: a clean checkout on a different machine
- Data needed: none
- Steps: read `tests/e2e/a11y.spec.ts` and `scripts/test-e2e.sh` for absolute paths and
  for the passphrase the suite logs in with; then try to run `bun run test:e2e:local`
- Expected: no committed file names a session-specific directory, and the suite's
  passphrase is supplied by the script rather than by an out-of-repo wrapper.
  Resolved (run 2026-08-24-0659, verify phase): both fixed — see ISSUES.md "The E2E
  suite is not runnable from a clean checkout" (RESOLVED) for the mechanism
  (`tests/e2e/e2e-passphrase.ts` as the single source of truth for `E2E_PASSPHRASE`,
  `scripts/hash-passphrase.sh` extended to accept a `PASSPHRASE` env var so
  `test-e2e.sh` can mint the matching hash non-interactively, and `a11y.spec.ts`'s
  `storageState` directory moved to `os.tmpdir()`). Verified: `PASSPHRASE=x
  ./scripts/hash-passphrase.sh` works standalone; `bun -e "import {
  E2E_PASSPHRASE } from './tests/e2e/e2e-passphrase.ts'"` resolves outside any
  Playwright context; a full `./scripts/test-e2e.sh` run in this sandbox got past
  starting Postgres, confirming it accepts a query, and reached `migrate.sh` before
  failing — at that point on a **separate, pre-existing, unrelated** limitation:
  this sandbox cannot reach a `docker run -p`-published port from its own shell
  (`sandbox-docker-net` skill), so `migrate.sh`'s host-side `psql` gets connection
  refused against `localhost:55432` even though the container itself is healthy
  (confirmed via `docker exec` from the same script). This is a sandbox constraint,
  not a defect in the script — a real machine or CI runner reaches its own
  published ports normally, which `test-e2e.sh`'s design already assumes.

---

## Requirement coverage — `002-worklog-ui`

Every acceptance criterion of `.kiro/specs/002-worklog-ui/requirements.md`, and the use
case (or cases) that exercise it. Nothing in the specification is left without a home.

**Requirement 1 — Application Shell and Navigation**
1.1 UC-238 · 1.2 UC-238 · 1.3 UC-239 · 1.4 UC-240 · 1.5 UC-241, UC-334 ·
1.6 UC-238, UC-249 · 1.7 UC-242 · 1.8 UC-242 · 1.9 UC-237 · 1.10 UC-244 ·
1.11 UC-243, UC-505 · 1.12 UC-245, UC-507 · 1.13 UC-245 · 1.14 UC-247 ·
1.15 UC-248, UC-502 · 1.16 UC-249, UC-498 · 1.17 UC-250, UC-500 · 1.18 UC-251 ·
1.19 UC-250, UC-500 · 1.20 UC-250 · 1.21 UC-252 · 1.22 UC-253 · 1.23 UC-254 ·
1.24 UC-255 · 1.25 UC-246, UC-275

**Requirement 2 — Authentication**
2.1 UC-256 · 2.2 UC-257, UC-505 · 2.3 UC-258 · 2.4 UC-257 · 2.5 UC-259, UC-253 ·
2.6 UC-260 · 2.7 UC-261

**Requirement 3 — Timer Page**
3.1 UC-262 · 3.2 UC-263 · 3.3 UC-263 · 3.4 UC-264 · 3.5 UC-264 · 3.6 UC-264 ·
3.7 UC-264 · 3.8 UC-265 · 3.9 UC-266 · 3.10 UC-267 · 3.11 UC-268 ·
3.12 UC-269, UC-506 · 3.13 UC-270 · 3.14 UC-271 · 3.15 UC-272 · 3.16 UC-273 ·
3.17 UC-274 · 3.18 UC-275, UC-246 · 3.19 UC-262 · 3.20 UC-262

**Requirement 4 — Day Timeline**
4.1 UC-276, UC-470 · 4.2 UC-277 · 4.3 UC-277 · 4.4 UC-278 · 4.5 UC-279 ·
4.6 UC-280, UC-324 · 4.7 UC-281 · 4.8 UC-282 · 4.9 UC-283 · 4.10 UC-284 ·
4.11 UC-285 · 4.12 UC-286 · 4.13 UC-287 · 4.14 UC-288 · 4.15 UC-289 · 4.16 UC-290 ·
4.17 UC-291 · 4.18 UC-276 · 4.19 UC-292 · 4.20 UC-293, UC-414 · 4.21 UC-294 ·
4.22 UC-295 · 4.23 UC-296 · 4.24 UC-297 · 4.25 UC-298

**Requirement 5 — Day Navigation**
5.1 UC-299 · 5.2 UC-300 · 5.3 UC-301 · 5.4 UC-302 · 5.5 UC-303 · 5.6 UC-304

**Requirement 6 — Activity Creation**
6.1 UC-305 · 6.2 UC-306 · 6.3 UC-307 · 6.4 UC-308 · 6.5 UC-309 · 6.6 UC-310 ·
6.7 UC-311, UC-502 · 6.8 UC-312 · 6.9 UC-313 · 6.10 UC-314, UC-307 · 6.11 UC-315 ·
6.12 UC-316 · 6.13 UC-317, UC-271 · 6.14 UC-318 · 6.15 UC-319, UC-432 · 6.16 UC-320 ·
6.17 UC-317 · 6.18 UC-321 · 6.19 UC-322, UC-308, UC-310

**Requirement 7 — Activity Editing and Deletion**
7.1 UC-323, UC-276 · 7.2 UC-324, UC-280 · 7.3 UC-325 · 7.4 UC-326, UC-285 ·
7.5 UC-327 · 7.6 UC-328 · 7.7 UC-329 · 7.8 UC-330 · 7.9 UC-331 · 7.10 UC-332 ·
7.11 UC-333

**Requirement 8 — Timer Frame Editing**
8.1 UC-334, UC-241 · 8.2 UC-335 · 8.3 UC-336 · 8.4 UC-337 · 8.5 UC-338, UC-441 ·
8.6 UC-339 · 8.7 UC-340 · 8.8 UC-341 · 8.9 UC-342 · 8.10 UC-343

**Requirement 9 — Change Preview**
9.1 UC-344, UC-309 · 9.2 UC-345 · 9.3 UC-346 · 9.4 UC-347 · 9.5 UC-348, UC-343 ·
9.6 UC-349, UC-495 · 9.7 UC-350 · 9.8 UC-351, UC-343 · 9.9 UC-352 ·
9.10 UC-353, UC-346 · 9.11 UC-354, UC-320 · 9.12 UC-355 · 9.13 UC-356, UC-352 ·
9.14 UC-357, UC-506 · 9.15 UC-358 · 9.16 UC-359, UC-315

**Requirement 10 — Uncovered Time Guidance**
10.1 UC-360 · 10.2 UC-281, UC-323 · 10.3 UC-287, UC-362 · 10.4 UC-298 · 10.5 UC-361 ·
10.6 UC-264 · 10.7 UC-362 · 10.8 UC-363

**Requirement 11 — Project Management**
11.1 UC-364 · 11.2 UC-365 · 11.3 UC-366 · 11.4 UC-367 · 11.5 UC-368 · 11.6 UC-369 ·
11.7 UC-370 · 11.8 UC-371 · 11.9 UC-373, UC-279 · 11.10 UC-372 ·
11.11 UC-374, UC-265 · 11.12 UC-375 · 11.13 UC-376, UC-321, UC-312 · 11.14 UC-377

**Requirement 12 — Statistics**
12.1 UC-378, UC-397 · 12.2 UC-379 · 12.3 UC-380 · 12.4 UC-381, UC-377 · 12.5 UC-382 ·
12.6 UC-383 · 12.7 UC-384 · 12.8 UC-385 · 12.9 UC-386 · 12.10 UC-387 · 12.11 UC-388 ·
12.12 UC-389 · 12.13 UC-390 · 12.14 UC-391 · 12.15 UC-392 · 12.16 UC-393, UC-397 ·
12.17 UC-394 · 12.18 UC-395 · 12.19 UC-392 · 12.20 UC-396

**Requirement 13 — Internationalization**
13.1 UC-398, UC-410 · 13.2 UC-399 · 13.3 UC-400 · 13.4 UC-401 · 13.5 UC-401, UC-411 ·
13.6 UC-402 · 13.7 UC-403, UC-302 · 13.8 UC-404, UC-258 · 13.9 UC-405 · 13.10 UC-406 ·
13.11 UC-404 · 13.12 UC-407, UC-409 · 13.13 UC-408 · 13.14 UC-402, UC-254

**Requirement 14 — Responsiveness, Interaction and Accessibility**
14.1 UC-412, UC-503 · 14.2 UC-413 · 14.3 UC-414, UC-293 · 14.4 UC-415 ·
14.5 UC-416, UC-272, UC-289 · 14.6 UC-417 · 14.7 UC-418, UC-486 · 14.8 UC-419 ·
14.9 UC-420 · 14.10 UC-421, UC-473 · 14.11 UC-422, UC-390 ·
14.12 UC-423, UC-239, UC-436 · 14.13 UC-424, UC-307 · 14.14 UC-425, UC-433 ·
14.15 UC-426, UC-494 · 14.16 UC-427 · 14.17 UC-428, UC-436 ·
14.18 UC-429, UC-306, UC-406 · 14.19 UC-417 · 14.20 UC-430 · 14.21 UC-431, UC-340 ·
14.22 UC-432, UC-319 · 14.23 UC-433, UC-252 · 14.24 UC-434, UC-250 ·
14.25 UC-435, UC-488

**Requirement 15 — Feedback, Loading and Error States**
15.1 UC-437 · 15.2 UC-438, UC-355 · 15.3 UC-439 · 15.4 UC-440, UC-314, UC-270 ·
15.5 UC-441, UC-338 · 15.6 UC-442 · 15.7 UC-443, UC-247 ·
15.8 UC-444, UC-329, UC-336 · 15.9 UC-445, UC-504, UC-260 ·
15.10 UC-446, UC-376, UC-290 · 15.11 UC-447 · 15.12 UC-448, UC-502 · 15.13 UC-449 ·
15.14 UC-450 · 15.15 UC-451, UC-268

**Requirement 16 — Day Gauge**
16.1 UC-452, UC-507, UC-470 · 16.2 UC-453 · 16.3 UC-454 · 16.4 UC-455, UC-469 ·
16.5 UC-456 · 16.6 UC-457, UC-469 · 16.7 UC-458 · 16.8 UC-459 · 16.9 UC-453 ·
16.10 UC-460 · 16.11 UC-461 · 16.12 UC-462 · 16.13 UC-463 · 16.14 UC-464 ·
16.15 UC-465 · 16.16 UC-466 · 16.17 UC-467 · 16.18 UC-452 · 16.19 UC-468, UC-265

**Requirement 17 — Visual Design and Theming**
17.1 UC-471, UC-493, UC-499 · 17.2 UC-472 · 17.3 UC-473 · 17.4 UC-474 · 17.5 UC-475 ·
17.6 UC-476 · 17.7 UC-477 · 17.8 UC-478, UC-254 · 17.9 UC-479 · 17.10 UC-480 ·
17.11 UC-481 · 17.12 UC-482, UC-422 · 17.13 UC-483 · 17.14 UC-484, UC-279 ·
17.15 UC-485 · 17.16 UC-486 … UC-501 (one case per compared artboard)

**Correctness Properties of `002-worklog-ui/design.md`**
P1 UC-452 · P2 UC-277, UC-293, UC-296 · P3 UC-453

**Not a criterion, verified anyway**
UC-503 (long project name) · UC-504 (rate limiting) · UC-505 (no JavaScript) ·
UC-506 (two tabs) · UC-507 (DST days) · UC-508 (the E2E suite off this machine)
