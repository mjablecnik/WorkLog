# Requirements Document

## Introduction

Worklog's timer and activity log, specified in `001-worklog-domain-api` and drawn by
`002-worklog-ui`, record one kind of time: work, attributed to a `Project`, reconciled
against the timer frame. This specification extends both halves so the same log can
also tell paid work apart from unpaid work, and either from leisure — without adding a
second timer, a category field chosen at the timer, or any change to `Work_Session`
itself.

Two decisions carry the whole design. First, whether logged time is paid or unpaid is
a property of the `Project` it is attributed to (`Billable`), not something chosen
per entry — a user who wants to separate "client work" from "housework" or "my own
projects" already does that by having a different `Project` for each; this
specification only lets that project say which side of the line it is on. Second,
leisure time carries no `Project` at all and is not reconciled against the timer
frame the way work is — the point of leisure logging is that it does not depend on
the timer having run, so it is deliberately **not** `Tracked_Time`, `Covered_Time` or
`Uncovered_Time` as `001-worklog-domain-api` defines them. Both choices keep
`Work_Session` and `Clipping`'s pure arithmetic untouched; what changes is what a
small number of callers feed into that arithmetic, which entries one re-clipping
query is allowed to return, and what the day and range aggregations report alongside
it.

This specification covers: the data layer and service changes in
`src/lib/server/` and `src/db/schema/` (a new `migrations/002_*.sql`, `Project.billable`,
a nullable `activity_entries.project_id`, and the `Unrestricted_Window` reconciliation
path); the wire contracts in `src/lib/contracts/`; the form-action layer in
`src/lib/server/services/activity-form-actions.ts` and the affected `+page.server.ts`
actions; and the interface changes in `src/modules/` — the projects page, the
`Activity_Dialog`, the `Day_Timeline`, and the statistics page. The `Day_Gauge` is
explicitly **not** redesigned: it continues to draw `Work_Session` and `Work_Entry`
data exactly as `002-worklog-ui` specifies it, with leisure time excluded from it
entirely rather than folded in.

Two visual questions this specification might have been expected to leave open are
instead decided, because `.design/DESIGN.md` already answers both. The
`Leisure_Palette_Slot` is **not** a ninth categorical colour — § 2 of that document
establishes that eight mutually distinguishable categorical colours do not exist, so
leisure opts out of the scale by being deliberately low-chroma rather than competing
in it; the measured values and the reasoning are in the design document's palette
component. The category picker is the project's existing three-way segmented control,
already drawn for the theme picker and the mode control and implemented once, so
Paid/Unpaid/Relax is a fourth instance of a known shape rather than a new component.

Three artboards extend the `Design_Contract` for this specification and are drawn,
rendered and binding exactly as every other screen in `.design/artboards/` is:

| Artboard | Screen |
|---|---|
| `TimerCategories.dc.html` | The timer page — the `Day_Gauge` unchanged, with the category figures added beside its existing readouts |
| `DayCategories.dc.html` | The day page — paid, unpaid and `Leisure_Block` units on one timeline, including leisure logged where the timer never ran |
| `AddTaskCategories.dc.html` | The `Activity_Dialog` with the category control above the mode control |

What remains open is narrower still: the light-theme and mobile variants of these
three screens are not drawn, and the exact placement of the `Billable` toggle within
an existing project row is not either. Where this document is silent on an exact
visual detail, an implementer follows the closest existing convention in
`.design/DESIGN.md` and flags the gap rather than guessing silently, exactly as
`001-worklog-domain-api`'s and `002-worklog-ui`'s own introductions already establish
as this project's convention.

This is now settled rather than open: the light-theme and mobile renderings of these
three screens are governed by `.design/DESIGN.md`'s general rules, not by dedicated
artboards — no light or mobile variant of `TimerCategories`, `DayCategories` or
`AddTaskCategories` will be drawn. Conformance is instead checked by the automated
accessibility and narrow-viewport sweep in `tests/e2e/a11y.spec.ts`, which opens the
`Activity_Dialog` and sweeps all four pages in both themes and at 320px.

## Glossary

