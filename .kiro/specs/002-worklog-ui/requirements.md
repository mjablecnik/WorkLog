# Requirements Document

## Introduction

This specification covers the browser interface of the Worklog SvelteKit application at `worklog/` — everything under `src/routes/` other than `src/routes/api/`, the feature modules in `src/modules/`, and the shared design system in `src/lib/ui/`. The server-side domain, data layer and REST API it builds on are specified in `001-worklog-domain-api`.

The interface has one job the server cannot do: make a working day **visible**. During the day the user only presses start and stop, so the interface must make that one action immediate and unambiguous. In the evening the user describes what they did, and the interface must show which stretches of the day are still unexplained, make filling them cheap, and — because the server reconciles every write against the timer frame — show what a change will do *before* it is saved.

The reconciliation is the reason a plain list is not enough. An activity logged as one three-hour block may be stored as two segments with a break between them, and shortening a timer session may silently remove time from activities logged against it. Both are shown on the `Day_Timeline`, and both are previewed through the server's `Dry_Run` before anything is written.

The appearance of the interface is not open. It is fixed by the `Design_Contract` in `.design/` — `DESIGN.md` for the tokens and rules, `artboards/` for the approved screens and `screens/` for their renders. Where this document states a colour, a size or an arrangement, it is restating that contract, and a disagreement between the two is a defect to be resolved rather than a choice left to the implementer.

The interface is Czech-first with English as a fallback, runs in a light and a dark theme, works on a phone as well as a desktop, and is used by exactly one person who is already logged in on their own device.

## Glossary

Terms carried over from `001-worklog-domain-api` keep their meaning there: **Work_Session**, **Activity_Entry**, **Activity_Segment**, **Orphaned_Entry**, **Tracked_Time**, **Untracked_Time**, **Covered_Time**, **Uncovered_Time**, **Logical_Day**, **Explicit_Mode**, **Duration_Mode**, **Open_Mode**, **Placement_Anchor**, **Untracked_Policy**, **Dry_Run**, **Open_Session**, **Stale_Session**, **Gauge_Window**, **Overtime**, **Project**, **Auth_Hook**, **Health_Endpoint**, **Evening_Hour**.

- **Worklog_UI**: The browser interface of the application — `src/routes/` excluding `src/routes/api/`, plus `src/modules/` and `src/lib/ui/`
- **Design_Contract**: The approved visual definition of the interface — `.design/DESIGN.md` together with the artboards in `.design/artboards/` and their renders in `.design/screens/`
- **Theme**: One of the two complete colour sets of the interface — `dark` ("Midnight") and `light` ("Daylight")
- **Theme_Preference**: What the user chose — `system`, `light` or `dark`. `system` resolves to a `Theme` through `prefers-color-scheme`; the other two name one directly.
- **Settings_Menu**: The single control holding the `Theme_Switcher`, the `Locale_Switcher` and the logout control — a round gear chip at the right end of the top bar, opening as an anchored menu on desktop and as a modal bottom sheet on mobile
- **Theme_Switcher**: The three-way segmented control inside the `Settings_Menu` that sets the `Theme_Preference`
- **Design_Tokens**: The named colour, typography, radius, height and spacing values of the `Design_Contract`, declared once as CSS custom properties
- **Palette_Slot**: One of the eight categorical `Project` colours, addressed by `color_index` 0–7, each with a `dark` and a `light` value
- **Timer_Control**: The start and stop control at the centre of the `Day_Gauge`, together with the elapsed readout above it
- **Day_Gauge**: The circular reading of one `Logical_Day` shown on the timer page — an outer arc for `Work_Session` records and an inner arc for `Activity_Segment` records
- **Gauge_Track**: The part of the `Day_Gauge` covering the `Gauge_Window`, drawn with a visible groove and a graduated dial
- **Gauge_Gap**: The remainder of the circle, outside the `Gauge_Window`, drawn completely bare
- **Overtime_Arc**: The part of the `Day_Gauge` falling in the `Gauge_Gap` — work outside the expected window
- **Project_Legend**: The row beneath the `Day_Gauge` naming every `Project` drawn on it, each with its `Palette_Slot` swatch, plus one entry for `Uncovered_Time`
- **Running_Indicator**: The 6 px accent dot and elapsed readout shown in the top bar while an `Open_Session` exists, on every page but the timer page
- **Day_Timeline**: The vertical reading of one `Logical_Day` shown on the day page — one `Work_Block` per `Work_Session`, stacked in chronological order and separated by `Break_Marker` rows
- **Work_Block**: One `Work_Session` on the `Day_Timeline` — a head naming its start, end and duration, a `Session_Rail`, and the column of `Segment_Block` elements belonging to it
- **Session_Rail**: The rounded vertical rail at the left edge of a `Work_Block` standing for the `Work_Session` itself — 8 px wide on desktop, 6 px on mobile
- **Segment_Block**: One `Activity_Segment` on the `Day_Timeline`, tinted with its `Project` colour and carrying the project name, the description and the times
- **MIN_BLOCK_PX**: The minimum rendered height of a `Segment_Block` — 36 pixels on desktop, 26 pixels on mobile
- **MAX_OPEN_SESSION_HOURS**: The limit past which `001-worklog-domain-api` stops counting an `Open_Session`, reported to the interface by the `Health_Endpoint`
- **MAX_INTERVAL_RANGE_DAYS**: The widest range for which `001-worklog-domain-api` returns per-day work intervals — 62 `Logical_Day` values. Beyond it the summaries still arrive and the intervals are omitted.
- **MIN_UNCOVERED_SECONDS**: The shortest stretch of `Uncovered_Time` the interface draws or lists — 300 seconds. Shorter stretches still count in every total.
- **Orphan_Panel**: The third panel of the day page's side column, listing every `Orphaned_Entry` of the displayed day
- **Break_Marker**: The single collapsed row the `Day_Timeline` draws between two `Work_Block` groups instead of leaving the break proportionally empty
- **Long_Break**: A break of one hour or more, drawn with the emphasised `Break_Marker` treatment
- **Split_Marker**: The treatment that makes the shared identity of several `Activity_Segment` records of one `Activity_Entry` visible
- **Uncovered_Marker**: The treatment of `Uncovered_Time` wherever it is drawn — a dashed accent outline with an accent title
- **Activity_Dialog**: The overlay for creating and editing an `Activity_Entry`
- **Session_Dialog**: The overlay for editing or deleting a `Work_Session`
- **Change_Preview**: The part of a dialog that shows the outcome returned by a `Dry_Run` before the user confirms
- **Project_Picker**: The control for choosing a `Project`, with search and inline creation
- **Quick_Log**: The one-tap control that records an `Activity_Entry` in `Open_Mode`, letting the server resolve the interval from the `Placement_Anchor` to the current time
- **KPI_Row**: The four figures at the top of the statistics page
- **Day_Rhythm_Strip**: The statistics panel drawing one narrow horizontal strip per `Logical_Day` on a shared axis running from `DAY_START_HOUR` to `DAY_START_HOUR`
- **Locale_Switcher**: The two-way segmented control inside the `Settings_Menu` that changes the interface language between Czech and English
- **Design_System**: The shared component library in `src/lib/ui/`

