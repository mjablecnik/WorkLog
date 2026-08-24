# Run 2026-08-24-0659 — 002-worklog-ui

The browser interface of Worklog — timer, day timeline, projects, statistics, login,
themes and locales — built on top of the REST API that run `2026-08-23-2200` delivered.
Target: `.` (the repository root; Worklog is a single SvelteKit application, not a
monorepo).

102 commits, 176 files, ~34 700 lines added (`8c52566..1be51fa`).

## Status

Two phases are recorded `failed`. Neither means "broken" — both mean the phase left
real open items rather than ticking them off, which is exactly what the gate rule
asks for.

| Phase | Result | |
|---|---|---|
| 1 impl | **FAILED** (OK WITH ISSUES) | every task implemented, but task 11.6 and four checkpoints deliberately left unchecked; 27 issues opened |
| 4 verify | **FAILED** (OK WITH ISSUES) | 33 of 34 E2E tests green, contrast and 320px overflow fixed, but 5 items knowingly left open; gate "every walkthrough item passes" not met |
| 2 build | OK WITH ISSUES | the priority Dry_Run bug fixed; build, lint, 545 tests and `docker build` all clean; app answers `/api/health` for real |
| 3 cases | OK WITH ISSUES | 272 new use cases (UC-237…UC-508) covering all 270 acceptance criteria |
| 5 docs | OK WITH ISSUES | every documented command executed; found a HIGH bug making the E2E suite unrunnable |
| — fix pass | (not a phase) | 10 issues investigated, 9 fixed, 1 stale test rewritten |
| 6 report | OK | this summary |

**The two headline bugs of this run were both found by running the application, not by
reading it**, and both are now fixed:

- **Every fresh visitor got a 500** — `theme.svelte.ts`'s cookie writers had no SSR
  guard, so the default `system` theme preference threw `ReferenceError: document is
  not defined` on the server for any browser with an empty cookie jar, `/login`
  included. Nobody could reach the login form. Fixed during `impl`, re-verified live
  in the fix pass.
- **Every write that reached the confirm step was rejected** — `finishWrite` computed
  its returned `previewToken` *after* the mutation while the next write's freshness
  check compared against one computed *before* it, so every `Dry_Run` confirm answered
  `409 STALE_PREVIEW`, for every write shape, at any speed. Creating or editing a
  session or activity through the app's own dialogs did not work at all. Found in
  `impl` (correctly refused as out-of-spec-scope), fixed in `build`.

Both had been invisible for the whole of run 001 and most of this one, because the
four `tasks.md` checkpoints that call for using the app by hand have never been run —
see *Needs your decision*.

## What was built

Everything spec `002` asked for. 61 of 67 `tasks.md` boxes are checked; the 6 unchecked
are task 11.6 (visual conformance) and Checkpoints 2, 4, 10 and 12 — all deliberate,
all listed below.

- **Four screens** — `/` (timer hero, `Day_Gauge`, `Quick_Log`, `Project_Legend`,
  stale-session notice), `/day/[date]` (the timeline with rail edges, segment blocks,
  gaps and uncovered markers), `/projects`, `/stats` — inside a shared
  `Shell`/`Topbar`/`BottomNav`, plus `/login`, `/logout` and `/offline`.
- **The Change-Preview pattern** — `SessionDialog` and `ActivityDialog` both drive the
  server's `Dry_Run`/`Preview_Token` before writing, so the user sees what a change
  discards before confirming it. This is the interface's whole reason for existing and
  it now genuinely works end to end.
- **Theme and locale** — light/dark with a `system` default, cs/en via Paraglide,
  cookie-driven and correct on first paint.
- **Design system** — `lib/ui/` primitives, generated `palette.css` and
  `timeline-heights.css`, and a token set that now passes a full axe sweep with zero
  `color-contrast` violations on all four pages in both themes.
- **Tests** — 545 unit/integration tests across 52 files, plus a 34-test Playwright
  E2E suite across 10 spec files built from scratch this run, including two
  accessibility specs.
- **Docs** — `DOCS.md` gained a User Interface section and a Known Limitations list;
  `CLAUDE.md` gained an interface summary; `README.md`'s Testing section corrected.

**Specified but not delivered:** the mobile FAB create path. `Shell.svelte` reserves
the floating-action-button space, but no mechanism exists to pass content into it, so
on a phone there is no way to create a brand-new session or activity that does not
start from a timeline rail edge (UC-305, UC-334). This is a missing feature, not a
repair — see *Needs your decision*. Also not delivered: a project legend beside the
statistics page's `Day_Rhythm_Strip` (design.md asks for one; building it would have
introduced this codebase's first cross-domain module import, judged too big a
precedent to set unilaterally).

## The fix pass after phase 5

Outside the phase structure, on top of `docs`' end SHA: 11 commits
(`019b664..1be51fa`), 10 issues investigated, 9 fixed, 1 found to be a stale test.

