# Implementation Plan: worklog-ui

## Overview

Build the browser interface of the Worklog SvelteKit application on top of the domain, data layer and REST API delivered by `001-worklog-domain-api`. Work proceeds outside-in: the shell, theme, design system and i18n first, then the `Day_Timeline` that everything else hangs off, then the write dialogs with their `Change_Preview`, then projects and statistics.

Reads are load functions and writes are form actions with `sveltekit-superforms` and Zod; `fetch` is used only for the `Dry_Run` behind a `Change_Preview`, the timer refresh, and inline project creation. Pure geometry and formatting are unit tested in node, components with `@testing-library/svelte` in jsdom, and the reconciliation-visible behavior end to end with Playwright. Four checkpoints mark the phase boundaries.

## Tasks

- [ ] 1. Shell, theme and design system
  - [ ] 1.1 Port the design system subset into `src/lib/ui/`
    - Take from `template-crm/src/lib/ui/` only what this project uses: `elements/` (Button, Badge, Icon, Input, Select, Checkbox, Spinner, Tooltip, flags), `forms/` (FormField, DatePicker, TimeInput, SearchInput), `layout/` (Shell, Topbar, BottomNav, PageHeader, Section), `overlays/` (Modal, ConfirmDialog, Toast, ToastContainer, LoadingSkeleton, toast-store), `components/` (StatCard, EmptyState, DataTable)
    - Keep the Svelte 5 runes API — `$props()`, `$bindable()` — and the 44 pixel minimum touch target
    - Add `TimeInput` if the template has no equivalent: a text field accepting `HH:MM` with keyboard stepping
    - _Requirements: 14.2, 14.3, 14.5, 14.6_

  - [ ] 1.2 Set up the theme and Tailwind 4 tokens
    - `src/app.css` imports Tailwind and the theme, and declares an `@theme` block mapping the theme's CSS variables to Tailwind tokens
    - Port `src/lib/theme/` from the template; define the spacing scale 4, 8, 12, 16, 24, 32, 48, 64 and the transition durations 200 ms for hover and 300 ms for panels
    - Include a `prefers-reduced-motion` block disabling non-essential animation, and a styled `::selection`
    - Author mobile-first with 768 pixels as the single breakpoint
    - Declare the light and dark chart surfaces used by the palette validation
    - _Requirements: 14.6, 14.7, 14.8, 14.9, 14.11_

  - [ ] 1.3 Set up Paraglide and the message files
    - `project.inlang/settings.json` with `baseLocale: "en"`, `locales: ["en","cs"]`, `pathPattern: "./messages/{locale}.json"`, the message-format and m-function-matcher plugins
    - Wire `paraglideVitePlugin` into `vite.config.ts` after `tailwindcss()` and `sveltekit()`, compiling into `src/lib/paraglide/`
    - `src/lib/core/i18n/state.svelte.ts` overriding `getLocale`/`setLocale` over a `$state` rune; `index.ts` with `initLocale()` resolving `localStorage` → `navigator.language` → **English** when the detected language is neither Czech nor English, and `switchLocale()` stripping the hash with `history.replaceState` and updating `document.documentElement.lang`
    - The switcher indicates the active language
    - `src/hooks.ts` exporting `reroute` via `deLocalizeUrl`
    - Create `messages/cs.json` and `messages/en.json` with flat snake_case keys prefixed by domain
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6_

  - [ ] 1.4 Build the application shell
    - `src/routes/+layout.svelte` renders `Shell` with the navigation, the `Locale_Switcher` and the logout control, and calls `initLocale()` in `onMount`
    - `src/routes/+layout.server.ts` loads the current session state so the running indicator can appear on every page
    - Navigation collapses to a bottom bar under 768 pixels; the active target carries `aria-current`
    - `src/routes/+error.svelte` offers a link back to the timer page, and a dedicated connection error page covers a degraded or unreachable server
    - Load the server's `TIMEZONE` and `DAY_START_HOUR` from `/api/health` once in the root layout and put them in context; every wall-clock rendering and parse uses that zone, and the shell says which zone it is when it differs from the device
    - Navigation between pages stays on the client — no full document reload
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [ ] 1.5 Build the login and logout pages
    - `src/routes/login/+page.svelte` with a single passphrase field submitted as a form action; a wrong passphrase returns one generic message key
    - Redirect to the originally requested page after success, or to the timer page
    - `src/routes/logout/+page.server.ts` ends the session and returns to login
    - A request failing on an expired session redirects to login carrying a session-ended message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 1.6 Implement the palette and formatting helpers
    - `src/lib/viz/palette.ts` with the eight validated slots from the design, `PALETTE_SIZE`, `projectColorVar` wrapping the index at eight, and `labelInkOn` returning the per-slot label ink from the design's contrast table
    - `src/lib/viz/format.ts` with `formatDuration`, `formatTimeOfDay`, `formatDayLabel` and `parseTimeOfDay`, locale aware, taking the server time zone explicitly, never rendering a bare decimal of hours, rendering anything under a minute as "< 1 min"
    - _Requirements: 11.9, 11.11, 13.7_

  - [ ] 1.7 Write tests for the palette, formatting and i18n
    - `tests/lib/viz/palette.test.ts`: eight slots; an index of 8 wraps to 0; the hex values match the design table exactly; `labelInkOn` returns dark for orange, aqua, yellow, magenta and red and white for blue, green and violet, and every returned pairing measures at least 4:1
    - `tests/lib/viz/format.test.ts`: durations in both locales, zero, under a minute, over a day; `formatDayLabel` says today for the current `Logical_Day`
    - `tests/lib/i18n.test.ts`: `cs.json` and `en.json` hold identical key sets; every key `messageKeyFor` can emit exists in both; no `.svelte` file under `src/` carries a user-facing string literal outside a message call; no `.svelte` file uses `{@html}` on a project name or description
    - `tests/lib/viz/format.test.ts` additionally pins that a time renders in the server zone, not the device zone
    - _Requirements: 1.9, 1.12, 11.9, 13.1, 13.2, 13.7, 13.8, 13.9, 13.10, 13.11_