Every term defined in `001-worklog-domain-api` and `002-worklog-ui` keeps its meaning
here unchanged, in particular **Worklog_Server**, **Worklog_UI**, **Work_Session**,
**Tracked_Time**, **Untracked_Time**, **Activity_Entry**, **Activity_Segment**,
**Orphaned_Entry**, **Clipping**, **Explicit_Mode**, **Duration_Mode**, **Open_Mode**,
**Placement_Anchor**, **Target_Day**, **Untracked_Policy**, **Project**, **Logical_Day**,
**Dry_Run**, **Preview_Token**, **Day_Gauge**, **Overtime_Arc**, **Project_Legend**,
**Day_Timeline**, **Work_Block**, **Segment_Block**, **MIN_BLOCK_PX**,
**Activity_Dialog**, **Change_Preview**, **Project_Picker**, **Quick_Log**, **KPI_Row**,
**Day_Rhythm_Strip**, **Palette_Slot**, **Design_Contract** — which this specification
extends with the three artboards named in the Introduction.

Two inherited terms are **narrowed** by this specification and are therefore redefined
below rather than inherited: `Covered_Time` and `Uncovered_Time`.

- **Billable**: A boolean attribute of `Project`, defaulting to `true`, that decides
  whether a `Work_Entry` attributed to it is `paid` or `unpaid`
- **Work_Entry**: An `Activity_Entry` whose `projectId` is not null — reconciled
  against `Tracked_Time` by `Clipping` exactly as every `Activity_Entry` was before
  this specification
- **Leisure_Entry**: An `Activity_Entry` whose `projectId` is null — carries a
  description and a resolved interval like any `Activity_Entry`, but is reconciled
  against the `Unrestricted_Window` instead of `Tracked_Time`, and can be created
  whether or not any `Work_Session` exists for its `Target_Day`
- **Unrestricted_Window**: The window a `Leisure_Entry`'s `Clipping` runs against in
  place of `Tracked_Time` — the requested interval itself in `Explicit_Mode` and
  `Open_Mode`, and the `Target_Day` bounds in `Duration_Mode` — so nothing about a
  `Leisure_Entry`'s own stated interval is discarded, extended against or rejected for
  lying outside a timer frame that does not apply to it
- **Category**: The three-way classification of an `Activity_Entry`, derived at read
  time and never stored — `paid` for a `Work_Entry` whose `Project` is `Billable`,
  `unpaid` for a `Work_Entry` whose `Project` is not `Billable`, `relax` for a
  `Leisure_Entry`
- **Covered_Time**: **Narrowed here.** The union of every `Work_Entry`
  `Activity_Segment` interval in a given range. `001-worklog-domain-api` defines it as
  the union of *all* `Activity_Segment` intervals; that definition and this one were
  the same set before this specification, because every `Activity_Entry` then had a
  `Project`. A `Leisure_Entry` segment is **not** `Covered_Time`
- **Uncovered_Time**: **Narrowed here** by the same restriction — `Tracked_Time` minus
  `Covered_Time` as narrowed above, so that `Covered_Time` and `Uncovered_Time`
  together continue to reconstruct `Tracked_Time` exactly
- **Leisure_Time**: The union of every `Leisure_Entry` `Activity_Segment` interval in
  a given range — wholly separate from `Covered_Time`, `Uncovered_Time` and
  `Tracked_Time`
- **Leisure_Block**: The `Day_Timeline`'s rendering unit for one `Leisure_Entry`
  segment — drawn as its own top-level unit on the shared time axis, never nested
  inside a `Work_Block`
- **Leisure_Palette_Slot**: The single fixed colour representing `Leisure_Time`
  wherever it is drawn — distinct from all eight `Palette_Slot` values and never
  assigned by the `colorIndex` wraparound rule

## Requirements

### Requirement 1: Project Billable Classification

**User Story:** As a user separating client work from unpaid personal or household
projects, I want to mark a project as paid or unpaid, so that time logged against it
is classified without tagging every task individually.

#### Acceptance Criteria

1. THE Worklog_Server SHALL carry a `Billable` boolean on every `Project`, defaulting
   to `true` when a `Project` is created without one stated
2. WHEN a POST request is received at `/api/projects` with a `billable` field, THE
   Worklog_Server SHALL create the `Project` with that value
3. WHEN a PATCH request is received at `/api/projects/{id}` with a `billable` field,
   THE Worklog_Server SHALL update it and return HTTP 200
4. THE Worklog_Server SHALL keep a `Project`'s `Billable` value unchanged when the
   project is renamed, archived, unarchived or recoloured
5. THE Worklog_Server SHALL classify every `Work_Entry` attributed to a `Project` as
   `paid` when that project's `Billable` is `true` and `unpaid` when it is `false`,
   re-evaluated at every read rather than fixed at the time the `Work_Entry` was
   created
