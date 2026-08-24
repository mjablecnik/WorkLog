# Implementation Plan: worklog-domain-api

## Overview

Build the `Worklog_Server` — the server-side half of the Worklog SvelteKit application: the pure reconciliation domain, the PostgreSQL data layer, the `Auth_Hook` and the REST routes under `/api`. Work proceeds bottom-up — the pure `domain` modules first, then the schema and stores against a real database, then reconciliation, authentication, and finally the routes.

The runtime is Bun 1.2.15 with SvelteKit ^2.63 on Svelte 5, Drizzle ORM over `postgres.js`, and Zod at every boundary. Pure logic is covered by Vitest unit tests and `fast-check` property tests that need no database; the schema guarantees and atomicity are covered by integration tests against a PostgreSQL container; routes are covered by direct handler tests. Test tasks follow the implementation task they validate, and four checkpoints mark the phase boundaries.

## Tasks

- [x] 1. Project scaffolding and server infrastructure
  - [x] 1.1 Initialize the SvelteKit project
    - Scaffold with Bun 1.2.15; set `packageManager`, `engines.bun`, `.npmrc` with `engine-strict=true`, and `bunfig.toml` with `[run] bun = true`
    - Dependencies, at the versions the workspace already resolves — `@sveltejs/kit` ^2.63.0, `svelte` ^5.56.1, `vite` ^8.0.16, `@sveltejs/adapter-node` ^5.5.7, `typescript` ^6.0.3 strict, `drizzle-orm` ^0.45.2, `zod` ^4.4.3, `@inlang/paraglide-js` ^2.18.2
    - Two dependencies no other workspace project uses, so take the major only and let `bun install` pin the exact version into `bun.lock`: `postgres` ^3.4.0 and `@date-fns/tz` ^1.0.0. Run `bun install` and read the lockfile before committing — a version that does not resolve stops this task, and every other task, dead
    - Dev dependencies: `vitest` ^4.1.10, `fast-check` ^4.9.0 declared explicitly, `@playwright/test` ^1.62.1, `drizzle-kit` ^0.31.10, `bun-types` ^1.3.14, `eslint`, `prettier`
    - Scripts matching the workspace: `dev`, `build`, `preview`, `prepare`, `messages:compile`, `check`, `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:local`, `test:all`, `lint`, `format`
    - Set `version` in `package.json` to `0.1.0` as the single source of truth; nothing else may declare a version
    - Aliases in `svelte.config.js`: `$lib`, `$db`, `$modules`; `compilerOptions.runes: true`
    - Configure `kit.csp` in `svelte.config.js` with `mode: 'nonce'` and the directives from design component 9, `'font-src': ['self']` among them — Inter Tight is self-hosted and must not depend on the `default-src` fallback, and no directive in any environment names a Google Fonts host. This is where the `Content-Security-Policy` is built: only SvelteKit can nonce its own inline hydration script, so a hand-assembled strict policy blocks hydration in a production build
    - **Create four minimal build inputs that `002` later replaces**, because `bun run build` cannot run without them and checkpoint 12 has to be reachable from this specification alone:
      - `src/app.html` as a bare shell — `<!doctype html><html lang="%lang%" data-theme="%theme%"><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>`
      - `project.inlang/settings.json` with `baseLocale: "en"`, `locales: ["en", "cs"]`, `pathPattern: "./messages/{locale}.json"` and the message-format plugin
      - `messages/en.json` and `messages/cs.json` holding **only** the error keys of the design's Error Handling table — the keys `001` itself emits as `messageKey`
      - `static/.gitkeep`, because `adapter-node` copies `static/` and the build fails without the directory
      `002` owns the content of all four and rewrites them freely — the pre-paint markup, the full message catalogue, the fonts. `001` creates them once here and never edits them again. Without this, `001` depends on four artefacts only `002` produces and cannot build on its own, which contradicts the whole two-specification split
    - Commit `bun.lock`
    - _Requirements: 12.14, 13.8, 13.9, 13.10_

  - [x] 1.2 Implement configuration in `src/lib/server/core/config.ts`
    - Define `Config` and `loadConfig()` per design component 12, reading `version` from `package.json`
    - Defaults: `PORT=3000`, `TIMEZONE=Europe/Prague`, `DAY_START_HOUR=3`, `GAUGE_START=06:00`, `GAUGE_END=00:00`, `EVENING_HOUR=21`, `APP_ENV=production` (accepting `development`, `test` and `production` only — `test` exists so the E2E run has an environment of its own), `DB_QUERY_TIMEOUT_SECONDS=5`, `RATE_LIMIT_PER_MINUTE=120`, `SESSION_DURATION_HOURS=720`, `MAX_OPEN_SESSION_HOURS=12`, `MIN_INTERVAL_SECONDS=60`, `ALLOW_DAY_BOUNDARY_CHANGE=false`
    - When `GAUGE_END` is less than or equal to `GAUGE_START`, take the end as falling on the following date — without this the default `06:00`–`00:00` measures zero hours
    - Reject a `Gauge_Window` shorter than 1 hour or longer than 24
    - Implement and apply `dayStartIsInGaugeGap`: reject a configuration in which the hour named by `DAY_START_HOUR` falls inside the `Gauge_Window`, because the window would then straddle a `Logical_Day` boundary and stop being one continuous stretch
    - Reject a `Gauge_Window` containing an hour at which `TIMEZONE` changes offset, checked against the zone's actual transitions for the coming year — the gap invariant does **not** imply this: `GAUGE_START=00:00`, `GAUGE_END=22:00`, `DAY_START_HOUR=23` passes it and still contains the transition
    - Reject a `DAY_START_HOUR` naming an hour that does not exist or occurs twice in `TIMEZONE` — `2` in `Europe/Prague` is exactly that
    - Also read `TRUSTED_PROXY_HOPS` (default `0`, range 0..8), `LOG_LEVEL` (default `info`, one of `debug` `info` `warn` `error`), `DB_POOL_MAX` (default `10`, range 1..100), and default `CORS_ORIGINS` to the empty list so an unset value admits nothing cross-origin
    - Enforce a range on every numeric variable and refuse to start outside it: `PORT` 1..65535, `DB_QUERY_TIMEOUT_SECONDS` 1..60, `DB_POOL_MAX` 1..100, `RATE_LIMIT_PER_MINUTE` 1..10000, `SESSION_DURATION_HOURS` 1..8760, `MAX_OPEN_SESSION_HOURS` 1..24, `MIN_INTERVAL_SECONDS` 1..3600, `TRUSTED_PROXY_HOPS` 0..8, `DAY_START_HOUR` and `EVENING_HOUR` 0..23
    - Declare every `Fixed_Constant` here, since this file is the one place configuration lives, with exactly these values: `MAX_RANGE_DAYS = 366`, `MAX_INTERVAL_RANGE_DAYS = 62`, `ACTIVITY_PAGE_SIZE = 200`, `ERROR_DETAIL_SAMPLE_SIZE = 10`, `FUTURE_TOLERANCE_SECONDS = 300`, `SUGGESTED_WINDOW_COVERAGE = 0.9`, `CLEANUP_INTERVAL_MINUTES = 60`, `SERVICE_RETRY_AFTER_SECONDS = 5`, `LOGIN_ATTEMPT_LIMIT = 5`, `LOGIN_ATTEMPT_WINDOW_MINUTES = 15`, `IDEMPOTENCY_RETENTION_HOURS = 24`, `SESSION_TOKEN_BYTES = 32`, `MAX_BODY_BYTES = 1048576`, `SHUTDOWN_GRACE_SECONDS = 30`, `WORKLOG_ADVISORY_LOCK = 4919372001`, and `ARGON2ID = { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 }`
    - No other module may repeat any of these numbers — `tx.ts` imports the lock constant from here rather than declaring its own
    - Validate: `DATABASE_URL` non-empty; `WORKLOG_API_TOKEN` at least 32 characters; `WORKLOG_PASSPHRASE_HASH` present and parseable as argon2id; `DAY_START_HOUR` in 0..23; `EVENING_HOUR` in 0..23; `TRUSTED_PROXY_HOPS` a non-negative integer; `TIMEZONE` loadable
    - Reject `CORS_ORIGINS=*` unless `APP_ENV` is `development`
    - `APP_ENV` is one of `development`, `test`, `production`. **`test` relaxes exactly one thing: `Secure` is omitted from cookies.** Nothing else — not the CSP, not CORS, not the token length. The E2E run drives `http://localhost`, where a `Secure` cookie is discarded and login can never succeed; that is the whole reason the value exists
    - `PUBLIC_ORIGIN` is required when `APP_ENV` is `production`, and is exported to `adapter-node` as `ORIGIN` at startup. `PROTOCOL_HEADER`/`HOST_HEADER` are deliberately not used — they trust caller-supplied headers
    - Throw once listing every problem, not just the first
    - _Requirements: 1.13, 2.4, 3.7, 4.10, 7.5, 7.13, 8.10, 8.13, 8.18, 9.6, 10.4, 10.5, 10.9, 10.13, 11.6, 11.13, 11.16, 11.17, 11.20, 11.21, 12.6, 12.9, 12.22, 13.5, 13.6, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 13.18, 13.19, 13.20, 13.21, 13.22, 13.23, 13.26, 13.27, 13.28, 13.29, 13.30, 13.33, 13.34, 13.35_

  - [x] 1.3 Implement logging and request identity
    - `src/lib/server/core/logger.ts`: JSON lines to stdout carrying `timestamp`, `level`, `message`, `requestId`; a redaction helper used wherever a secret could reach a log call
    - `src/lib/server/core/request-id.ts`: read `X-Request-Id`, generate a UUID when absent, expose it on `locals`, echo it back
    - Declare `App.Locals` in `src/app.d.ts` with `requestId`, `auth`, `today`, `locale` and `theme`. There is **no** `cspNonce`: `kit.csp` owns the nonce and nothing on `locals` ever holds one, so declaring the field would leave an always-undefined property for someone to build on
    - _Requirements: 11.9, 12.10, 12.11_

  - [x] 1.4 Implement the error envelope in `src/lib/server/core/errors.ts`
    - Define the `ErrorCode` union, `ApiError`, `errorResponse()` and `messageKeyFor()` per design component 8, including `SERVICE_UNAVAILABLE` (503) for an unreachable database or a query past `DB_QUERY_TIMEOUT_SECONDS` — a caller must be able to tell a transient failure from a defect and retry
    - Fix the field-naming rule in one place and apply it to every route: JSON bodies use `camelCase`, query parameters use `snake_case`
    - Implement `fieldMessageKeyFor(issue)` returning a `fields_*` key per failing field, from the enumerated table in design component 8 — a schema's English sentence must never reach the screen, and `002` tests its catalogue against that list, so the keys are looked up, never computed
    - Implement the 405 handler: SvelteKit's own method-not-allowed response is a bare framework error, not this envelope, so catch it and re-emit `METHOD_NOT_ALLOWED` with the `Allow` header and the standard body
    - The body carries `error`, an English `message`, a `messageKey`, the `requestId`, and optional `details` — the request id is in the **body** as well as the header, because it is the only thing a user can quote about a 500
    - Populate `details` for every code exactly as the design's Error Handling table specifies. The test of a code's details is whether the interface can write a complete sentence from the response alone: `NOTHING_TO_LOG` therefore carries a `reason` of `empty-interval`, `no-tracked-time`, `already-covered` or `all-slivers` rather than leaving the client to guess between four different explanations; `STALE_PREVIEW` carries both tokens; `PROJECT_IN_USE` carries the blocking entries themselves, not a count; `SESSION_OVERLAP` marks whether the conflict is the running timer; `RATE_LIMITED` says whether the bucket was the request bucket or the login one
    - Cap any list in `details` at `ERROR_DETAIL_SAMPLE_SIZE` and send the full count beside it
    - Map any unknown error to 500 `INTERNAL_ERROR`, logging the real cause with the `requestId`
    - Never place stack traces, SQL text or filesystem paths in a response body
    - _Requirements: 3.7, 4.5, 12.1, 12.2, 12.3, 12.5, 12.15, 12.19, 12.20, 12.21, 12.34_

  - [x] 1.5 Implement security headers in `src/lib/server/core/security-headers.ts`
    - The `Content-Security-Policy` — including `frame-ancestors 'none'` — comes from `kit.csp` in `svelte.config.js` (task 1.1). **Do not assemble it in the hook.** A handwritten strict policy cannot nonce SvelteKit's own inline hydration script, so the production build renders a page that never hydrates, and the only way to make it work again is `unsafe-inline`, which Requirement 12.13 forbids
    - The CSP goes on **rendered pages only**; `/api` JSON responses carry the other three headers and no policy, because a JSON body executes nothing
    - `handleSecurityHeaders` sets only what `kit.csp` does not: `Strict-Transport-Security` (production only), `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`
    - Its `transformPageChunk` performs two substitutions: `%lang%` → `locals.locale` and `%theme%` → `locals.theme` resolved to `light` or `dark`, never the literal `system` (task 7.4). It performs **no nonce injection** — that is `kit.csp`'s job
    - **Do not edit `src/app.html` beyond the bare shell task 1.1 creates.** Its content belongs to `002-worklog-ui`, which authors it with `<html lang="%lang%" data-theme="%theme%">` and with `%sveltekit.nonce%` for any inline script of its own
    - The production policy carries neither `unsafe-inline` nor `unsafe-eval` in `script-src` or `style-src`; `002` colours projects through eight static classes rather than an inline custom property, so nothing needs an inline `style`
    - Development relaxes the policy in one place only: `svelte.config.js` selects its `csp.directives` from `APP_ENV`, and the development set adds `'unsafe-inline'` and `'unsafe-eval'` to `script-src` and `'unsafe-inline'` to `style-src` for Vite and HMR; `handleSecurityHeaders` omits `Strict-Transport-Security` outside production. Nothing else differs and the production set is never derived from the development one
    - _Requirements: 12.12, 12.13, 12.33_

  - [x] 1.6 Write unit tests for configuration, errors and headers
    - `tests/lib/server/core/config.test.ts`: defaults applied; missing `DATABASE_URL`, short token and missing passphrase hash each rejected; `DAY_START_HOUR=24` rejected; `EVENING_HOUR=24` rejected; bad `TIMEZONE` rejected; wildcard CORS rejected outside development; several failures reported together; version comes from the manifest
    - Gauge window: the default `06:00`–`00:00` measures 18 hours, not 0; `22:00`–`02:00` measures 4; a window of 30 minutes and one of 25 hours are both rejected
    - `dayStartIsInGaugeGap`: the default `DAY_START_HOUR=3` against the default window passes; `DAY_START_HOUR=0` also passes, since the window is half-open and midnight is the gap's first instant; `DAY_START_HOUR=12` against the default window is rejected; `DAY_START_HOUR=6` against `GAUGE_START=04:00`, `GAUGE_END=00:00` is rejected — that is the configuration where the `Gauge_Window` would split into two arcs on different `Logical_Day` values
    - The DST checks: `GAUGE_START=00:00`, `GAUGE_END=22:00`, `DAY_START_HOUR=23` in `Europe/Prague` is **rejected** even though it satisfies the gap invariant, because 02:00 falls inside the window; `DAY_START_HOUR=2` in `Europe/Prague` is rejected as non-existent-or-ambiguous, while `DAY_START_HOUR=2` in `UTC` is accepted
    - Every `Fixed_Constant` is exported and holds its specified value, so nothing downstream hard-codes 366, 62, 200, 300 or 0.9
    - Each numeric range is enforced at both ends: `PORT=0`, `DB_QUERY_TIMEOUT_SECONDS=61`, `MAX_OPEN_SESSION_HOURS=25`, `TRUSTED_PROXY_HOPS=9` and `LOG_LEVEL=verbose` are each rejected; an unset `CORS_ORIGINS` yields an empty list rather than a wildcard
    - `tests/lib/server/core/errors.test.ts`: every `fields_*` key in the design table is reachable from some Zod issue and an unknown issue falls back to `fields_invalid`; the envelope carries `error`, an English `message`, a `messageKey`, the `requestId` and optional `details`; `message` is prose and `messageKey` is a key, never swapped; every `ErrorCode` maps to a distinct key; unknown error becomes `INTERNAL_ERROR` 500; a stack trace never reaches the body
    - Every `ErrorCode` that the design's table gives `details` for produces exactly those fields — the assertion that keeps a client from having to guess
    - `tests/lib/server/core/security-headers.test.ts`: a rendered page response carries all five headers; the production CSP is free of `unsafe-inline` and `unsafe-eval` in both `script-src` and `style-src`; the nonce differs between requests; SvelteKit's own hydration script carries that nonce — the assertion that fails when the policy is assembled by hand instead of by `kit.csp`
    - _Requirements: 10.9, 11.16, 11.17, 12.2, 12.3, 12.12, 12.13, 13.9, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17_

  - [x] 1.7 Create `.env.example` and fix `.gitignore`
    - `.env.example` lists every variable `loadConfig` reads, with no exceptions: `PORT`, `DATABASE_URL`, `WORKLOG_API_TOKEN`, `WORKLOG_PASSPHRASE_HASH`, `TIMEZONE`, `DAY_START_HOUR`, `GAUGE_START`, `GAUGE_END`, `EVENING_HOUR`, `APP_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`, `TRUSTED_PROXY_HOPS`, `DB_QUERY_TIMEOUT_SECONDS`, `DB_POOL_MAX`, `RATE_LIMIT_PER_MINUTE`, `SESSION_DURATION_HOURS`, `MAX_OPEN_SESSION_HOURS`, `MIN_INTERVAL_SECONDS`, `ALLOW_DAY_BOUNDARY_CHANGE` — grouped by comments, placeholders for the two secrets and real defaults everywhere else
    - Point the `WORKLOG_PASSPHRASE_HASH` placeholder at `./scripts/hash-passphrase.sh`, so nobody has to work out how the value is produced
    - Add `TEST_DATABASE_URL` with the placeholder `postgres://worklog:worklog@localhost:5432/worklog_test` and the comment `# Integration and E2E tests only. MUST NOT equal DATABASE_URL — the suites truncate every table.` It is required only when `APP_ENV=test` and is never read otherwise
    - Write `scripts/hash-passphrase.sh` here rather than with the other operational scripts in task 11.3. `loadConfig` refuses to start without a parseable hash from task 1.2 onward, so a generator delivered in the final wave would leave every wave before it with no runnable server
    - `.gitignore` covers `.env`, `.env.*`, `!.env.example`, `src/lib/paraglide/`, `build/`, `node_modules/`, `.svelte-kit/`
    - _Requirements: 13.8, 13.11, 13.16, 13.18, 13.19, 13.20, 13.21_

  - [x] 1.8 Declare the shared contracts in `src/lib/contracts/`
    - Every schema from the design's Field Naming and the Shared Schemas section: `createActivitySchema`, `patchActivitySchema`, `createSessionSchema`, `startSessionSchema`, `stopSessionSchema`, `patchSessionSchema`, `createProjectSchema`, `patchProjectSchema`, `loginSchema`, and the query schemas `listActivitiesQuery`, `listSessionsQuery`, `listProjectsQuery`, `daysQuery`, `coverageQuery`, `deleteSessionQuery` and `deleteActivityQuery`, plus `dryRunFields` and the inferred types. There is **no** `deleteSessionSchema`: a DELETE carries its dry-run flags as `dry_run` and `preview_token` **query parameters**, in snake_case like every other query parameter, and that is the single spelling — `dryRun`/`previewToken` on a DELETE is a 400 from `.strict()`
    - `src/lib/contracts/constants.ts` declares `MAX_RANGE_DAYS = 366`, `MAX_INTERVAL_RANGE_DAYS = 62` and `ACTIVITY_PAGE_SIZE = 200` as pure data. The schemas need them (`limit` is capped at `ACTIVITY_PAGE_SIZE`) and `lib/contracts` may not import from `lib/server`, so `core/config.ts` re-exports these three from here instead of declaring them again. The policy field is `untrackedPolicy` — it governs what happens to the part of a request lying in `Untracked_Time`, and the old name said the opposite of what it does
    - **The path is deliberate: `src/lib/contracts/`, outside `src/lib/server/`.** `002` validates the same forms in the browser through superforms **and types its components with the same domain types**, and nothing under `lib/server/` may be imported by client code
    - The directory imports `zod` and nothing else — no database client, no `$env`, no `$app/server`, no SvelteKit runtime, no Drizzle. It must be safe to ship to the browser
    - This specification owns the directory. `002` imports from it and never declares a schema or re-declares a type of its own, so the REST routes, the form actions and the components cannot drift apart
    - Every schema is `.strict()`, so an unknown field is rejected wherever the body is parsed
    - JSON bodies name fields in `camelCase`; query parameters stay `snake_case` and are parsed at the route
    - _Requirements: 12.1, 12.4_

  - [x] 1.9 Write `vitest.config.ts`, `playwright.config.ts` and the test setup
    - **There is no "workspace pattern" to follow.** This repository contains no other project, so every reference to one in either specification means this task. It is the pattern
    - `vitest.config.ts` declares three projects, because they need different environments and different concurrency:
      ```ts
      test: { projects: [
        { test: { name: 'domain', environment: 'node',
                  include: ['tests/lib/server/domain/**/*.test.ts', 'tests/lib/viz/**/*.test.ts'] } },
        { test: { name: 'server', environment: 'node',
                  include: ['tests/lib/server/**/*.test.ts', 'tests/api/**/*.test.ts'],
                  exclude: ['tests/lib/server/domain/**'],
                  setupFiles: ['tests/setup/db.ts'],
                  poolOptions: { threads: { singleThread: true } } } },
        { test: { name: 'components', environment: 'jsdom',
                  include: ['tests/modules/**/*.test.ts', 'tests/lib/theme/**/*.test.ts',
                            'tests/lib/ui/**/*.test.ts', 'tests/lib/*.test.ts'],
                  setupFiles: ['tests/setup/dom.ts'] } }
      ] }
      ```
      The `components` globs also carry `002`'s theme, design-system, i18n and CSP suites, which
      live under `tests/lib/theme/`, `tests/lib/ui/` and `tests/lib/` directly. A project list that
      only names `tests/modules/**` silently runs none of them — Vitest reports success over the
      files it matched and says nothing about the five it did not.

      `domain` keeps full parallelism — it touches no database. `server` is single-threaded because its suites share one database and truncate between tests, so parallel workers would truncate each other's fixtures
    - `playwright.config.ts`: `testDir: 'tests/e2e'`, `workers: 1`, `fullyParallel: false`, `retries: 0`, `use.baseURL` pointing at the preview server, and a `webServer` running `bun run preview` with `APP_ENV=test` and `TEST_DATABASE_URL` in its environment, `reuseExistingServer: !process.env.CI`
    - Extend Playwright's `test` with a worker-scoped auto fixture calling the same `resetDb()` from task 4.9, so an E2E run starts from an empty database exactly as the integration suites do
    - Wire the `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:local` and `test:all` scripts of task 1.1 to these two files, and state what distinguishes `test:e2e` from `test:e2e:local` — or drop whichever is redundant, rather than shipping two names for one thing
    - _Requirements: 13.8_