- [ ] 2. Checkpoint — shell runs
  - Run `bun run check && bun run test tests/lib` and confirm the application starts, login works, the shell renders and the language switches without a reload

- [ ] 3. Day timeline
  - [ ] 3.1 Implement the timeline geometry in `src/modules/day/components/timeline-geometry.ts`
    - `visibleRange` collects every record plus `now` when the day is today, rounds outward to whole hours, pads one hour each side clamped to the `Logical_Day` bounds, and falls back to 08:00–18:00 for an empty day
    - `toPercent` maps an instant into the range; `hourTicks` returns the whole hours inside it
    - Plain TypeScript with no DOM access, so it can be tested as functions
    - _Requirements: 4.2_

  - [ ] 3.2 Write unit tests for the timeline geometry
    - `tests/modules/day/timeline-geometry.test.ts`: empty day falls back to 08:00–18:00; a single session pads to whole hours; a running session extends the range to `now`; ticks land on whole hours inside the range; an instant at the range start maps to 0 and at the end to 100
    - _Requirements: 4.2_

  - [ ] 3.3 Build `DayTimeline`, `TimelineLane` and `TimelineAxis`
    - Two lanes over one shared range: the `Frame_Lane` drawing one bar per `Work_Session` with `Untracked_Time` left empty, and the `Activity_Lane` drawing one bar per `Activity_Segment` coloured by `color_index`
    - Segments of one `Activity_Entry` share a visible marker so their common identity reads without hovering
    - `Uncovered_Time` stretches carry the `Uncovered_Marker` and are activatable
    - An `Open_Session` on the displayed day is drawn continuing to `now` and marked as running
    - Every bar is a `<button>` in chronological DOM order carrying an `aria-label` with its times, project and description; bars wide enough show the project name directly
    - `orientation` prop switches the axis between horizontal and vertical; the caller picks it from a media query
    - Consecutive segments too short to render as a usable target merge into one marker rather than becoming unclickable slivers; a session continuing past the displayed day reaches the axis edge marked as continuing
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.12, 4.13, 4.15, 4.16, 11.9, 14.10_

  - [ ] 3.4 Wire the timeline activation handlers
    - Activating an `Activity_Segment` bar opens the `Activity_Dialog` for its entry; activating a `Work_Session` bar opens the `Session_Dialog`; activating an uncovered stretch opens the `Activity_Dialog` in `Explicit_Mode` prefilled with exactly that stretch
    - An empty `Logical_Day` renders an empty state inviting the user to start the timer
    - _Requirements: 4.9, 4.10, 4.11, 4.14_

  - [ ] 3.5 Write component tests for `DayTimeline`
    - `tests/components/day-timeline.test.ts`: one bar per session and per segment; uncovered stretches marked; bars in chronological DOM order; every bar has an accessible name containing its times; an entry split into two segments shows the shared-identity marker; a running session is marked; the empty day shows the empty state; a bar's label uses the ink `labelInkOn` returns for its slot
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.13, 4.14, 11.11_

  - [ ] 3.6 Build the day page and its navigation
    - `src/routes/day/[date]/+page.server.ts` loads the day from the store; `+page.svelte` renders `DayPage`
    - `DayNav` offers previous and next day controls and a date picker, disables next on the current `Logical_Day`, and labels it as today
    - An invalid date in the URL renders the error page
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 3.7 Build `ActivityList` and `UncoveredList`
    - `ActivityList` shows every `Activity_Entry` with project, description, times and total duration; a split entry shows each segment's times and states that it was split around a break; the originally requested interval or duration appears whenever it differs from what was stored
    - `UncoveredList` states the day's total `Uncovered_Time`, lists each stretch with times and duration, omits stretches under five minutes while still counting them in the total, and states when the day is fully described
    - Activating a listed stretch opens the `Activity_Dialog` prefilled with it
    - A separate group lists every entry reconciliation emptied, explains that nothing of it remains inside the timer frame, and offers deleting it or re-entering its times — without this such a record is unreachable and blocks its project from ever being deleted
    - _Requirements: 7.1, 7.2, 7.3, 7.9, 7.10, 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 4. Checkpoint — the day is visible
  - Seed a day with a break and an activity spanning it, then confirm the timeline draws two activity bars with the gap between them, the entry list explains the split, and the uncovered list matches

