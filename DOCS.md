# Worklog — Reference

This is the reference document: environment variables, project structure, the full
REST API, the browser UI, known limitations, testing and troubleshooting.
`README.md` is the quick start; this is where you come back to look something up.

## Environment Variables

Copy `.env.example` to `.env` (or `.env.<environment>` for a deploy target) and fill
it in. Every variable the server reads is listed there with a comment; the table below
is the same information grouped by purpose.

| Variable                    | Required      | Default                      | Notes                                                                                                                                                                                                 |
| --------------------------- | ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | no            | `3000`                       |                                                                                                                                                                                                       |
| `APP_ENV`                   | no            | `production` (unset default) | `development` relaxes the CSP and cookie `Secure` flag; never trust a client-supplied value for this                                                                                                  |
| `PUBLIC_ORIGIN`             | in production | —                            | The app's own `https://` origin, e.g. `https://worklog.fly.dev`. Behind Fly's TLS proxy the runtime otherwise infers `http://localhost:3000`, which breaks the cross-origin check and CSRF protection |
| `DATABASE_URL`              | yes           | —                            | `postgres://user:pass@host:5432/db`                                                                                                                                                                   |
| `TEST_DATABASE_URL`         | tests only    | —                            | Must differ from `DATABASE_URL` and its database name must end in `_test` — the test suite truncates every table in it on every run                                                                   |
| `DB_QUERY_TIMEOUT_SECONDS`  | no            | `5`                          | A query past this becomes `SERVICE_UNAVAILABLE`                                                                                                                                                       |
| `DB_POOL_MAX`               | no            | `10`                         |                                                                                                                                                                                                       |
| `WORKLOG_API_TOKEN`         | yes           | —                            | Bearer token for scripts and phone shortcuts. At least 32 characters                                                                                                                                  |
| `WORKLOG_PASSPHRASE_HASH`   | yes           | —                            | argon2id hash of the browser login passphrase. Produce it with `./scripts/hash-passphrase.sh`                                                                                                         |
| `TIMEZONE`                  | no            | `Europe/Prague`              | IANA zone name. Changing it regroups existing history into different `Logical_Day` values — see below                                                                                                 |
| `DAY_START_HOUR`            | no            | `3`                          | 0-23. Must fall inside the `Gauge_Gap` and must itself exist and be unambiguous in `TIMEZONE` (the server refuses to start otherwise)                                                                 |
| `GAUGE_START` / `GAUGE_END` | no            | `06:00` / `00:00`            | `HH:MM`. `GAUGE_END <= GAUGE_START` wraps to the next date — see below                                                                                                                                |
| `EVENING_HOUR`              | no            | `21`                         | 0-23                                                                                                                                                                                                  |
| `ALLOW_DAY_BOUNDARY_CHANGE` | no            | `false`                      | When unset, the server refuses to start if the stored `Day_Boundary_Config` disagrees with `TIMEZONE`/`DAY_START_HOUR`                                                                                |
| `MAX_OPEN_SESSION_HOURS`    | no            | `12`                         | A running timer past this is a `Stale_Session`; its tail stops counting as `Tracked_Time`                                                                                                             |
| `MIN_INTERVAL_SECONDS`      | no            | `60`                         | The floor below which a `Work_Session` or `Activity_Segment` is never stored                                                                                                                          |
| `SESSION_DURATION_HOURS`    | no            | `720`                        | How long a browser login session lasts                                                                                                                                                                |
| `LOG_LEVEL`                 | no            | `info`                       |                                                                                                                                                                                                       |
| `CORS_ORIGINS`              | no            | (none)                       | Comma-separated allow-list. Never a wildcard outside development                                                                                                                                      |
| `TRUSTED_PROXY_HOPS`        | no            | `0`                          | How many `X-Forwarded-For` entries (counted from the right) to trust for `clientAddress()`. `1` behind Fly's single proxy                                                                             |
| `RATE_LIMIT_PER_MINUTE`     | no            | `120`                        | Per client address, all `/api` routes except `/api/health`                                                                                                                                            |