- [x] 2. Pure domain — interval algebra and logical day
  - [x] 2.1 Implement the interval algebra in `src/lib/server/domain/interval.ts`
    - Define `Interval` as half-open `[start, end)` and implement `isEmpty`, `duration`, `overlaps`, `normalize`, `union`, `intersect`, `subtract`, `clamp`, `total`, `take`, `gaps` per design component 1
    - `normalize` sorts by start, drops empty intervals, merges overlapping **and touching** ones
    - `take(input, ms, minIntervalMs)` splits the interval in which the requested duration runs out, **never emits a piece shorter than `minIntervalMs`**, **skips a stretch already below the floor and carries on past it**, and reports everything it could not place as the remainder. Stopping at a thirty-second fragment in the middle of `eligible` would strand the hours after it. Without the floor here the walk ends in a sliver that `clip` must throw away, and then placed + unplaced no longer equals what was asked for
    - The module imports nothing from the project, no Drizzle and no SvelteKit
    - _Requirements: 9.2, 9.3_

  - [x] 2.2 Write unit tests for the interval algebra
    - `tests/lib/server/domain/interval.test.ts`: empty input; single interval; touching merge; overlapping merge; disjoint stay separate
    - `subtract` producing a hole in the middle, at the head, at the tail, and eliminating an interval entirely
    - `take` with zero, less than the first interval, exactly the first interval, spanning two intervals, and exceeding the total; and the floor case — eligible `[11:00–12:00, 13:00–16:00]` with `ms = 1 h 0 min 20 s` and `minIntervalMs = 60 s` emits no 20-second tail and reports those 20 seconds as remainder
    - `gaps` over a window wider than, narrower than and equal to the input
    - _Requirements: 9.2, 9.3_

  - [x]* 2.3 Write property tests for the interval algebra
    - `tests/lib/server/domain/interval.property.test.ts` with generators producing unsorted lists with duplicates and zero-length entries
    - **Property 4: Interval algebra is conservative** — `total(intersect(a,b)) + total(subtract(a,b)) === total(normalize(a))`
    - **Property 5: Normalization is idempotent and canonical**
    - **Property 6: Take is exact and order-preserving**
    - **Validates: Requirements 5.8, 5.10, 9.2, 9.3**

  - [x] 2.4 Implement `createDayResolver` in `src/lib/server/domain/logical-day.ts`
    - Use `TZDate` from `@date-fns/tz` for DST-correct arithmetic
    - Throw when the timezone is not loadable or `startHour` is outside 0..23
    - `bounds(date)` runs from `startHour` to `startHour` the next date; `dateOf(t)` attributes instants before `startHour` to the previous date; `range(from, to)` yields one window per day
    - Throw when the hour named by `startHour` does not exist or is ambiguous in that zone — `startHour = 2` in `Europe/Prague` is both, twice a year
    - Fix the fold policy explicitly and apply it in `bounds`, `dateOf` and `range` alike: an ambiguous wall-clock time takes the **earlier** offset, a non-existent one moves **forward** to the first instant that exists. If the two functions disagree, an instant can fall outside `bounds(dateOf(t))` and Property 12 fails on exactly two days a year
    - _Requirements: 10.4, 10.5, 10.6, 10.13, 10.14_

  - [x] 2.5 Write unit tests for the logical day
    - `tests/lib/server/domain/logical-day.test.ts`: `02:30` belongs to the previous date; `03:00` and `23:59` to the current one
    - Pin the DST dates exactly — with `startHour = 3` in `Europe/Prague` the **day before** each transition is the irregular one: `2026-03-28` is 23 hours, `2026-10-24` is 25 hours, and both transition dates are 24. Do not assume the transition date itself is short or long.
    - `startHour = 0` behaves as a plain calendar day; a malformed date string is rejected
    - _Requirements: 10.4, 10.5, 10.6_

  - [x]* 2.6 Write a property test for the logical day
    - `tests/lib/server/domain/logical-day.property.test.ts` over several years including both transitions
    - **Property 12: Logical day assignment is a partition**
    - **Validates: Requirements 10.5, 10.6**

  - [x] 2.7 Implement the shared types in `src/lib/contracts/models.ts` and `responses.ts`
    - `Interval`, `WorkSession`, `Project` (carrying `archived` and `updatedAt` beside `archivedAt`), `ActivityEntry`, `ActivitySegment`, `ActivityMode`, `NewActivityEntry`, `ProjectTotal`, `ProjectInterval` in `models.ts`; every response shape — `ActivityResponse`, `ActivityListResponse`, `SessionListResponse`, `ProjectListResponse`, `SessionWriteResponse`, `SessionChangePreview`, `CurrentSessionResponse`, `DaySummary`, `DaysRangeResponse`, `DayResponse`, `CoverageResponse`, `HealthResponse` — in `responses.ts`
    - **Not under `lib/server/domain/`.** `002` types its components with these, and the Module Boundaries forbid `lib/ui`, `modules` and the routes from importing anything under `lib/server/`; declared there, the interface would have nothing to compile against and would end up with a second copy that drifts. `src/lib/server/domain/interval.ts` imports `Interval` from here and contributes only the algebra
    - Every shape that names a `Project` carries its `colorIndex` as well: `ActivityEntry`, `ProjectTotal`, `ReclipOutcome` and the `ACTIVITY_OVERLAP` conflict details. The timeline, the gauge, the legend, the statistics breakdown and the rhythm strip all colour by project, and none of them may fetch the project list to do it
    - `ActivityEntry` carries a **non-null** resolved requested interval in every mode, the requested duration where one was given, and an `orphaned` flag
    - `WorkSession` carries a `stale` flag, derived at read time and never stored, so every response carrying a session carries the `Stale_Session` answer with it
    - `ProjectTotal` carries `archived`, so an archived project holding time in a range is still recognisable in a breakdown
    - Serialize every timestamp as RFC 3339 in UTC
    - _Requirements: 1.10, 4.2, 5.13, 7.3, 7.15, 8.5, 8.16, 10.1, 10.3, 14.2_

