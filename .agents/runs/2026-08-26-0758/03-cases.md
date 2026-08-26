# Phase 3 — Cases

**Target:** `.` — the repository root, which is also the SvelteKit project root. Passed
explicitly in this phase's prompt and matching `.agents/PIPELINE_STATE.json`'s
`"target": "."`. Worklog is a single-package repository, not a monorepo: `.kiro/`,
`.agents/`, `.design/` and `src/` all sit at the same level, so there is no sub-project
to resolve and no nested `.agents/` anywhere in the tree.

## Result
OK WITH ISSUES

## Headline
Spec `003`'s billable/leisure feature now has a written definition of "working": 90 new
use cases (UC-509 … UC-598) appended to `.agents/USE_CASES.md` as a new **Part III**,
covering all 82 acceptance criteria of `003-worklog-time-categories/requirements.md`,
all seven of its correctness properties, and the three new artboards.
`.agents/tmp/VERIFY_TASKS.md` orders them into a 62-step walkthrough in nineteen passes,
grouped so the database is reseeded about twenty times rather than ninety. Three
findings were harvested, all places where the specification is too vague to write a
settled acceptance criterion — none of them was resolved by guessing.

## Needs attention

- **Requirements 3.2 and 3.3 contradict each other** on what a *partial* leisure overlap
  does — 3.2 says the overlapping stretch is trimmed out of the segments, 3.3 says any
  overlap is refused with `ACTIVITY_OVERLAP`. Three use cases turn on the answer
  (UC-525, UC-526, UC-527). They are written on the reading that 3.3 wins, because that
  matches `001-worklog-domain-api` and today's code — but the requirements document
  still states both, and somebody has to amend one of them. Logged LOW.
- **Requirement 10.7 does not say what the activity dialog's category defaults to on a
  day with no `Work_Entry`** — which is exactly the pure-leisure day this whole
  specification exists to support. Today's build falls back to `paid`; `relax` is at
  least as defensible. UC-582 records what the build does and explicitly does not treat
  either answer as a failure. Logged LOW.
- **The three new artboards have no light or mobile variant**, so the `Leisure_Block`,
  the category control and the billable toggle can be conformance-checked at
  desktop-dark only. The requirements document declares this open and tells an
  implementer to flag it rather than guess; this is the flag. `002-worklog-ui`'s own run
  found three real contrast violations and a 320 px overflow on surfaces that *did* have
  artboards, so the gap has a track record. Logged LOW.
- **Two cases are expected to fail** and are written as failures rather than omitted, so
  `verify` measures them instead of skipping them: **UC-589** (the `Day_Rhythm_Strip`'s
  covered and leisure rects have no `fill` rule and most likely render black — the
  existing `ISSUES.md` entry from `impl`, confirmed independently this phase by reading
  the component's full `<style>` block) and **UC-598** (the full E2E suite is expected to
  surface the unrelated `gaps.spec.ts` / `preview.spec.ts` `SESSION_OVERLAP` collision,
  which must be told apart from a category failure rather than masking one).
- **UC-589 needs a live browser screenshot, not a DOM assertion.** The existing component
  test asserts only the CSS class name and explicitly asserts that no `fill` *attribute*
  is set, so nothing short of a real browser computing the style can measure it. The
  walkthrough says so at step 56.

## What changed

- **`.agents/USE_CASES.md`** — extended, not replaced. Parts I (UC-001 … UC-236) and II
  (UC-237 … UC-508) are untouched apart from the opening section, which now describes
  three parts instead of two and records that Part III **narrows** `Covered_Time` and
  amends `001`'s Property 22 to speak of `Work_Entry` segments only. A new **Part III**
  carries its own conventions — it is the first part that spans both layers, so every
  case states a `Method:` (`API`, `browser`, `inspection`, `artboard`, `migration`) — ten
  new `FIX-CAT-*` fixtures built on Part I's and Part II's, 90 cases, and a
  requirement-coverage table mapping all 82 criteria plus Properties 1–7. Every case
  states the data it needs. ID contiguity was checked mechanically: UC-001 … UC-598, no
  gaps, no duplicates, in order.
