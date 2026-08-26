# Run 2026-08-26-0758 — 003-worklog-time-categories

Billable projects and leisure time, built end to end and verified in a real browser.
Target: `.` (the repository root — Worklog is a single-package repo).
35 commits, 85 files, +6340/−459 (`c08c73b..23ec36f`).

## Status

| Phase | Result | |
|---|---|---|
| impl | OK | all 70 spec tasks implemented and checked off; `check` + 618 tests green |
| build | OK | clean-state ladder — install, migrations, check, lint, tests, build, real running instance, `docker build` — all green, nothing to repair |
| cases | OK WITH ISSUES | 90 use cases (UC-509…UC-598) covering all 82 acceptance criteria; 3 spec ambiguities logged, none guessed |
| verify | OK WITH ISSUES | all 90 executed against a real DB and a real built app; 88 pass, the 2 written as expected failures failed exactly as predicted; 3 fixes made, 2 pre-existing a11y defects logged |
| docs | OK | README/DOCS/CLAUDE synced, every documented command actually run, one inaccurate CLAUDE.md claim found and fixed |

No phase failed. The run delivered what the spec asked for.

## What was built

Requirements 1–12 of `.kiro/specs/003-worklog-time-categories` are all implemented, and
all 70 boxes in `tasks.md` are checked — none silently ticked.

- **Schema and contracts** — `migrations/002_leisure_time_categories.sql` adds
  `projects.billable` and drops `NOT NULL` from `activity_entries.project_id`; the
  wire shape gains `billable` and a derived `category` (`paid` / `unpaid` / `relax`).
- **Domain** — a `Leisure_Entry` is an entry with no project, reconciled against the
  `Unrestricted_Window` instead of `Tracked_Time`. Category transitions re-clip
  all-or-nothing; `Quick_Log` and the dialog's "most recent entry" now resolve from
  `Work_Entry` rows only, so leisure never suggests a project.
- **Interface** — `Leisure_Block` on the day timeline as a top-level unit sharing the
  proportional height budget, a paid/unpaid/relax segmented control with a filtered
  project picker in the activity dialog, a billable toggle on project rows and the
  creation form, a by-category day panel, and statistics grouped by billable with the
  three new figures. A ninth reserved low-chroma palette slot (`pj-relax`) that the
  modular colour wraparound never reaches.
- **i18n** — 22 new keys added to `en`/`cs` in lockstep (pinned count 256 → 278).
- **Tests** — new unit, `fast-check` property, real-Postgres integration, component and
  Playwright coverage at every layer; 54 files / 618 tests green.

Nothing specified was left undelivered. Three things the spec itself left undecided are
under "Needs your decision" below.

**Three real bugs were found and fixed by running the thing rather than reading it:**

- Converting an existing `Work_Entry` into a `Leisure_Entry` through the real activity
  dialog **silently failed every time** (400, generic validation error).
  `sveltekit-superforms` fills a `FormData`-absent nullable field with `null`, not
  `undefined`, so the "was `projectId` actually submitted?" check in
  `src/lib/server/services/activity-form-actions.ts` was always true and every plain
  `clearProject=true` submission was rejected as contradictory. Now checks
  `formData.has('projectId')`. Reproduced and re-confirmed through a real browser.
- The category-crossing patch path returned a hardcoded empty `discarded` list,
  under-reporting a re-clip (`src/lib/server/services/activities.ts`).
- Two of this spec's own new E2E fixtures collided on `2024-01-21` in the shared
  database (`tests/e2e/conflict.spec.ts`).

Plus two caught during `impl`: an `<hr>` with an implicit `role="separator"` colliding
with `BreakMarker`'s, and a 320 px overflow on the projects creation form.

## Open issues

Nineteen entries in `.agents/ISSUES.md` are `OPEN`; seven were opened by this run.
Full detail — what, impact, what was tried, next step — is in that file.

**From this run:**

- **[HIGH] `ProjectPicker`'s `aria-activedescendant` points at an element that is not in
  the DOM** while the popup is collapsed. axe flags it `critical`; a screen reader
  following it is pointed at nothing. Reachable on every dialog with a project field.
  Confirmed via `git log` to predate spec 003 — a `002-worklog-ui` defect this run's
  broader axe sweep newly surfaced, not a regression.
- **[MEDIUM] A shared rust-orange text token marginally fails WCAG AA** in two places
  the existing a11y suite never scanned: `/stats` in light theme at 390 px (4.31:1) and
  the active segmented-control tab in dark theme (4.35:1). In both, a brand-new element
  fails identically to a pre-existing sibling sharing the same class — one token, not
  per-feature code.