- [x] 3. Checkpoint — pure domain proven
  - Run `bun run check && bun run test tests/lib/server/domain tests/lib/server/core` with no database running

- [x] 4. Schema and data layer
  - [x] 4.1 Write `migrations/001_init.sql`
    - Create `btree_gist`, then `projects`, `work_sessions`, `activity_entries`, `activity_segments`, `auth_sessions`, `idempotency_keys` and `day_boundary_config` exactly as in the design Data Models section
    - **Do not create `schema_migrations` here.** `scripts/migrate.sh` creates it before applying anything, so a second `CREATE TABLE` without `IF NOT EXISTS` raises 42P07 on a clean database and no migration ever succeeds. One owner: the script
    - Primary keys are UUID v7 generated by the application (`Bun.randomUUIDv7()`), never v4 and never `gen_random_uuid()` — v7 is time-ordered, so inserts stay at the right edge of every index
    - `projects` carries `updated_at` with its own `set_updated_at` trigger, like `work_sessions` and `activity_entries`
    - `idempotency_keys` carries `status` and `request_hash` and constrains the key to 1–200 characters of `[A-Za-z0-9_-]`
    - Include `work_sessions_one_open`, the gist range index on `work_sessions`, both `EXCLUDE USING gist` constraints, `projects_name_unique` on `lower(btrim(name))`, and every check constraint
    - Declare `activity_segments_no_overlap` as `DEFERRABLE INITIALLY DEFERRED`
    - Create `set_updated_at()` and its triggers on `work_sessions` and `activity_entries`
    - Create `day_boundary_config` empty. The migration must not seed it: it knows neither `TIMEZONE` nor `DAY_START_HOUR`, and the row is written at startup by task 7.4
    - `activity_entries_mode_fields` requires a resolved interval in **every** mode, with `requested_duration_minutes` additionally required for `duration` — a duration entry with no interval has a null sort key, nothing to re-place it by and no handle to find it by once it is emptied
    - Add `activity_entries_requested_range` as a gist index over `tstzrange(requested_started_at, requested_ended_at)`, because re-clipping and orphan lookup both select by requested interval
    - `idempotency_keys.entry_id` is `ON DELETE SET NULL`, never `CASCADE`: cascading deletes the key with the entry, so the next retry creates a second one. Store the HTTP `status` beside the response body
    - _Requirements: 1.9, 2.9, 3.2, 3.3, 4.5, 4.8, 5.13, 6.4, 7.13, 10.10, 11.7, 12.8, 12.17, 12.18, 13.7_

  - [x] 4.2 Write `scripts/migrate.sh`
    - `#!/bin/bash` with `set -euo pipefail` and the **Script Portability preamble**, which is these three lines and is identical in every script of this project:
      ```bash
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
      cd "${PROJECT_ROOT}"
      ```
      It makes every script runnable from any working directory, which is what `dploy` and the deploy flow assume
    - Take the environment name as `$1`, defaulting to the local `.env`
    - Take a session advisory lock first, so two concurrent runs cannot interleave
    - Create `schema_migrations` when absent, then apply each unapplied `migrations/*.sql` in filename order inside a transaction, recording the filename
    - Idempotent — a second run applies nothing and exits 0
    - This is the only supported way to apply migrations; `drizzle-kit migrate` is not used, because the exclusion constraints are not expressible in the Drizzle DSL. There are no down migrations: a mistake is corrected by a new forward migration.
    - The script **creates the database if it does not exist** (`CREATE DATABASE` against the maintenance database when the connection fails with 3D000), so a fresh machine needs only PostgreSQL running and a `DATABASE_URL`; nothing else provisions it
    - _Requirements: 13.8_

  - [x] 4.3 Write the Drizzle schema in `src/db/schema/`
    - One file per table plus a barrel `index.ts`, mirroring the SQL for typed queries
    - Do not express `EXCLUDE` constraints, expression indexes or triggers here — the SQL is the authority
    - _Requirements: 1.1, 3.1, 4.1, 11.7_

  - [x] 4.4 Implement the transaction helper in `src/lib/server/store/tx.ts`
    - Build the Drizzle client over `postgres.js` with the configured query timeout
    - `withTx(fn, { dryRun })` opens a transaction, runs `select pg_advisory_xact_lock($1)` with `WORKLOG_ADVISORY_LOCK` imported from `core/config.ts` first, runs `fn`, then commits — or rolls back when `dryRun` is set, by throwing a private rollback signal caught outside
    - **In the `dryRun` branch, issue `SET CONSTRAINTS ALL IMMEDIATE` after `fn` resolves and before the rollback.** `activity_segments_no_overlap` is `DEFERRABLE INITIALLY DEFERRED`, so it is checked at `COMMIT` — which a dry run never reaches. Without this statement the dry run reports success for a write that then fails, and the guarantee the whole preview rests on is false
    - Add `withReadTx(fn)`: the same transaction **without** the exclusive advisory lock and at **REPEATABLE READ**, for every read-only path. The isolation level is not optional — a day response issues several statements, and at READ COMMITTED a concurrent write lands between two of them, so `covered` can come from after a write whose `tracked` came from before it and Property 7 fails intermittently. The `Auth_Hook` looks a session up on every request, so routing reads through `withTx` would put the global write lock in front of all traffic and fail healthy requests at the query timeout
    - `translateConstraintError(err, op)` maps SQLSTATE and constraint name to `ApiError` codes, taking the operation because `activity_entries_project_id_fkey` means `PROJECT_IN_USE` (409) when deleting a project and `VALIDATION_ERROR` (400) when writing an entry against a project that does not exist
    - Build the pool with `max: DB_POOL_MAX` (10) and enforce `DB_QUERY_TIMEOUT_SECONDS` as `statement_timeout` **on the connection**, not as a JavaScript timer — a timer abandons the client while the server keeps executing. A cancellation arrives as SQLSTATE 57014 and maps to 503 `SERVICE_UNAVAILABLE`; register a shutdown handler on `sveltekit:shutdown` closing it, and set `SHUTDOWN_TIMEOUT` to `SHUTDOWN_GRACE_SECONDS` (30) so `adapter-node` drains before exiting 0
    - _Requirements: 6.11, 12.15, 13.5, 13.6, 14.1, 14.3, 14.5_

  - [x] 4.5 Implement `src/lib/server/store/work-sessions.ts`
    - Open, close, current, get, list overlapping, create closed, update, delete, insert many
    - `trackedIntervals` returns normalized intervals, treating an `Open_Session` as running until `now` **but never longer than `MAX_OPEN_SESSION_HOURS`**, so an abandoned timer cannot inflate totals
    - Every function returning a `WorkSession` sets its `stale` flag from `now` and `MAX_OPEN_SESSION_HOURS`, and never closes the session itself
    - `sessionsConflictingWith` reports overlaps **including the `Open_Session`**, read as `[startedAt, now)` — **uncapped**, unlike `trackedIntervals`. The `EXCLUDE` constraint is declared `WHERE (ended_at IS NOT NULL)`, so the database does not stop a closed session being written straight across a running timer; this query, called inside the writing transaction under the advisory lock, is what does. The cap belongs to totalling: capping it here leaves a `Stale_Session`'s tail invisible to the guard *and* outside `Tracked_Time`, so `extend` fills it and the next stop can never succeed (Requirements 1.15, 6.18)
    - _Requirements: 1.1, 1.5, 1.8, 1.10, 1.11, 1.12, 1.15, 1.16, 2.1, 2.2, 2.5, 2.8_

  - [x] 4.6 Implement `src/lib/server/store/projects.ts`
    - Create, list with `includeArchived`, update name, archived state and colour index, delete
    - Translate the uniqueness violation to `PROJECT_EXISTS`; on a foreign-key violation return `PROJECT_IN_USE` from `entriesBlockingProject`, which yields the total count plus up to `ERROR_DETAIL_SAMPLE_SIZE` entries with their description and requested interval — the fields the error promises, so the client writes its sentence without fetching them back
    - `createProject` assigns `colorIndex` as the lowest value in 0..7 not held by a non-archived project; when all eight are taken it assigns the index held by the fewest non-archived projects, lowest index winning a tie, so a ninth project is coloured deterministically rather than by an unstated rule. Renaming, archiving and unarchiving never change it
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

  - [x] 4.7 Implement `src/lib/server/store/activities.ts`
    - Every function from design component 6, including `orphanedEntriesOverlapping` and `entryIdsForProject`; `listEntriesOverlapping` orders by `requestedStartedAt, createdAt, id` — the one total order every listing and the cursor share, and the only one an `Orphaned_Entry` has a key in
    - `createEntry` writes the `Activity_Entry` and its `Activity_Segment` rows together; `replaceSegments` deletes then reinserts, relying on the deferred constraint
    - `coveredIntervals` accepts an `Activity_Entry` to exclude; `entriesOverlapping` orders by `requestedStartedAt` then `createdAt`
    - `listEntriesOverlapping` joins the `Project` name, attaches the `Activity_Segment` rows, sets `orphaned`, and unions in every `Orphaned_Entry` selected by requested interval; it takes `ACTIVITY_PAGE_SIZE` and a cursor and returns `nextCursor`, keyed on `(requestedStartedAt, createdAt, id)` so paging is stable
    - `entriesAffectedBy` selects the union of "a segment intersects the affected intervals" **and** "the requested interval intersects them", taking `Interval[]` rather than one interval — an entry an earlier change emptied owns no segment and is otherwise unreachable for ever
    - `src/lib/server/store/aggregates.ts`: `daySummaries`, `dayIntervals` and `suggestedWindow` compute the `/api/days` figures **in SQL** over the requested day windows. A 366-day range must not be answered by reading a year of sessions and segments into the process and reducing in TypeScript; the day boundaries are passed in from the `DayResolver`, so the database never reasons about the `Logical_Day`
    - _Requirements: 4.1, 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.11, 7.13, 7.14, 8.4, 8.5, 8.9, 8.11, 8.12, 8.13, 8.15, 8.16, 8.19_

  - [x] 4.8 Write integration tests for the schema constraints
    - `tests/lib/server/store/schema.test.ts` against PostgreSQL 16 started with plain `docker run` on the sandbox network and reached by container name
    - **Every database-touching Vitest project runs single-threaded** (`poolOptions.threads.singleThread: true`): the suites share one database and truncate between tests, so parallel workers would truncate each other's fixtures and fail at random. The pure-domain project keeps full parallelism
    - A second `Open_Session` rejected; overlapping closed `Work_Session` rows rejected; sessions touching at one instant accepted
    - Overlapping `Activity_Segment` rows rejected; a delete-then-reinsert reshuffle in one transaction succeeds
    - Deleting a referenced `Project` rejected; names differing only in case or whitespace collide
    - A closed session written across the running `Open_Session` is **accepted by the database** — proving the exclusion constraint does not cover it — and rejected by `sessionsConflictingWith`, which is what actually guards it
    - **The stale tail is guarded even though it is untracked**: with an `Open_Session` older than `MAX_OPEN_SESSION_HOURS`, its tail contributes nothing to `trackedIntervals`, yet a closed session written into that tail is still refused by `sessionsConflictingWith` and the subsequent stop succeeds. Capping the guard instead of only the totals is what made the timer unstoppable (Requirements 1.15, 6.18)
    - An `activity_entries` row with a null requested interval is rejected in every mode, duration included
    - Deleting an `Activity_Entry` leaves its `idempotency_keys` row with a null `entry_id` rather than deleting it
    - `updated_at` advances on UPDATE and not on unrelated writes
    - Assert every Drizzle column exists in the migrated database with a compatible type
    - _Requirements: 1.9, 2.7, 3.2, 3.7, 4.5, 6.4, 13.7_

  - [x] 4.9 Write integration tests for the stores
    - `tests/lib/server/store/work-sessions.test.ts`: start, stop, current when none open, create closed, listing by window with partial overlaps, `trackedIntervals` with an `Open_Session`, and with a `Stale_Session` past `MAX_OPEN_SESSION_HOURS` contributing only the capped part
    - `tests/lib/server/store/activities.test.ts`: create with several `Activity_Segment` rows, `coveredIntervals` with and without exclusion, `replaceSegments`, `entriesOverlapping` ordering, cascade delete, and an emptied `Activity_Entry` still returned as an `Orphaned_Entry` by `orphanedEntriesOverlapping`
    - `tests/lib/server/store/projects.test.ts`: colour index assignment, reuse after delete, stability across rename and archive, `PROJECT_IN_USE` carrying `Activity_Entry` ids; the ninth `Project` takes the least-used index and the tenth the next, deterministically
    - `tests/lib/server/store/tx.test.ts`: commits on success, rolls back on throw, rolls back on `dryRun` while returning the value
    - **`dryRun` surfaces a deferred-constraint violation**: a dry run inserting overlapping segments fails exactly as the committed write would, because `SET CONSTRAINTS ALL IMMEDIATE` runs before the rollback. Removing that statement must make this test fail — it is the whole basis of Property 13
    - `withReadTx` does not take the exclusive lock: two concurrent read transactions overlap, while a write held open blocks a second write and not a read
    - `translateConstraintError` maps SQLSTATE 23503 on `activity_entries_project_id_fkey` to `PROJECT_IN_USE` for a project delete and to `VALIDATION_ERROR` for an entry write
    - `tests/lib/server/store/aggregates.test.ts`: `daySummaries` matches figures computed by hand over a seeded fortnight; `longestBlockSeconds` merges two touching sessions into one block while `sessionCount` still reports two; `suggestedWindow` returns a window crossing midnight for an evening worker and `null` for an empty range
    - Provide `tests/setup/db.ts` exporting `resetDb()`, truncating every table between tests in one statement. It connects to **`TEST_DATABASE_URL`, never `DATABASE_URL`**, and refuses to run at all unless three things hold, checked before the first statement: `TEST_DATABASE_URL` is set; it differs from `DATABASE_URL`; and its database name ends in `_test`. Any failure throws `TEST_DATABASE_URL must be set, must differ from DATABASE_URL and must name a database ending in _test — refusing to truncate`. The guard exists because the alternative is a helper that silently erases the operator's own working history — which this project treats as invoicing evidence — and no test failure would ever reveal it
    - _Requirements: 1.1, 1.5, 1.8, 1.12, 2.1, 3.7, 3.9, 3.10, 3.12, 4.1, 7.1, 7.2, 7.11, 14.5_

