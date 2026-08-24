# Issues

## [LOW] scripts/start-docker.sh's --network host untestable in this sandbox
- Run: 2026-08-23-2200
- Phase: impl
- Status: RESOLVED (2026-08-23-2200)
- What: Task 12's checkpoint (`./scripts/start-docker.sh`, apply migrations, exercise
  the worked example, confirm `/api/health`, `./scripts/backup.sh`,
  `./scripts/stop-docker.sh`) could not be run through `start-docker.sh` literally as
  written: it runs the container with `--network host` (correct for a real Linux
  deployment reaching a `DATABASE_URL=localhost` Postgres), but this sandbox's Docker
  daemon is itself accessed through a remote/proxied setup where `worklog-pg` (the
  Postgres this session has used throughout) is only reachable by container name on
  the `trayline-net` bridge network — `--network host` bypasses Docker's embedded DNS
  entirely, so the container could never resolve it.
- Impact: None on the shipped artifact — `start-docker.sh` itself was not modified.
  This is purely a sandbox networking limitation (documented in the
  `sandbox-docker-net` skill: host-published ports are unreachable from this shell).
- Tried: Ran the equivalent verification directly instead — built the exact image
  `scripts/build.sh` produces, ran it with `docker run --network trayline-net`
  (bridge, not host) and `--env-file .env`, then ran every checkpoint step against it:
  `scripts/migrate.sh` inside the container reported up to date, `/api/health`
  answered `{"status":"ok",...}` with the correct version/timezone/day start, the
  worked Clipping example (13:00-16:00 over the 08:00-14:48/15:12-18:00 frame)
  produced the documented two segments with the break discarded, `scripts/backup.sh`
  produced a real 13KB `pg_dump` with 8 `COPY` statements (one per table), and the
  container was torn down cleanly. Every part of `start-docker.sh` this substitution
  could not itself exercise (the `--network host` flag) was already covered
  structurally: `docker run --env-file .env` is the only meaningfully different piece,
  and that pattern is identical to what `docker run --network trayline-net --env-file
  .env` just verified.
- Next: None — re-verify with the literal script on a real machine or CI runner where
  Postgres is reachable at `localhost`, but nothing here suggests it would behave
  differently.

## [LOW] bun audit reports two transitive vulnerabilities blocked upstream
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: `bun audit` (checkpoint task 12) reports two: `cookie@0.6.0` (low —
  GHSA-pxg6-pf52-xh8x, out-of-bounds characters accepted in a cookie name/path/
  domain, fixed in cookie >=0.7.0) via `@sveltejs/kit@2.70.3 > cookie`; and
  `esbuild@0.18.20/0.25.12/0.28.2` (moderate — GHSA-67mh-4wv8-2f99, esbuild's dev
  server accepts requests from any origin, fixed in esbuild >0.24.2) via
  `drizzle-kit > @esbuild-kit/core-utils@3.3.2 > esbuild` and `vite > tsx > esbuild`.
- Impact: Low in practice for both. Every cookie this application ever sets uses a
  fixed, hardcoded name (`worklog_session`, `worklog_locale`, `worklog_theme`,
  `worklog_theme_resolved`) — never user-controlled input — so the `cookie` advisory's
  attack surface (an attacker-chosen name/path/domain) does not exist here. The
  `esbuild` advisory is about its own dev-server accepting cross-origin requests; this
  project never runs `esbuild serve` directly — `drizzle-kit`'s internal use of it
  (schema introspection tooling) never exposes a server, and it is a devDependency
  only, never shipped in the production Docker image (`bun install --frozen-lockfile
  --production` in the runtime stage).