## Requirements

### Requirement 1: Application Shell and Navigation

**User Story:** As a user opening the application, I want a consistent frame around every page, so that I can reach the timer, the day, my projects and the statistics without hunting.

#### Acceptance Criteria

1. THE Worklog_UI SHALL present a persistent navigation offering the timer page, the current `Logical_Day`, the projects page and the statistics page
2. WHEN the viewport is at least 768 pixels wide, THE Worklog_UI SHALL lay the top bar out as a three-column grid of `1fr auto 1fr` with the brand at the left, the navigation centred, and the `Running_Indicator` followed by the `Settings_Menu` chip at the right
3. WHEN the viewport is narrower than 768 pixels, THE Worklog_UI SHALL collapse the navigation into a bottom bar of four tabs, each carrying an SVG icon above its label
4. WHEN a navigation target is the active page, THE Worklog_UI SHALL mark it as current with `aria-current`, SHALL draw it in full-strength text on the desktop top bar, and SHALL draw it in the accent colour on the mobile bottom bar
5. WHEN the viewport is narrower than 768 pixels and the displayed page offers a create action, THE Worklog_UI SHALL present it as a 54 pixel round floating button at the bottom right above the bottom bar, which on the day page opens a choice between adding an `Activity_Entry` and adding a `Work_Session`, and elsewhere performs that page's single create action directly
6. THE Worklog_UI SHALL show the `Settings_Menu` chip at the right end of the top bar on every authenticated page, at both viewport widths, and SHALL offer the `Theme_Switcher`, the `Locale_Switcher` and the logout control only from inside it
7. WHILE an `Open_Session` exists, THE Worklog_UI SHALL display the `Running_Indicator` in the top bar of every page except the timer page, showing the elapsed time in tabular figures beside a 6 pixel accent dot
8. THE timer page SHALL NOT show the `Running_Indicator`, because its hero readout already states the elapsed time and a second copy in the same view would be noise
9. WHEN the application is opened at the root path, THE Worklog_UI SHALL show the timer page
10. THE Worklog_UI SHALL render an error page for an unknown route offering a link back to the timer page
11. WHEN the user moves between pages of the application, THE Worklog_UI SHALL navigate on the client without a full document reload
12. THE Worklog_UI SHALL render and parse every wall-clock time in the time zone the server reports, never in the time zone of the device
13. WHEN the device time zone differs from the server's, THE Worklog_UI SHALL state which zone the displayed times are in
14. IF a page's own load fails because the server answered `SERVICE_UNAVAILABLE` or could not be reached at all, THEN THE Worklog_UI SHALL show the connection error page rather than a broken layout, while the same failure on a request the browser issued later SHALL surface as a retryable message in place instead
15. THE Worklog_UI SHALL escape all user-supplied text on output and SHALL NOT use `{@html}` for any value originating from a `Project` name or an `Activity_Entry` description
16. WHEN the `Settings_Menu` chip is activated at a viewport of at least 768 pixels, THE Worklog_UI SHALL open a 268 pixel menu anchored under the chip at the right edge of the page
17. WHEN the `Settings_Menu` chip is activated at a viewport narrower than 768 pixels, THE Worklog_UI SHALL open the same content as a bottom sheet carrying a grabber at its top edge
18. THE Settings_Menu SHALL hold, in this order: the `Theme_Switcher` under an uppercase label, the `Locale_Switcher` under an uppercase label, a hairline divider, and the logout control drawn in the destructive colour
19. WHILE the `Settings_Menu` is open on a viewport narrower than 768 pixels, THE Worklog_UI SHALL make it modal — a scrim SHALL cover the page content and the bottom navigation, and the sheet SHALL sit above that scrim
20. WHILE the `Settings_Menu` is open, THE Worklog_UI SHALL dim the page through the scrim alone, and SHALL NOT set an opacity on the page content or on the bottom navigation, because either would create a stacking context that paints the navigation over the sheet
21. THE Settings_Menu SHALL close on Escape, on an activation outside it, and on choosing the logout control, and SHALL return focus to the chip that opened it
22. WHEN the logout control in the `Settings_Menu` is activated, THE Worklog_UI SHALL close the menu and submit the logout form action, the `Settings_Menu` being the only place in the interface that offers logging out
23. THE Worklog_UI SHALL emit `src/app.html` with `%lang%` and `%theme%` placeholders on the document element, which `001-worklog-domain-api` substitutes with the server-resolved language and `Theme`, so both are correct in the first bytes of the response
24. THE Worklog_UI SHALL serve the Inter Tight faces from its own origin, so that the `Content-Security-Policy` needs no font host beyond `'self'` and the typography does not depend on a third party being reachable
25. THE Worklog_UI SHALL take the current `Logical_Day` and its boundaries from the server on every request, and SHALL NOT compute a `Logical_Day` boundary, a day rollover or a time-zone conversion of one in the browser

### Requirement 2: Authentication

**User Story:** As the only user, I want to unlock the application once on my device and stay in, so that daily use costs no ceremony.

#### Acceptance Criteria

1. WHEN THE Auth_Hook redirects an unauthenticated navigation to the login route, THE Worklog_UI SHALL render the login page and SHALL carry the originally requested path through the `next` query parameter and a hidden field of the same name, so the visitor returns to it after logging in
2. THE login page SHALL offer a single password field named `passphrase` and SHALL submit it as a form action
3. IF the passphrase is wrong, THEN THE Worklog_UI SHALL show one generic message that does not reveal whether any credential exists
4. WHEN the passphrase is accepted, THE Worklog_UI SHALL navigate to the path carried in `next`, or to the timer page when there was none
5. WHEN the logout form action returns, THE Worklog_UI SHALL show the login page and SHALL retain no authenticated view state
6. IF a request the browser itself issued fails with `UNAUTHORIZED`, THEN THE Worklog_UI SHALL navigate to `/login?next=<current path>&reason=session_expired` and SHALL render the message explaining that the session ended
7. IF the login route is reached without `reason=session_expired`, THEN THE Worklog_UI SHALL show no session-ended message, because a redirect issued by THE Auth_Hook carries the requested path only and cannot distinguish an expired session from a first visit

### Requirement 3: Timer Page

**User Story:** As a user starting work, I want one obvious control to start and stop the timer, so that tracking never interrupts what I am about to do.

#### Acceptance Criteria