- [x] 5. Checkpoint — data layer proven against a real database
  - Start PostgreSQL, run `./scripts/migrate.sh`, then `bun run test tests/lib/server/store`

- [ ] 6. Reconciliation core
  - [x] 6.1 Implement `clip` for `Explicit_Mode` in `src/lib/server/domain/clipping.ts`
    - Define `UntrackedPolicy`, `ClipInput` and `ClipResult` per design component 3
    - `ClipInput` carries `minIntervalMs` and `now` as inputs. The module may not read `$env` and may not call `new Date()`: the floor of Requirement 6.5 and the future bound of Requirement 6.8 both arrive from the caller, and every test supplies them explicitly
    - Compute `inside = intersect(requested, tracked)` and `outside = subtract(requested, tracked)`
    - Set `conflicts = intersect(inside, covered)`; a non-empty value tells the caller to reject
    - Discard any resulting `Activity_Segment` shorter than `minIntervalMs` into `slivers`, **kept separate from `discarded`**: under policy `reject` a non-empty `discarded` must fail the request while a sliver must not, and one list cannot express both. In `Duration_Mode` add the sliver time to `unplacedMs` so the conservation invariant holds; in `Explicit_Mode` and `Open_Mode` the `slivers` list is the whole report and `unplacedMs` stays 0 (Requirement 6.16)
    - Apply the `Untracked_Policy`: `clip` sets `discarded`; `extend` sets `extend` and takes the whole requested interval, clamped so that nothing ends after `now`; `reject` leaves `outside` for the caller
    - Return empty `segments` when nothing survives; the route answers 409 `NOTHING_TO_LOG` for it in every mode, so an accepted write never manufactures an `Orphaned_Entry`
    - _Requirements: 4.1, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.12, 6.18_

  - [x] 6.2 Implement `resolveAnchor` and `clip` for `Duration_Mode`
    - `resolveAnchor` returns the `Placement_Anchor`: the explicit start when given, else the end of the `Target_Day`'s latest `Activity_Segment`, else the start of its earliest `Work_Session`, else throws `NoPlacementAnchorError`
    - Declare `NoPlacementAnchorError` in `clipping.ts` carrying the `Target_Day` date. It is a domain error, not an `ErrorCode`; the route catches it and answers 409 `NO_PLACEMENT_ANCHOR`, so the domain still names no HTTP status
    - Compute `eligible = subtract(clamp(tracked, [anchor, dayBounds.end)), covered)` and call `take(eligible, durationMs, minIntervalMs)`
    - Record the interval the walk resolved to — first placed start to last placed end — as the entry's requested interval, beside the requested duration
    - Under `extend`, place what it lawfully can **anywhere in the window that is not already tracked**, earliest gap first — not only after the last tracked instant. A day of `[09:00–10:00, 12:00–13:00]` with a four-hour duration from 09:00 fills `10:00–12:00` before reaching past 13:00; placing only after the last tracked instant would leave a two-hour hole the user asked to have filled. Never past `min(now, dayBounds.end)`, never over an existing `Work_Session`, never inside `openSessionSpan`, and never as a session shorter than `MIN_INTERVAL_SECONDS`. Where it cannot place, the time stays `unplaced` and the request still succeeds
    - **Reduce `unplacedMs` only by what was actually placed.** Appending "an interval of length `unplacedMs`" and zeroing the counter loses the user's time whenever that interval comes out empty — which is exactly what happens when the last tracked instant is already `now`
    - `total(segments) + unplacedMs === durationMs` must hold on every path, sliver discards included
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 6.13, 6.14, 6.15_

  - [x] 6.3 Implement `Open_Mode`
    - Resolve the start with `resolveAnchor`; the end is now for the current `Logical_Day`, or the end of the `Target_Day`'s last `Work_Session` for a past day — so a morning-after quick log still works
    - Run the `Explicit_Mode` path with the resolved interval; store it as the `Activity_Entry`'s requested interval with `mode` recording that it was inferred
    - Reject with `NOTHING_TO_LOG` when the resolved start is not before the resolved end, and equally when `Clipping` leaves no segment — the same answer the other two modes now give
    - Reject a `Target_Day` in the future with `VALIDATION_ERROR`: a day that has not begun has no `Placement_Anchor` and no end to log up to, which is reachable by calling at 02:00 with today's date under `DAY_START_HOUR=3`
    - Implemented in `src/lib/server/services/activities.ts` (`resolveCreateWindow`), not in `domain/clipping.ts`: resolving the end against the `Target_Day`'s last `Work_Session` needs a store query, which the pure domain layer may not perform — the domain half (`resolveAnchor`, `clipExplicit`) stays where task 6.2/6.1 put it
    - _Requirements: 6.12, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.10_

  - [x] 6.4 Write unit tests for `clip`
    - `tests/lib/server/domain/clipping.test.ts`
    - Named case `worked example, explicit`: tracked `[08:00–14:48, 15:12–18:00]`, requested `13:00–16:00` → `[13:00–14:48, 15:12–16:00]`
    - Named case `worked example, duration`: same frame, anchor `14:00`, `2h` → `[14:00–14:48, 15:12–16:24]`, exactly 120 minutes
    - A request wholly inside one `Work_Session` yields one `Activity_Segment`; wholly outside yields none and reports everything discarded
    - A clip producing a 20-second sliver reports it in `slivers`, not in `discarded`, and adds its time to `unplacedMs`; under policy `reject` that sliver does **not** fail the request while an untracked remainder does
    - A request whose whole interval survives nothing yields empty `segments`, which the route turns into `NOTHING_TO_LOG`
    - Each `Untracked_Policy` in every mode; `conflicts` populated on collision; `extend` never produces a future interval, never crosses `dayBounds.end`, and skips an interval that would overlap an existing `Work_Session`, leaving that time unplaced
    - `extend` with the last tracked instant already at `now` places nothing and leaves `unplacedMs` unchanged — the case where the naive implementation silently destroys the request
    - `resolveAnchor` resolves the `Placement_Anchor` for all four branches of Requirements 5.4–5.7
    - _Requirements: 4.1, 5.1, 5.4, 5.5, 5.6, 5.7, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 15.2, 15.3_

  - [x]* 6.5 Write property tests for `clip`
    - `tests/lib/server/domain/clipping.property.test.ts`
    - **Property 1: Segments never cover untracked time**
    - **Property 2: Duration mode conserves the requested duration**
    - **Property 3: Breaks survive inside an entry**
    - **Property 11: The recorded request is preserved**
    - **Property 17: No stored interval is shorter than the floor**
    - **Property 20: Extending never reaches into the future**
    - **Property 24: Explicit segments never exceed the request**
    - **Property 25: Clipping is idempotent over its own output**
    - **Validates: Requirements 1.14, 4.1, 4.2, 5.8, 5.10, 5.13, 5.14, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.13, 6.14, 6.15, 7.10, 15.6**

  - [x] 6.6 Implement re-clipping in `src/lib/server/domain/reclip.ts`
    - Declare `ReclipPorts` and `ReclipOutcome` per design component 4 so the module stays free of Drizzle
    - `affected` is an `Interval[]`, not one interval: moving a session across the week yields two disjoint stretches, and merging them re-clips everything in between for no reason. Define the boundary cases — `start` has no old interval and a new one of `[startedAt, now)`; `stop` reads the old one as `[startedAt, now)` and the new one as `[startedAt, endedAt)`; a delete has no new interval
    - `reclipAffected` loads the affected `Activity_Entry` records through `entriesAffectedBy` — segment overlap **or** requested-interval overlap — in deterministic order, clears their `Activity_Segment` rows, and re-applies `Clipping` to each with `Untracked_Policy` `clip`, treating already re-clipped entries as part of `Covered_Time`
    - A `Duration_Mode` entry re-clips **as an explicit request over its frozen requested interval**; the `Placement_Anchor` is never resolved again, or a morning session edit would relocate an afternoon entry and Property 11 would fail. `reclipAffected` therefore takes **no `DayResolver`** — nothing here needs to know where a day starts, and the parameter would only invite the wrong implementation
    - Load `trackedIntervals` over the **union of the selected entries' requested intervals**, not over `affected`: an entry can reach well outside the changed stretch, and tracked time loaded only for `affected` would delete the parts of it the change never touched
    - `removedMs = total(subtract(before, after))` — time that was there and is gone. Never negative, and exactly zero when a session grew
    - Return `projectName`, `description`, `before`, `after`, `removedMs` and `orphaned` per `Activity_Entry` so a `Dry_Run` can name the consequence
    - Keep an `Activity_Entry` with zero `Activity_Segment` rows as an `Orphaned_Entry` rather than deleting it
    - _Requirements: 2.9, 2.10, 2.11, 14.2, 14.6_

  - [x] 6.7 Write tests for re-clipping against a fake `ReclipPorts`
    - `tests/lib/server/domain/reclip.test.ts` with an in-memory fake, no database
    - Shrinking a `Work_Session` splits an `Activity_Entry`; deleting one leaves it an `Orphaned_Entry` with `orphaned: true`; widening restores `Covered_Time`
    - **An `Orphaned_Entry` comes back**: after a delete empties an entry, re-creating a session over its requested interval re-places it — the case a selection by segment alone can never find
    - A session moved to a disjoint time re-clips both the old and the new stretch and nothing in between
    - A segment ending exactly at the start of the affected interval does not overlap it, yet the entry is still selected through its requested interval
    - Two `Activity_Entry` records competing for freed `Tracked_Time` resolve in `requestedStartedAt` order
    - `removedMs` matches the time actually lost; `projectName` and `description` are carried through
    - _Requirements: 2.9, 2.10, 14.2, 14.6_

  - [x]* 6.8 Write a property test for re-clipping
    - **Property 9: Re-clipping is deterministic and idempotent**
    - **Validates: Requirements 2.9, 2.10**

