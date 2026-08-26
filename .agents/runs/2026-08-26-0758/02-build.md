# Phase 2 — Build

**Target:** `.` (repo root) — passed directly by the orchestrator; single-project repo, no sub-project resolution needed.

## Result
OK

## Headline
A full clean-state pass — install, migration check, `bun run check`, lint, the full test suite, production build, a real running instance answering real HTTP requests, and a `docker build` — all came back green with no code changes needed. Phase 1 (`impl`) left the tree in a genuinely working state; this phase's job was independent confirmation and repair, and there was nothing left to repair.

## Needs attention
- Nothing new. The two pre-existing, out-of-scope issues `impl` already logged (`DayRhythm.svelte` missing `fill` CSS; `gaps.spec.ts`/`preview.spec.ts` E2E date collision) were not re-investigated or re-logged — they're unchanged and already tracked in `.agents/ISSUES.md`.
- `scripts/migrate.sh` cannot run on this sandbox host (`psql` not on PATH, no root to install it). Not a project defect — worked around by checking applied-migration state directly via `docker exec worklog-pg psql`. Recorded in `.agents/MEMORY.md` for future phases; `verify`/later phases hitting the same script should use the same workaround rather than re-diagnosing it.

## What changed
No source files changed — every ladder step passed as-is:
- `bun install --frozen-lockfile` — no changes (397 installs across 535 packages).
- Migrations: `001_init.sql` and `002_leisure_time_categories.sql` already applied to both `worklog` and `worklog_test` databases in the long-running `worklog-pg` container, confirmed via `docker exec worklog-pg psql -U worklog -d <db> -tAc "select filename from schema_migrations order by filename;"` (host `psql` unavailable — see Decisions/Memory).
- `bun run check` — clean (`svelte-check`: 2752 files, 0 errors, 0 warnings; generated `palette.css`/`timeline-heights.css` matched what's committed).
- `bun run lint` (`eslint .`) — clean, no output.
- `./scripts/run-vitest.sh run` — 54 files, 618 tests, all passed (521.52s).
- `bun run build` (`./scripts/run-vite.sh build`) — SSR + client builds succeeded (`✓ built in 13.97s`); the only warnings were pre-existing third-party circular-dependency notices from `typebox`/`zod-v3-to-json-schema` inside `node_modules`, not project code.
- Real start: ran the built `build/index.js` directly with Node against the real `.env` (reaching `worklog-pg` over the shared `trayline-net` Docker network this sandbox shell is already attached to — no port publishing needed). Confirmed:
  - `GET /api/health` → `200 {"status":"ok","version":"0.1.0",...}` (real DB connectivity, not a stub).
  - `GET /api/sessions/current` with `Authorization: Bearer <WORKLOG_API_TOKEN>` → `200 {"session":null,"elapsedSeconds":0,"stale":false}` (real authenticated API round-trip, not just the health probe).
  - Process stopped cleanly afterward.
- `./scripts/build.sh worklog:build-phase-check` (`docker build`) — succeeded (`Successfully built ...`, `Successfully tagged worklog:build-phase-check`, ~2GB image). Image removed after confirming success; nothing left running or tagged in the local Docker daemon beyond what was there before this phase.

## Decisions made
- **Verified migration state via `docker exec` instead of `scripts/migrate.sh`.** The script is bash and requires `psql` on the caller's PATH; this sandbox host has neither `psql` nor root to install it, while the `worklog-pg` container bundles its own. Since both `worklog` and `worklog_test` already showed both migrations applied, no actual migration run was needed this phase — only a state check, which the container's own `psql` performs identically. Documented in `.agents/MEMORY.md` so a later phase doesn't re-diagnose this from scratch.
- **Ran the real start check via `node build/index.js` directly rather than through `scripts/start-docker.sh`.** That script uses `docker run --network host`, which would need `DATABASE_URL` to resolve `worklog-pg` from the host network namespace — it doesn't, since `worklog-pg` is a container name on the separate `trayline-net` bridge network, not something host-network DNS resolves. Running the build's own Node entrypoint directly, from a shell already attached to `trayline-net` (confirmed via `getent hosts worklog-pg` and a raw TCP connect to port 5432), reaches the same database with zero extra plumbing and exercises the exact same production build (`bun run build`'s output) that Docker would run. The separate `docker build` ladder step still confirms the Dockerfile itself builds correctly; this decision only concerns how the *smoke test* reached Postgres.
- **No new ISSUES.md entries.** Every ladder step passed cleanly; nothing was found that needed logging beyond what `impl` already recorded.