- [ ] 5. Writes and the change preview
  - [ ] 5.1 Implement the dry-run client in `src/modules/day/dry-run.ts`
    - `previewActivity` and `previewSessionChange` post the pending change with `dryRun: true` and map the response into `ActivityPreview` and `SessionPreview`
    - Abort an in-flight request when the input changes again, so a stale preview can never be confirmed
    - Compute nothing locally — the browser holds no clipping logic
    - Debounce by 400 ms so editing a field does not exhaust the rate limit; treat a non-2xx response as a rejection to render, not a transport failure; carry `previewToken` into the confirming write and recompute on `STALE_PREVIEW`
    - _Requirements: 9.1, 9.11, 9.12, 9.13_

  - [ ] 5.2 Build `ChangePreview`
    - Render in order: what will be stored, what will be lost, what is unresolved — resulting segments and their count, discarded stretches with durations, unplaced minutes, and for a session change each affected entry with the duration it loses plus the total removed
    - A rejection replaces the body with the reason and disables confirm; a loading state also keeps confirm disabled
    - When the preview reports discarded time, offer the `Uncovered_Policy` choice inline with `clip` selected and `extend` available, re-running the `Dry_Run` when the choice changes
    - Write nothing until the user confirms
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [ ] 5.3 Write component tests for `ChangePreview`
    - `tests/components/change-preview.test.ts`: a two-segment split states the part count; discarded time is shown with its duration; unplaced minutes are shown; a session change lists each affected entry and the total removed; a rejection disables confirm and shows the reason; the loading state disables confirm; changing the policy triggers a new preview
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.10_

  - [ ] 5.4 Build `ActivityDialog`
    - A segmented control switches between `Explicit_Mode` and `Duration_Mode`, both first class
    - `Explicit_Mode` requires start and end; `Duration_Mode` requires a duration, leaves the start optional, and shows the anchor the server will infer, labelled as an inference
    - Require a `Project`, accept an optional description, and default both from the most recent entry of the day unless a prefill overrides
    - Validate in the browser before submitting, showing messages beside the field without clearing input
    - Escape dismisses the dialog and focus returns to the control that opened it
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.13_

  - [ ] 5.5 Implement activity create, edit and delete actions
    - Form actions in `src/routes/day/[date]/+page.server.ts` using `superValidate` with the shared Zod schemas from `001`, returning message keys rather than prose
    - A metadata-only edit saves without a preview; a change to the interval or duration goes through `Change_Preview` first
    - Deletion sits behind a confirmation naming what will be removed
    - After any write the `Day_Timeline` updates without a full page reload
    - _Requirements: 6.1, 6.12, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ] 5.6 Build `SessionDialog` and the frame-editing actions
    - Editable start and end, a delete action, and an add-session action for a stretch that was never tracked
    - A change altering existing segments shows a `Change_Preview` first; an overlap shows which sessions conflict and does not save; an inverted interval shows the error beside the field
    - Both lanes update without a full page reload after a change
    - Deleting a session shows a `Change_Preview` naming every entry that would lose time and every one that would be emptied
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10_

  - [ ] 5.7 Implement session edge dragging
    - At viewports 768 pixels and wider, a pointer-event handle on each `Work_Session` edge drags with five-minute snapping
    - Releasing the drag does not commit — it opens the `Session_Dialog` carrying the dragged values so the change still passes through a `Change_Preview`
    - _Requirements: 8.7, 8.8_

  - [ ] 5.8 Build the `Quick_Log` action
    - A single control posting in `Open_Mode` with only the `projectId` — the server resolves the start from the `Placement_Anchor` and the end from now
    - Display the interval the control expects from the already-loaded day data, labelled as what the server will use rather than as an input
    - Offer opening the full `Activity_Dialog` instead, and surface `NOTHING_TO_LOG` and `NO_PLACEMENT_ANCHOR` as plain explanations
    - _Requirements: 6.10, 6.11_

  - [ ] 5.9 Write component tests for `ActivityDialog`
    - `tests/components/activity-dialog.test.ts`: the mode switch changes the required fields; `Duration_Mode` with no start shows the inferred anchor; prefill from a gap fills both times exactly; defaults come from the most recent entry; a validation failure keeps the typed input; Escape closes and returns focus to the opener
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 6.13_