- [x] 7. Authentication and hooks
  - [x] 7.1 Implement authentication in `src/lib/server/core/auth.ts` and `src/lib/server/store/auth-sessions.ts`
    - Split by the Module Boundaries: `core` holds no persistence, so `core/auth.ts` keeps `verifyPassphrase`, `mintSessionToken`, `hashSessionToken`, `secretsMatch`, `SESSION_COOKIE` and `sessionCookieOptions`, while `store/auth-sessions.ts` owns every row — `beginBrowserSession`, `findAuthSession`, `deleteAuthSession`, `purgeExpiredAuthSessions`, all taking a hash and never a raw token
    - `authenticate(event)` needs a `RequestEvent` and a lookup, so it belongs to neither and lives in `src/hooks.server.ts` with the rest of the `Auth_Hook` (task 7.4)
    - `verifyPassphrase` checks the submitted passphrase against `WORKLOG_PASSPHRASE_HASH` with `Bun.password.verify`; hashes are produced with the `ARGON2ID` constant — `memoryCost: 65536` (64 MiB), `timeCost: 3` — and the plaintext is never stored anywhere
    - `mintSessionToken` produces `SESSION_TOKEN_BYTES` (32) from `crypto.getRandomValues`, encodes them **base64url** as the cookie value, and hashes that string with **sha256, lowercase hex**, as the stored form. Both encodings are fixed: a token encoded differently on two paths never matches
    - The `Auth_Hook` admits a valid session cookie or a bearer token equal to the `API_Token` compared in constant time, and reports which
    - Never log the token, the passphrase or the session identifier
    - `SESSION_COOKIE` is set with `httpOnly`, `sameSite: 'strict'`, explicit `path` and `maxAge`, and `secure` unless `APP_ENV` is `development`
    - Reject a session cookie presented on a cross-origin request, so `SameSite=Strict` remains sufficient CSRF protection
    - Logout deletes the stored session; expired sessions are purged on access **and** by the sweep every `CLEANUP_INTERVAL_MINUTES` (60), since access-time cleanup never reaches the session nobody returns to
    - The session lookup runs through `withReadTx`, never `withTx` — authentication happens on every request and must not queue behind the global write lock
    - `safeRedirectTarget` accepts only a path starting with a single `/`, never `//` or a scheme, and falls back to `/`
    - _Requirements: 11.2, 11.3, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.14, 11.15, 11.18, 11.21, 11.22, 13.30_

  - [x] 7.2 Implement rate limiting in `src/lib/server/core/rate-limit.ts`
    - A per-address **fixed-window counter** — one count and one window-start instant, reset when the window rolls over — allowing `RATE_LIMIT_PER_MINUTE` requests per 60 seconds. Fixed window rather than token bucket because `Retry-After` then has an exact answer, the seconds left in the window, instead of an invented one. `GET /api/health` is exempt: a platform health check polls it from one address forever and would otherwise eat the whole allowance, returning 429 with `Retry-After` set to the seconds left in the current window and `details.scope` of `request`; the login bucket answers with `scope` of `login`
    - A stricter bucket for the login route: `LOGIN_ATTEMPT_LIMIT` (5) per address per `LOGIN_ATTEMPT_WINDOW_MINUTES` (15), not configurable
    - The address comes from `clientAddress(event, TRUSTED_PROXY_HOPS)`: drop that many entries from the **right** of `X-Forwarded-For` and take the next, or use the socket address when the count is zero or the header is absent. Taking the leftmost entry lets a caller mint a new identity per request by prepending one, which would defeat the login bucket entirely
    - Evict a bucket once it has been idle for twice its own window — 2 minutes for the request bucket, 30 minutes for the login bucket — on the sweep that runs every `CLEANUP_INTERVAL_MINUTES`, so memory cannot grow without bound
    - State plainly in the module's doc comment that this state is in-process: it resets on restart and is not shared between instances, which is why Requirement 13.25 fixes the deployment at one instance. Do not describe it as a distributed limit
    - _Requirements: 11.13, 11.20, 11.26, 12.7, 12.21, 13.23, 13.25, 13.30_

  - [x] 7.3 Implement the idempotency and day-boundary stores
    - `src/lib/server/store/idempotency.ts` — **not** `core/idempotency.ts`: `idempotency_keys` is a table, and `core` holds no persistence
    - On a POST to `/api/activities` carrying `Idempotency-Key`, look the key up first and replay the stored **status and body** when the stored `request_hash` matches the sha256 of this request's canonical body
    - When the key exists with a **different** body, answer 409 `IDEMPOTENCY_KEY_REUSED` and write nothing — replaying the first answer would silently discard the second request
    - Reject a key longer than 200 characters or outside `[A-Za-z0-9_-]` with `VALIDATION_ERROR`
    - Otherwise store the key, the status and the response inside the same transaction as the write
    - The key outlives the `Activity_Entry` it created (`ON DELETE SET NULL`), so a retry after a deletion replays instead of creating a second entry
    - Purge keys older than `IDEMPOTENCY_RETENTION_HOURS` (24) on the sweep that runs every `CLEANUP_INTERVAL_MINUTES` (60)
    - `src/lib/server/store/day-boundary.ts` — `readDayBoundaryConfig` and `writeDayBoundaryConfig` over the single `day_boundary_config` row, for the startup check in task 7.4
    - _Requirements: 10.10, 10.11, 10.12, 12.8, 12.9, 12.17, 12.18_

  - [x] 7.4 Compose `src/hooks.server.ts`
    - Export each handle individually, then `sequence(handleRequestId, handleReadiness, handleRequestLog, handleLocals, handleSecurityHeaders, handleCors, handleRateLimit, handleAuth)`
    - **Two kinds of startup failure, handled two different ways.** Bad configuration — missing, unparseable, out of range, or breaking a `Gauge_Window` invariant — is caught synchronously by `loadConfig()` at module load, which logs every problem and **exits non-zero**; no request is ever served and a restart cannot help. An unmigrated database or a disagreeing `Day_Boundary_Config` is asynchronous, so the process **keeps running** and `handleReadiness` answers 503 `SERVICE_UNAVAILABLE` until it is repaired by `scripts/migrate.sh` or by fixing the environment. One hook cannot both answer 503 and exit, and an earlier draft asked for exactly that
    - `handleReadiness` runs **after** `handleRequestId` so its 503 carries a `requestId`, and it exempts `GET /api/health` — otherwise the endpoint that reports `degraded` is shadowed by the failure it exists to report
    - The readiness probe is one promise created at module load, awaited by every request, and retried at most once per `CLEANUP_INTERVAL_MINUTES` while it fails. It writes the `Day_Boundary_Config` when the row is absent, refuses when it disagrees without a truthy `ALLOW_DAY_BOUNDARY_CHANGE`, and overwrites it with a warning when that flag is truthy — the flag is read as a value (`1`, `true`, `yes`), never as mere presence
    - `handleLocals` resolves the **locale** — `worklog_locale` cookie when it names a supported locale, else the best supported match from `Accept-Language`, else `cs` — and this is the **only** place it is resolved. `002` must not repeat the fallback in a layout: `%lang%` is stamped from this value, so a second resolution means English text inside `lang="cs"` on an English browser's first visit
    - It resolves the **theme** from two cookies: `worklog_theme` holds the preference (`system` | `light` | `dark`, default `system`) and `worklog_theme_resolved` holds what the browser last resolved (`light` | `dark`). A preference of `light` or `dark` is used directly; `system` falls back to `worklog_theme_resolved`, then to `DEFAULT_RENDER_THEME`. One cookie cannot do both jobs — writing the resolved value into the preference destroys the preference and the toggle stops working
    - `handleLocals` fills `event.locals` per request with `today` (the current `Logical_Day` date and its bounds), `locale` and `theme`. **Per request, never at module load**: a server started before midnight would otherwise render yesterday for the rest of its life. `002` reads these and never derives a `Logical_Day` in the browser
    - `handleSecurityHeaders` runs `transformPageChunk` replacing `%lang%` with `locals.locale` and `%theme%` with the resolved theme. A cookie value of `system`, an unrecognised value or no cookie at all all resolve to the default, so neither placeholder ever reaches the browser unsubstituted. Those are the only two substitutions `001` performs on `app.html`, a file `002` owns; the CSP nonce is `kit.csp`'s job
    - Assert in a test that a rendered page contains neither `%lang%` nor `%theme%` literally, for a request with no cookies and for one whose theme cookie says `system`
    - All three preference cookies — `worklog_locale`, `worklog_theme`, `worklog_theme_resolved` — are script-readable (`HttpOnly` unset) with `SameSite=Lax`, `Path=/`, `Max-Age` 31536000 and `Secure` outside `development` and `test`; an unrecognised value falls back to the default rather than failing the render
    - Re-check `dayStartIsInGaugeGap` against the **stored** `DAY_START_HOUR` in the same guard, since that is the one the data was grouped by
    - `handleCors` allows only the configured origins, never reflects an arbitrary `Origin`, and **answers a preflight `OPTIONS` itself and returns** — a preflight carries no credentials by definition, so letting it reach `handleAuth` answers it 401 and the browser reports a CORS failure for a legal request
    - `handleAuth` is the `Auth_Hook` and holds `authenticate(event)`: it admits a valid `Browser_Session` or `API_Token`, exempts the `Health_Endpoint`, the login route, preflights and **the framework's static assets**, returns 401 for unauthenticated `/api` paths and redirects other paths to login carrying the originally requested path through `safeRedirectTarget`
    - Without the static-asset exemption the login page is served as unstyled HTML that never hydrates, because its own CSS and JavaScript are redirected to the login page they are being fetched for
    - Cap request bodies at 1 MiB **while reading the stream**, returning `PAYLOAD_TOO_LARGE`; a `Content-Length` check alone is bypassed by a chunked request that declares no length
    - _Requirements: 10.10, 10.11, 10.12, 10.17, 10.18, 11.1, 11.4, 11.5, 11.17, 11.19, 11.22, 11.23, 11.24, 11.27, 12.6, 12.10, 12.11, 12.12, 12.16, 12.25, 12.26, 12.27, 12.28, 12.29, 12.30, 12.31, 12.32, 13.4, 13.8, 13.14, 13.15, 13.24, 13.31, 13.32_

  - [x] 7.5 Implement the login and logout routes
    - `src/routes/login/+page.server.ts` and `src/routes/logout/+page.server.ts` — **these two files are owned by this specification**, load functions and form actions included. `002` owns the matching `+page.svelte` files and nothing else in these routes; the split is by file, so neither spec edits the other's half
    - Compare in constant time, create a session on success, redirect to the originally requested path, return a generic failure key otherwise
    - _Requirements: 11.5, 11.6, 11.10, 11.12, 11.14, 11.25_

  - [x] 7.6 Write tests for authentication, rate limiting and idempotency
    - `tests/lib/server/core/auth.test.ts`: missing, malformed and wrong credentials each yield 401 on `/api`; a valid cookie passes; a valid bearer token passes; `/api/health` needs neither; no log line contains a secret; cookie flags exactly as specified; a cross-origin request with only a cookie is refused
    - A wrong passphrase returns the same generic key as an empty one; logout invalidates server-side; an expired session is rejected; the stored hash never equals the submitted passphrase
    - `tests/lib/server/core/rate-limit.test.ts`: over `RATE_LIMIT_PER_MINUTE` returns 429 with `Retry-After`; a lowered configured limit trips correspondingly sooner; the login bucket trips after 5 attempts in 15 minutes and is unaffected by that configuration
    - `tests/lib/server/store/idempotency.test.ts`: a repeated key replays the original response and creates nothing; a key older than 24 hours is purged
    - `tests/lib/server/core/rate-limit.test.ts` additionally: with `TRUSTED_PROXY_HOPS=1` two requests behind the same proxy but from different clients count separately, and a caller **prepending** addresses to `X-Forwarded-For` cannot escape its own bucket; with the default of `0` the header is ignored entirely
    - A CORS preflight `OPTIONS` is answered before authentication and never returns 401; a request for a static asset is served without a credential; a redirect target of `//evil.example` or `https://evil.example` is refused and becomes `/`
    - An expired session is removed by the periodic sweep without anyone presenting it
    - `tests/lib/server/store/day-boundary.test.ts`: an absent row is written from the configuration; a matching row starts cleanly; a differing row refuses to start; the same differing row with `ALLOW_DAY_BOUNDARY_CHANGE` set is overwritten
    - _Requirements: 10.10, 10.11, 10.12, 11.2, 11.3, 11.4, 11.6, 11.7, 11.8, 11.9, 11.11, 11.12, 11.13, 11.14, 11.15, 11.18, 12.7, 12.8, 12.9, 13.21_