A handful of values are deliberately **not** configuration — `FUTURE_TOLERANCE_SECONDS`
(300), `MAX_RANGE_DAYS` (366), `MAX_INTERVAL_RANGE_DAYS` (62), `ACTIVITY_PAGE_SIZE`
(200), `ERROR_DETAIL_SAMPLE_SIZE` (10), `SUGGESTED_WINDOW_COVERAGE` (0.9),
`CLEANUP_INTERVAL_MINUTES` (60), `SERVICE_RETRY_AFTER_SECONDS` (5),
`LOGIN_ATTEMPT_LIMIT` (5 per 15 minutes) and `IDEMPOTENCY_RETENTION_HOURS` (24). They
are fixed in `src/lib/server/core/config.ts` and `src/lib/contracts/constants.ts`.

## Project Structure

```
src/
├── app.d.ts                 # App.Locals: requestId, auth, today, locale, theme
├── hooks.server.ts          # the Auth_Hook and everything that runs before it
├── db/schema/                # Drizzle table definitions
├── lib/
│   ├── contracts/             # browser-safe: types, response shapes, Zod schemas
│   ├── server/
│   │   ├── domain/             # pure — no database, no SvelteKit, no $env
│   │   ├── core/                 # env validation, auth, errors, logging, rate limiting
│   │   ├── store/                 # every Drizzle query, one file per aggregate
│   │   └── services/               # the one body of every write; routes call these
│   ├── core/i18n/              # locale resolution/state (cs/en)
│   ├── theme/                  # theme.css tokens, theme.svelte.ts (light/dark),
│   │                           #   generated palette.css / timeline-heights.css
│   ├── ui/                     # generic UI: elements, forms, overlays, layout
│   │                           #   (Shell, Topbar, BottomNav, Fab, SettingsMenu)
│   └── paraglide/               # compiled i18n messages — generated, gitignored
├── modules/                  # feature code, one folder per screen's domain logic
│   ├── timer/                  # elapsed-time and tab-title reactive state
│   ├── day/                    # timeline geometry, Dry_Run preview helpers
│   ├── projects/                # ProjectPicker and related components
│   └── stats/                   # statistics aggregation and its components
├── routes/
│   ├── api/                    # the REST API — see below
│   ├── login/, logout/          # server-side auth actions
│   ├── +page.svelte              # the timer page ("/")
│   ├── day/[date]/                # the day timeline
│   ├── projects/                  # project management
│   ├── stats/                     # statistics
│   └── offline/                   # the offline fallback page
migrations/                  # hand-written, sequential SQL — see Migrations below
scripts/                     # every operational script — see README.md
messages/                    # source i18n strings, {locale}.json — cs.json, en.json
tests/
├── lib/server/domain/         # pure unit + property tests, no database
├── lib/server/{core,store,services}/  # database-backed tests
├── api/                        # route-level tests, calling +server.ts handlers directly
└── e2e/                         # Playwright specs — see Testing below
```

Module boundaries are enforced by `tests/lib/server/imports.test.ts`: `domain` may
depend on nothing of this project's own but `contracts`; `core` may depend on
`contracts` alone; `store` may depend on `domain`, `core` and `contracts`; `services`
may additionally depend on `store`; routes may depend on all of the above. The
interface (`002-worklog-ui`) reaches `src/lib/server/` only through `services` or
`store`, and only from a `+page.server.ts`, a `+server.ts` or a `modules/*` file.

## API

Every response is JSON. Every failure uses the same envelope:

```json
{
	"error": "VALIDATION_ERROR",
	"message": "The request could not be validated.",
	"messageKey": "errors_validation_error",
	"requestId": "…",
	"details": { "fields": { "projectId": { "reason": "fields_invalid_id" } } }
}
```

Authenticate with `Authorization: Bearer $WORKLOG_API_TOKEN`, or with the
`worklog_session` cookie a browser gets from `POST /login`. `GET /api/health` needs
neither.

### Sessions — the timer

| Method              | Path                    |                                    |
| ------------------- | ----------------------- | ---------------------------------- |
| `POST`              | `/api/sessions/start`   | starts the timer                   |
| `POST`              | `/api/sessions/stop`    | stops it                           |
| `GET`               | `/api/sessions/current` | the running timer, or `null`       |
| `GET`               | `/api/sessions`         | list, `from`/`to` default to today |
| `POST`              | `/api/sessions`         | create a closed session directly   |
| `PATCH` \| `DELETE` | `/api/sessions/{id}`    | correct or remove one              |