- [ ] 6. Timer page
  - [ ] 6.1 Implement the elapsed store in `src/modules/timer/elapsed.svelte.ts`
    - A rune-based store ticking once per second, with `sync()` replacing the local count from the server response
    - Never treat the local count as truth: sync on load, on `visibilitychange` back to visible, and after every start and stop
    - _Requirements: 3.3, 3.6, 3.8_

  - [ ] 6.2 Build `TimerControl` and the timer page
    - A single start action when no `Open_Session` exists and a single stop action when one does, both form actions with `use:enhance` applying the change optimistically and rolling back with the reason on failure
    - Display the running session elapsed time, the day's total `Tracked_Time`, and the day's total `Uncovered_Time`
    - Reachable by tab, activated by both Enter and Space
    - The page lives at the root path `/`, so opening the application lands on the timer
    - The page shows a compact `Day_Timeline` of the current `Logical_Day` and offers `Quick_Log`
    - A stale session is called out with an offer to stop it at a time the user picks; a start refused for an existing or overlapping session explains which session is in the way
    - _Requirements: 1.6, 3.1, 3.2, 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 10.6_

  - [ ] 6.3 Implement the tab title
    - While an `Open_Session` exists, write the running elapsed time into `document.title` from the same store that feeds the on-screen readout, so the two cannot disagree
    - Restore the plain title when the timer stops
    - _Requirements: 3.7_

  - [ ] 6.4 Write component tests for the timer
    - `tests/components/timer-control.test.ts`: start shown when idle and stop when running; the elapsed readout advances; `sync()` overrides a drifted local count; a failed action restores the previous state and shows the reason; Enter and Space both activate
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.9, 3.12_

- [ ] 7. Projects
  - [ ] 7.1 Build the projects page
    - List every `Project` with its total `Covered_Time` over the last thirty `Logical_Day` values and its palette swatch beside the name
    - Create by name, rename, archive and unarchive, hiding archived by default
    - A duplicate name differing only in case or surrounding whitespace shows the error beside the field
    - Delete an unreferenced project; a referenced one explains that it is in use and offers archiving instead
    - A colour control on each row opens the eight `Palette_Slot` swatches and saves the chosen one, so the automatic assignment can be overridden
    - An empty state covers the case of no projects at all, offering to create the first one
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 15.10_

  - [ ] 7.2 Build `ProjectPicker`
    - A combobox over non-archived projects with substring search and keyboard navigation
    - A "create <typed name>" row when nothing matches, posting to `/api/projects` and inserting the result without closing the surrounding dialog
    - Each option shows its swatch next to the name, never the swatch alone
    - When the entry being edited references an archived project, that project is offered as the current value marked as archived, so fixing a typo never forces re-assigning the record
    - With no projects at all the picker offers creating the first one instead of an empty list
    - _Requirements: 6.7, 11.6, 11.9, 11.12, 11.13, 14.10_

  - [ ] 7.3 Write component tests for `ProjectPicker`
    - `tests/components/project-picker.test.ts`: filtering by substring; archived projects absent; inline creation inserts and selects without closing the dialog; full keyboard navigation; every option names the project as text
    - _Requirements: 6.7, 11.6, 14.4, 14.10_