- [x] 8. Write services and REST routes

  Every write in tasks 8.1, 8.3 and 8.5 is implemented **once**, in `src/lib/server/services/`,
  and the `+server.ts` route is the thin half: parse with the Zod schema, call the service,
  serialize what comes back. Where a bullet below describes a transaction, a re-clip, an
  `Idempotency-Key`, a `Preview_Token` or a mapping to an error code, that behaviour belongs
  to the service and not to the route. `002`'s form actions call the same functions, which is
  the only reason the interface can write without reimplementing reconciliation.

  - [x] 8.0 Implement the write services in `src/lib/server/services/`
    - `activities.ts` — `createActivity`, `patchActivity`, `deleteActivity`; `sessions.ts` — `startSession`, `stopSession`, `createSession`, `patchSession`, `deleteSession`; `projects.ts` — `createProject`, `patchProject`, `deleteProject`
    - Each takes plain arguments already parsed by a schema, plus `now`, opens its own `withTx`, and returns a shape from `src/lib/contracts/responses.ts`
    - **Never touch a `RequestEvent` and never name an HTTP status.** A service throws `ApiError`; `core/errors.ts` maps it to a status and the envelope. This is what lets a form action call it without inventing a fake request
    - The service owns the whole write: mode selection, `resolveAnchor`, the fixed `withTx` → `clip` → `reclipAffected` order of Requirement 2.12, the `Idempotency-Key` lookup and record, the `Preview_Token` check, and `dryRun` returning the same shape from a rolled-back transaction
    - Follow the Module Boundaries: `services` may import `domain`, `store`, `core` and `contracts`, and nothing under `routes`
    - _Requirements: 2.12, 12.8, 12.16, 12.17, 14.1, 14.3, 14.4, 14.5, 14.7, 14.8, 14.9_

  - [x] 8.1 Implement the session routes
    - `src/routes/api/sessions/{start,stop,current}/+server.ts`, `sessions/+server.ts` (GET list and **POST create closed**), `sessions/[id]/+server.ts`
    - Validate with `startSessionSchema`, `stopSessionSchema`, `createSessionSchema`, `patchSessionSchema` and `deleteSessionQuery` — **all five carry the dry-run fields**, DELETE taking them as the `dry_run` and `preview_token` **query** parameters because a DELETE body is not reliably transmitted, because start and stop create and modify a `Work_Session` and Requirement 14.2 covers them too; the GET listing validates with `listSessionsQuery`
    - `GET /api/sessions` answers `SessionListResponse` — a bare `WorkSession[]` ordered by start ascending, each carrying its `stale` flag. Not an envelope: the listing is bounded by `MAX_RANGE_DAYS` and is never paged, so there is no cursor to wrap it for
    - Return `SESSION_ALREADY_RUNNING`, `NO_SESSION_RUNNING`, `SESSION_OVERLAP`, `FUTURE_TIMESTAMP` and `INTERVAL_TOO_SHORT` as specified; `current` reports `elapsedSeconds` as the true time since the start, uncapped even for a `Stale_Session`, because the interface shows it as the running clock
    - **`stop` always succeeds.** When the `Open_Session` is shorter than `MIN_INTERVAL_SECONDS`, delete the row instead of closing it and answer 200 with `SessionWriteResponse` carrying `session: null` and `discarded: true` — every other session write answers the same shape with the stored row and `discarded: false` — a timer the user started must always be stoppable, and twenty seconds records nothing. The floor rejects *created and modified* sessions, never a stop
    - `current` returns `CurrentSessionResponse` with elapsed seconds and the `stale` flag; every route returning a `WorkSession` carries the same flag on the session itself
    - Start, stop, create, PATCH and DELETE call `reclipAffected` for the union of the old and new interval inside the same transaction, and honour `dryRun` by returning a `SessionChangePreview`
    - Check overlap with the `Open_Session` in the transaction through `sessionsConflictingWith` — the `EXCLUDE` constraint does not cover it, so nothing else stops a closed session being written across a running timer
    - `affected` is an `Interval[]` built per operation: start `[startedAt, now)`; stop old `[startedAt, now)` and new `[startedAt, endedAt)`; PATCH the old and new intervals, which may be disjoint; DELETE the old interval alone
    - Compute the `Preview_Token` in `core/preview-token.ts` as a hash over the `Work_Session` and `Activity_Segment` **rows** in the affected window — ids, bounds, `updatedAt` — and never over a derived `Tracked_Time`, which changes every second while the timer runs and would make every preview stale before it could be confirmed
    - A `SessionChangePreview` also carries `lostUncoveredSeconds` and `lostUncovered`: the `Uncovered_Time` that stops being `Tracked_Time`, computed inside the rolled-back transaction as the coverage before the change minus the coverage after it. It belongs to no `Activity_Entry`, so it appears nowhere in `reclipped` and would otherwise be invisible — and the interface must never reconstruct it by intersecting intervals of its own
    - Default the listing range to the current `Logical_Day` and reject spans over 366 days
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 14.2, 14.3, 14.6, 14.9, 14.10, 14.11, 14.12_

  - [x] 8.2 Write tests for the session routes
    - `tests/api/sessions.test.ts`: start 201, second start 409, stop 200, stop with none running 409, current with and without an open session including `stale`
    - `POST /api/sessions` creates a closed session and re-clips; an inverted interval 400; an overlap 409 with identifiers; a future start 400; a 30-second session 400
    - DELETE 204 and re-applies `Clipping`; the same DELETE with `dryRun` returns the preview naming each affected `Activity_Entry` and leaves every row untouched
    - `POST /api/sessions/stop` with `dryRun` reports what closing the timer would re-clip and closes nothing
    - `DELETE …?dry_run=true` answers **200 with the preview**, not 204 — a 204 preview would carry nothing to preview — while the real DELETE still answers 204
    - A closed session overlapping the running timer is rejected 409 `SESSION_OVERLAP`, and a preview token stays valid while the timer keeps running — it fingerprints rows, not elapsed time
    - Shortening a session that ends in a described stretch reports the loss in `reclipped` and leaves `lostUncoveredSeconds` at zero; shortening one whose cut-off part carries **no** `Activity_Entry` reports an empty `reclipped` and a non-zero `lostUncoveredSeconds` with the interval itself in `lostUncovered`; a cut spanning both reports each part exactly once and neither total counts the other's time
    - A `Stale_Session` is reported with `stale: true` on `current`, in the listing and in the day response, and is not closed by the server
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.8, 1.10, 1.11, 1.13, 1.14, 2.1, 2.5, 2.6, 2.7, 2.8, 2.9, 14.2, 14.5, 14.10_

  - [x] 8.3 Implement the project routes
    - `src/routes/api/projects/+server.ts` and `projects/[id]/+server.ts` with `createProjectSchema`, `patchProjectSchema` and `listProjectsQuery`
    - `GET /api/projects` answers `ProjectListResponse` — a bare `Project[]` ordered by name ascending, each carrying its `colorIndex`, archived rows included only with `include_archived=true`. A bare array for the same reason the session listing is one: nothing pages it
    - PATCH accepts name, archived state and `colorIndex`
    - Map store errors to `PROJECT_EXISTS` and `PROJECT_IN_USE`, the latter carrying `Activity_Entry` ids
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [x] 8.4 Write tests for the project routes
    - `tests/api/projects.test.ts`: create; duplicate differing only in case rejected, the response naming the existing project; empty and over-long names rejected; listing excludes archived by default; delete in use rejected with `entryCount` and the blocking entries' descriptions and requested intervals in the details, capped at `ERROR_DETAIL_SAMPLE_SIZE`; delete unused succeeds; PATCH sets a colour index another project already holds
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11, 12.19_

  - [x] 8.5 Implement the activity routes
    - `src/routes/api/activities/+server.ts` and `activities/[id]/+server.ts` with `createActivitySchema` and `patchActivitySchema`, both `.strict()`
    - Select the mode from the design's table: `endedAt` alone is `Explicit_Mode`, `durationMinutes` alone is `Duration_Mode`, neither is `Open_Mode`, both is `AMBIGUOUS_MODE`; reject naive timestamps and future instants
    - Resolve the `Target_Day` from `date`, defaulting to the current `Logical_Day`, so yesterday can be filled in the next morning
    - Reject an archived `projectId` with `PROJECT_ARCHIVED`
    - Supply `clip` with `minIntervalMs` from the configuration and `now`, since the domain reads neither for itself
    - Store the resolved interval as the entry's requested interval in **every** mode, `Duration_Mode` included, beside the requested duration
    - Answer 409 `NOTHING_TO_LOG` whenever `Clipping` produced no segment, in every mode, so no accepted write creates an `Orphaned_Entry`
    - Report `slivers` separately from `discarded`; policy `reject` fails on a non-empty `discarded` and never on a sliver
    - Reject a PATCH moving an entry to an archived `Project` with `PROJECT_ARCHIVED`
    - Page the listing at `ACTIVITY_PAGE_SIZE` with `cursor`, `order` (`asc` default, `desc` for the newest first — what a quick-log needs) and `limit` (capped at `ACTIVITY_PAGE_SIZE`) query parameters, and a `nextCursor` in the body. The cursor is base64url of `requestedStartedAt|createdAt|id` — the exact sort key of `activity_entries_order`, so a page can neither skip nor repeat a row; a cursor that fails to decode is a `VALIDATION_ERROR`
    - Every returned entry carries its project's `colorIndex` beside `projectName`
    - Catch `NoPlacementAnchorError` and answer 409 `NO_PLACEMENT_ANCHOR` carrying the `Target_Day` date and its bounds
    - Report the resolved `Placement_Anchor` and its `source` in the **success** body too, not only in an error: the add-task dialog names the start on the happy path, and a value that exists only on failure cannot be shown before the request is sent
    - `unplacedMinutes` is always 0 outside `Duration_Mode`; policy losses go to `discarded` and floor losses to `slivers`
    - An `ACTIVITY_OVERLAP` response carries, per conflict, the `Activity_Entry` id, its `Project` name, its description and the overlapping interval
    - Under policy `extend` the order inside the transaction is fixed (Requirement 2.12): **insert the extending `Work_Session`, then `reclipAffected`, then clip and insert the new entry** against the coverage that leaves. If a rescued `Orphaned_Entry` reclaims time the new entry asked for, that is **not an error**. Pass the reclaimed time to the second `clip` call as part of `covered` **and** set `policy: 'clip'` for it, so the overlap is subtracted rather than returned in `conflicts` — a non-empty `conflicts` is what makes the caller answer 409, and here there is nothing for the user to resolve. The new entry takes what remains and the difference is reported in `discarded`
    - The `Preview_Token` window for an activity write is the **whole `Logical_Day` of the `Target_Day`**, not just the requested interval: reconciliation is day-bounded, so any change in that day can move the outcome
    - Run each write in one `withTx` call; pass `dryRun` through; honour `Idempotency-Key`; verify `previewToken` and return `STALE_PREVIEW` on mismatch
    - Always report `discarded` (policy losses only), `slivers` (floor losses only — never folded into `discarded`, Requirement 6.5), `extendedSessions`, `unplacedMinutes`, `removedSeconds`, `anchor`, `dryRun` and `previewToken`
    - A PATCH carrying `durationMinutes` with its `date` sets `mode` to `duration`, resolves the anchor inside that `Target_Day` ignoring the entry's own segments, walks the duration, and rewrites both the requested interval and the requested duration (Requirement 7.26); a PATCH carrying `endedAt` and `durationMinutes` together is 400 `AMBIGUOUS_MODE` (Requirement 7.25)
    - GET returns every `Activity_Entry` including each `Orphaned_Entry` selected by requested interval, all flagged `orphaned`; range over 366 days rejected
    - A PATCH touching only description or `Project` skips `Clipping`; one touching the interval or duration replaces the `Activity_Segment` rows while ignoring the entry's own segments for overlap
    - `startedAt` and `endedAt` travel together or not at all; `durationMinutes` requires a `date`. Ignore the entry's own segments when resolving the `Placement_Anchor` as well as when testing overlap, or the entry blocks itself
    - **A PATCH is the orphan rescue path** the day page's "mimo výkaz" panel calls for *Přepsat čas*: an `Orphaned_Entry` owns no segment, and nothing in validation may require one. Supplying both bounds replaces the requested interval, clears `requestedDurationMinutes` and sets `mode` to `explicit`; on success the entry comes back with `orphaned: false`; if the rewritten time still yields no segment, answer 409 `NOTHING_TO_LOG` and leave the entry byte-identical — a failed rescue must not destroy the record
    - _Requirements: 2.12, 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.1, 5.2, 5.3, 5.7, 5.11, 5.12, 5.13, 5.16, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.16, 6.17, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 7.19, 7.20, 7.21, 7.22, 7.23, 7.24, 7.25, 7.26, 10.2, 10.18, 12.4, 12.8, 12.19, 12.20, 12.21, 12.23, 12.24, 14.1, 14.3, 14.4, 14.7, 14.8, 14.9, 15.1, 15.6, 15.7, 15.8, 15.9, 15.10_

  - [x] 8.6 Write tests for the activity routes
    - `tests/api/activities.test.ts`, seeding the frame `[08:00–14:48, 15:12–18:00]` before each case
    - The success body of a `Duration_Mode` and an `Open_Mode` write carries the resolved anchor and its source; an `Explicit_Mode` write carries `anchor: null`
    - `order=desc` returns the newest first and `limit=1` returns exactly one entry
    - A repeated `Idempotency-Key` with a **different** body returns 409 `IDEMPOTENCY_KEY_REUSED` and writes nothing; a key with an illegal character returns 400
    - Explicit `13:00–16:00` returns 201 with two `Activity_Segment` rows and the requested values preserved
    - Duration `2h` anchored at `14:00` totals exactly 120 minutes
    - `Duration_Mode` with `date` set to yesterday places against yesterday's frame, not today's
    - `Open_Mode` with only a `projectId` records from the last `Activity_Segment`'s end to now; with `date` in the past it ends at that day's last session end; an empty day returns `NO_PLACEMENT_ANCHOR`; a last `Activity_Segment` already reaching now returns `NOTHING_TO_LOG`
    - Both `endedAt` and `durationMinutes` 400; neither with no project 400; a naive timestamp 400; an unknown field 400; a future interval 400; an archived project 400
    - An overlapping `Explicit_Mode` request returns 409 with the conflicting `Activity_Entry` ids, `Project` names and descriptions; `Untracked_Policy` `reject` outside `Tracked_Time` 409 writing nothing; `extend` creates the covering `Work_Session` and reports it
    - A duration exceeding the eligible time reports `unplacedMinutes`
    - The same create with `dryRun` returns the identical body plus `dryRun: true` and the same status, leaving every table unchanged
    - A repeated `Idempotency-Key` creates one `Activity_Entry` and replays the original **status** as well as the body; repeating it after the entry has been deleted still replays instead of creating a second entry; a stale `previewToken` returns `STALE_PREVIEW`
    - A `Duration_Mode` entry stores the interval it resolved to, is found again by GET after a session delete empties it, and is re-placed when the session is restored
    - A request whose `Clipping` places nothing returns 409 `NOTHING_TO_LOG` in all three modes and writes no entry
    - A 20-second sliver is reported in `slivers`, counted in `unplacedMinutes`, and does not fail policy `reject`
    - A PATCH moving an entry to an archived project returns 400 `PROJECT_ARCHIVED`
    - A listing longer than `ACTIVITY_PAGE_SIZE` returns a `nextCursor` that continues without repeating or skipping an entry
    - Every returned entry carries `projectName` and `colorIndex`
    - An `Open_Mode` request naming a future `Target_Day` returns 400
    - An `Activity_Entry` emptied by a `Work_Session` delete is still returned by GET as an `Orphaned_Entry` with `orphaned: true`, carrying its `projectName`, `colorIndex` and requested interval — everything the "mimo výkaz" panel draws — and can be deleted
    - PATCHing that orphan onto tracked time succeeds despite it having no segments, returns it with `orphaned: false` and new segments, and sets `mode` to `explicit`; PATCHing it onto untracked time returns 409 `NOTHING_TO_LOG` and leaves every column unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.10, 5.1, 5.2, 5.11, 6.6, 6.7, 6.9, 7.2, 7.3, 7.7, 7.8, 7.9, 7.11, 7.16, 7.17, 7.18, 7.19, 10.2, 12.4, 12.8, 12.20, 14.1, 14.3, 14.5, 14.8, 15.1, 15.3, 15.7, 15.8_

  - [x] 8.7 Implement the day, coverage and health routes
    - `days/[date]/+server.ts` returns bounds, `Work_Session` and `Activity_Entry` records with their true bounds, coverage, and totals **clamped to the day**, including every `Orphaned_Entry` and archived `Project`; `totals.byProject` is `ProjectTotal[]`, so `archived` travels with each row; an empty day returns 200 with zeroes
    - `totals` also carries `sessionCount`, `longestBlockSeconds` and `eveningSeconds`, defined exactly as in `DaySummary`, so the day page fills its "tvar dne" panel from this one response instead of calling `/api/days` for a single day and risking two answers that disagree
    - The response carries `quickLog`: what a one-touch `Open_Mode` write would record — resolved by the Requirement 15 rules **including the end**, so a past day ends at that day's last session end and not at now — with its `anchorSource` **and the `projectId`, `projectName` and `colorIndex`** of the most recent `Activity_Entry` of that day, or of any day when that day has none. `null` when there is no anchor or no entry anywhere to take a project from: `projectId` is required by the write and `002` may not look one up. The client labels the quick-log pill from it and opens the full dialog when it is null; it may not derive the anchor rule itself
    - `days/+server.ts` returns one `DaySummary` per `Logical_Day` carrying its date, totals, per-project breakdown, session count, longest uninterrupted block, overtime outside the `Gauge_Window` and the seconds after the `Evening_Hour`
    - The per-day `tracked`, `covered` and `uncovered` interval lists — the shape of the day rather than only its size — are **opt-in**: send them only for a request carrying `include=intervals`, and only when the range is at most `MAX_INTERVAL_RANGE_DAYS`. `covered` carries a `projectId` per stretch so the rhythm strip can colour it; `tracked` stays bare because sessions belong to no project; `uncovered` is sent rather than left for the caller to derive. Declare that constant as 62 in `core/config.ts` beside `MAX_RANGE_DAYS`; never write the number into a route
    - Report the outcome as `intervalsIncluded` on the range response. A request asking for intervals over a longer range is **not an error**: answer 200 with the summaries and `intervalsIncluded: false`, so a statistics page over a year keeps working and simply does not draw the rhythm strip
    - Materialise the `Gauge_Window` per day as `[GAUGE_START, GAUGE_END)` on that day's dates in `TIMEZONE`, with the end on the following date when it wraps, and compute `overtimeSeconds` as the `Tracked_Time` outside it
    - `longestBlockSeconds` is measured over the **normalized** `Tracked_Time`, so two sessions touching at 12:00 count as the one block they are; `sessionCount` counts rows, which is a different figure and is named as such
    - Compute the day figures through `store/aggregates.ts` in SQL. A 366-day range must not pull a year of rows into the process
    - The range response additionally carries `suggestedWindow`: the **shortest** arc on the 24-hour clock covering 90 % of `Tracked_Time`, permitted to run past midnight — "earliest and latest" cannot express 21:00 → 01:40 and returns nearly the whole day for anyone working across midnight. It is `null` for a range with no `Work_Session`, and it must itself satisfy the startup checks, since the interface offers it as a `Gauge_Window` the server has to accept
    - Default the range to the current `Logical_Day` when `from` and `to` are absent, as the other range routes do; spans over `MAX_RANGE_DAYS` rejected
    - `include` accepts the single value `intervals`; any other value is a `VALIDATION_ERROR` rather than a silently ignored parameter. `min_gap_seconds` defaults to `0` on `/api/coverage`
    - The `Evening_Hour` instant of a day is the first occurrence of that wall-clock hour at or after the day's start, so `EVENING_HOUR` and `DAY_START_HOUR` cannot resolve to two different orderings
    - `byProject` carries each project's `colorIndex`
    - `coverage/+server.ts` returns `tracked`, `covered`, `uncovered` and `untracked`, plus a `totals` object of all four in seconds; `min_gap_seconds` filters the returned `uncovered` list only and never the totals; range limits as elsewhere
    - `health/+server.ts` is the `Health_Endpoint`: 200 with the `HealthResponse` — status `ok`, the version, the effective `TIMEZONE`, `DAY_START_HOUR`, `GAUGE_START`, `GAUGE_END`, `EVENING_HOUR` and `MAX_OPEN_SESSION_HOURS` — without a credential; 503 `degraded` when the database is unreachable or migrations are unapplied
    - `MAX_OPEN_SESSION_HOURS` is published here because the interface bounds how far it draws an `Open_Session` by it. Without it the client estimates that from a day's `trackedSeconds`, which is a guess standing in for a value the server already knows
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21, 8.22, 8.23, 8.24, 8.25, 8.26, 8.27, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.8, 10.15, 10.16, 10.18, 13.1, 13.2, 13.3, 13.4, 13.11, 13.13, 13.16, 13.18_

  - [x] 8.8 Write tests for the day, coverage and health routes
    - `tests/api/days.test.ts`: a populated day returns correct totals and per-project seconds; an empty day returns zeroes; a malformed date 400; a 400-day range `RANGE_TOO_LARGE`; **a session spanning the 03:00 boundary appears in both days with its true bounds but contributes its own part to each day's total, and the two parts sum to its full length**
    - `longestBlockSeconds` picks the longest single session, not the day total; `overtimeSeconds` counts only `Tracked_Time` outside `GAUGE_START`–`GAUGE_END`; a day ending at 03:00 against the default window reports 3 hours of overtime
    - `overtimeSeconds` plus the `Tracked_Time` inside the window equals `trackedSeconds` on an ordinary day, on the 23-hour day `2026-03-28` and on the 25-hour day `2026-10-24` alike — the DST hour falls in the `Gauge_Gap`, so the window is 18 hours on every one of them
    - `eveningSeconds` counts only `Tracked_Time` after the `Evening_Hour`; a `Work_Session` running 20:00–22:00 contributes one hour at the default
    - With `include=intervals` over a short range, `tracked`, `covered` and `uncovered` are present per day, clamped to that day's bounds, every `covered` stretch carries the `projectId` that describes it, `uncovered` equals `tracked` minus `covered`, `intervalsIncluded` is true, and a `Work_Session` crossing the boundary appears in both days' interval lists cut at 03:00 while the day's own `sessions` list still carries its true bounds
    - Without `include=intervals` the same range omits all three lists and reports `intervalsIncluded: false`, while every total stays identical to the request that asked for them
    - `longestBlockSeconds` reports one block for two `Work_Session` rows that touch, while `sessionCount` reports two
    - `suggestedWindow` for an evening worker crosses midnight rather than widening to the whole day; an empty range returns `null`; the returned window satisfies the startup checks
    - `byProject` carries `colorIndex` and `archived`, and its `coveredSeconds` sum equals the day's `coveredSeconds`
    - `/api/days` without `from` and `to` returns the current `Logical_Day`; a range whose `to` falls exactly on a day boundary does not add a trailing empty day
    - The single-day response carries `sessionCount`, `longestBlockSeconds` and `eveningSeconds` matching what `/api/days` reports for the same day, and a `quickLog` interval that is `null` on an empty day and runs from the last segment's end to now otherwise
    - **With `include=intervals` over a range longer than `MAX_INTERVAL_RANGE_DAYS` — a full year — the response is still 200**, carries one summary per day with correct totals, omits all three interval lists, and reports `intervalsIncluded: false`; a range of exactly `MAX_INTERVAL_RANGE_DAYS` still carries them, so the boundary is pinned on both sides
    - `suggestedWindow` over a seeded week brackets the middle 90 % of `Tracked_Time` and ignores a single outlying night
    - `tests/api/coverage.test.ts`: `Covered_Time` and `Uncovered_Time` reconstruct `Tracked_Time` exactly; `untracked` holds the `Untracked_Time` breaks; `min_gap_seconds` filters the list while `totals.uncoveredSeconds` stays unchanged; all four totals present; `from` after `to` 400
    - `tests/api/health.test.ts`: 200 with a reachable migrated database carrying version, timezone, day start, `GAUGE_START`, `GAUGE_END`, `EVENING_HOUR` and `MAX_OPEN_SESSION_HOURS`, each matching the loaded configuration; 503 when the database is closed; 503 when a migration is pending; no credential required; **and `/api/health` still answers while every other route is 503 from the readiness probe** — that is the whole reason it is exempt
    - A request to an existing path with an unimplemented method returns 405 `METHOD_NOT_ALLOWED` with an `Allow` header
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21, 8.22, 8.23, 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.7, 10.8, 13.1, 13.2, 13.3, 13.4, 13.13, 13.18_