- **`.agents/tmp/VERIFY_TASKS.md`** — new, and left in place for `verify` to consume and
  delete. Nineteen passes, 62 steps: the migration first on its own pre-`002` database
  (it cannot be un-migrated afterwards), then source inspection before any server starts,
  then the API passes ordered so the read-only mixed-day pass runs against one seeding,
  then the browser passes after a single login. It opens with the four things that
  otherwise waste a pass — the theme cookie that must be set before the first navigation,
  the 5-per-15-minutes login rate limit, the pre-installed Chromium, and the fact that
  the E2E `createProject` helper always creates a *paid* project.
- **`.agents/ISSUES.md`** — three new LOW entries at the top, described above. No
  existing entry was edited or closed.

Nothing else was touched. No source file, no test, no spec document; no service was
started and nothing was executed against a database — this phase writes documents.

## Decisions made

- **Part III rather than a fourth section inside Part II.** `003` changes both the API
  and the interface, so its cases do not belong under a heading that says "the browser
  interface". Making it a part of its own, with `Method:` mandatory on every case, keeps
  the layer explicit — which matters because a Part III browser case failing while its
  API counterpart passes localises the defect exactly as Part II's relationship to Part I
  already does.
- **`FIX-CAT-PROJECTS` is deliberately not all-billable.** `Alpha` paid, `Beta` unpaid,
  `Gamma` paid-and-archived. A fixture where every project is billable cannot tell `paid`
  from "the category feature does nothing", which is the single most likely silent
  failure of this specification.
- **`FIX-CAT-MIXED` is arithmetically pinned.** Tracked 34 560, covered 10 800, paid
  7 200, unpaid 3 600, uncovered 23 760, relax 5 400 — one day carrying all three
  categories, against which every identity the specification claims (Property 3's
  reconstruction, Property 4's partition, and relax's independence from all of them) is
  checkable by arithmetic rather than by eye.
- **A new date, `L` = 2026-08-13, for the leisure-only day.** Part I's fixtures already
  collide with each other on 2026-08-19 (a logged issue), and the pure-leisure day is
  seeded alongside others often enough that reusing a claimed date would reintroduce that
  exact failure. `L` is claimed by nothing else in the file.
- **`FIX-CAT-UI-FOLD` carries eighteen projects, nine per group**, chosen against the
  actual `TOP_PROJECT_COUNT = 7` in `src/modules/stats/aggregate.ts`. Requirement 11.2's
  real content is that the top-N fold happens *within* each group, and a fixture with
  fewer than eight projects in a group cannot distinguish that from folding before
  grouping.
- **UC-528 accepts either 409.** Where the two contradictory criteria (3.2 vs 3.3) make
  the error code genuinely undetermined for a fully-claimed leisure interval, the case
  requires *a* 409 that stores nothing rather than naming one code — and the ambiguity is
  logged rather than papered over. A case that asserted one code would be measuring my
  guess, not the specification.
- **Every use case was written against verified identifiers, not against the design
  document alone.** The form action names (`?/billable` / `?/unbillable`, not
  `?/setBillable`), the form-only field name (`clearProject`), the fourth anchor source
  (`day-start`), the interval key (`leisure`), the palette class (`pj-relax`) and all 22
  message keys were each read out of the implementation before a case named them. The one
  asymmetry that would otherwise sink a test is written into UC-574: the projects row
  toggle's *visible* text names the current state (`Placeno` / `Neplaceno`) while its
  *accessible* name names the action (`Označit jako placený` / `…neplacený`).
- **Parts I and II are not re-walked.** They were verified in runs `2026-08-23-2200` and
  `2026-08-24-0659`. Where a Part III case could silently regress one of them — the
  coverage arithmetic (UC-552), the gauge (UC-558, UC-559) and the timeline height budget
  (UC-565) — the Part III case checks it directly instead.
