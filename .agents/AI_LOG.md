# AI Log

## 2026-08-24 11:56 Prague — 2026-08-23-2200

Spec `001-worklog-domain-api` — the Worklog domain layer, data layer and REST API —
implemented, verified and documented across all six pipeline phases.

- Built the whole service from an empty `src/`: the pure domain layer (interval
  algebra, DST-correct `Logical_Day` resolution, clipping and re-clipping), the store
  layer over `drizzle-orm/postgres-js`, three write services, every `/api` route,
  auth over both cookie and bearer token, the Dockerfile, `fly.toml` and all
  operational scripts. 58 commits, 138 files, ~20 000 lines (`b96346d..8c52566`).
- 68 of 70 spec tasks checked off. Task 10.5 (optional property tests for the gauge
  and suggested windows) deliberately skipped and recorded, not silently ticked.
- `cases` wrote 236 use cases covering all 285 acceptance criteria and all 25
  correctness properties, and found 18 divergences by reading the code against the
  spec — one HIGH (a bad configuration never logged its problems and never exited).
- `verify` drove 44 of 45 walkthrough steps against the live API on a real Postgres,
  fixed 15 of the 18 `cases` findings plus 6 more defects that only running the code
  could surface — including a Drizzle error-wrapping bug that made the DB-timeout-to-503
  path unreachable, and adapter-node's own 512K body ceiling pre-empting this app's
  1 MiB check. The 327-test suite stayed green throughout.
- Two real environment bugs, both from Bun's `.env` loader expanding `$name` inside
  the argon2id passphrase hash: `migrate.sh`/`backup.sh` crashing under `set -u`
  (fixed in `impl`), and `dev`/`build`/`preview` not starting at all (fixed in `build`
  via `scripts/run-vite.sh`). Both recorded in `MEMORY.md`.
- Nine issues left OPEN, all LOW: the two upstream-blocked `bun audit` transitive
  vulnerabilities, skipped task 10.5, `aggregates.ts` summing days in TypeScript
  rather than SQL, `migrate.sh` ignoring an environment `DATABASE_URL`, a fixture
  collision in `USE_CASES.md`, `/login` rendering unverifiable until spec 002, and
  the three items awaiting a product decision.
- Four questions left for the user: whether Requirement 12.30's preference-cookie
  setting belongs to 001 or 002 (resolved in favour of 001, reversible in one
  function), whether Requirement 11.1 should name `/logout` among its auth
  exemptions, whether an idempotent replay should return the status it stored, and
  confirmation of the `ALLOW_DAY_BOUNDARY_CHANGE` spellings taken from `tasks.md`.
- The `report` phase ran roughly seven hours after `docs` closed, delayed by a
  prolonged Anthropic API outage unrelated to this project. Run `2026-08-24-0659`
  (spec 002, the UI) had already started in the meantime and was mid-`impl` when this
  summary was written.