- [ ] 9. Checkpoint — API complete
  - Run `bun run check && bun run test` with PostgreSQL running

- [ ] 10. Guards
  - [ ] 10.1 Write the module boundary test
    - `tests/lib/server/imports.test.ts` walks the import graph of `src/lib/server/`
    - Enforce the layer order `domain` → `core` → `store` → `services` → `routes`, each importing only to its left: fail when `domain` imports anything under `store`, `services` or `core`, Drizzle, `$env`, `$app` or SvelteKit; when `core` imports `domain`, `store`, `services` or `routes`; when `store` imports from `services` or `routes`; when `services` imports from `routes` or names a `RequestEvent`
    - Walk `src/lib/contracts/` too and fail when anything there imports from `src/lib/server/`, `$env`, `$app`, Drizzle or SvelteKit — it is shipped to the browser, so a server import there is a build failure at best and a leak at worst. `lib/server/domain` importing **from** contracts is expected and must pass
    - Fail when anything under `src/lib/ui/`, `src/modules/` or a non-`api` route imports from `src/lib/server/` outside a `+page.server.ts`, a `+server.ts` or a `modules/*/actions.ts`; and in those three, fail on any `src/lib/server/` import that is not `services` or `store` — `002` reaches the core through the service functions, never through `domain` or `core`
    - The design is consistent with this: the session rows live in `store/auth-sessions.ts` and the idempotency rows in `store/idempotency.ts`, so no `core` module reaches for the database
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
    - **Property 22: Stored segments always lie inside tracked time** — generate a random *sequence* of session and entry operations, then assert the invariant over the final database. This is the one the application exists for, and re-clipping is where it breaks
    - **Property 23: Described time is conserved**
    - **Validates: Requirements 2.9, 4.5, 6.1, 6.2, 6.4, 8.3, 8.4, 8.5, 9.3, 10.7**

  - [ ]* 10.5 Write property tests for the gauge window and the suggested window
    - `tests/api/days.property.test.ts`, generating random session frames across ranges that include both DST transitions and windows other than the default
    - **Property 19: Overtime and in-window time partition the day** — the one that would have caught a dial stretched to fit an irregular `Logical_Day`, a `Gauge_Window` measuring zero because the end wrapped, or a `DAY_START_HOUR` sitting inside the window
    - **Property 21: The suggested window brackets the bulk of the work**
    - **Validates: Requirements 8.12, 8.13, 13.13, 13.14**