6. WHEN a `Project`'s `Billable` value is changed, THE Worklog_Server SHALL
   immediately reclassify every existing `Work_Entry` attributed to it in every
   subsequent read, because `Category` is derived and never stored
7. WHEN migrating existing data, THE Worklog_Server SHALL set `Billable` to `true` on
   every `Project` that existed before this specification, consistent with every
   `Activity_Entry` before it having required a `Project` and none of them having had
   a category

### Requirement 2: Leisure Entry Creation

**User Story:** As a user who wants to log rest and personal time without inventing a
project for it, I want to record an activity with no project at all, so that leisure
time is tracked as plainly as work is.

#### Acceptance Criteria

1. THE Worklog_Server SHALL accept a POST request at `/api/activities` with no
   `projectId` and SHALL create a `Leisure_Entry` in whichever of `Explicit_Mode`,
   `Duration_Mode` or `Open_Mode` the supplied fields select, by exactly the same
   mode-selection rule as a `Work_Entry`
2. THE Worklog_Server SHALL treat `projectId` as optional on creation, a present value
   naming the `Project` of a `Work_Entry`
3. THE Worklog_Server SHALL treat an absent `projectId` on creation as creating a
   `Leisure_Entry`, requiring no `Project` for it
4. THE Worklog_Server SHALL accept a `Leisure_Entry` whose description is empty,
   exactly as it does for a `Work_Entry`
5. THE Worklog_Server SHALL apply the same description length limit, the same
   `FUTURE_TOLERANCE_SECONDS` bound and the same `AMBIGUOUS_MODE`/`INVALID_INTERVAL`
   validation to a `Leisure_Entry` as to a `Work_Entry`
6. IF `projectId` is supplied and does not reference an existing `Project`, THEN THE
   Worklog_Server SHALL return HTTP 400 with error code `VALIDATION_ERROR`, exactly as
   for a `Work_Entry`
7. IF `projectId` is supplied and references an archived `Project`, THEN THE
   Worklog_Server SHALL return HTTP 400 with error code `PROJECT_ARCHIVED`

### Requirement 3: Leisure Entry Reconciliation Against the Unrestricted Window

**User Story:** As a user, I want to log leisure time whether or not the timer has
run that day, so that rest is not gated behind an unrelated work session.

#### Acceptance Criteria

1. WHEN `Clipping` a `Leisure_Entry`, THE Worklog_Server SHALL use the
   `Unrestricted_Window` in place of `Tracked_Time`, so no part of its requested
   interval or resolved duration is discarded, extended against or rejected for lying
   outside a timer frame
2. WHEN placing a `Leisure_Entry` created in `Duration_Mode`, THE Worklog_Server SHALL
   advance forward and consume only time that is not already claimed by another
   `Activity_Entry`'s `Activity_Segment` — `Work_Entry` or `Leisure_Entry` alike — by
   the same rule as `001-worklog-domain-api` Requirement 5.8, so only one thing is
   ever logged as happening at a given instant. This governs `Duration_Mode` only:
   `Explicit_Mode` and `Open_Mode` have a fixed requested interval instead of a
   forward walk, and criterion 3 governs those unconditionally — an overlap there is
   rejected outright, never trimmed
3. IF a `Leisure_Entry`'s requested interval overlaps an `Activity_Segment` of a
   different `Activity_Entry`, THEN THE Worklog_Server SHALL return HTTP 409 with
   error code `ACTIVITY_OVERLAP`, exactly as for a `Work_Entry`
4. THE Worklog_Server SHALL still discard any resulting interval shorter than
   `MIN_INTERVAL_SECONDS` as a sliver, by the same rule that governs every
   `Activity_Entry`
5. IF `Clipping` a `Leisure_Entry` would produce no `Activity_Segment` at all, THEN
   THE Worklog_Server SHALL return HTTP 409 with error code `NOTHING_TO_LOG`, exactly
   as for a `Work_Entry`
6. THE Worklog_Server SHALL accept an `untrackedPolicy` value on a `Leisure_Entry`
   request without effect, because the `Unrestricted_Window` leaves nothing in
   `Untracked_Time` for `clip`, `extend` or `reject` to act on
7. THE Worklog_Server SHALL report an empty `discarded` list and a zero
   `unplacedMinutes` remainder for a `Leisure_Entry` whenever nothing was lost to an
   overlap or to the `MIN_INTERVAL_SECONDS` floor