1. WHEN no `Open_Session` exists, THE Timer_Control SHALL present a single start action
2. WHEN an `Open_Session` exists, THE Timer_Control SHALL present a single stop action
3. WHILE an `Open_Session` exists, THE Timer_Control SHALL display the elapsed time of that session above the `Day_Gauge` as a running clock, updating at least once per second, under a caption naming when it started
4. THE timer page SHALL display the total `Tracked_Time` of the current `Logical_Day`
5. THE timer page SHALL display the total `Covered_Time` of the current `Logical_Day`
6. THE timer page SHALL display the total `Uncovered_Time` of the current `Logical_Day` in the accent colour
7. THE timer page SHALL present the three figures of criteria 4, 5 and 6 side by side in that order, each under an uppercase label
8. THE timer page SHALL show the `Project_Legend` beneath the `Day_Gauge`, naming every `Project` drawn on the gauge beside its `Palette_Slot` swatch and adding one dashed entry standing for `Uncovered_Time`
9. THE timer page SHALL arrange its elements in this order: the elapsed readout, the caption naming when the running session started, the `Day_Gauge` with the `Timer_Control` at its exact centre, the three figures, the `Quick_Log` control, the `Project_Legend`
10. THE Worklog_UI SHALL take the authoritative timer state from the server on page load rather than from anything stored in the browser
11. WHILE an `Open_Session` exists, THE Worklog_UI SHALL show the running elapsed time in the browser tab title
12. WHEN the browser tab regains focus, THE Worklog_UI SHALL refresh the timer state from the server and SHALL invalidate the page's loaded data, so a day edited on another device is not shown stale beside a fresh timer
13. IF starting or stopping fails, THEN THE Worklog_UI SHALL restore the previous state and show the reason
14. THE timer page SHALL offer the `Quick_Log` action
15. THE Timer_Control SHALL be operable from the keyboard, with the start and stop action reachable by tab and activated by both Enter and Space
16. WHEN the server reports the running session as a `Stale_Session`, THE Worklog_UI SHALL show a notice above the elapsed readout saying the timer has run since its start and stopped counting, offering a time field prefilled with the moment counting stopped and one action that stops the session at that time
17. IF starting the timer fails because a session already exists or overlaps one, THEN THE Worklog_UI SHALL explain which session is in the way rather than failing silently
18. WHEN the current `Logical_Day` rolls over while a page is open, THE Worklog_UI SHALL re-resolve the current day and reload the page data, so a session started before `DAY_START_HOUR` stops being counted into the day that has just ended
19. WHILE no `Open_Session` exists, THE timer page SHALL show the day's total `Tracked_Time` in the hero position and in the same face, under a caption naming when the last session stopped, or stating that the timer is not running when the day holds none
20. WHILE no `Open_Session` exists, THE Day_Gauge SHALL draw the day's arcs unchanged and THE Timer_Control SHALL show the start icon, so the resting page differs from the running one only in the hero figure, the caption and that icon

### Requirement 4: Day Timeline

**User Story:** As a user reviewing a day, I want the day drawn as the blocks I actually worked, so that I can see at a glance when I worked, what I was doing, and where a description is still missing.

#### Acceptance Criteria

1. THE Day_Timeline SHALL draw one `Work_Block` per `Work_Session` in a single column, in chronological order from the top, with the `Break_Marker` rows between them
2. THE Day_Timeline SHALL give each `Work_Block` its own local time axis, rather than laying the whole day out on one axis
3. THE Day_Timeline SHALL size a `Segment_Block` in proportion to its duration **within** its `Work_Block`, so proportions hold inside a block even though they do not hold across a break
4. THE Work_Block SHALL draw the `Session_Rail` at its left edge, spanning the full height of its segment column, standing for the `Work_Session` itself
5. THE Work_Block SHALL draw one `Segment_Block` per `Activity_Segment`, tinted with its `Project` colour and carrying a left border in the same colour at full strength
6. WHEN one `Activity_Entry` produced several `Activity_Segment` records, THE Day_Timeline SHALL apply the `Split_Marker` to every `Segment_Block` of that entry, naming which part it is and how many parts there are in text as well as visually
7. THE Day_Timeline SHALL apply the `Uncovered_Marker` to every stretch of `Uncovered_Time` inside a `Work_Block`
8. WHILE an `Open_Session` exists on the displayed day, THE Day_Timeline SHALL draw its `Work_Block` as continuing to the current time and SHALL mark it as still running
9. IF the `Open_Session` is a `Stale_Session`, THEN THE Day_Timeline SHALL draw its `Work_Block` only as far as the `MAX_OPEN_SESSION_HOURS` the server reports, and SHALL state that the timer is still running but no longer counting
10. WHEN a `Segment_Block` is hovered or focused, THE Day_Timeline SHALL show its times, its `Project` and its description
11. WHEN a `Segment_Block` is activated, THE Worklog_UI SHALL open the `Activity_Dialog` for its `Activity_Entry`
12. WHEN a `Session_Rail` or a `Work_Block` head is activated, THE Worklog_UI SHALL open the `Session_Dialog` for that `Work_Session`
13. WHEN a stretch carrying the `Uncovered_Marker` is activated, THE Worklog_UI SHALL open the `Activity_Dialog` in `Explicit_Mode` prefilled with exactly that stretch
14. THE Day_Timeline SHALL be laid out vertically at every viewport width, differing between the phone and the desktop in density rather than in orientation
15. THE Day_Timeline SHALL be navigable by keyboard, moving focus between blocks in chronological order
16. WHEN the `Logical_Day` holds no records, THE Day_Timeline SHALL show an empty state inviting the user to start the timer
17. THE Day_Timeline SHALL draw a `Work_Session` continuing past the displayed day as reaching the end of its `Work_Block`, marked as continuing, and SHALL name its true end in the block head
18. THE Day_Timeline SHALL replace every break between two `Work_Block` groups with a single `Break_Marker` of fixed height, naming the break's duration and its start and end
19. WHEN a break is a `Long_Break`, THE Break_Marker SHALL be emphasised against the treatment used for a shorter break
20. THE Day_Timeline SHALL give every `Segment_Block` a rendered height of at least `MIN_BLOCK_PX`, regardless of how short the segment is
21. THE Day_Timeline SHALL draw the description inside a `Segment_Block` only at the desktop density and only when the block is at least 60 pixels tall; below that height, and at every height on mobile, the block carries the project name and the times alone
22. THE Day_Timeline SHALL label each `Work_Block` with its start, its end and its total duration
23. IF the `Day_Timeline` cannot honour `MIN_BLOCK_PX` for every `Segment_Block` within the height available to it, THEN THE Day_Timeline SHALL grow beyond that height and the page SHALL scroll, because a block too small to read is worse than a page that scrolls
24. WHEN any part of a `Work_Session` falls at or after the `Evening_Hour` of its `Logical_Day`, THE Work_Block SHALL mark its head as a night block
25. THE Day_Timeline SHALL NOT draw a stretch of `Uncovered_Time` shorter than `MIN_UNCOVERED_SECONDS` as its own block, SHALL keep its duration in the proportional division of its `Work_Block`'s height so the drawn blocks still sum to the block, and SHALL count it in every total

### Requirement 5: Day Navigation

**User Story:** As a user filling in yesterday's log, I want to move between days, so that I can work on a day other than today.

#### Acceptance Criteria

