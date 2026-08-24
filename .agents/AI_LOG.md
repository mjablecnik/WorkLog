# AI Log

## 2026-08-24 23:30 Prague — 2026-08-24-0659

Spec `002-worklog-ui` — the Worklog browser interface — implemented, built, catalogued,
verified, documented and closed, plus an extra bug-fixing pass after the last phase.

- Built the whole interface on top of run 001's API: four screens (`/`, `/day/[date]`,
  `/projects`, `/stats`) inside a shared shell, plus `/login`, `/logout`, `/offline`,
  the `lib/ui/` design system, light/dark themes, cs/en via Paraglide, and the
  `Dry_Run`/`Preview_Token` Change-Preview pattern that every session and activity
  dialog uses. 102 commits, 176 files, ~34 700 lines (`8c52566..1be51fa`).
- 61 of 67 `tasks.md` boxes checked. The 6 unchecked are task 11.6's visual
  conformance pass and Checkpoints 2, 4, 10 and 12 — all deliberately left open, none
  silently ticked.
- Two severe bugs, both found only by driving a real browser rather than reading code,
  both fixed: every fresh visitor got a 500 (`theme.svelte.ts`'s cookie writers had no
  SSR guard, so the default `system` preference threw `document is not defined` on the
  server — `/login` included, so nobody could even log in), and every write that
  reached the confirm step answered `409 STALE_PREVIEW` (`finishWrite` fingerprinted
  after the mutation while the freshness check compared against a fingerprint taken
  before it — the two could never agree, for any write shape, at any speed).
- `impl` correctly refused to fix the second one under 002's scope — the broken code is
  spec 001's `services/` — and logged it in full; `build` then fixed it properly.
- `build` also found that `eslint.config.js` had never wired a TypeScript parser since
  the project's first commit: `bun run lint` reported 0 errors only because espree was
  silently failing to parse TypeScript. Wiring it in surfaced ~37 real errors, all fixed.
- `cases` wrote 272 use cases (UC-237…UC-508) covering all 270 acceptance criteria and
  the sixteen artboards, taking the catalogue to 508 cases across both specs.
- `verify` fixed a systemic WCAG contrast gap (root-caused to `--text-faint`'s alpha
  against every palette tint, not the three isolated spots originally logged), a 320px
  overflow (a missing `invalidateAll()` after the viewport-cookie correction), the E2E
  clean-checkout blocker, and two defects found by redoing the visual pass. 33 of 34
  E2E tests green; the one failure turned out later to be a stale test.
- `docs` found a HIGH bug while verifying its own documented commands:
  `scripts/test-e2e.sh` set `DATABASE_URL` identical to `TEST_DATABASE_URL`, which
  `tests/setup/db.ts` refuses outright, so `test:e2e:local` and `test:all` threw before
  any spec ran, on any machine — not a sandbox artifact.
- A post-phase-5 fix pass (11 commits, `019b664..1be51fa`) investigated 10 issues:
  9 fixed, 1 found to be a stale test for an already-fixed bug and rewritten. Included
  that E2E harness bug, `migrate.sh`/`backup.sh`/`run-vite.sh` silently overriding a
  caller's `DATABASE_URL`, `layOutDay`'s UTC-midnight day-boundary approximation, the
  decorative idempotency status column, seven files' desktop-first media queries, and
  three documentation defects fixed at their source (`design.md`'s Property 1 wording,
  Requirement 11.1's missing `/logout`, the fixture date collision).
- `impl` and `verify` are recorded `failed`, not `done` — both left real, tracked open
  items rather than ticking them off. `build`, `cases`, `docs` and `report` are `done`.
- 18 issues left OPEN across both runs, all `LOW`. Every CRITICAL, HIGH and MEDIUM
  finding ever raised on this project is now closed.
- Eight things left for the user: the two design contradictions resolved provisionally
  in favour of the code (block head 13px not 14px, mobile uncovered-marker threshold
  44px not 26px), the missing mobile FAB create path, four artboard-less icons,
  `SessionDialog`'s `lostUncoveredSeconds` edge case, UC-472's flag-colour token
  exception, the nine unrechecked token-only surfaces, and — the one that matters —
  a human-paced manual walkthrough of the running application, which has never
  happened for either spec.
- Both specs together now make a working, fixed, documented, backend-and-UI-complete
  application. All of its verification is machine verification.

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