- **`scripts/test-e2e.sh` made the E2E suite unrunnable from a clean checkout**
  (`HIGH`) — the script exported `DATABASE_URL` equal to `TEST_DATABASE_URL` on
  purpose, which `tests/setup/db.ts`'s safety check unconditionally refuses. Every
  `test:e2e:local` and `test:all` run threw in `global-setup.ts` before a single spec
  executed, on any machine. The script no longer exports it at all; `playwright.config.ts`
  already pointed the spawned app at the test database independently.
- **`migrate.sh`, `backup.sh` and `run-vite.sh` silently overrode a caller's
  `DATABASE_URL`** with `.env`'s own value — the exact opposite of what all three
  scripts' own header comments promised. An operator overriding it on the command line
  migrated the wrong database with no error. All three now conditional-assign.
- **`layOutDay`'s `continues` flag** approximated the day boundary with UTC midnight
  rather than the real `Logical_Day` boundary (UC-291) — now takes the real bounds the
  day page already computes, with new coverage for a non-UTC-midnight boundary.
- **An idempotent replay** re-hardcoded `201` instead of returning the status it had
  stored — nothing was observably wrong yet, but the column was decorative and the
  next replayable status would have been silently wrong.
- **Seven files' desktop-first media queries** flipped to the codebase's mobile-first
  `min-width: 768px` convention (UC-423), verified by reading the built CSS.
- **Three documentation defects** fixed at their source rather than around them:
  `design.md`'s Property 1 wording (which asserted a 360° difference the correct,
  DST-safe implementation deliberately does not produce — a trap for anyone who would
  have "fixed" working code to match it), Requirement 11.1's auth-exempt list
  (missing `/logout`, which the code correctly exempts), and the `FIX-TOUCHING`/
  `FIX-WEEK` fixture date collision in the use-case catalogue.
- **The one stale test:** `auth.spec.ts`'s "clicking Odhlásit se does nothing" — the
  logout bug it documented had already been fixed; the test was rewritten to assert
  the real behaviour (navigation to `/login` plus a server-side session that is
  genuinely gone), after running it in isolation to rule out cross-test leakage.

## Open issues

`.agents/ISSUES.md` holds 73 entries, 55 resolved and **18 open — every one of them
`LOW`**. Every `CRITICAL`, `HIGH` and `MEDIUM` finding raised across both runs has been
closed. Nine of the open entries belong to this run, nine to run 001. Ranked:

1. **Checkpoints 2, 4, 10 and 12 have never been walked by hand** — the single most
   consequential open item, and the reason both headline bugs above survived so long.
   See *Needs your decision*.
2. **Task 11.6's "nine token-only surfaces"** (confirmation dialogs, toasts, empty
   states, skeletons, the login/error/offline pages, the timezone notice, the focus
   ring) were never checked against their specified token values. `DESIGN.md` specifies
   them in prose, so the 16-artboard image comparison `verify` redid does not cover
   them.
