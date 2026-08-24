# Phase 1 — Implementation

**Target:** `.` (repository root) — the whole repository, since `worklog` is a single
SvelteKit application, not a monorepo. Derived from the spec: `.kiro/specs/001-worklog-domain-api/design.md`'s
file list covers the entire `src/`, `migrations/`, `scripts/` tree at the repo root.

## Result
OK

## Headline
Implemented the whole of spec `001-worklog-domain-api` from an empty `src/` skeleton
to a deployable, documented service: the pure domain layer (interval algebra,
`Logical_Day`/DST resolution, `Clipping`, re-clipping), the store layer over
`drizzle-orm/postgres-js`, authentication and hooks, all three write services
(sessions, activities, projects), every REST route (`/api/sessions`, `/api/projects`,
`/api/activities`, `/api/days`, `/api/coverage`, `/api/health`), the module-boundary
guard, a substantial set of property tests against the real database, the production
Dockerfile, `fly.toml`, every operational script, and `DOCS.md`/`CLAUDE.md`. 68 of 70
tasks are checked off; the one open task (10.5, a starred/optional property test) is
recorded in `ISSUES.md` with reasoning. `bun run check`, `bun run test` (327 tests)
and the deployable-service checkpoint (task 12) all pass.

## Needs attention
- **Task 10.5** (gauge-window/suggested-window property tests, optional per the
  spec's own `*` convention) was deliberately not written — the underlying behaviour
  already has deterministic coverage in `tests/api/days.test.ts`, and the real-database
  property tests already written (10.2-10.4) had already grown the suite's runtime
  substantially. See `ISSUES.md` for the full writeup and what writing it later would
  look like.
- **`bun audit`** (part of the task 12 checkpoint) reports two transitive
  vulnerabilities — `cookie@0.6.0` (low, via `@sveltejs/kit`) and `esbuild`
  (moderate, via `drizzle-kit`'s dev tooling) — both blocked upstream (`bun audit fix`
  confirms neither can move within this project's own declared ranges) and both low
  real-world risk given how this project actually uses them (fixed cookie names only;
  `esbuild`'s dev server is never run). Recorded in `ISSUES.md`; worth re-checking
  after a future `bun update` once `@sveltejs/kit` or `drizzle-kit` bump their own
  transitive pins.
- **Commit history was not squashed** for this phase. `git rebase -i` is unavailable
  in this environment (the harness explicitly disallows the `-i` flag), and a manual
  `git reset --soft` + re-stage across ~40 commits spanning this much surface area
  risked losing or misattributing real history for a purely cosmetic gain. Every
  commit already represents one logical, Conventional-Commit-formatted change with no
  WIP/fixup noise — five small `docs(spec): mark ... complete` bookkeeping commits sit
  immediately after the feature commit they document and were judged not worth the
  risk of forcibly merging without an interactive tool. See `git log --oneline
  b96346dbb19a8721469ee47b9157d1b9719cb64d..HEAD` for the full, legible list.
- `002-worklog-ui` depends on this spec and can now start.

## What changed
Everything under `src/`, `migrations/`, `scripts/`, `tests/`, plus `Dockerfile`,
`.dockerignore`, `fly.toml`, `DOCS.md`, `CLAUDE.md`, and a `README.md` edit (linked
`DOCS.md` in). The full commit list from `git log --oneline
b96346dbb19a8721469ee47b9157d1b9719cb64d..HEAD` is the authoritative account; the
major areas, in the order they were built:

1. **Scaffold and contracts** — SvelteKit project skeleton, `.env.example`,
   `src/lib/contracts/` (Zod schemas, response/model types), `core/` (config
   validation, logging, error envelope, security headers).
2. **Domain layer** (`src/lib/server/domain/`) — the interval algebra
   (`interval.ts`), DST-correct `Logical_Day` resolution via a from-scratch
   `Intl.DateTimeFormat`-based transition scanner (`logical-day.ts`, deliberately
   independent from `core/config.ts`'s own parallel implementation — see the module
   boundary note below), `clip()` for all three activity modes plus `resolveAnchor`
   (`clipping.ts`), and `reclipAffected` (`reclip.ts`).
3. **Database** — `migrations/001_init.sql` (the full schema: `EXCLUDE USING gist`
   constraints, the deferred-constraint reshuffle support, triggers), `scripts/migrate.sh`,
   Drizzle table definitions under `src/db/schema/`.
4. **Store layer** (`src/lib/server/store/`) — `tx.ts` (the advisory lock, `Dry_Run`
   rollback signal, constraint-error translation), one file per aggregate
   (`work-sessions.ts`, `projects.ts`, `activities.ts`, `aggregates.ts`,
   `auth-sessions.ts`, `idempotency.ts`, `day-boundary.ts`).
5. **Auth and hooks** — `core/auth.ts`, `core/rate-limit.ts`, `hooks.server.ts`
   (the full `handle` sequence — request id, readiness, logging, locals, security
   headers, CORS, body-size limit, rate limit, the `Auth_Hook`), `/login`/`/logout`.
6. **Services** (`src/lib/server/services/`) — `projects.ts`, `sessions.ts` (the
   `Dry_Run`/`Preview_Token`/re-clip orchestration for every session write),
   `activities.ts` (mode selection, the extend-policy rescue order fixed by
   Requirement 2.12, `Idempotency-Key` handling, `Preview_Token` over the whole
   `Logical_Day`), and — added mid-phase, after `tests/lib/server/imports.test.ts`
   caught them importing `domain` from `core` — `day-aggregation.ts`, `query-range.ts`
   and `auth.ts` (the last so `/login`/`/logout` never reach `core/auth.ts` directly).
7. **REST routes** (`src/routes/api/`) — every route in the design's file list:
   sessions (`start`/`stop`/`current`/list/create/`[id]`), projects, activities
   (including cursor pagination and `Idempotency-Key`), `days`, `days/[date]`
   (including `quickLog`), `coverage`, `health`.
8. **Guards and property tests** — `tests/lib/server/imports.test.ts` (the module
   boundary guard, via the TypeScript compiler API, not a regex), and property tests
   against the real database: write atomicity and reachability (Properties 10, 16),
   the dry-run properties (13, 14, 18 — this is what caught the dry-run status-code
   bug below), and the global invariants (7, 8, 15, 22, 23 — Property 22 via a random
   sequence of session/activity operations).
9. **Packaging and docs** — the two-stage `Dockerfile`, `fly.toml`, every operational
   script (`build.sh`, `start-docker.sh`, `stop-docker.sh`, `deploy.sh`, `backup.sh`,
   `test-e2e.sh`, alongside the already-existing `migrate.sh`/`hash-passphrase.sh`),
   `DOCS.md`, `CLAUDE.md`.

## Decisions made
- **Open_Mode's orchestration lives in `services/activities.ts`, not
  `domain/clipping.ts`** (task 6.3). Resolving the end against the `Target_Day`'s last
  `Work_Session` needs a store query, which the pure domain layer may not perform.
  Recorded directly in the task's own text in `tasks.md`.
- **`core/day-aggregation.ts` and `core/query-range.ts` were moved to `services/`
  mid-phase.** Both originally lived under `core/` and imported
  `domain/logical-day.ts`; `tests/lib/server/imports.test.ts` (written for task 10.1)
  correctly failed on this — `core` may depend on nothing of this project's own but
  `contracts`, by design, so that `core/config.ts` and `domain/logical-day.ts` can
  never accidentally disagree about a DST transition by one silently calling the
  other. `services` may depend on `domain`, so both moved there. The commit fixing
  this predates the guard test's own commit, since the violation was found and fixed
  while writing the eventual test.
- **`services/auth.ts` was added** so `/login` and `/logout` (`+page.server.ts` files
  under a non-`api` route) never import `core/auth.ts` or `core/config.ts` directly —
  the same module-boundary rule that restricts the future `002-worklog-ui` layer to
  reaching `src/lib/server/` only through `services` or `store`. This was a real,
  pre-existing violation the guard test caught, not a hypothetical one.
- **`resolveQueryRange` gained a cheap lower-bound check** before calling the
  DST-aware `dayResolver.range()`: a multi-year query range was materialising
  thousands of `Logical_Day` windows just to be rejected as `RANGE_TOO_LARGE`, timing
  out a property test. `MAX_LOGICAL_DAY_MS` (25h) bounds the true day count from
  below cheaply; only a range close enough to the boundary pays for the precise walk.
- **Two real bugs were found and fixed by the property tests written for task 10.3**,
  not by manual testing: (1) `POST /api/sessions/start`, `POST /api/sessions` and
  `POST /api/activities` all forced a `Dry_Run` to answer HTTP 200 regardless of what
  the real write would answer, when Requirement 14.3 requires the same status code in
  both cases (only a 204 write is remapped, to 200, per 14.11) — creates should have
  answered 201 in both cases. (2) `createActivity` consulted and claimed an
  `Idempotency-Key` even during a `Dry_Run`, which never creates anything — a client
  previewing with a key and then confirming with the same key would have replayed the
  cached preview instead of reaching a genuine first write.
- **`migrate.sh` and `backup.sh` were `source`-ing `.env` directly**, which crashes
  under `set -u` the instant `WORKLOG_PASSPHRASE_HASH` holds a real argon2id hash
  (`$argon2id$v=19$...` — bash tries to expand `$argon2id`, `$v`, etc. as unset
  variables). Neither script had been exercised against a real hash value until the
  task 12 checkpoint. Fixed by reading the file line by line with `read` instead of
  `source`, which never re-parses a value for expansion. `deploy.sh` already used the
  safe line-based pattern and did not have this bug.
- **`bun.lock` was regenerated in Bun 1.2.15's lockfile format (v1).** The committed
  lockfile had been written by this sandbox's Bun 1.4.0 (v2 format), which
  `oven/bun:1.2.15` (the Dockerfile's pinned base image, matching `package.json`'s
  `packageManager`) cannot parse at all — `bun install --frozen-lockfile` failed
  outright in the builder stage. Regenerated inside an `oven/bun:1.2.15` container;
  the resolved dependency versions are byte-identical between the two formats, only
  the lockfile's own version marker differed.
- **`.gitignore`'s bare `coverage/` pattern was shadowing `src/routes/api/coverage/`**
  — anchored it to the project root (`/coverage/`) so it only ever matches the test-
  coverage output directory it was meant for.
- **`bun run build/index.js` and `bun ./build/index.js` were verified to work
  correctly** against the real database before committing to the Dockerfile's `CMD` —
  this matters because the Bun PATH-shim bug documented in `MEMORY.md`
  (`scripts/run-vitest.sh`'s reason for existing) is specific to `bun run <package.json
  script>`'s nested-subprocess PATH shimming, not to Bun loading `zod` and `postgres`
  together in general; a directly-invoked file (not a `package.json` script name)
  never triggers it, confirmed by running the actual production build end to end
  including a real `POST /api/projects`.
- **`start-docker.sh` uses `--network host`**, correct for a real Linux deployment
  reaching a `DATABASE_URL=localhost` Postgres, but untestable in this sandbox (its
  Docker daemon only exposes sibling containers by name on a bridge network, never
  via host networking). Verified the equivalent (`docker run --network
  <sandbox-network> --env-file .env`) directly against the real database instead for
  the task 12 checkpoint — recorded as resolved-by-substitution in `ISSUES.md`.
- **Route-level tests call `+server.ts` handlers directly** with a constructed
  `RequestEvent` (`tests/api/helpers.ts`'s `mockEvent`), per the design document's own
  stated testing strategy, rather than through a live HTTP server — faster and closer
  to what the design specifies, though a handful of manual smoke tests through the
  real `vite dev`/production-build server were also run during development to catch
  what a route-level test alone would not (routing, serialization, real middleware
  ordering).
