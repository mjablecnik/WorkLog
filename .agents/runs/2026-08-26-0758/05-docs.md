# Phase 5 — Docs

**Target:** `.` (repo root) — matches `.agents/PIPELINE_STATE.json`'s `"target": "."`
and every prior phase's own resolution. Worklog is a single-package repository; no
sub-project to resolve.

## Result
OK

## Headline
`README.md`, `DOCS.md` and `CLAUDE.md` now describe the billable/leisure feature this
run built. Every documented command was executed for real against a live PostgreSQL
and a real built instance — `bun run check`, `bun run lint`, `bun run test` (54
files/618 tests), `bun run build`, and the exact `curl` examples in `DOCS.md`'s
Activities section — rather than trusted from an earlier phase's report. One of those
executions turned up a broken shared environment left by `verify`'s teardown (the
standing `worklog_test` database had been dropped), which was restored so the
suite could actually run. `DOCS.md`'s Known Limitations now lists all seven real,
currently-open gaps this run's phases found (three spec-ambiguity items `cases`
asked to be surfaced, plus two accessibility defects, a rendering bug and a test-file
date collision that `verify`/`impl` found but never wrote into the docs), and one
inaccurate claim was found and fixed in `CLAUDE.md` by reading the code directly.

## Needs attention
- Nothing new for a human to decide. The three LOW spec-ambiguity issues (3.2/3.3
  contradiction, Requirement 10.7's undefined default, the missing artboard variants)
  are unchanged in `.agents/ISSUES.md` — still open, still needing a decision — and are
  now also visible to anyone reading `DOCS.md` instead of only the issue tracker.
- `.env` and `.env.example` were checked key-for-key against `src/lib/server/core/
  config.ts`'s actual reads (plus `TEST_DATABASE_URL`, read by the test harness): 22
  keys, identical sets both directions. No env var changed for this spec — nothing to
  update.

## What changed
- **`README.md`** — added a short paragraph on billable projects and leisure entries
  right after the existing Clipping pitch; added a table row for
  `003-worklog-time-categories`; corrected the artboard count (`21` → `24`, the three
  new dark/desktop-only category artboards); updated the "depends on" sentence to
  name `003`.
- **`CLAUDE.md`** — added spec `003` to the Specs list (with its own one-line
  description and dependency); extended the `.design/` sentence to cover `003` and
  flag that its three artboards are dark/desktop only; rewrote the `Activity_Entry`
  bullet in "The reconciliation model" to state the optional `Project`, the
  `Leisure_Entry`/`Unrestricted_Window` reconciliation, and the derived
  `paid`/`unpaid`/`relax` category — this bullet previously described the pre-003
  model only. **Found and fixed a real inaccuracy**: the paragraph following it
  claimed Property 22 holds for "every stored `Activity_Segment`" against
  `Tracked_Time` — reading `tests/lib/server/store/overlap.property.test.ts` directly
  showed this was amended by `003-worklog-time-categories` to a `Work_Entry`'s
  segments only (a `Leisure_Entry`'s segments are reconciled against the
  `Unrestricted_Window` by design, so they are not inside `Tracked_Time`, and the old
  wording would have made an incorrect claim the moment leisure time exists). Fixed to
  say so and cite the amendment.
- **`DOCS.md`** — added seven new bullets to Known Limitations (existing four were
  untouched): the 3.2/3.3 partial-leisure-overlap contradiction (and which reading the
  server actually follows), the `Activity_Dialog`'s undecided `paid` default on a
  pure-leisure day, the three artboards' missing light/mobile variants, `DayRhythm.
  svelte`'s missing `fill` rule (segments render black), `ProjectPicker`'s
  `aria-activedescendant` pointing at a nonexistent listbox option, the shared
  rust-orange text colour's marginal AA contrast failure (now also hit by the new
  "Volný čas" stats row and the category segmented control), and the
  `gaps.spec.ts`/`preview.spec.ts` date collision that can fail `bun run
  test:e2e:local`. All seven were already recorded as OPEN in `.agents/ISSUES.md` by
  `impl`, `cases` or `verify`; this phase did not investigate or re-verify any of them
  further, only transcribed them into the reference doc the project's own `CLAUDE.md`
  points readers to for "the current list of open gaps."
- **`.agents/MEMORY.md`** — one new entry: this run's `verify` phase dropped the
  standing `worklog_test` database believing it to be scratch state, breaking `bun run
  test` for every phase after it. Documented so a future teardown checks a database
  name against `.env`'s `TEST_DATABASE_URL`/`DATABASE_URL` before dropping it.
- **`.env` / `.env.example`** — read only, not edited. Confirmed in sync: 22 keys, same
  set both directions, matching every `env.*` read in `src/lib/server/core/config.ts`
  plus `TEST_DATABASE_URL`. Spec 003 added no new environment variable.
- No source, test, config or script file was changed. `git status --porcelain` at the
  end of this phase's work showed only `README.md`, `CLAUDE.md`, `DOCS.md` and
  `.agents/MEMORY.md`/`.agents/PIPELINE_STATE.json` (this phase's own bookkeeping)
  modified; the tree was otherwise clean at both the start and end of the phase — no
  foreign dirty files were present to preserve.

## Decisions made
- **The `worklog_test` database, found dropped, was recreated and re-migrated rather
  than logged and left broken.** `bun run test` is a documented command this phase's
  own charter requires executing for real; a missing database is an environment defect
  blocking that, not a documentation question, and restoring it (`CREATE DATABASE`,
  then both `migrations/*.sql` files applied by hand through `docker exec worklog-pg
  psql`, mirroring `scripts/migrate.sh`'s own logic since this sandbox has no `psql` on
  its own PATH — see the existing `MEMORY.md` entry from `build`) touches no tracked
  file and is the same kind of operational recovery `build`/`verify` already performed
  in this run. Confirmed working afterward: `bun run test` — 54 files, 618 tests, all
  green.
- **All seven currently-open ISSUES.md findings from this run were folded into
  `DOCS.md`'s Known Limitations, not just the three the task explicitly named.**
  `CLAUDE.md` itself commits to "`DOCS.md`'s Known Limitations for the current list of
  open gaps," and the project's own precedent (`002-worklog-ui`'s docs phase, commit
  `b027bab`) transcribed every one of that run's open findings the same way. Leaving
  the accessibility, rendering and test-collision findings out of `DOCS.md` while
  putting only the three ambiguity items in would have been an arbitrary half-measure
  against that precedent.
- **The two pre-existing (`002`-vintage) accessibility defects and the `DayRhythm`
  fill bug were documented, not fixed.** All three are real, already `OPEN` in
  `ISSUES.md`, and fixing any of them means changing component source — out of this
  phase's scope regardless of how small the fix looks.
- **README's pitch gained one short paragraph, not a rewrite.** The existing
  Clipping-worked-example pitch is the project's established voice; billable/leisure
  is described in the same register (plain prose, no jargon) rather than introducing
  `Project.billable`/`category` terminology that belongs in `DOCS.md`.
- **Test data created while exercising `DOCS.md`'s own curl examples (a "Household
  chores" project, an "Evening off" leisure entry) was deleted afterward** via the
  same API, leaving the pre-existing dev-database fixtures (`Checkpoint Worked
  Example`, `Docs check`, from earlier phases) exactly as found.