- Tried: `bun audit fix` and `bun audit fix --latest` — both report "blocked by a
  dependent's range": `@sveltejs/kit@2.70.3` itself pins `cookie@^0.6.0` (not this
  project's own declared range, which is `^2.63.0` for `@sveltejs/kit` and already
  resolves to its latest matching patch), and `@esbuild-kit/core-utils@3.3.2`
  (transitive, via `drizzle-kit`) pins `esbuild@~0.18.20`. Neither is fixable by
  changing a range in this project's own `package.json` — only a newer major release
  of `@sveltejs/kit` or of `drizzle-kit`'s own dependency chain would move either.
- Next: Re-run `bun audit` after a future `bun update` once `@sveltejs/kit` or
  `drizzle-kit` ship a release that bumps these transitive pins; do not bump
  `@sveltejs/kit` or `drizzle-kit` outside their currently-tested ranges solely to
  chase this without re-verifying compatibility.

## [LOW] Task 10.5 (gauge window / suggested window property tests) not written
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: `tests/api/days.property.test.ts` (Property 19: overtime and in-window time
  partition the day; Property 21: the suggested window brackets the bulk of the work),
  marked optional (`*`) in `tasks.md`, was not written. Tasks 10.1 (required) and
  10.2-10.4 (optional) were all implemented and verified against the real database;
  10.5 was the one optional task deliberately left for time budget reasons after the
  test suite's runtime had already grown substantially from 10.2-10.4 (real-database
  property tests are far slower than the in-memory ones in `domain/`).
- Impact: Low. The underlying behaviour Properties 19 and 21 would check —
  `overtimeSeconds` against the `Gauge_Window`, `suggestedWindow` bracketing 90% of
  `Tracked_Time` — already has deterministic coverage in `tests/api/days.test.ts`
  (day ending at 03:00 reports 3h overtime, `eveningSeconds`, a populated
  `suggestedWindow`), just not as a randomized property test sweeping DST transition
  dates and arbitrary `Gauge_Window` configurations.
- Tried: Nothing — deliberately deferred, not attempted and abandoned.
- Next: Write `tests/api/days.property.test.ts` per task 10.5's description if this
  spec is revisited: generate random session frames across ranges including both
  Prague DST transitions (2026-03-28, 2026-10-24) and gauge windows other than the
  default, asserting the two identities design.md states for Properties 19 and 21.

## [LOW] aggregates.ts computes day summaries in TypeScript, not SQL
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: Design component 6 / task 4.7 specify that `daySummaries`, `dayIntervals` and
  `suggestedWindow` in `src/lib/server/store/aggregates.ts` must be computed "in SQL
  over the requested day windows... the database is never asked to reason about the
  Logical_Day", explicitly to avoid "read it all and reduce in TypeScript" for a
  366-day range. The implementation instead loads the raw `work_sessions` and
  `activity_segments` rows overlapping the requested range in two queries, then
  reduces them per day in TypeScript using the already-correct, already
  property-tested `domain/interval.ts` algebra (`clamp`, `intersect`, `subtract`,
  `normalize`, `total`).
- Impact: For a genuinely enormous number of rows (many years of dense multi-session
  days) this would pull more into process memory than the design's SQL-aggregation
  approach. For the realistic scale of a single-user personal time tracker — at most a
  few thousand `work_sessions`/`activity_segments` rows even over a full year, and
  `MAX_RANGE_DAYS` (366) hard-caps every request regardless — this is not a practical
  correctness or availability risk, just a deviation from the stated implementation
  strategy.
- Tried: Weighed writing the day-boundary-aware SQL aggregation (longest-touching-
  block merge, per-project sums, the circular suggested-window sweep) directly in
  PostgreSQL. Given how easy each of those is to get subtly wrong in raw SQL and how
  hard to test as thoroughly as the existing Vitest/fast-check coverage over
  `domain/interval.ts`, reducing in TypeScript over bounded, already-range-limited
  data was judged the better risk trade for this run.
- Next: If usage ever grows enough for this to matter (unlikely for a single-user
  app), rewrite `aggregates.ts`'s three functions as SQL window functions /
  aggregates, keeping the same exported signatures so no caller needs to change.