8. WHEN resolving the `Placement_Anchor` of a `Leisure_Entry` created in
   `Duration_Mode` or `Open_Mode` with no explicit start, THE Worklog_Server SHALL
   fall back through the same rule as a `Work_Entry` — the end of the `Target_Day`'s
   latest `Activity_Segment`, else the start of its earliest `Work_Session` — and,
   where neither exists, SHALL further fall back to the start of the `Target_Day`
   itself rather than reporting `NO_PLACEMENT_ANCHOR`, because a `Leisure_Entry` does
   not depend on a `Work_Session` having ever run that day
9. THE Worklog_Server SHALL bound a `Leisure_Entry` created in `Duration_Mode` at the
   end of the `Target_Day`, exactly as for a `Work_Entry`
10. THE Worklog_Server SHALL report the `Placement_Anchor` of a `Leisure_Entry`
    resolved by criterion 8's day-start fallback with its own distinct source value,
    so a caller can tell it apart from a `Work_Entry`'s `explicit`, `last-segment` and
    `first-session` anchor sources
11. WHEN a `Work_Session` is created, modified or deleted, THE Worklog_Server SHALL
    NOT re-apply `Clipping` to any `Leisure_Entry`, because a `Leisure_Entry` is
    reconciled against the `Unrestricted_Window` and never against `Tracked_Time`, so
    a change to the timer frame can neither shorten, split nor empty one
12. IF a `Leisure_Entry` is created in `Open_Mode` for a `Logical_Day` in the past
    that holds no `Work_Session`, THEN THE Worklog_Server SHALL return HTTP 409 with
    error code `NOTHING_TO_LOG`, because `Open_Mode`'s end for a past day is the end
    of that day's last `Work_Session` and the day-start fallback of criterion 8 makes
    the resolved interval empty; `Explicit_Mode` and `Duration_Mode` remain the
    supported ways to log leisure on such a day

### Requirement 4: Leisure Entry Editing, Deletion and Category Transitions

**User Story:** As a user who logged something as leisure but realizes it was
actually paid work — or the reverse — I want to change which it is, so that a
mistake does not have to be deleted and retyped.

#### Acceptance Criteria

1. THE Worklog_Server SHALL accept a PATCH request at `/api/activities/{id}` that
   sets `projectId` to `null`, converting a `Work_Entry` into a `Leisure_Entry`
2. THE Worklog_Server SHALL accept a PATCH request at `/api/activities/{id}` that
   sets `projectId` to a `Project`'s identifier on a `Leisure_Entry`, converting it
   into a `Work_Entry`
3. WHEN a PATCH request changes whether `projectId` is null, THE Worklog_Server SHALL
   re-apply `Clipping` to the entry's existing requested interval under the regime of
   what it is becoming, even when the interval or duration itself is not otherwise
   being changed
4. IF re-applying `Clipping` under criterion 3 would leave the entry with no
   `Activity_Segment`, THEN THE Worklog_Server SHALL return HTTP 409 with error code
   `NOTHING_TO_LOG` and SHALL leave the `Activity_Entry` exactly as it was — the same
   guarantee Requirement 7.19 of `001-worklog-domain-api` already gives every other
   rescue attempt that would empty an entry
5. THE Worklog_Server SHALL leave a PATCH that changes only the description, or that
   changes `projectId` between two non-null values, governed by the existing
   meta-only or interval-only rules of Requirements 7.8 and 7.9 of
   `001-worklog-domain-api` unchanged, because neither crosses the null/non-null
   boundary criterion 3 governs
6. THE Worklog_Server SHALL delete a `Leisure_Entry` exactly as it deletes a
   `Work_Entry`
7. THE Worklog_Server SHALL list, page and order a `Leisure_Entry` in
   `/api/activities` and in the day and coverage-adjacent responses by exactly the
   same rule as a `Work_Entry`
8. THE Worklog_Server SHALL NOT permit a `Leisure_Entry` to become an
   `Orphaned_Entry`, because creation rejects an empty `Clipping` result with
   `NOTHING_TO_LOG` (criterion 3.5), a PATCH that would empty one leaves it untouched
   (criterion 4), and no `Work_Session` change ever re-clips one (criterion 3.11) —
   leaving no path by which a stored `Leisure_Entry` loses its last
   `Activity_Segment`