```bash
curl -X POST https://worklog.fly.dev/api/sessions/start \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN"
# {"session":{"id":"…","startedAt":"2026-06-01T08:00:00.000Z","endedAt":null,"stale":false,…},"discarded":false}

curl -X POST https://worklog.fly.dev/api/sessions/stop \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN"
# {"session":{…,"endedAt":"2026-06-01T12:00:00.000Z"},"discarded":false}
```

Stopping a timer that ran under `MIN_INTERVAL_SECONDS` always succeeds — the row is
deleted instead of stored, and the response carries `session: null, discarded: true`.
That is not an error.

### Projects

`GET /api/projects` (add `?include_archived=true` for archived ones too),
`POST /api/projects`, `PATCH /api/projects/{id}`, `DELETE /api/projects/{id}`.

### Activities — the log

`GET /api/activities` (paged, `from`/`to`/`project_id`/`cursor`/`order`/`limit`),
`GET /api/activities/{id}`, `POST /api/activities`, `PATCH /api/activities/{id}`,
`DELETE /api/activities/{id}`.

Three ways to write an activity, picked by which fields are present:

```bash
# Explicit — exact start and end.
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"…","description":"Code review","startedAt":"2026-06-01T13:00:00Z","endedAt":"2026-06-01T16:00:00Z"}'

# Duration — a bare length, placed after the last entry (or the day's first session).
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"…","description":"Bug triage","durationMinutes":120}'

# Open — nothing but the project. Everything since the last entry ended.
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"…","description":"Reviewed the migration"}'
```

Every write also accepts `untrackedPolicy` (`clip` — the default, `extend` or
`reject`), `dryRun` and `previewToken`.

**`dryRun`** evaluates the write in full — including every check that would reject
it — without saving anything, and answers with the same status code the real write
would (a create still 201, a delete still 204 unless it is previewed, in which case it
answers 200 with the preview body — a 204 has nothing to preview):

```bash
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"…","description":"…","startedAt":"…","endedAt":"…","dryRun":true}'
# {"entry":{…},"discarded":[…],"extendedSessions":[…],"dryRun":true,"previewToken":"…"}
```

Submit the same request again with `dryRun` omitted (or `false`) to actually save it.
If something about the underlying timer frame changed between the preview and the
confirm, the write answers 409 `STALE_PREVIEW` instead of silently confirming a
preview that no longer matches — pass the `previewToken` from the preview back on the
confirming request to get that check.

**`Idempotency-Key`** (a header, not a body field) makes a `POST /api/activities`
retry-safe: repeating the same key with the same body replays the original response
and creates nothing a second time; the same key with a **different** body is rejected
with 409 `IDEMPOTENCY_KEY_REUSED`. A key is retained for at least 24 hours. A `dryRun`
request neither consults nor claims a key — nothing was created to protect.

```bash
curl -X POST https://worklog.fly.dev/api/activities \
  -H "Authorization: Bearer $WORKLOG_API_TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: a-client-generated-uuid' \
  -d '{"projectId":"…","description":"…"}'
```

### Days, coverage and health

`GET /api/days` (a `DaySummary` per `Logical_Day`; add `?include=intervals` for the
per-day `tracked`/`covered`/`uncovered` lists, capped at `MAX_INTERVAL_RANGE_DAYS`),
`GET /api/days/{date}` (everything about one day — sessions, entries, coverage,
totals and `quickLog`), `GET /api/coverage` (`tracked`/`covered`/`uncovered`/
`untracked` over a range), `GET /api/health` (no credential; `degraded` and 503 when
the database is unreachable or a migration is unapplied).

## The Clipping worked example

A request can span a break. Given the timer frame `08:00–14:48` and `15:12–18:00` and
an explicit request for `13:00–16:00`:

```
timer      ├──────────────────────────┤   ├─────────────────────────┤
           08:00                   14:48  15:12                 18:00

requested                13:00────────────────────16:00

stored                       ├───────┤     ├──────┤
                          13:00   14:48  15:12  16:00
```

