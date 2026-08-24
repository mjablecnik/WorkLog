# Phase 3 — Cases

**Target:** `.` — the repository root. Passed explicitly in the phase prompt and
confirmed by `PIPELINE_STATE.json` (`"target": "."`); Worklog is a single SvelteKit
application, not a monorepo, and `design.md`'s file list resolves entirely under `src/`,
`migrations/`, `scripts/` and `tests/` at the root.

## Result
OK WITH ISSUES

## Headline
The spec now has a written target: 236 numbered use cases covering all 285 acceptance
criteria of `requirements.md` and all 25 correctness properties of `design.md`, plus a
45-step walkthrough that drives them over the REST API in one pass. Reading the
implementation against the requirements while writing them turned up eighteen
divergences, one of them high — a bad configuration never logs its collected problem
list and never exits — all recorded in `ISSUES.md` for `verify` to confirm and fix.

## Needs attention
- **The login passphrase is unrecoverable.** `.env` holds a real argon2id hash but the
  passphrase behind it is recorded nowhere. Eleven use cases need a `Browser_Session`.
  `verify` should mint a throwaway hash for a scratch environment; it must not change
  the committed `.env` and must not write any passphrase into a tracked file.
- **Requirement 12.30 may belong to spec 002.** The server reads all three preference
  cookies and sets none, so the attribute table it fixes is unimplemented. Either `001`
  gains the code or the requirement moves — that is a specification decision, not one to
  take while verifying.
- **`tasks.md` and `config.ts` disagree** on which spellings of
  `ALLOW_DAY_BOUNDARY_CHANGE` are truthy. One of the two has to change.
- **`/logout` is exempt from authentication** though Requirement 11.1 enumerates the
  exemptions and does not list it. Harmless in practice; needs a decision rather than a
  reflex fix.
- Nine use cases (UC-002, UC-003, UC-005, UC-006, UC-007 and the whole configuration
  matrix in walkthrough step 44) require restarting the process with deliberately broken
  environments, and several need PostgreSQL stopped. They are deliberately placed last
  in the walkthrough so they cannot disturb the main pass.

## What changed
- **`.agents/USE_CASES.md`** — created (2 524 lines). A preamble fixing the conventions
  (`$BASE`, `$TOKEN`, the default preconditions, `ENV-DEFAULT`, the fixed-constant
  values), sixteen named fixtures, then UC-001 … UC-236 grouped by area: health,
  config, ops, auth, errors, projects, timer, sessions, the three activity modes,
  clipping, activity CRUD, days, coverage, logical day, dry run and the end-to-end
  correctness properties. It closes with a coverage matrix mapping every one of the 285
  criteria and all 25 properties to the case that exercises it — mechanically checked,
  with no gaps.
- **`.agents/tmp/VERIFY_TASKS.md`** — created. 45 ordered steps, each naming the cases it
  settles, ordered so that each fixture is seeded once and then drained: bring-up,
  auth, envelope, projects, timer, stale timer, session CRUD, explicit mode, policies,
  duration mode, open mode, re-clipping and orphans, listing and paging, days,
  coverage, logical day and DST, dry run, idempotency, the property sweep, and finally
  the restart-heavy rate-limit, readiness and configuration matrices. It opens with the
  sandbox facts the next phase would otherwise rediscover: reach PostgreSQL by container
  name on `trayline-net`, never let Bun parse `.env`, use `worklog_test` rather than the
  dirty `worklog`, and mint a passphrase hash before step 3.
- **`.agents/ISSUES.md`** — eighteen entries prepended, under a note stating plainly that
  this phase executed nothing and every finding came from reading. One HIGH (no
  configuration exit), seven MEDIUM (`METHOD_NOT_ALLOWED` never produced and no
  `handleError`; the streaming body limit answering 500; cross-origin cookie rejection
  gated on production; the preference cookies never set; `DELETE /api/projects/{id}`
  answering 204 for an unknown id; `POST /api/sessions` misclassifying reversed bounds;
  `/api/days/{date}` accepting an impossible date), ten LOW.
- No source file, test, script or specification document was touched.

## Decisions made
- **236 cases at criterion granularity, not a dozen scenarios.** `requirements.md`
  numbers 285 criteria and the gate is that every one is traceable. A smaller catalogue
  would have had to bundle unrelated assertions under one identifier, and a case that
  half-fails then has nowhere to be recorded. The cost is paid back in the walkthrough,
  which groups them into 45 steps.
- **Cases assert the specified behaviour, never the observed behaviour.** Where the
  implementation is known to diverge, the case states the requirement's answer and names
  the `ISSUES.md` entry inline. A case rewritten to match a bug can never find it again.
- **Named fixtures rather than per-case setup prose.** Sixteen fixtures are defined once
  and each `Data needed` line names one plus its deltas, so the walkthrough can seed
  once and drain many cases. Every fixture is built through the API except the two that
  cannot be — the 30-second session of UC-140, which the write path rightly refuses, and
  FIX-PAGE's 201 entries, which is a script's job.
- **Day D is 2026-08-20 and the autumn DST fixture uses 2025-10-25.** Every write is
  refused beyond `FUTURE_TOLERANCE_SECONDS`, so the fixtures must sit in the past. The
  design's own autumn example, 2026-10-24, is two months in the future from this run and
  cannot be seeded; the 2025 transition gives the same 25-hour logical day. The spring
  example, 2026-03-28, is already in the past and is used verbatim.
- **The restart-dependent cases go last.** Rate limits, readiness states and the
  configuration matrix all need the process stopped and started with a different
  environment, and several need PostgreSQL down. Interleaving them would make every
  earlier step's failure ambiguous.
- **Eighteen issues rather than a shorter, tidier register.** The contract says to write
  down anything uncertain, and a divergence found by reading is exactly that: cheap to
  record, unrecoverable once this agent's context is gone. Each entry says explicitly
  that it was not reproduced, so `verify` knows to confirm before fixing.
- **Inspection-only cases are marked as such.** Nine cases (constant-time comparison,
  argon2id storage, session-token hashing, per-request `locals.today`, the version
  source, the unconfigurable login bucket, and the three property sweeps) cannot be
  settled by a request alone and carry a `Method:` line saying what to read instead.