1. THE day page SHALL be addressed by a date in the URL so that a particular day can be bookmarked and reloaded
2. THE Worklog_UI SHALL offer a previous-day and a next-day control, and a date picker
3. WHEN the displayed day is the current `Logical_Day`, THE Worklog_UI SHALL disable the next-day control and SHALL draw it at reduced opacity
4. THE Worklog_UI SHALL label the current `Logical_Day` as today rather than by date alone
5. IF the date in the URL is not a valid `YYYY-MM-DD` value, THEN THE Worklog_UI SHALL show the error page
6. THE day page SHALL show the day's date, its first and last tracked instant and its total `Tracked_Time` in one heading line

### Requirement 6: Activity Creation

**User Story:** As a user writing up my day, I want to record what I worked on by exact times, by how long it took, or by nothing but the project, so that logging costs no more effort than the memory I actually have.

#### Acceptance Criteria

1. THE day page SHALL offer an action that opens the `Activity_Dialog` for a new `Activity_Entry`
2. THE Activity_Dialog SHALL offer a segmented control with three modes — `Explicit_Mode`, `Duration_Mode` and `Open_Mode` — all three first class
3. WHILE in `Explicit_Mode`, THE Activity_Dialog SHALL require a start time and an end time
4. WHILE in `Duration_Mode`, THE Activity_Dialog SHALL require a duration and SHALL leave the start optional
5. WHILE in `Duration_Mode` or `Open_Mode` with no start given, THE Activity_Dialog SHALL show the `Placement_Anchor` carried by the successful `Dry_Run` response, labelled as an inference rather than as an input, and SHALL NOT compute that anchor in the browser nor read it out of an error payload
6. WHILE in `Open_Mode`, THE Activity_Dialog SHALL require neither a duration nor an end, and SHALL submit the entry with the project alone, letting the server resolve the interval
7. THE Activity_Dialog SHALL require a `Project` and SHALL accept an optional description
8. THE Activity_Dialog SHALL offer the `Project_Picker` with search and the ability to create a `Project` without leaving the dialog
9. THE Activity_Dialog SHALL default the `Project` and description to those of the most recent `Activity_Entry` of the displayed day
10. THE Activity_Dialog SHALL validate the input in the browser before submitting, showing messages beside the field concerned without clearing what was typed
11. THE Activity_Dialog SHALL show the `Change_Preview` live beneath the form, updating as the input changes, rather than as a separate confirmation step
12. WHEN the `Quick_Log` action is used, THE Worklog_UI SHALL submit the entry in `Open_Mode`, letting the server resolve the start from the `Placement_Anchor` and the end from the current time, rather than computing either in the browser
13. THE Quick_Log control SHALL state the interval and the `Project` the server resolved for it, taken from the day payload rather than computed in the browser, and SHALL let the user open the full `Activity_Dialog` instead
14. WHEN an `Activity_Entry` is created, THE Worklog_UI SHALL update the `Day_Timeline` without a full page reload
15. THE Activity_Dialog SHALL be dismissable with the Escape key and SHALL return focus to the control that opened it
16. THE Activity_Dialog SHALL state in its footer that nothing is written until the user confirms
17. THE Quick_Log control SHALL submit the `Project` the server named in the day payload, which is the most recent `Activity_Entry` of the displayed `Logical_Day`, or of any day when that day holds none
18. IF no `Project` exists at all, THEN THE Quick_Log control SHALL open the `Activity_Dialog` in `Open_Mode` with focus on the `Project_Picker` instead of submitting anything
19. THE Activity_Dialog SHALL show the `Logical_Day` field in every mode, the start and end fields in `Explicit_Mode` only, and the duration field in `Duration_Mode` only, laying the field row out as a grid whose column count follows the active mode

### Requirement 7: Activity Editing and Deletion

**User Story:** As a user who mistyped an entry, I want to correct or remove it, so that the log stays accurate.

#### Acceptance Criteria

1. THE Day_Timeline SHALL be the day's list of `Activity_Entry` records: every `Activity_Segment` of the displayed day is drawn as a `Segment_Block` carrying its `Project`, its description where the height allows, its times and its duration, and no separate list of the same records is rendered beside it
2. WHEN an `Activity_Entry` was split into several `Activity_Segment` records, THE Day_Timeline SHALL draw each segment with its own times and SHALL state through the `Split_Marker` that the entry was split around a break
3. WHEN the originally requested interval or duration of an `Activity_Entry` differs from what was stored, THE Activity_Dialog SHALL show the requested values alongside the stored segments when that entry is opened
4. WHEN an `Activity_Entry` is opened for editing, THE Activity_Dialog SHALL be prefilled with its current values
5. WHEN only the description or the `Project` is changed, THE Worklog_UI SHALL save without showing a `Change_Preview`
6. WHEN the interval or the duration is changed, THE Worklog_UI SHALL show a `Change_Preview` before saving
7. THE Worklog_UI SHALL offer deletion of an `Activity_Entry` behind a confirmation that names what will be removed
8. WHEN an `Activity_Entry` is deleted, THE Worklog_UI SHALL update the `Day_Timeline` without a full page reload
9. WHEN the displayed day holds at least one `Orphaned_Entry`, THE day page SHALL show the `Orphan_Panel` listing each of them with its `Project` and its originally requested interval, explaining that nothing of it remains inside the timer frame, because an entry with no `Activity_Segment` cannot appear on the `Day_Timeline` at all
10. IF the displayed day holds no `Orphaned_Entry`, THEN THE day page SHALL NOT render the `Orphan_Panel` at all, rather than rendering it empty
11. THE Orphan_Panel SHALL offer re-entering the times of a listed entry or deleting it, so an `Orphaned_Entry` can never become a record the user cannot reach. The two actions act on the selected row and are drawn once at the foot of the panel rather than repeated per row: at the side column's 290 pixels, a pair of pills on every row costs more height than the rows themselves

### Requirement 8: Timer Frame Editing

**User Story:** As a user who forgot to stop the timer before lunch, I want to correct the frame afterwards, so that the record matches the day I actually had.

#### Acceptance Criteria

1. THE day page SHALL offer an action to add a `Work_Session` for a stretch that was never tracked, in the heading line on desktop and in the mobile create menu
2. WHEN a `Work_Session` is opened for editing, THE Session_Dialog SHALL offer its start and end as editable times, showing a changed value beside the previous one struck through
3. THE Session_Dialog SHALL offer deletion of the `Work_Session` as an inline destructive control, behind a confirmation naming the interval that will be removed
4. WHEN a `Work_Session` change would alter existing `Activity_Segment` records, THE Session_Dialog SHALL show a `Change_Preview` as a distinct confirmation state, replacing the save action with a confirm action and a way back to editing
5. IF a `Work_Session` change would overlap another `Work_Session`, THEN THE Worklog_UI SHALL show which sessions conflict and SHALL NOT save
6. IF a `Work_Session` change would produce a start not before its end, THEN THE Worklog_UI SHALL show the error beside the field and SHALL NOT save
7. WHEN an edge region of a `Session_Rail` is activated, THE Worklog_UI SHALL open the `Session_Dialog` with that edge's field focused and selected, so a boundary is always changed through a field with a `Change_Preview` behind it
8. THE Worklog_UI SHALL NOT offer dragging a `Work_Session` edge on the `Day_Timeline`, because a block's height is proportional only within its block and is clamped at `MIN_BLOCK_PX`, so no pixel-to-minute mapping exists that would not misreport the time being set
9. WHEN a `Work_Session` is changed or removed, THE Worklog_UI SHALL update the `Day_Timeline` without a full page reload
10. WHEN a `Work_Session` is deleted, THE Worklog_UI SHALL show a `Change_Preview` naming every `Activity_Entry` that would lose time and every one that would be emptied

