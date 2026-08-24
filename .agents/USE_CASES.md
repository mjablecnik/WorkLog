# Use Cases — Worklog

Everything that must be true for the `Worklog_Server` (spec
`.kiro/specs/001-worklog-domain-api/`) to count as working. Numbers are **stable**:
the walkthrough in `.agents/tmp/VERIFY_TASKS.md` and every later run refer to them.
New cases are appended at the end; an obsolete case is marked `OBSOLETE` in place and
never renumbered away.

Spec `002-worklog-ui` is not started, so there is no browser interface to drive. Every
case below is exercised over the REST API with `curl` (or the equivalent), except the
handful marked `Method: inspection`, which are properties of the code, the schema or
the process that no request can observe.

## Conventions

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

## Fixtures

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

## Requirement coverage

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