9. WHEN converting a `Work_Entry` into a `Leisure_Entry` through a form action rather
   than the JSON API, THE Worklog_Server SHALL take the instruction from a dedicated
   boolean field rather than from a null `projectId`, because a `FormData` body cannot
   carry a null and cannot distinguish an absent field from an empty one
10. IF that dedicated boolean field is supplied to the JSON API, THEN THE
    Worklog_Server SHALL reject the request with HTTP 400 and error code
    `VALIDATION_ERROR`, so a null `projectId` remains the one JSON encoding of the
    conversion and a caller can never have the field silently accepted and dropped
11. IF that dedicated boolean field is supplied together with a `projectId` in the same
    form action, THEN THE Worklog_Server SHALL reject the request with HTTP 400 and
    error code `VALIDATION_ERROR`, because the two name contradictory outcomes and
    silently preferring either one would discard an instruction the caller gave

### Requirement 5: Category-Derived Wire Shape

**User Story:** As the interface, I want to know an entry's category and see plainly
that it has no project, so that I never join against the projects list to colour or
file it.

#### Acceptance Criteria

1. THE Worklog_Server SHALL report `projectId` as `null` and `projectName` as `null`
   on every `Leisure_Entry`
2. THE Worklog_Server SHALL report a `category` field of `paid`, `unpaid` or `relax`
   on every `Activity_Entry`, derived by Requirement 1.5, so no caller needs its own
   `Project` list to tell them apart
3. THE Worklog_Server SHALL report `colorIndex` as `null` on every `Leisure_Entry`,
   because none of the eight `Palette_Slot` values represents it
4. THE Worklog_Server SHALL NOT wrap a `Leisure_Entry` into an existing `Palette_Slot`
   by the `colorIndex` modular rule
5. THE Worklog_Server SHALL report `billable` on every row of a `Project`-keyed total
   (`ProjectTotal`), so a caller can split a per-project breakdown into paid and
   unpaid without a second `Project` lookup

### Requirement 6: Category Totals and Category-Aware Aggregation Reads

**User Story:** As a user reviewing a day or a range, I want to see how much of it
was paid, unpaid and leisure separately, so that "how much did I work" and "how much
did I rest" are never blended into one number.

#### Acceptance Criteria

1. THE Worklog_Server SHALL compute `Covered_Time`, `Uncovered_Time` and every figure
   derived from them (`coveredSeconds`, `uncoveredSeconds`, the per-`Project`
   breakdown, `/api/coverage`) from `Work_Entry` segments only, so a `Leisure_Entry`'s
   segments — which are not subsets of `Tracked_Time` — never inflate `Covered_Time`
   past `Tracked_Time` and never disturb the guarantee that `Covered_Time` and
   `Uncovered_Time` together reconstruct `Tracked_Time` exactly
2. THE Worklog_Server SHALL include in the day response and in every day summary a
   `paidSeconds` figure and an `unpaidSeconds` figure, being `coveredSeconds` split by
   the `Billable` value of each `Work_Entry`'s `Project`, so that
   `paidSeconds + unpaidSeconds` always equals `coveredSeconds`
3. THE Worklog_Server SHALL include in the day response and in every day summary a
   `relaxSeconds` figure, being the total duration of every `Leisure_Entry` segment
   overlapping that `Logical_Day`, clamped to its boundaries — a figure wholly
   separate from `trackedSeconds`, `coveredSeconds` and `uncoveredSeconds`
4. WHEN a GET request at `/api/days` carries `include=intervals`, THE Worklog_Server
   SHALL additionally include in every day summary the `Leisure_Time` intervals of
   that `Logical_Day`, clamped to its boundaries, alongside the existing
   `Tracked_Time`, `Covered_Time` and `Uncovered_Time` intervals
5. THE Worklog_Server SHALL exclude a `Leisure_Entry` from the entries blocking a
   `Project` deletion, because a `Leisure_Entry` never references a `Project`
6. THE Worklog_Server SHALL consider only the most recent `Work_Entry` when resolving
   the `Project` a `Quick_Log` write would attribute an entry to, because `Quick_Log`
   requires a `Project` and a `Leisure_Entry` has none; this exclusion governs the
   `Project` resolution only, and the `Quick_Log` interval's own `Placement_Anchor`
   SHALL continue to consider every `Activity_Segment` of either kind, so that the
   offered interval never overlaps a `Leisure_Entry` and fails `ACTIVITY_OVERLAP` on
   submission