### Requirement 9: Change Preview

**User Story:** As a user about to shorten a session, I want to see what it will do to my logged work before I commit, so that I never lose a record by surprise.

#### Acceptance Criteria

1. THE Change_Preview SHALL take every figure it shows from a `Dry_Run` against the server — including the lost `Uncovered_Time` — and SHALL derive none of them in the browser, neither by recomputing the reconciliation nor from the day data already loaded
2. WHEN a new `Activity_Entry` would be split into several `Activity_Segment` records, THE Change_Preview SHALL show each resulting segment and state how many parts there will be
3. WHEN part of a request falls outside `Tracked_Time`, THE Change_Preview SHALL show which part and how long it is
4. WHEN a `Duration_Mode` request cannot be placed in full, THE Change_Preview SHALL show how many minutes would remain unplaced
5. WHEN a `Work_Session` change would remove time from existing `Activity_Entry` records, THE Change_Preview SHALL name each affected entry and the duration it would lose, showing its segments as they are now beside what they would become
6. THE Change_Preview SHALL state one total — the sum of the duration removed from `Activity_Entry` records and the `Uncovered_Time` that would fall outside `Tracked_Time` — and SHALL break that total into its two parts beneath itself, while any count of affected records SHALL count `Activity_Entry` records only
7. WHEN a `Dry_Run` reports that a `Work_Session` change would leave a stretch of `Uncovered_Time` outside `Tracked_Time`, THE Change_Preview SHALL show that stretch and its duration as a separate row marked as `Uncovered_Time`, described in prose rather than as a before-and-after pair, because it is not an `Activity_Entry`
8. WHEN an `Activity_Entry` would be emptied completely, THE Change_Preview SHALL describe it in prose rather than as a before-and-after pair
9. WHEN a request would be rejected, THE Change_Preview SHALL show the reason and SHALL disable the confirm action
10. WHERE a request falls outside `Tracked_Time`, THE Change_Preview SHALL offer the choice between the `clip` and `extend` values of `Untracked_Policy`, defaulting to `clip`
11. THE Worklog_UI SHALL NOT write anything until the user confirms the `Change_Preview`
12. WHILE the `Dry_Run` is in flight, THE Change_Preview SHALL show a loading state and SHALL keep the confirm action disabled
13. THE Worklog_UI SHALL treat a non-2xx response to a `Dry_Run` as a rejection to display, not as a transport failure
14. WHEN a write is refused because the timer frame changed since the preview, THE Worklog_UI SHALL recompute the preview and ask the user to confirm again
15. THE Worklog_UI SHALL wait for a pause in typing before requesting a new `Dry_Run`, so that editing a field does not exhaust the request budget
16. THE Change_Preview SHALL state that the server computed it, so it is clear that what is shown is what will happen

### Requirement 10: Uncovered Time Guidance

**User Story:** As a user writing up my day, I want the application to tell me which stretches still have no description, so that I know when I am finished.

#### Acceptance Criteria

1. THE day page SHALL state the total `Uncovered_Time` of the displayed day in a summary panel beside the `Day_Timeline`, together with the day's `Tracked_Time`, its `Covered_Time`, a meter of the described share and that share as a percentage
2. THE Day_Timeline SHALL draw each stretch of `Uncovered_Time` of at least `MIN_UNCOVERED_SECONDS` in place, with its times and duration, and no separate list of the same stretches is rendered beside it
3. WHEN a listed stretch is activated, THE Worklog_UI SHALL open the `Activity_Dialog` prefilled with exactly that stretch
4. THE Worklog_UI SHALL apply `MIN_UNCOVERED_SECONDS` as the single threshold everywhere — a shorter stretch is neither drawn on the `Day_Timeline` nor named anywhere — while still counting it in every total
5. WHEN the displayed day has no `Uncovered_Time`, THE Worklog_UI SHALL state that the day is fully described
6. THE timer page SHALL show the `Uncovered_Time` of the current `Logical_Day` as a prompt to finish the log
7. THE Uncovered_Marker SHALL be drawn in four variants, all using the same fill, the same dashed border and the same accent title: on desktop a tall block with a title, the times and an invitation to fill it in, or, at `MIN_BLOCK_PX`, a single row with the title, the times and an action at the right edge; on mobile a two-line block with an action pill when it is at least 44 pixels tall, or, below that, a single row of title and duration whose whole area is the target
8. THE day page SHALL show a second panel beside the `Day_Timeline` giving the shape of the day — the number of `Work_Block` groups, the longest uninterrupted `Work_Session` and the `Tracked_Time` after the `Evening_Hour` — reading all three from the day response and issuing no second request for them

### Requirement 11: Project Management

**User Story:** As a user attributing work, I want to manage the list of projects, so that my logs stay tidy and my statistics group the way I expect.

#### Acceptance Criteria

1. THE projects page SHALL list every `Project` with its total `Covered_Time` over the last thirty `Logical_Day` values, summed from the per-project totals the server returns for that range
2. THE projects page SHALL offer creation of a `Project` by name
3. IF a `Project` name already exists ignoring case and surrounding whitespace, THEN THE Worklog_UI SHALL show the error beside the field and SHALL NOT create a duplicate
4. THE projects page SHALL offer renaming a `Project`
5. THE projects page SHALL offer archiving and unarchiving a `Project`, and SHALL hide archived projects from the list by default
6. THE Project_Picker SHALL offer only non-archived projects
7. THE projects page SHALL offer deletion of a `Project` that no `Activity_Entry` references
8. IF deletion is attempted on a `Project` that is referenced, THEN THE Worklog_UI SHALL explain that it is in use and SHALL offer archiving instead, and THE Worklog_UI SHALL leave the delete control enabled until then, because the list carries no reference count to disable it from
9. THE Worklog_UI SHALL show each `Project` in the `Palette_Slot` named by the `colorIndex` the server returns on every read shape carrying a project, used consistently on the `Day_Timeline`, on the `Day_Gauge`, in the `Project_Picker` and in the statistics, and SHALL NOT resolve that index by joining the projects list in the browser
10. THE projects page SHALL let the user change a `Project` colour from within that project's own row, offering the eight `Palette_Slot` swatches with the current one ringed
11. THE Worklog_UI SHALL show a `Project` name wherever it shows that project's colour, so colour never carries the identity of a project on its own
12. WHEN an `Activity_Entry` being edited references an archived `Project`, THE Project_Picker SHALL offer that project as the current value, marked as archived
13. WHEN no `Project` exists, THE projects page and THE Project_Picker SHALL both offer creating the first one rather than showing an empty control
14. THE projects page SHALL draw each row's bar as that project's share of the range's total `Covered_Time`, the same quantity the statistics breakdown draws