- [ ] 8. Statistics
  - [ ] 8.1 Build the statistics queries and range control
    - `src/modules/stats/query.ts` aggregates from `/api/days` for the selected day, week or month range
    - Fold everything past the top seven projects by `Covered_Time` into an "Other" slot so no chart cycles the palette
    - Include archived projects holding time in the range, so the per-project figures reconcile with the total
    - _Requirements: 12.1, 12.2, 12.4, 12.11_

  - [ ] 8.2 Build `CoverageMeter`, `ProjectBreakdown` and `DayStack`
    - `CoverageMeter` shows the described share of `Tracked_Time` as a hero figure with a meter
    - `ProjectBreakdown` is a horizontal bar chart sorted descending, one bar per project in its assigned colour
    - `DayStack` is one stacked vertical bar per `Logical_Day`, segments by project, activatable to navigate to that day
    - Apply the mark specs: 2 pixel surface gaps between stacked segments and adjacent bars, 4 pixel rounded data-ends anchored to the baseline, recessive gridlines, hover tooltips, and a legend whenever two or more projects appear
    - Show the average `Tracked_Time` per day that holds at least one `Work_Session` for multi-day ranges
    - Present every chart's numbers as a table beside it, which is also what satisfies the light-mode relief rule
    - An empty range shows an empty state rather than an empty chart
    - A `DayRhythm` strip shows where in each day the work actually fell — one narrow timeline row per day of the range, coloured by project — because knowing the shape of a day is the thing totals cannot tell you
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 14.10_

  - [ ] 8.3 Write component tests for the statistics charts
    - `tests/components/stats.test.ts`: the breakdown sorts descending and folds an eighth project into Other; the stack renders one bar per day and navigates on activation; the empty range shows the empty state; every chart's numbers appear as text
    - _Requirements: 12.4, 12.5, 12.7, 12.8, 12.9_

- [ ] 9. Feedback, loading and error states
  - [ ] 9.1 Implement loading and progress states
    - Skeletons shaped like the content for first loads, never a bare spinner
    - A submitted action disables its control and shows progress on it
    - Required fields are marked as required; navigating away from a form holding unsaved input asks for confirmation first
    - _Requirements: 14.12, 14.13, 15.1, 15.2_

  - [ ] 9.2 Implement result and error feedback
    - A success confirms briefly without demanding dismissal; a failure shows the reason and keeps the input intact
    - An overlap conflict names the conflicting records and offers to open one
    - A write reporting discarded or unplaced time is never presented as an unqualified success — the confirmation names what did not fit
    - An unreachable server says so and offers retry without losing input
    - Every destructive action is preceded by a confirmation naming what will be lost
    - Map every code from the `001` error table to the behaviour in the design's Error Handling section — including `NOT_FOUND`, `NOTHING_TO_LOG`, `RANGE_TOO_LARGE`, `PAYLOAD_TOO_LARGE`, `STALE_PREVIEW`, `PROJECT_ARCHIVED`, `FUTURE_TIMESTAMP`, `INTERVAL_TOO_SHORT` and `INTERNAL_ERROR`
    - _Requirements: 13.11, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9_

- [ ] 10. Checkpoint — the interface is complete
  - Run `bun run check && bun run test` and walk the whole application by hand on a desktop and at a 375 pixel width