The write produces **two** `Activity_Segment` rows, `13:00–14:48` and `15:12–16:00`,
and reports `14:48–15:12` as `discarded` — the part of the request that fell in a
break. The `Activity_Entry` itself still remembers the original request
(`requestedStartedAt: 13:00`, `requestedEndedAt: 16:00`) for auditing; only the
segments follow the timer frame.

## User Interface

Four screens, reached from the same `Topbar` (desktop) / `BottomNav` (mobile) shell:

| Route          | Screen                                                          |
| -------------- | ---------------------------------------------------------------- |
| `/`            | Timer — start/stop, the running session, today's `Day_Gauge`     |
| `/day/[date]`  | Day timeline — every `Work_Session`/`Activity_Segment` for one day |
| `/projects`    | Project management — create, edit, archive                        |
| `/stats`       | Statistics — aggregated time by project over a range               |

`/login` and `/logout` are server-side auth actions (not shown in the nav); `/offline`
is the fallback page shown when the app cannot reach the server.

**Theme and locale.** Light and dark themes, Czech and English locales, both switched
from `SettingsMenu` (in the shell's top bar / mobile sheet) without a page reload.
Locale strings live in `messages/{locale}.json` (source) and compile to
`src/lib/paraglide/` at dev/build time via the Paraglide Vite plugin — nothing to run
by hand. Layout density (desktop/mobile) is resolved server-side from a
`worklog_viewport` cookie and corrected client-side on a mismatch.

**Change Preview.** Every session or activity create/edit dialog that can discard
tracked time or extend a session goes through the same `Dry_Run`/`Preview_Token`
mechanism the API exposes directly (see `dryRun` above): the dialog previews the
write, shows its consequences (discarded intervals, extended sessions, uncovered/lost
time) via the `ChangePreview` component, and only actually saves on a second,
explicit confirmation.

**Day timeline geometry.** The visual layout of `Work_Block`/`Uncovered_Marker`/
`Day_Gauge` is generated, not hand-tuned — `bun run generate:css`
(`scripts/generate-palette-and-heights.ts`) writes `src/lib/theme/palette.css` and
`src/lib/theme/timeline-heights.css` from the design tokens, and `bun run check` fails
if the committed files and a fresh generation disagree.

### Known Limitations

Real, currently-open gaps — listed here rather than left for a reader to discover the
hard way:

- **Four icons have no artboard source.** `search`, `sun`, `moon` and `check` in
  `Icon.svelte` render from a documented fallback geometry rather than a value traced
  from `.design/artboards/`.
- A handful of prose-only design surfaces (confirmation dialogs generically, toasts,
  empty states, skeletons, the login/error/offline pages, the timezone notice, the
  focus ring) have not had their token values independently re-checked against
  `.design/DESIGN.md`'s written description.

## Migrations

Forward-only. `migrations/*.sql` are numbered and applied in order by
`scripts/migrate.sh`, the only supported way to apply them — never run one by hand. A
mistake already shipped is corrected by a new migration, never by editing or removing
one that has run. On Fly, migration is the deploy's `release_command`: a non-zero exit
aborts the release and the previous version keeps serving.

**Changing `TIMEZONE` or `DAY_START_HOUR` regroups existing history** — every
`Logical_Day` boundary moves, so which day a given `Work_Session` or
`Activity_Segment` belongs to can change. The server therefore refuses to start when
the stored `Day_Boundary_Config` disagrees with the environment, unless
`ALLOW_DAY_BOUNDARY_CHANGE=true` is set for that one restart.

## The Gauge_Window

`GAUGE_START`–`GAUGE_END` is the interface's expected-working-hours dial, drawn as a
fixed 24-hour arc — an hour is always the same angle regardless of a `Logical_Day`
being 23, 24 or 25 hours long. Two rules the server checks at startup, refusing to run
otherwise:

- **`GAUGE_END` may wrap past midnight.** `GAUGE_END <= GAUGE_START` means the window
  ends on the _following_ calendar date — the default `06:00`–`00:00` describes
  eighteen hours, not zero or negative.
- **`DAY_START_HOUR` must fall inside the resulting gap** (the `Gauge_Gap`), and that
  gap must never contain an hour at which `TIMEZONE` changes offset. With the
  defaults — day start `03:00`, window `06:00`–`00:00` — the gap is `00:00`–`06:00`,
  comfortably clear of Prague's DST transitions (both between `02:00` and `03:00`).

## Testing

```bash
bun run check           # type and Svelte checks
bun run lint             # eslint
bun run test            # unit, property and integration tests (needs PostgreSQL)
bun run test:e2e:local  # Playwright, via scripts/test-e2e.sh (ephemeral PostgreSQL)
bun run test:all        # check + test + test:e2e:local — the intended gate before pushing
```

`bun run test` needs `TEST_DATABASE_URL` set (in `.env`), pointing at a database whose
name ends in `_test` and which differs from `DATABASE_URL` — the suite truncates every
table in it before each test. It is always run through
`scripts/run-vitest.sh`, never `bunx vitest` or `vitest` directly (see Troubleshooting).

## Troubleshooting

**`bun run test` (or anything importing both `postgres` and `zod` in one process)
silently produces `zod is not a constructor` or a similarly nonsensical error deep
inside a schema.** This project's `bunfig.toml` sets `[run] bun = true`, which puts a
shim directory at the front of `PATH` whose `node` is actually Bun itself — so even a
plain `node ...` call nested inside a shell script still runs under Bun, not real
Node, and Bun's transpiler has a reproducible bug that corrupts a separately-imported
`zod` named export once `postgres` is also loaded in the same process.
`scripts/run-vitest.sh` resolves the real, non-shimmed `node` explicitly and is the
only supported way to run the test suite — `package.json`'s `test`/`test:watch`/
`test:coverage` scripts already call it.

**`bun run dev`/`build`/`preview` fails configuration validation, or a login made
against a passphrase set through `.env` never succeeds.** Bun's automatic `.env`
loading — both the implicit kind under `bun run <script>` and the explicit
`--env-file=` — expands any `$name` sequence it finds in a value against other
environment variables, unconditionally, and quoting the value does not suppress it.
`WORKLOG_PASSPHRASE_HASH` is a real argon2id hash (`$argon2id$v=19$m=65536,...`), so
Bun's own loader silently mangles it before `loadConfig()` ever sees it. `package.json`'s
`dev`/`build`/`preview` scripts therefore route through `scripts/run-vite.sh`, which
exports `.env` itself with plain `read` (never re-parsed for expansion) before `exec`ing
`bun vite`, so Bun's loader never gets to touch the file at all. Confirmed live:
`bun --env-file=.env -e 'console.log(process.env.WORKLOG_PASSPHRASE_HASH)'` prints a
mangled hash with the `$argon2id$v=19$m=65536,t=3,p=1$` fragments stripped out. Never
invoke `vite`/`bunx vite` directly, and never add a new script that does — always go
through `bun run dev`/`build`/`preview` (or `scripts/run-vite.sh` itself).

**The server answers 503 `SERVICE_UNAVAILABLE` on every route except `/api/health`.**
The readiness probe failed — either the database is unreachable, a migration in
`migrations/` has not been applied yet (`./scripts/migrate.sh`), or the stored
`Day_Boundary_Config` disagrees with `TIMEZONE`/`DAY_START_HOUR` (see Migrations
above). `/api/health` still answers and names the reason in its `status` field.

**The server refuses to start at all, logging a list of configuration problems.** This
is `loadConfig()` failing fast — a missing or malformed environment variable, or one of
the `Gauge_Window`/`DAY_START_HOUR` invariants above. No request is ever served in
this state; fix the environment and restart. This is different from the 503 case
above, which is a database problem the process survives.

**A `Work_Session` overlaps the running timer but the database's own constraint did
not catch it.** Expected: the `EXCLUDE` constraint on `work_sessions` only sees
`ended_at IS NOT NULL` rows, since a database constraint cannot express a range whose
end is absent. The application checks the running timer explicitly, inside the same
transaction as the write, under the advisory lock — this is `sessionsConflictingWith`
in `src/lib/server/store/work-sessions.ts`.
