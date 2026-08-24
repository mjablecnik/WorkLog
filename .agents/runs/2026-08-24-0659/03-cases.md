# Phase 3 — Cases

**Target:** `.` — the repository root, which is also the SvelteKit project root. Taken
from `.agents/PIPELINE_STATE.json`'s `"target": "."`, set by the earlier phases of this
run. Worklog is a single-package repository rather than a monorepo: `.kiro/`, `.agents/`
and `src/` all sit at the same level, so there is no sub-project to resolve.

## Result
OK WITH ISSUES

## Headline
Spec `002`'s browser interface now has a written definition of "working": 272 new use
cases (UC-237 … UC-508) appended to `.agents/USE_CASES.md`, covering every one of the
270 acceptance criteria in `002-worklog-ui/requirements.md`, the three correctness
properties, and the sixteen artboards the `Design_Contract` requires the implementation
to match. `.agents/tmp/VERIFY_TASKS.md` orders them into a 55-step walkthrough grouped
so the database is reseeded twelve times rather than two hundred. Three findings were
harvested: one that stops the E2E suite running anywhere but this session, and two
places where the two specification documents contradict each other and somebody has to
decide.

## Needs attention

- **The E2E suite cannot run off this machine.** `tests/e2e/a11y.spec.ts:30` hardcodes
  a `/tmp/claude-1000/…/scratchpad` path as its `storageState` directory, and
  `scripts/test-e2e.sh` never sets `WORKLOG_PASSPHRASE_HASH`, so the passphrase the
  fixtures submit only matches through an uncommitted wrapper. This bites the `verify`
  phase at step 0, and `a11y.spec.ts` is the only automated check of Requirement 14.1
  and 14.10. Logged MEDIUM.
- **Two contract contradictions need a decision, not a guess.** `DESIGN.md` puts the
  block head at 14 px while `design.md` and the code put it at 13, which changes
  `BLOCK_HEAD_PX` and therefore the timeline's height budget. And Requirement 10.7 puts
  the mobile `Uncovered_Marker` pill threshold at 44 px while `design.md` puts it at the
  26 px floor, leaving every block between the two undefined. Both logged LOW; neither
  was resolved here, because inventing an answer and presenting it as settled is the one
  thing this phase must not do.
- **Nine use cases are expected to fail on today's build**, for reasons already in
  `ISSUES.md`: no mobile create path (UC-305, UC-334), 320 px overflow (UC-412), three
  contrast violations (UC-421), four icons with no artboard source (UC-417), the
  `continues` UTC approximation (UC-291), the session-dialog shortcut that ignores
  `lostUncoveredSeconds` (UC-350), the locale scroll assertion (UC-401), and the
  scratchpad path above (UC-508). They are written as failures rather than omitted, so
  the `verify` phase measures them rather than skipping them.
- **Task 11.6 has to be redone from scratch.** The only visual conformance pass ever run
  compared the application while no CSS was reaching it, so it compared layout and never
  palette. Pass 12 of the walkthrough (steps 52–54) is that redo, one case per artboard.

## What changed

- **`.agents/USE_CASES.md`** — extended, not replaced. Part I (UC-001 … UC-236, spec
  `001`) is untouched apart from three heading labels and the stale opening sentence that
  said `002` was not started. A new **Part II** carries its own conventions (three named
  viewports, two themes, two locales, the four cookies, and three non-browser methods —
  `inspection`, `artboard`, `screen reader`), thirteen new `FIX-UI-*` fixtures built on
  Part I's, 272 cases, and a requirement-coverage table mapping all 270 criteria plus
  Properties 1–3. Every case states the data it needs, and every case whose specified
  behaviour the current build is known to miss names the `ISSUES.md` entry and still
  counts as a failure.
- **`.agents/tmp/VERIFY_TASKS.md`** — new. Twelve passes: source inspection before the
  browser opens, a cookie-less first visit, the everyday day read-only, then writes and
  previews against that same seed, the timer's four states, the six unusual day shapes,
  statistics over a week, settings and both themes and both languages, the phone,
  accessibility, then the destructive pass that stops the server, and finally the
  artboards. Left in place deliberately — the `verify` phase consumes and deletes it.
- **`.agents/ISSUES.md`** — three entries prepended, as above.

## Decisions made

- **Extend `USE_CASES.md` rather than start a second file.** `dev-rules` says the
  catalogue is persistent and reused across runs, that existing IDs keep their numbers
  and new ones are appended. A `USE_CASES_002.md` would have given the `verify` phase two
  files to reconcile and made "UC-042" ambiguous forever. The file is now explicitly two
  parts with a shared numbering line.
- **Part I is not re-run and is not superseded.** Its cases drive the API directly
  because no interface existed when they were written; that is still a correct test of a
  layer that still exists. The walkthrough says to reach for a Part I case only when a
  Part II failure could be a server defect — having both layers catalogued is what
  localises a bug to the interface.
- **Selectors are accessible names and Czech strings from the Message Catalogue, not
  `data-testid`.** There is not one `data-testid` anywhere in `src/`, and the E2E suite
  already selects by role, label and text. Writing cases against invented test hooks
  would have described an application that does not exist; writing them against
  accessible names tests the accessibility contract at the same time.
- **One case per compared artboard rather than one case for Requirement 17.16.** Sixteen
  screens are compared and five are excluded; a single pass/fail over all of them tells
  the next run nothing about which screen drifted. UC-486 … UC-501 are individually
  checkable, and each carries the corrections the design has already made to its own
  drawing — `SessionEdit`'s wrong record count, `Stats`'s bar scale and axis labels,
  `DayCollapsed`'s 88 px bar and missing line height.
- **Six cases were written for things no criterion states**: a long project name, rate
  limiting, JavaScript disabled, two tabs on one day, the two DST days, and whether the
  E2E suite runs off this machine. They are marked as such in the coverage table so
  nobody later mistakes them for criteria that went missing.
- **Cases assert the specified behaviour even where the design's own artboard is wrong.**
  Where `design.md` records a correction to a drawing, the case asserts the corrected
  rule and says the artboard is the thing being fixed. The alternative — asserting what
  was drawn — would make the verify phase file defects against correct code.
- **`design.md`'s Property 1 wording is flagged in UC-452 rather than tested as
  written.** The document says a 24-hour difference "SHALL equal exactly 360" while the
  DST-safe implementation returns 0; that is already an open issue, and a case written
  to the sentence would have failed correct code.