- [ ] 11. End-to-end and accessibility
  - [ ] 11.1 Write the reconciliation E2E scenarios
    - `tests/e2e/day.spec.ts` following the workspace pattern — `workers: 1`, a `resetDb` fixture, a real database
    - Start the timer, stop at the break, start again, stop at the end; log `13:00–16:00` and assert two bars with the break between them and a list entry stating it was split
    - Log two hours in `Duration_Mode` with no start over the same frame and assert the segments total exactly 120 minutes across the break
    - _Requirements: 4.1, 4.5, 6.2, 6.4, 7.2_

  - [ ] 11.2 Write the preview and gap-filling E2E scenarios
    - `tests/e2e/preview.spec.ts`: shorten a session carrying an activity, assert the preview names the entry and the minutes it loses, cancel and assert nothing changed, then repeat and confirm and assert the timeline updates
    - `tests/e2e/gaps.spec.ts`: click an uncovered stretch, assert the dialog opens prefilled with exactly that range, save, assert the uncovered total reaches zero and the day reports itself fully described
    - `tests/e2e/conflict.spec.ts`: log an activity overlapping an existing one and assert the conflict is named and nothing is written
    - _Requirements: 4.11, 8.4, 9.1, 9.5, 9.9, 10.3, 10.5, 15.5_

  - [ ] 11.3 Write the shell E2E scenarios
    - `tests/e2e/locale.spec.ts`: switch to English mid-page and assert the text changes with no reload and no lost scroll position
    - `tests/e2e/auth.spec.ts`: clear the cookie and assert the next navigation redirects to login with the session-ended message; a wrong passphrase shows the generic message
    - _Requirements: 2.3, 2.6, 13.4_

  - [ ]* 11.4 Write the accessibility pass
    - An axe run over the timer, day, projects and statistics pages
    - A keyboard-only walk of the day page reaching every timeline bar, opening a dialog and completing a save with no pointer
    - Assert no horizontal page scrolling at 320 pixels
    - _Requirements: 14.1, 14.4, 14.10_

- [ ] 12. Checkpoint — ready to use
  - Run `bun run test:all`, then use the application for one real working day and fix whatever gets in the way

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.6"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.7", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "5.1", "7.1", "7.2"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6", "5.2", "7.3"] },
    { "id": 4, "tasks": ["3.7", "5.3", "5.4", "6.1", "8.1"] },
    { "id": 5, "tasks": ["5.5", "5.6", "5.8", "6.2", "8.2"] },
    { "id": 6, "tasks": ["5.7", "5.9", "6.3", "6.4", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster first version. Only the accessibility pass is optional; everything else is load-bearing.
- **The browser never computes the reconciliation.** Every `Change_Preview` renders a server `Dry_Run` response verbatim. Reimplementing clipping in TypeScript for the client would be a second copy of the hardest logic in the project and it would drift. If a preview seems slow, cache it — do not compute it locally.
- **The server owns the timer.** The elapsed readout ticks locally but is replaced by `sync()` on load, on tab focus and after every start and stop. Never persist timer state in the browser: a cached value that survives a server-side change is worse than no cache.
- **Palette**: the eight slots in `src/lib/viz/palette.ts` were validated with the data-viz validator in both modes — adjacent CVD ΔE 9.1 light and 8.4 dark, normal-vision 19.6 and 19.3. Three light-mode slots sit below 3:1 contrast, so the **relief rule** applies and is non-negotiable: every timeline bar wide enough carries its project name, and the entry list beside the timeline is the table view. Do not add a ninth colour; beyond eight projects the index wraps and the label carries the distinction. Charts fold past the top seven into "Other" rather than cycling.
- **Reads are load functions, writes are form actions.** `fetch` is only for the `Dry_Run`, the timer refresh and inline project creation. Keep it that way — form actions are what give field-level errors and preserved input for free through superforms.
- Form actions and the REST routes share the Zod schemas from `001`, so the interface and an external script cannot diverge. Do not write a second schema.
- Error `message` values from the server are Paraglide keys, not prose. Render the translation; never show a raw code to the user.
- `Interval` is half-open `[start, end)` in the interface exactly as on the server. A session ending at 12:00 and the next starting at 12:00 do not overlap, and the timeline must not draw a gap between them.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL for E2E with plain `docker run` on the sandbox's own network and reach it by container name. The `sandbox-docker-net` skill has the details.
- Playwright browsers are already installed at `/opt/playwright-browsers`. Never run `playwright install` in this sandbox.
- Test directories mirror the source tree: `tests/routes/api/…` for routes, `tests/modules/<feature>/components/…` for feature components, `tests/lib/…` for shared code.
- Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