### Requirement 12: Statistics

**User Story:** As a user looking back over a period, I want to see how my time was distributed, so that I can tell where the work actually went.

#### Acceptance Criteria

1. THE statistics page SHALL offer exactly three ranges — a day, a week and a month — through a segmented control, each anchored on the current `Logical_Day` with the week beginning on Monday, naming the resolved date range beside it, and SHALL offer no range longer than a month
2. THE statistics page SHALL present a `KPI_Row` of four figures: the total `Tracked_Time`, the total `Covered_Time`, the described share of `Tracked_Time` as a percentage over a meter, and the total `Overtime` with its share of `Tracked_Time` beneath it
3. THE statistics page SHALL show the `Covered_Time` per `Project` for the selected range, sorted descending, each row carrying the project's swatch, its name, its duration and its share of the range's total `Covered_Time`
4. THE statistics page SHALL draw each project's bar as its share of the range's total `Covered_Time`, so the bar and the printed percentage state the same quantity and a full track means the whole range
5. THE statistics page SHALL show the total `Uncovered_Time` of the range beneath the per-project rows, separated from them, and never as one of the bars
6. WHEN the range covers more than one `Logical_Day`, THE statistics page SHALL show the `Day_Rhythm_Strip` — one strip per `Logical_Day` on a shared axis running from `DAY_START_HOUR` to `DAY_START_HOUR` — drawing each covered interval the server returns in the `Palette_Slot` of the `projectId` that interval carries, at the position the work actually fell
7. THE Day_Rhythm_Strip SHALL take its axis bounds and its axis labels from the `DAY_START_HOUR` the server reports, labelling both ends with that hour and the three interior ticks at even divisions of the span, rather than assuming any fixed hour
8. THE Day_Rhythm_Strip SHALL mark the current `Logical_Day` with an accent label and an accent inset outline, and SHALL draw a day holding no `Tracked_Time` as an empty strip with an em dash in place of its total
9. WHEN a strip of the `Day_Rhythm_Strip` is activated, THE Worklog_UI SHALL navigate to that day page
10. WHEN the range covers more than one `Logical_Day`, THE statistics page SHALL show a rhythm panel giving the number of days worked, the average `Tracked_Time` per day holding at least one `Work_Session`, the longest day, the longest uninterrupted `Work_Session` and the total number of `Work_Block` groups
11. THE statistics page SHALL show how much of the range's `Tracked_Time` fell after the `Evening_Hour` in the rhythm panel, taking that hour from the server rather than assuming it
12. WHEN the selected range holds no records, THE statistics page SHALL show an empty state rather than an empty chart
13. THE statistics page SHALL present every chart's underlying numbers as text as well, so the information does not depend on colour alone
14. THE statistics page SHALL include archived projects that hold time in the selected range, so the per-project figures reconcile with the total
15. WHEN the server reports a suggested window that differs from the configured `Gauge_Window` by more than 30 minutes at either end, THE Worklog_UI SHALL show it as a suggestion, so the window can be fitted to real habits rather than guessed
16. THE Worklog_UI SHALL request the per-day work intervals explicitly when it needs the `Day_Rhythm_Strip`, and IF the server reports them omitted because the range exceeds `MAX_INTERVAL_RANGE_DAYS`, THEN THE statistics page SHALL render every other panel in full, draw no `Day_Rhythm_Strip`, and treat the response as a success rather than an error
17. THE Day_Rhythm_Strip SHALL draw the uncovered intervals the server returns with a hatched fill, so a day whose work was logged but never described is distinguishable from one that was described
18. THE statistics page SHALL close its rhythm panel with exactly one observation line, being the first of the three defined templates whose condition holds, and SHALL omit the line entirely — not substitute other text and not leave blank space — when none of them holds
19. WHEN the suggested window is shown, THE Worklog_UI SHALL present it as a value to set in the server's configuration and restart with, not as a control the interface can apply, because the `Gauge_Window` has no write endpoint
20. WHEN the selected range is a single `Logical_Day`, THE statistics page SHALL omit both the `Day_Rhythm_Strip` and the rhythm panel and SHALL lay the remaining panels out in one column, because a one-row strip shows nothing a day page does not and the observation line has nothing to compare

### Requirement 13: Internationalization

**User Story:** As a Czech speaker who sometimes shows the tool to others, I want the interface in Czech by default and switchable to English, so that it reads naturally to whoever is looking.

#### Acceptance Criteria

1. THE Worklog_UI SHALL provide every user-facing string in Czech and English through Paraglide message keys
2. THE Worklog_UI SHALL contain no user-facing literal text outside the message files
3. THE Worklog_UI SHALL render the language the server resolved and reported, and SHALL NOT resolve a language itself — the server reads the `worklog_locale` cookie, falls back to `Accept-Language` and falls back again to Czech
4. WHEN the `Locale_Switcher` changes the language, THE Worklog_UI SHALL apply it without reloading the page, without a visible flash, and without losing scroll position, and SHALL write it to the `worklog_locale` cookie
5. THE Worklog_UI SHALL persist the chosen language and SHALL apply it on the next visit
6. THE Worklog_UI SHALL keep the `lang` attribute of the document in step with the active language
7. THE Worklog_UI SHALL format dates, times and durations according to the active language, offering four duration forms — the running clock, the full duration, the unit-less short form and the compact signed form — and using each only where this specification names it
8. WHEN the server returns an error carrying a message key, THE Worklog_UI SHALL render the translation of that key
9. THE Worklog_UI SHALL carry no language prefix in any URL, because the language lives in the `worklog_locale` cookie and a second source of truth would let the two disagree
10. THE Locale_Switcher SHALL indicate the active language
11. THE Worklog_UI SHALL render the `messageKey` field of a server error and SHALL never display the raw `error` code to the user
12. THE Worklog_UI SHALL render every message carrying a count through a plural rule for the active language, so Czech selects between its one, few and other forms — `2 záznamy`, `5 záznamů`, `část 2 ze 3`, `6 ze 7 dnů`
13. THE Worklog_UI SHALL place no verb after a number in any message, because Czech verb agreement would then depend on the count as well as the noun
14. WHEN a page is server-rendered, THE Worklog_UI SHALL emit the document `lang` attribute from the language the server resolved, so hydration never switches the language visibly

### Requirement 14: Responsiveness, Interaction and Accessibility

**User Story:** As a user who starts the timer on a phone and writes the log on a desktop, I want the interface to work properly on both.

#### Acceptance Criteria