### Requirement 7: Day Gauge Excludes Leisure Time

**User Story:** As a user, I want the Day Gauge to keep showing my work rhythm
exactly as before, so that adding leisure logging does not redraw the one picture I
check throughout the day.

#### Acceptance Criteria

1. THE Day_Gauge SHALL draw its inner arc from `Work_Entry` `Activity_Segment`
   records only, excluding every `Leisure_Entry`
2. THE Day_Gauge's outer arc, its `Uncovered_Time` dashes, its `Overtime_Arc`
   decorations and its worked/covered/uncovered readouts SHALL be unaffected by the
   presence of any `Leisure_Entry`, because none of them derive from anything a
   `Leisure_Entry` produces
3. THE Project_Legend beneath the Day_Gauge SHALL continue to name only the `Project`
   records drawn on the gauge's inner arc, and SHALL NOT gain a `Leisure_Palette_Slot`
   entry, because the gauge draws no leisure arc for it to legend
4. THE timer page SHALL present the `paidSeconds`, `unpaidSeconds` and `relaxSeconds`
   figures beside the `Day_Gauge`'s existing worked/covered/uncovered readouts rather
   than folded into them, and SHALL match `.design/artboards/TimerCategories.dc.html`
   on the same terms as Requirement 8.8

### Requirement 8: Day Timeline Leisure Blocks

**User Story:** As a user reviewing a day, I want to see my leisure time on the same
timeline as my work, so that a fuller picture of the day is visible in one place
without switching views.

#### Acceptance Criteria

1. THE Day_Timeline SHALL draw one `Leisure_Block` per `Leisure_Entry` segment,
   positioned chronologically on the shared time axis alongside every `Work_Block`,
   rather than nested inside one
2. THE Leisure_Block SHALL be tinted with the `Leisure_Palette_Slot` and SHALL carry
   the entry's description and its times
3. THE Day_Timeline SHALL size a `Leisure_Block` from the same proportional height
   budget every other unit is sized from — its duration counted into the day's total
   seconds and its height drawn from the same flexible remainder — floored at
   `MIN_BLOCK_PX` exactly as a `Segment_Block` is, so that the total rendered height
   never exceeds the available height and Property 2 of `002-worklog-ui` continues to
   hold; being a top-level unit means it is not nested inside a `Work_Block`'s column,
   not that it is sized outside that budget
4. WHEN a `Leisure_Block` is activated, THE Worklog_UI SHALL open the `Activity_Dialog`
   for its `Leisure_Entry`, with the category control already set to `relax`
5. THE Day_Timeline SHALL render its `Leisure_Block` units on a `Logical_Day` that
   holds no `Work_Session` at all, rather than the empty state, because a day of
   leisure with the timer never started is the ordinary case this specification exists
   to support
6. THE Day_Timeline SHALL be navigable by keyboard through every `Leisure_Block` in
   the same chronological order as every `Work_Block`, exactly as Requirement 4.15 of
   `002-worklog-ui` already requires across the whole timeline
7. THE Day_Timeline SHALL name each `Segment_Block`'s derived `Category` as text
   beside its `Project` name, so a `Work_Entry`'s paid or unpaid state is never
   carried by colour alone — the same rule Requirements 9.3 and 11.5 apply to the
   projects and statistics surfaces
8. THE Day_Timeline SHALL match `.design/artboards/DayCategories.dc.html` in layout,
   proportion and palette when rendered at that artboard's frame size, on the same
   terms Requirement 14.16 of `002-worklog-ui` sets for every other screen — comparing
   arrangement and relative proportion rather than exact pixel heights, and excepting
   copy and example data
9. THE day page SHALL present the `paidSeconds`, `unpaidSeconds` and `relaxSeconds`
   figures in its day-summary column beside the existing worked/described/undescribed
   figures, with `relaxSeconds` visually separated from the other two, because leisure
   is not part of the worked total and must not read as a share of it

### Requirement 9: Project Management — Billable Toggle

**User Story:** As a user managing my projects, I want to mark one as paid or unpaid
from its own row, so that every task logged against it is classified without
visiting each one.

#### Acceptance Criteria

1. THE projects page SHALL offer a two-way control on each `Project`'s own row
   setting its `Billable` value, presented beside the existing colour and archive
   controls
2. THE projects page SHALL offer choosing `Billable` at the point a `Project` is
   created, defaulting to paid
3. THE projects page SHALL show a `Project`'s `Billable` state as a plain label
   wherever its row is drawn, so the classification is never carried by colour alone