3. **No mobile FAB create path** — the missing feature above, tracked as two entries
   (the mechanism, and `SessionDialog`'s dependence on it).
4. **Four `Icon.svelte` glyphs** (`search`, `sun`, `moon`, `check`) have no artboard
   source; the implementation invented their geometry.
5. **`SessionDialog`'s Editing→Confirming shortcut** follows `design.md`'s literal
   wording rather than `ChangePreview`'s three-way `lostUncoveredSeconds` check, so one
   edge case skips a confirmation that arguably should appear (UC-350).
6. **UC-472** — hardcoded national-flag colours bypass the token system.
7. **The full E2E suite in one process still occasionally trips the login rate limiter**
   at `auth.spec.ts`'s deliberate wrong-passphrase test. Structural fixes cut real
   logins from ~24 to ~6; the residual was logged rather than worked around by
   weakening a limit Requirement 11.13 calls deliberately unconfigurable.
8. **Stale documentation, found while writing this summary** (new, logged this phase):
   the fix pass removed the "E2E suite is broken" notes from `DOCS.md` but left them in
   `README.md` (a `[!WARNING]` block linking to a DOCS.md section that no longer exists)
   and `CLAUDE.md` (an inline "currently broken, see Known gaps" comment where Known
   gaps no longer mentions it). Both now tell a reader a working command is broken.
9. Smaller code-hygiene items: `gauge-geometry.ts`'s `arc()` scoped to single-calendar-day
   spans, two mechanisms for hover/active surface-alpha derivation, Paraglide's native
   plural form vs literal ICU, two statistics page-assembly judgment calls, three
   spec-001 property tests that failed once under heavy sandbox load and passed clean
   on retry (informational).

From run 001, still open: `bun audit`'s two upstream-blocked transitive
vulnerabilities, task 10.5's optional property tests, `aggregates.ts` summing days in
TypeScript rather than SQL, the unrecorded login passphrase, and `/login` rendering
(that last one is now moot — this run exercises it in every E2E spec).

Full text, with reproduction steps and next actions, in `.agents/ISSUES.md`.

## Needs your decision

**Two design contradictions were resolved on your behalf and are marked provisional.**
Both were settled in favour of the shipped code and the numbered requirement over the
visual-contract doc's prose. Both are genuine judgment calls, and the `verify` phase
explicitly asked for your sign-off:

1. **Block head type size stays at 13px** (12 on mobile), not the 14px `.design/DESIGN.md`
   stated. 13 is what `design.md`'s own `BLOCK_HEAD_PX=29` derivation implies and what
   `timeline-geometry.ts` ships; `DESIGN.md` was corrected to match. **If 14px was
   actually intended this is not a docs edit** — it means `BLOCK_HEAD_PX=31`, a re-run
   of the height-ladder generator, and re-verification of every block-head-dependent
   case.
2. **The mobile `Uncovered_Marker` pill threshold stays at 44px**, not `design.md`'s
   looser "above the 26px floor" wording. 44 is what Requirement 10.7 states and what
   `SegmentBlock.svelte`'s `isUncoveredTall` already implements; `design.md` was
   corrected. Note this is the *opposite* call from what the `cases` phase guessed
   might be intended — reversed deliberately, because shipped code matching a numbered
   requirement beat a guess about design intent.

**Six things nobody can settle without you:**

3. **The mobile FAB create path** — build it, or accept that creating from scratch is
   desktop-only? It needs a new content-passthrough mechanism between `+layout.svelte`/
   `Shell.svelte` and each page. This is the only thing spec `002` asked for that does
   not exist.
4. **The four artboard-less icons** — extend `.design/artboards/` to cover `search`,
   `sun`, `moon` and `check`, or accept the invented fallback geometry as final?
5. **`SessionDialog`'s shortcut and `lostUncoveredSeconds`** — which is the intended
   bar for skipping the confirmation step, `design.md`'s literal wording or
   `ChangePreview`'s three-way check? A guess here changes when the app does and does
   not warn before discarding tracked time.
6. **UC-472** — is a national flag's colour a legitimate exception to the token system,
   or should the locale switcher's flags be tokenised like everything else?
7. **The nine token-only surfaces** — worth a dedicated conformance pass, or is prose
   specification without an artboard acceptable to leave unverified?
8. **Checkpoints 2, 4, 10 and 12 — a human-paced manual walkthrough of the running
   application has never happened, for either spec.** Not once across both runs. Both
   of this run's severe bugs (the SSR 500, the always-rejected confirm) were exactly
   what those checkpoints exist to catch, and both survived until an automated suite
   happened to drive a real browser. Everything else here is a question about polish;
   this one is a question about whether the application has actually been used. Doing
   it needs a real working day: start and stop the timer, log the evening's activities
   through the dialogs, in both themes, at 375px.

## Where things stand overall

Specs `001` and `002` together now represent a **working, fixed, documented
application** — domain layer, data layer, REST API, and a complete browser interface
on top of it. Build, type checks, lint, 545 unit/integration tests and `docker build`
are all clean; the E2E suite runs from a clean checkout again; the container starts and
answers for real. Every serious defect either run found has been fixed and verified.

The one caveat worth holding onto: **all of that verification is machine verification.**
No human has sat down and used Worklog to track a day's work. Item 8 above is what
closes that gap.

## Where to look

- `.agents/runs/2026-08-24-0659/01-impl.md` … `05-docs.md` — the five phase reports.
  Each one's `Decisions made` section is the part that exists nowhere else;
  `04-verify.md`'s is the most load-bearing (the contrast root cause, the two
  contradiction resolutions, and why four items were left alone).
- `.agents/runs/2026-08-23-2200/00-summary.md` — run 001's closing summary, and the
  four questions it left open. Three of them were answered by this run's fix pass
  (`/logout` in Requirement 11.1, the idempotent replay status, `migrate.sh`'s
  `DATABASE_URL`); the preference-cookie ownership question resolved in 001's favour
  stands unchallenged by 002's implementation.
- `.agents/ISSUES.md` — 73 entries, 55 resolved, 18 open. Append-only; resolved entries
  keep their original findings.
- `.agents/USE_CASES.md` — 508 cases in two parts (001's 236 API-level, 002's 272
  interface-level) with a coverage table over all 555 acceptance criteria. Reusable by
  any future run. Note `FIX-TOUCHING` and `FIX-WEEK` must be seeded in separate passes.
- `.kiro/specs/002-worklog-ui/tasks.md` — the 6 unchecked boxes, all named above.
- `.kiro/specs/001-worklog-domain-api/tasks.md` — task 10.5 is the one unchecked box.
- `DOCS.md` — the reference: environment variables, the REST API, the UI's structure,
  Known Limitations, testing and troubleshooting.
- `git log 8c52566..1be51fa` — the run itself, one Conventional Commit per logical
  change throughout.