1. THE Worklog_UI SHALL render without horizontal page scrolling at viewport widths from 320 pixels upwards
2. THE Worklog_UI SHALL give every interactive control an activation area of at least 44 by 44 pixels, counted including its padding or a transparent pseudo-element, while its drawn shape may be smaller — the `Design_Contract` draws chips at 30, close buttons and icon buttons at 32, day controls and segmented items at 34 and dialog buttons at 42. The `Segment_Block` elements of the `Day_Timeline` follow criterion 3 instead
3. THE Segment_Block SHALL be at least `MIN_BLOCK_PX` tall and SHALL span the full width of its column, because a twenty-minute task has to stay readable and clickable while a fourteen-hour day still fits on one screen — at 44 pixels a long day stretches past any viewport. The edge regions of a `Session_Rail` take the same exception for the same reason, and are omitted entirely below a block height of 60 pixels, where the `Session_Dialog` is still reachable from the block itself
4. THE Worklog_UI SHALL show a pointer cursor and a distinct hover, active and disabled state on every interactive element, derived from its resting tokens by one rule that holds across the whole interface rather than chosen per control
5. THE Worklog_UI SHALL make every action reachable and operable by keyboard alone, with a visible focus indicator that separates the accent ring from the element beneath it by a ring of the surrounding background, so the indicator stays visible on an accent-filled control and on a `Palette_Slot` tint in both themes
6. THE Worklog_UI SHALL use only SVG icons
7. THE Worklog_UI SHALL take every spacing, size and radius from the `Design_Contract`, and SHALL use the 4, 8, 12, 16, 24, 32, 48, 64 pixel scale only where the `Design_Contract` states no value
8. THE Worklog_UI SHALL animate hover states over about 200 milliseconds and panels over about 300 milliseconds
9. WHEN the user has asked for reduced motion, THE Worklog_UI SHALL disable non-essential animation
10. THE Worklog_UI SHALL meet a contrast ratio of at least 4.5 to 1 for body text in both themes
11. THE Worklog_UI SHALL convey no information by colour alone
12. THE Worklog_UI SHALL be built mobile-first, with 768 pixels as the single breakpoint between the phone and desktop layouts
13. THE Worklog_UI SHALL mark every required form field as required
14. WHEN the user navigates away from a form holding unsaved input, THE Worklog_UI SHALL ask for confirmation first
15. WHEN the viewport is narrower than 768 pixels, THE Activity_Dialog and THE Session_Dialog SHALL fill the screen rather than float as a panel, stacking their fields one per row and pinning their footer to the bottom edge
16. THE Worklog_UI SHALL persist the viewport width in a cookie and SHALL resolve the density and the height available to the `Day_Timeline` from it on the server, defaulting to a 1440 by 900 desktop viewport when no cookie exists, so a server-rendered page is deterministic
17. WHEN the client measures a viewport that differs from the cookie, THE Worklog_UI SHALL update the cookie and lay the page out again, and SHALL do nothing when it matches
18. THE Worklog_UI SHALL expose every segmented control as a radio group, so the keyboard reaches the group once and the arrow keys move between its options
19. THE Worklog_UI SHALL take its icons from the artboards, which are the source of truth for their geometry, and SHALL NOT substitute an icon set
20. WHILE the `Activity_Dialog`, the `Session_Dialog` or a confirmation dialog is open, THE Worklog_UI SHALL render it with `role="dialog"`, `aria-modal="true"` and an `aria-labelledby` naming its own heading
21. WHEN a dialog opens, THE Worklog_UI SHALL move focus into it — to the field named by the action that opened it where there is one, otherwise to its first focusable control — and SHALL confine Tab and Shift+Tab to the dialog until it closes
22. THE Activity_Dialog, THE Session_Dialog and every confirmation dialog SHALL close on Escape and SHALL return focus to the control that opened them
23. THE Worklog_UI SHALL NOT dismiss a write dialog when its scrim is activated, because the dialog holds unsaved input and criterion 14 forbids losing it to a stray click; a confirmation dialog and the `Settings_Menu` SHALL close on an outside activation
24. WHILE any modal surface is open — a write dialog, a confirmation, or the mobile `Settings_Menu` sheet — THE Worklog_UI SHALL prevent the document beneath from scrolling and SHALL mark it `inert`, so that pointer, keyboard and screen reader all reach only that surface
25. WHEN the viewport is narrower than 768 pixels, THE statistics page SHALL lay the `KPI_Row` out as two columns, SHALL stack the breakdown and the rhythm panel, and SHALL label the `Day_Rhythm_Strip` axis with three labels instead of five; THE projects page SHALL lay each row out as two lines with its actions behind one overflow control

### Requirement 15: Feedback, Loading and Error States

**User Story:** As a user, I want to know what the application is doing and what went wrong, so that I am never left guessing whether something saved.

#### Acceptance Criteria

1. WHILE a client-side navigation or a data invalidation is fetching a page's data, THE Worklog_UI SHALL show a skeleton shaped like the content rather than a spinner; a server-rendered first load arrives complete and needs none
2. WHILE a submitted action is in flight, THE Worklog_UI SHALL disable the submit control and show progress on it
3. WHEN an action succeeds, THE Worklog_UI SHALL confirm it briefly without demanding a dismissal
4. WHEN an action fails, THE Worklog_UI SHALL show the reason and SHALL keep the user's input intact
5. WHEN the server reports an overlap conflict, THE Worklog_UI SHALL name the conflicting records and offer to open one of them
6. WHEN a write succeeds but part of it was discarded or left unplaced, THE Worklog_UI SHALL report that explicitly rather than presenting an unqualified success
7. IF the server is unreachable, THEN THE Worklog_UI SHALL say so and offer to retry without losing the user's input
8. THE Worklog_UI SHALL show a confirmation before any destructive action, naming what will be lost
9. THE Worklog_UI SHALL map every error code defined by `001-worklog-domain-api` to a behaviour, including `NOT_FOUND`, `NOTHING_TO_LOG`, `RANGE_TOO_LARGE`, `PAYLOAD_TOO_LARGE`, `STALE_PREVIEW`, `PROJECT_ARCHIVED`, `FUTURE_TIMESTAMP`, `INTERVAL_TOO_SHORT`, `SERVICE_UNAVAILABLE` and `INTERNAL_ERROR`
10. THE projects page SHALL show an empty state when no `Project` exists
11. WHEN an uncaught client-side error occurs, THE Worklog_UI SHALL report it through the same error surface as a failed request rather than leaving a blank page
12. WHEN a write is rejected for a named field, THE Worklog_UI SHALL render the message key the server supplied for that field beside the field, and SHALL NOT display the validator's own English text
13. THE Worklog_UI SHALL render the toast container as a live region present in the document before any toast is inserted — `role="status"` with `aria-live="polite"` for a success and `role="alert"` with `aria-live="assertive"` for a failure, each toast `aria-atomic="true"` — because a live region created at the moment its message arrives is not announced
14. WHEN a `Dry_Run` settles, THE Change_Preview SHALL announce its headline outcome once, politely, and SHALL NOT announce the intermediate states of a debounced sequence
15. THE Worklog_UI SHALL announce no ticking value: the hero elapsed readout, the `Running_Indicator` and the browser tab title SHALL sit in no live region and SHALL have their digits hidden from assistive technology, and the state of the timer SHALL be carried instead by the accessible name of the `Timer_Control` and by the `Day_Gauge`'s text alternative, both of which change only when the timer starts or stops

### Requirement 16: Day Gauge