- [ ] 11. Packaging, deployment and documentation
  - [ ] 11.1 Write the `Dockerfile` and `.dockerignore`
    - Two stages on `oven/bun:1.2.15` then `oven/bun:1.2.15-slim`, granular COPY layers — `package.json bun.lock` first, then configs, then `project.inlang`, `messages`, `static`, `src`
    - Install with `bun install --frozen-lockfile`
    - **Copy `migrations/` and `scripts/` into the runtime image.** Readiness compares the filenames in `migrations/` against `schema_migrations` (task 7.4), so without them the check cannot run at all and an unmigrated production database is undetectable. Baking a build-time list instead is rejected: it goes stale the first time anyone migrates by hand
    - Placeholder env values so build-time validation passes, `bun x svelte-kit sync && bun run build`, `CMD ["bun", "run", "build/index.js"]`, port 3000, non-root user
    - `.dockerignore` excludes `.git`, `tests/`, `.env*`, `.kiro/`, `build/`, `node_modules/`, `.svelte-kit/`, `*.md`, `.vscode/`, `.idea/` — and **not** `migrations/` or `scripts/`, which the image needs
    - Install `postgresql-client` in the runtime stage (`apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*`). `migrate.sh` drives `psql`, and the release command of task 11.2 runs it from inside this image; without the client the deploy fails on a missing binary rather than on anything about the database
    - Set `APP_ENV=production` explicitly in the **builder** stage before `bun run build`, beside the placeholder values that let build-time validation pass. The `Content-Security-Policy` is chosen at build time from that variable, and an unset one must never be able to bake a development policy into a shipped image
    - _Requirements: 12.13, 13.10_

  - [ ] 11.2 Write `fly.toml`
    - `app = "worklog"`, `primary_region = "fra"`, `internal_port = 3000`, `force_https`, health check against `/api/health`
    - `[env]` carries only non-secret configuration — `PORT`, `PUBLIC_ORIGIN`, `TIMEZONE`, `DAY_START_HOUR`, `GAUGE_START`, `GAUGE_END`, `EVENING_HOUR`, `APP_ENV`, `TRUSTED_PROXY_HOPS`, `LOG_LEVEL`, `DB_POOL_MAX`, `MAX_OPEN_SESSION_HOURS`, `MIN_INTERVAL_SECONDS`, `SESSION_DURATION_HOURS`, `RATE_LIMIT_PER_MINUTE`. `PUBLIC_ORIGIN` is the app's `https://` URL: behind Fly's TLS proxy the runtime otherwise infers `http://localhost:3000`, and both the cross-origin check and the form-action CSRF protection are decided from it
    - Never place `WORKLOG_API_TOKEN`, `WORKLOG_PASSPHRASE_HASH` or `DATABASE_URL` in this file
    - **Migrate as a release command**, so a deploy carrying a migration cannot produce a server that answers 503 on every route (Requirement 13.4):
      ```toml
      [deploy]
        release_command = "./scripts/migrate.sh"
        strategy = "immediate"
      ```
      Fly runs it in a temporary machine built from the new image, inside the app's private network and with the app's secrets in the environment — the only place a `.internal` `DATABASE_URL` resolves at all. A non-zero exit aborts the deploy and the previous release keeps serving, so the unmigrated state never ships. `strategy = "immediate"` rather than a rolling replacement, because the next bullet permits exactly one machine and a rolling strategy has nothing to roll onto
    - **Pin the app to one machine**, because Requirement 13.25 requires it: the rate-limit buckets live in process memory and the `Day_Boundary_Config` startup write races between processes. Two machines silently double the login allowance that Requirement 11.13 deliberately made unconfigurable
      ```toml
      [http_service]
        internal_port = 3000
        force_https = true
        auto_stop_machines = false
        auto_start_machines = false
        min_machines_running = 1

      [[vm]]
        count = 1
      ```
      `auto_stop_machines = false` matters as much as the count: an autostopped machine loses its in-memory buckets on every wake, which turns the login limiter off for the first `LOGIN_ATTEMPT_LIMIT` attempts after each idle period
    - _Requirements: 11.16, 13.1, 13.4, 13.10, 13.11, 13.16, 13.18, 13.19, 13.20, 13.21, 13.25_

  - [ ] 11.3 Write the operational scripts
    - `scripts/build.sh`, `start-docker.sh`, `stop-docker.sh`, `deploy.sh`, `backup.sh`, `hash-passphrase.sh` and `test-e2e.sh`, all with `#!/bin/bash`, `set -euo pipefail` and the Script Portability preamble defined in task 4.2, parsing the app name from the resolved fly config
    - `hash-passphrase.sh` is how `WORKLOG_PASSPHRASE_HASH` is produced — without it the variable is a value nobody can generate. It reads the passphrase from `/dev/tty` without echoing, prints the argon2id hash, and nothing else:
      ```bash
      read -rs -p 'Passphrase: ' PASSPHRASE < /dev/tty; echo
      bun -e 'console.log(await Bun.password.hash(process.env.PASSPHRASE, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }))'
      ```
    - `deploy.sh` takes the environment as `$1` defaulting to `prod`, resolves `.env.<env>` and `fly.<env>.toml` with a `fly.toml` fallback, validates required files before any remote call and exits 2 when one is missing, resolves the org prompting through `/dev/tty` when absent and persisting the choice, creates the app only when missing, sets secrets skipping keys already in `[env]`, then deploys. Never pass `--ha` — the default high-availability pair violates Requirement 13.25
    - **`deploy.sh` never runs `migrate.sh` itself.** `DATABASE_URL` names a Fly private address that does not resolve from a developer's machine, so a local run either fails or — worse, with a stale `.env` — migrates the wrong database. Migration belongs to the deploy transaction and is the `release_command` of task 11.2. For a manual repair: `fly ssh console --app worklog -C './scripts/migrate.sh'`, which runs the same script in the same network
    - `backup.sh` takes the environment as `$1`, runs `pg_dump` into a timestamped file, and prints the restore command — the data becomes invoicing evidence, so a backup path must exist from day one
    - `test-e2e.sh` starts PostgreSQL with plain `docker run`, migrates, runs Playwright and tears everything down
    - _Requirements: 13.8, 13.10_

  - [ ] 11.4 Write `README.md` and `DOCS.md`
    - `README.md` follows the ten required sections in order: title and description, prerequisites, installation, usage, deployment, testing, documentation link, author, show your support, license — no environment table and no endpoint table, those belong in `DOCS.md`
    - Deployment covers `./scripts/start-docker.sh`, `./scripts/stop-docker.sh`, `./scripts/deploy.sh <env>`, `dploy release prod` and the useful Fly commands
    - `DOCS.md` carries environment variables, project structure, full API documentation with request and response examples including `dryRun` and `Idempotency-Key`, testing, and troubleshooting
    - Include the worked `Clipping` example showing `13:00–16:00` over a broken frame becoming two `Activity_Segment` rows
    - Note that migrations are forward-only and that changing `TIMEZONE` or `DAY_START_HOUR` regroups history
    - Document the `Gauge_Window` rules: `GAUGE_END` wraps past midnight, and `DAY_START_HOUR` must fall inside the `Gauge_Gap` or the server refuses to start
    - _Requirements: 13.8, 13.13, 13.14_

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
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.8", "1.9", "2.1", "2.4", "2.7", "4.1", "4.2"] },
    { "id": 2, "tasks": ["1.6", "2.2", "2.3", "2.5", "2.6", "4.3", "6.1"] },
    { "id": 3, "tasks": ["4.4", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "6.6", "7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["4.8", "4.9", "6.7", "6.8", "7.4", "7.5", "8.0"] },
    { "id": 6, "tasks": ["7.6", "8.1", "8.3", "8.5", "8.7"] },
    { "id": 7, "tasks": ["8.2", "8.4", "8.6", "8.8", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4", "10.5"] },
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
- **The gauge is a clock, not a scaled day.** The interface's dial is `angle(t) = 45° + minutes_since_midnight × 0.25` — one hour is always 15°, on the 23-hour day and the 25-hour day alike. The `Gauge_Window` is therefore a pair of wall-clock times, and two startup checks keep it coherent: `GAUGE_END` wraps to the following date when it is not after `GAUGE_START`, and `DAY_START_HOUR` must fall inside the `Gauge_Gap`. The second is what puts both Prague DST transitions — which happen between 02:00 and 03:00 — in the bare part of the circle, so the drawn track is 18 hours wide on all 365 days. Property 19 pins it.
- **File ownership across the two specs is by file, not by folder — with four scaffolding exceptions.** `001` owns `src/routes/login/+page.server.ts` and `src/routes/logout/+page.server.ts`; `002` owns their `+page.svelte` halves and owns the *content* of `src/app.html`, including `<html lang="%lang%" data-theme="%theme%">` and `%sveltekit.nonce%`. `001` substitutes `%lang%` and `%theme%` through `transformPageChunk`, and the nonce is stamped by `kit.csp`, not by a hook.

  The exceptions: task 1.1 creates `src/app.html`, `project.inlang/settings.json`, `messages/{cs,en}.json` and `static/` as **minimal build inputs**, because `bun run build` — and therefore checkpoint 12 — cannot run without them, and all four are otherwise `002`'s. `002` replaces their content rather than creating them, and `001` does not touch them again after task 1.1.
- **`src/lib/contracts/` is owned by `001` but lives outside `lib/server/` on purpose.** It holds the Zod schemas, the domain types and the response types, because `002` validates the same forms through superforms *and* types its components with `Interval`, `WorkSession`, `ActivityEntry`, `ActivitySegment` and `Project` — none of which client code may import from `lib/server/`. The directory carries no database, no `$env`, no `$app`, no Drizzle and no SvelteKit; `lib/server/domain` imports its types from there like everyone else, and task 10.1 fails the build if that slips. There is exactly one definition of every request body and every shared type; `002` writes none of its own.
- **Every shape that names a `Project` carries its `colorIndex`.** The timeline, the gauge, the legend, the statistics breakdown and the rhythm strip all colour by project; without it each of them would fetch the project list and join client-side.
- **`Untracked_Policy`, not `Uncovered_Policy`.** It governs the part of a request lying outside the timer frame — `Untracked_Time`. `Uncovered_Time` is tracked but undescribed and no policy applies to it; the old name said the opposite of what the field does.
- **A dry run must force deferred constraints.** `SET CONSTRAINTS ALL IMMEDIATE` before the rollback, or `activity_segments_no_overlap` is never evaluated in a transaction that never commits and the preview cheerfully approves a write that fails.
- **Reads do not take the advisory lock.** `withReadTx` exists because authentication reads on every request; routing that through the global write lock serializes the whole application behind any slow write.
- **The `Open_Session` is not covered by any constraint.** The `EXCLUDE` is declared `WHERE (ended_at IS NOT NULL)`. The application check under the lock is the only guard, and the design says so rather than claiming overlap is unrepresentable.
- **Every mode stores a resolved requested interval**, `Duration_Mode` included. It is the re-clipping sort key, the handle that finds an `Orphaned_Entry` again, and the interval a later frame change re-places the entry against.
- **Placed plus unplaced always equals what was asked for.** A sliver dropped below `MIN_INTERVAL_SECONDS` is added to `unplacedMs`, and `extend` clears the counter only by what it truly placed. Anything else silently destroys the user's time.
- **Anything the interface would otherwise guess is published by `/api/health`** — timezone, day start, both gauge bounds, the evening hour and `MAX_OPEN_SESSION_HOURS`. The last one bounds how far an `Open_Session` may be drawn; without it the client estimates it from a day's totals.
- **A session preview reports the undescribed time it destroys.** `SessionChangePreview` carries `lostUncoveredSeconds` and `lostUncovered` alongside `reclipped`, because shortening a session also erases `Uncovered_Time` that belongs to no `Activity_Entry` and appears in no re-clip outcome. The server computes it inside the rolled-back transaction; the interface never derives a reported number by intersecting intervals itself.
- **`core` holds no persistence.** Browser session rows live in `store/auth-sessions.ts`, idempotency keys in `store/idempotency.ts`, the `Day_Boundary_Config` in `store/day-boundary.ts`, and `authenticate(event)` in `hooks.server.ts`. The layers run `domain` → `core` → `store` → `services` → `routes` and task 10.1 fails the build if anything imports rightwards.
- **The `Gauge_Window`, the `Evening_Hour` and the day's interval lists are server output.** The interface never derives them. `.design/DESIGN.md` is the source of truth for how they are drawn; this spec is the source of truth for the values.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL with plain `docker run` on the sandbox's own network and reach it by container name. The `sandbox-docker-net` skill has the details.
- The schema was verified against `postgres:16-alpine` while the design was written: the single-open-session index, both exclusion constraints, acceptance of touching intervals and the deferred reshuffle all behave as specified.
- `Interval` is half-open `[start, end)`. This is what lets one session end at 12:00 and the next begin at 12:00 without overlapping, in the TypeScript and in the `tstzrange` columns alike.
- `src/lib/server/domain/` must stay free of Drizzle, `$env`, `$app` and SvelteKit imports. `reclipAffected` takes `ReclipPorts` instead of reaching for the store. Task 10.1 enforces this.
- The advisory lock constant `4919372001` is arbitrary but fixed. Every mutating transaction must take it as its first statement.
- A `Dry_Run` is the real write rolled back, not a separate code path. Keep it that way — it is what makes Property 13 hold.
- **An emptied `Activity_Entry` is never deleted, so it must stay findable.** Every listing selects each `Orphaned_Entry` by its requested interval; without that they become invisible rows that block project deletion forever.
- `pause` is not a server concept. The client sends `/api/sessions/stop` to pause and `/api/sessions/start` to resume; the gap between the two sessions is the break that reconciliation later preserves.
- JSON bodies are `camelCase`, query parameters are `snake_case`. One rule, applied everywhere.
- Error responses carry both an English `message` and a `messageKey`; the interface renders the key, a shell script shows the sentence.
- `fast-check` must be a declared dependency. The workspace template relies on it only transitively, which is a latent break.
- Dependency updates are their own commit. Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