4. THE projects page SHALL submit a `Billable` change through its own named form
   action, following the one-action-per-operation convention its existing
   archive and unarchive controls already establish

### Requirement 10: Activity Dialog — Category Selection

**User Story:** As a user logging a task, I want to say up front whether it was
paid, unpaid or leisure, so that the project list I am offered matches what I am
actually about to log.

#### Acceptance Criteria

1. THE Activity_Dialog SHALL offer a segmented control choosing `paid`, `unpaid` or
   `relax`, independent of and shown before the `Explicit_Mode`/`Duration_Mode`/
   `Open_Mode` control
2. WHILE `paid` is selected, THE Activity_Dialog SHALL offer the `Project_Picker`
   filtered to `Project` records whose `Billable` is `true`
3. WHILE `unpaid` is selected, THE Activity_Dialog SHALL offer the `Project_Picker`
   filtered to `Project` records whose `Billable` is `false`
4. WHILE `relax` is selected, THE Activity_Dialog SHALL hide the `Project_Picker`
   entirely and SHALL require nothing but the description and the mode fields
5. WHEN the category changes between `paid` and `unpaid`, or to or from `relax`, and
   the previously chosen `Project` no longer belongs to the newly filtered list, THE
   Activity_Dialog SHALL clear the chosen `Project`
6. WHEN the `Activity_Dialog` opens for editing an existing `Activity_Entry`, THE
   Activity_Dialog SHALL set the category control from that entry's `category`
7. THE Activity_Dialog SHALL default the category and, where it names a `Project`,
   the `Project` and description to those of the most recent `Work_Entry` of the
   displayed day, considering no `Leisure_Entry` when resolving that default,
   consistent with Requirement 6.6. WHERE the displayed day holds no `Work_Entry`,
   THE Activity_Dialog SHALL default the category to `paid` with no `Project`
   selected
8. THE Change_Preview beneath the form SHALL be offered for a `Leisure_Entry` draft on
   the same terms as for a `Work_Entry` draft, since `Clipping` reports the same shape
   of outcome for both and the resulting `Preview_Token` is required for the write
   either way
9. THE Activity_Dialog SHALL match `.design/artboards/AddTaskCategories.dc.html` in the
   placement and shape of the category control, on the same terms as Requirement 8.8
10. WHEN a `Project` is created inline from the `Project_Picker` while the
    `Activity_Dialog` is open, THE Worklog_UI SHALL set that project's `Billable` from
    the category currently selected, so a project created under `unpaid` is not born
    `Billable` and immediately filtered out of the very list it was created for

### Requirement 11: Statistics — Category Breakdown

**User Story:** As a user looking back over a period, I want paid, unpaid and
leisure time shown apart, so that the shape of my time is visible at a glance.

#### Acceptance Criteria

1. THE KPI_Row SHALL show `paidSeconds`, `unpaidSeconds` and `relaxSeconds` as
   individually visible figures, whether as three additional entries or folded into
   the existing figures' presentation
2. THE statistics page's per-`Project` breakdown SHALL group `Project` rows under a
   paid heading and an unpaid heading by `Billable`, each sorted descending exactly
   as today, and SHALL apply its top-N fold within each heading separately so that
   a combined row never mixes a paid `Project` with an unpaid one
3. THE statistics page SHALL show the range's total `Leisure_Time` beneath both
   headings, separated from them, and never as one of the bars
4. THE Day_Rhythm_Strip SHALL draw the `Leisure_Time` intervals the server returns in
   the `Leisure_Palette_Slot`, at the position the leisure time actually fell,
   alongside the existing covered and uncovered treatments
5. THE statistics page SHALL present the paid/unpaid/leisure split as text as well as
   any chart, so the information does not depend on colour alone, exactly as
   Requirement 12.13 of `002-worklog-ui` already requires

### Requirement 12: Internationalization

**User Story:** As a Czech-first user, I want the new category language to read as
naturally as everything else, so that leisure logging never feels bolted on.

#### Acceptance Criteria

1. THE Worklog_UI SHALL provide the category labels (`paid`, `unpaid`, `relax`) and
   the `Billable` toggle's labels in Czech and English through Paraglide message
   keys, exactly as every other user-facing string
2. THE Worklog_UI SHALL contain no literal text for any new string this specification
   introduces, consistent with Requirement 13.2 of `002-worklog-ui`