- **[LOW] `DayRhythm.svelte`'s covered and leisure rects have no `fill` rule**, so they
  most likely render black. Predates this spec; confirmed live as UC-589, which was
  deliberately written as an expected failure so it would be measured, not skipped.
- **[LOW] `gaps.spec.ts` and `preview.spec.ts` both hardcode `2024-01-19`** and collide
  with `SESSION_OVERLAP` when the full `bun run test:e2e:local` suite runs in one
  process. Unrelated to this spec (both are `002`-vintage). Confirmed live as UC-598.
- Three **[LOW] specification ambiguities** — listed under "Needs your decision", since
  they are questions rather than defects.

**Carried from earlier runs** (unchanged, none re-investigated this run): the full E2E
suite occasionally exceeding the login rate limit; `gauge-geometry.ts`'s `arc()` being
single-calendar-day only; two mechanisms for hover/active surface-alpha derivation; the
Paraglide plural/select array form; two statistics page-assembly judgment calls; the
`/login` page never exercised over HTTP in run 001; the unrecorded login passphrase; two
transitive `bun audit` vulnerabilities blocked upstream; unwritten task 10.5 property
tests; day summaries computed in TypeScript rather than SQL; and `002`'s Checkpoints 2,
4, 10 and 12 never walked by hand.

Also worth a one-line correction next time `USE_CASES.md` is touched: **UC-527's
"Expected" text is wrong** — it names `NOTHING_TO_LOG` where the server consistently
answers `ACTIVITY_OVERLAP`, which is what UC-525/526/528 already accept. A `cases`
authoring slip with the same root cause as the 3.2/3.3 ambiguity below, not a product
defect; no separate issue was opened.

## Needs your decision

Three questions the specification does not answer. Each is `LOW` severity but none can
be settled by an agent without guessing, and all three are one sentence of spec away
from closed.

1. **Requirements 3.2 and 3.3 contradict each other on a partial leisure overlap.**
   3.2 says the overlapping stretch is trimmed out; 3.3 says any overlap is refused with
   `ACTIVITY_OVERLAP`. Both cannot hold. The code, `design.md`'s error table and
   `001-worklog-domain-api` all follow the 3.3 reading, and the use cases were written to
   match the build — so the likely resolution is to reword 3.2 (and clarify where a
   leisure sliver can actually arise, for 3.4/3.7). **If 3.2 is the intended answer, this
   is a behaviour change, not a wording fix.**
2. **Requirement 10.7 does not say what category the activity dialog defaults to on a
   day with no `Work_Entry`** — precisely the pure-leisure day this spec exists to
   support. The build falls back to `paid`; `relax` is at least as defensible. UC-582
   records what the build does and deliberately does not treat either as a failure.
3. **The three new screens have no light or mobile artboards**, so the `Leisure_Block`,
   the category control and the billable toggle can be conformance-checked at
   desktop-dark only. The requirements document declares this open and asks an
   implementer to flag it; this is the flag. Either draw the six missing variants, or
   record a deliberate decision that these three screens are governed by `DESIGN.md`'s
   general rules in light and mobile. Both are legitimate; leaving it unstated is not.
   `002-worklog-ui` found three real contrast violations and a 320 px overflow on
   screens that *did* have artboards, so the gap has a track record.

## Where to look

- **Phase reports** — `.agents/runs/2026-08-26-0758/01-impl.md` … `05-docs.md`. Each
  carries a `What changed` and a `Decisions made` section far more detailed than the
  above; `04-verify.md` is the one to read for how the environment was actually stood up.
- **`.agents/ISSUES.md`** — all nineteen open entries, newest at the top.
- **`.agents/USE_CASES.md`** — Part III (UC-509…UC-598) is this spec's definition of
  working, with a table mapping all 82 acceptance criteria and Properties 1–7.
- **`.agents/MEMORY.md`** — two lessons from this run: `psql` is not on this sandbox's
  PATH (use `docker exec worklog-pg psql`), and a teardown must check a database name
  against `.env` before dropping it (this run's `verify` dropped the standing
  `worklog_test`, which `docs` then had to restore).
- **`DOCS.md` Known Limitations** — all seven of this run's open gaps, transcribed for
  readers who never open the issue tracker.
- **`.agents/tmp/`** — empty; `verify` consumed its handover files and this phase
  cleared the rest.