**User Story:** As a user with the timer page open all day, I want the shape of my day readable at a glance, so that I can see when I worked and whether I ran past my usual hours without reading a single number.

#### Acceptance Criteria

1. THE Day_Gauge SHALL map twenty-four hours onto a full circle, so that one hour occupies 15 degrees and a given time of day always sits at the same angle
2. THE Day_Gauge SHALL draw the `Gauge_Track` over the `Gauge_Window` only, leaving the `Gauge_Gap` bare
3. THE Day_Gauge SHALL place the `Gauge_Gap` at the bottom of the circle, so the reading runs from a visible start on one side to a visible end on the other
4. THE Day_Gauge SHALL draw an outer arc for `Work_Session` records at a radius of 138 and a stroke of 10, and an inner arc for `Activity_Segment` records at a radius of 118 and a stroke of 6, coloured by `Project`
5. THE Day_Gauge SHALL draw a closed `Work_Session` in the muted arc ink and the `Open_Session` in the accent colour, so the accent marks a running timer rather than overtime
6. THE Day_Gauge SHALL draw `Uncovered_Time` on the inner arc with a dashed stroke of the accent colour at reduced opacity, using the dash pattern and round cap of the `Design_Contract`
7. THE Day_Gauge SHALL graduate the `Gauge_Track` at three levels — a short mark every hour, a longer mark every three hours, and the longest every six hours at 06, 12, 18 and 00 — each level with its own length, width and ink
8. THE Day_Gauge SHALL label every third hour with a two-digit numeral outside the graduations, never with minutes
9. THE Day_Gauge SHALL NOT graduate or number the `Gauge_Gap`, so that work falling there reads as leaving the expected window rather than continuing along a scale
10. WHEN `Tracked_Time` falls outside the `Gauge_Window` at either end, THE Day_Gauge SHALL draw each such stretch as an `Overtime_Arc` in the `Gauge_Gap` without clipping or rescaling anything, so a day that began before the window and ran past its end shows two of them
11. WHEN an `Overtime_Arc` is present, THE Day_Gauge SHALL mark the `Gauge_Track` end it left with a filled dot and SHALL label that arc's far end with the time it reached, once for each `Overtime_Arc`, because the `Gauge_Gap` carries no scale to read from
12. WHEN `Tracked_Time` covers the whole `Logical_Day`, THE Day_Gauge SHALL close into a complete circle, and SHALL still leave the `Gauge_Gap` ungraduated
13. THE Day_Gauge SHALL place the start and stop control at the exact centre of the circle, at the size and with the halo given by the `Design_Contract`, keeping clear space between it and the inner arc
14. THE Day_Gauge SHALL show the elapsed time of the `Open_Session` above the circle, not inside it
15. THE Day_Gauge SHALL render its numerals well below the contrast required of body text, so the dial reads as background orientation rather than as data
16. WHEN an inner arc is hovered, THE Day_Gauge SHALL show a label naming the `Project` and the times of that arc, as an enhancement over the `Project_Legend`, which is what carries project identity in text
17. THE Day_Gauge SHALL take the `Gauge_Window` from the server rather than assuming it
18. THE Worklog_UI SHALL use the same angular mapping on every `Day_Gauge`, so two days can be compared by shape alone
19. THE Day_Gauge SHALL expose itself as a single image with a text alternative summarising the day — worked, described and undescribed totals and whether the timer is running — and SHALL mark its arcs as decorative, because an SVG path is not focusable and a per-arc reading would be unusable

### Requirement 17: Visual Design and Theming

**User Story:** As the user of an application I look at all day, I want it to look the way it was designed and to follow the light or dark setting of my system, so that it is readable at three in the afternoon and at three in the morning.

#### Acceptance Criteria

1. THE Worklog_UI SHALL implement both the `dark` and the `light` `Theme`, each defining the complete token set: background, text, dim text, faint text, accent, accent hover, ink on accent, panel, dialog, scrim, field, active field, divider and destructive
2. THE Worklog_UI SHALL declare the `Design_Tokens` once as CSS custom properties, and SHALL derive every colour it draws from those properties rather than from a literal value at the point of use
3. THE Worklog_UI SHALL use higher opacities for dim and faint text in the `light` `Theme` than in the `dark` one, because the dark theme's values fall below the contrast required by criterion 14.10 against the light background
4. THE Theme_Switcher SHALL offer three values of `Theme_Preference` — `system`, `light` and `dark` — and THE Worklog_UI SHALL default to `system`
5. WHILE the `Theme_Preference` is `system`, THE Worklog_UI SHALL resolve the `Theme` from `prefers-color-scheme`, resolving to `dark` when the browser expresses none, and SHALL follow a change of that setting without a reload
6. THE Theme_Switcher SHALL change the active `Theme` without reloading the page and SHALL write the chosen `Theme_Preference` to the `worklog_theme` cookie, which is the only write to that cookie the interface ever makes
7. WHILE the `Theme_Preference` is `system`, THE Worklog_UI SHALL write the `Theme` it resolved from `prefers-color-scheme` to the `worklog_theme_resolved` cookie, and SHALL rewrite it whenever that media query changes
8. WHEN a page is server-rendered, THE Worklog_UI SHALL emit the `Theme` named by `worklog_theme`, or, when that names `system`, the one in `worklog_theme_resolved`, so the first bytes carry the right theme
9. IF neither cookie can answer, THEN THE Worklog_UI SHALL render `DEFAULT_RENDER_THEME` and correct it once on hydration, this being the only flash the interface permits, because a server cannot know a system preference the browser has never reported
10. THE Worklog_UI SHALL store nothing that affects the first paint in `localStorage`, because the server cannot read it — the `Theme_Preference`, the resolved `Theme`, the active language and the viewport width are all cookies named `worklog_theme`, `worklog_theme_resolved`, `worklog_locale` and `worklog_viewport`
11. THE Worklog_UI SHALL style destructive controls from the destructive token and SHALL NOT style them from any `Palette_Slot`, and SHALL NOT style any `Palette_Slot` swatch from the destructive token, because the pink slot and the destructive colour are close enough to be confused
12. THE Worklog_UI SHALL use the accent colour for both primary actions and `Uncovered_Time`, and SHALL distinguish the two by shape — a filled control against a dashed outline — never by colour alone
13. THE Worklog_UI SHALL set no CSS through an inline `style` attribute, so that the `Content-Security-Policy` served by `001-worklog-domain-api` needs no `unsafe-inline`
14. THE Worklog_UI SHALL apply a `Palette_Slot` through one precompiled class per slot, and SHALL apply a computed block height through a precompiled class from a fixed ladder of heights
15. THE Worklog_UI SHALL render every text style — family, weight, size, letter spacing and case — as the `Design_Contract` states, and SHALL render every numeric readout with tabular figures
16. THE Worklog_UI SHALL match the layout, proportions and palette of the artboards in `.design/artboards/` when rendered at the artboard's frame size, comparing arrangement and relative proportion rather than exact pixel heights, and excepting copy and example data — the block heights drawn in an artboard illustrate the layout algorithm rather than fixing its output
