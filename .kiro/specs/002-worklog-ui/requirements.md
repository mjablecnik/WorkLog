# Requirements Document

## Introduction

This specification covers the browser interface of the Worklog SvelteKit application at `worklog/` — everything under `src/routes/` other than `src/routes/api/`, the feature modules in `src/modules/`, and the shared design system in `src/lib/ui/`. The server-side domain, data layer and REST API it builds on are specified in `001-worklog-domain-api`.

The interface has one job the server cannot do: make a working day **visible**. During the day the user only presses start and stop, so the interface must make that one action immediate and unambiguous. In the evening the user describes what they did, and the interface must show which stretches of the day are still unexplained, make filling them cheap, and — because the server reconciles every write against the timer frame — show what a change will do *before* it is saved.

The reconciliation is the reason a plain list is not enough. An activity logged as one three-hour block may be stored as two segments with a break between them, and shortening a timer session may silently remove time from activities logged against it. Both are shown on a shared time axis, and both are previewed through the server's `Dry_Run` before anything is written.

The interface is Czech-first with English as a fallback, works on a phone as well as a desktop, and is used by exactly one person who is already logged in on their own device.

## Glossary

Terms carried over from `001-worklog-domain-api` keep their meaning there: **Work_Session**, **Activity_Entry**, **Activity_Segment**, **Tracked_Time**, **Untracked_Time**, **Covered_Time**, **Uncovered_Time**, **Logical_Day**, **Explicit_Mode**, **Duration_Mode**, **Open_Mode**, **Placement_Anchor**, **Uncovered_Policy**, **Dry_Run**, **Open_Session**, **Project**.

- **Worklog_UI**: The browser interface of the application — `src/routes/` excluding `src/routes/api/`, plus `src/modules/` and `src/lib/ui/`
- **Timer_Control**: The start and stop control together with the elapsed readouts, shown on the timer page
- **Day_Timeline**: The shared-axis visualization of one `Logical_Day`, made of the `Frame_Lane` and the `Activity_Lane`
- **Frame_Lane**: The `Day_Timeline` lane drawing `Work_Session` records, where the gaps between bars are the breaks
- **Activity_Lane**: The `Day_Timeline` lane drawing `Activity_Segment` records, coloured by `Project`
- **Uncovered_Marker**: The visual treatment of `Uncovered_Time` on the `Day_Timeline` — time inside `Tracked_Time` that no `Activity_Segment` describes
- **Activity_Dialog**: The overlay for creating and editing an `Activity_Entry`
- **Session_Dialog**: The overlay for editing or deleting a `Work_Session`
- **Change_Preview**: The part of a dialog that shows the outcome returned by a `Dry_Run` before the user confirms
- **Project_Picker**: The control for choosing a `Project`, with search and inline creation
- **Quick_Log**: The one-tap control that records an `Activity_Entry` in `Open_Mode`, letting the server resolve the interval from the `Placement_Anchor` to the current time
- **Palette_Slot**: One of the eight validated categorical colours a `Project` can hold
- **Locale_Switcher**: The control that changes the interface language between Czech and English
- **Design_System**: The shared component library in `src/lib/ui/`

## Requirements

### Requirement 1: Application Shell and Navigation

**User Story:** As a user opening the application, I want a consistent frame around every page, so that I can reach the timer, the day, my projects and the statistics without hunting.

#### Acceptance Criteria

1. THE Worklog_UI SHALL present a persistent navigation offering the timer page, the current `Logical_Day`, the projects page and the statistics page
2. WHEN the viewport is narrower than 768 pixels, THE Worklog_UI SHALL collapse the navigation into a bottom bar reachable with one thumb
3. WHEN a navigation target is the active page, THE Worklog_UI SHALL mark it as current both visually and with `aria-current`
4. THE Worklog_UI SHALL show the `Locale_Switcher` and a logout control in the shell on every authenticated page
5. WHILE an `Open_Session` exists, THE Worklog_UI SHALL display a running indicator in the shell on every page
6. WHEN the application is opened at the root path, THE Worklog_UI SHALL show the timer page
7. THE Worklog_UI SHALL render an error page for an unknown route offering a link back to the timer page

### Requirement 2: Authentication

**User Story:** As the only user, I want to unlock the application once on my device and stay in, so that daily use costs no ceremony.

#### Acceptance Criteria

1. WHEN an unauthenticated visitor opens any page other than the login page, THE Worklog_UI SHALL redirect to the login page
2. THE login page SHALL offer a single passphrase field and SHALL submit it as a form action
3. IF the passphrase is wrong, THEN THE Worklog_UI SHALL show one generic message that does not reveal whether any credential exists
4. WHEN the passphrase is accepted, THE Worklog_UI SHALL redirect to the page the visitor originally requested, or to the timer page when there was none
5. WHEN the user activates the logout control, THE Worklog_UI SHALL end the session and return to the login page
6. IF a request fails because the session expired, THEN THE Worklog_UI SHALL redirect to the login page with a message explaining that the session ended

### Requirement 3: Timer Page

**User Story:** As a user starting work, I want one obvious control to start and stop the timer, so that tracking never interrupts what I am about to do.

#### Acceptance Criteria

1. WHEN no `Open_Session` exists, THE Timer_Control SHALL present a single start action
2. WHEN an `Open_Session` exists, THE Timer_Control SHALL present a single stop action
3. WHILE an `Open_Session` exists, THE Timer_Control SHALL display the elapsed time of that session, updating at least once per second
4. THE Timer_Control SHALL display the total `Tracked_Time` of the current `Logical_Day`
5. THE Timer_Control SHALL display the total `Uncovered_Time` of the current `Logical_Day`
6. THE Worklog_UI SHALL take the authoritative timer state from the server on page load rather than from anything stored in the browser
7. WHILE an `Open_Session` exists, THE Worklog_UI SHALL show the running elapsed time in the browser tab title
8. WHEN the browser tab regains focus, THE Worklog_UI SHALL refresh the timer state from the server
9. IF starting or stopping fails, THEN THE Worklog_UI SHALL restore the previous state and show the reason
10. THE timer page SHALL show a compact `Day_Timeline` of the current `Logical_Day`
11. THE timer page SHALL offer the `Quick_Log` action
12. THE Timer_Control SHALL be operable from the keyboard, with the start and stop action reachable by tab and activated by both Enter and Space

### Requirement 4: Day Timeline

**User Story:** As a user reviewing a day, I want the timer frame and my logged activities drawn on one time axis, so that I can see at a glance when I worked and what I was doing.

#### Acceptance Criteria

1. THE Day_Timeline SHALL draw the `Frame_Lane` and the `Activity_Lane` against one shared time axis
2. THE Day_Timeline SHALL span at least the range from the earliest to the latest record of the `Logical_Day`, and SHALL label the axis at regular whole-hour intervals
3. THE Frame_Lane SHALL draw one bar per `Work_Session`, leaving `Untracked_Time` visibly empty
4. THE Activity_Lane SHALL draw one bar per `Activity_Segment`, coloured by its `Project`
5. WHEN one `Activity_Entry` produced several `Activity_Segment` records, THE Activity_Lane SHALL make their shared identity visible
6. THE Day_Timeline SHALL apply the `Uncovered_Marker` to every stretch of `Uncovered_Time`
7. WHILE an `Open_Session` exists on the displayed day, THE Frame_Lane SHALL draw it as continuing to the current time and SHALL mark it as still running
8. WHEN a bar is hovered or focused, THE Day_Timeline SHALL show its times, its `Project` and its description
9. WHEN an `Activity_Segment` bar is activated, THE Worklog_UI SHALL open the `Activity_Dialog` for its `Activity_Entry`
10. WHEN a `Work_Session` bar is activated, THE Worklog_UI SHALL open the `Session_Dialog` for it
11. WHEN a stretch carrying the `Uncovered_Marker` is activated, THE Worklog_UI SHALL open the `Activity_Dialog` in `Explicit_Mode` prefilled with exactly that stretch
12. WHEN the viewport is narrower than 768 pixels, THE Day_Timeline SHALL lay the time axis out vertically
13. THE Day_Timeline SHALL be navigable by keyboard, moving focus between bars in chronological order
14. WHEN the `Logical_Day` holds no records, THE Day_Timeline SHALL show an empty state inviting the user to start the timer

### Requirement 5: Day Navigation

**User Story:** As a user filling in yesterday's log, I want to move between days, so that I can work on a day other than today.

#### Acceptance Criteria

1. THE day page SHALL be addressed by a date in the URL so that a particular day can be bookmarked and reloaded
2. THE Worklog_UI SHALL offer a previous-day and a next-day control, and a date picker
3. WHEN the displayed day is the current `Logical_Day`, THE Worklog_UI SHALL disable the next-day control
4. THE Worklog_UI SHALL label the current `Logical_Day` as today rather than by date alone
5. IF the date in the URL is not a valid `YYYY-MM-DD` value, THEN THE Worklog_UI SHALL show the error page

### Requirement 6: Activity Creation

**User Story:** As a user writing up my day, I want to record what I worked on either by exact times or by how long it took, so that I can log accurately without reconstructing times I no longer remember.

#### Acceptance Criteria

1. THE day page SHALL offer an action that opens the `Activity_Dialog` for a new `Activity_Entry`
2. THE Activity_Dialog SHALL offer a choice between `Explicit_Mode` and `Duration_Mode`, and SHALL reach `Open_Mode` through the `Quick_Log` control rather than as a third choice in the dialog
3. WHILE in `Explicit_Mode`, THE Activity_Dialog SHALL require a start time and an end time
4. WHILE in `Duration_Mode`, THE Activity_Dialog SHALL require a duration and SHALL leave the start optional
5. WHILE in `Duration_Mode` with no start given, THE Activity_Dialog SHALL show which start the server will infer
6. THE Activity_Dialog SHALL require a `Project` and SHALL accept an optional description
7. THE Activity_Dialog SHALL offer the `Project_Picker` with search and the ability to create a `Project` without leaving the dialog
8. THE Activity_Dialog SHALL default the `Project` and description to those of the most recent `Activity_Entry` of the displayed day
9. THE Activity_Dialog SHALL validate the input in the browser before submitting, showing messages beside the field concerned without clearing what was typed
10. WHEN the `Quick_Log` action is used, THE Worklog_UI SHALL submit the entry in `Open_Mode`, letting the server resolve the start from the `Placement_Anchor` and the end from the current time, rather than computing either in the browser
11. THE Quick_Log control SHALL state the interval the server will use before it is activated, and SHALL let the user open the full `Activity_Dialog` instead
12. WHEN an `Activity_Entry` is created, THE Worklog_UI SHALL update the `Day_Timeline` without a full page reload
13. THE Activity_Dialog SHALL be dismissable with the Escape key and SHALL return focus to the control that opened it

### Requirement 7: Activity Editing and Deletion

**User Story:** As a user who mistyped an entry, I want to correct or remove it, so that the log stays accurate.

#### Acceptance Criteria

1. THE day page SHALL list every `Activity_Entry` of the displayed day with its `Project`, description, times and total duration
2. WHEN an `Activity_Entry` was split into several `Activity_Segment` records, THE Worklog_UI SHALL show each segment's times and state that the entry was split around a break
3. THE Worklog_UI SHALL show the originally requested interval or duration alongside the stored segments whenever the two differ
4. WHEN an `Activity_Entry` is opened for editing, THE Activity_Dialog SHALL be prefilled with its current values
5. WHEN only the description or the `Project` is changed, THE Worklog_UI SHALL save without showing a `Change_Preview`
6. WHEN the interval or the duration is changed, THE Worklog_UI SHALL show a `Change_Preview` before saving
7. THE Worklog_UI SHALL offer deletion of an `Activity_Entry` behind a confirmation that names what will be removed
8. WHEN an `Activity_Entry` is deleted, THE Worklog_UI SHALL update the `Day_Timeline` without a full page reload

### Requirement 8: Timer Frame Editing

**User Story:** As a user who forgot to stop the timer before lunch, I want to correct the frame afterwards, so that the record matches the day I actually had.

#### Acceptance Criteria

1. THE day page SHALL offer an action to add a `Work_Session` for a stretch that was never tracked
2. WHEN a `Work_Session` is opened for editing, THE Session_Dialog SHALL offer its start and end as editable times
3. THE Session_Dialog SHALL offer deletion of the `Work_Session`
4. WHEN a `Work_Session` change would alter existing `Activity_Segment` records, THE Worklog_UI SHALL show a `Change_Preview` before saving
5. IF a `Work_Session` change would overlap another `Work_Session`, THEN THE Worklog_UI SHALL show which sessions conflict and SHALL NOT save
6. IF a `Work_Session` change would produce a start not before its end, THEN THE Worklog_UI SHALL show the error beside the field and SHALL NOT save
7. WHEN the viewport is at least 768 pixels wide, THE Frame_Lane SHALL allow a `Work_Session` edge to be dragged, snapping to five-minute steps
8. WHEN a drag is released, THE Worklog_UI SHALL show a `Change_Preview` before committing the change
9. WHEN a `Work_Session` is changed or removed, THE Worklog_UI SHALL update both lanes of the `Day_Timeline` without a full page reload

### Requirement 9: Change Preview

**User Story:** As a user about to shorten a session, I want to see what it will do to my logged work before I commit, so that I never lose a record by surprise.

#### Acceptance Criteria

1. THE Change_Preview SHALL be produced by a `Dry_Run` against the server, never by recomputing the reconciliation in the browser
2. WHEN a new `Activity_Entry` would be split into several `Activity_Segment` records, THE Change_Preview SHALL show each resulting segment and state how many parts there will be
3. WHEN part of a request falls outside `Tracked_Time`, THE Change_Preview SHALL show which part and how long it is
4. WHEN a `Duration_Mode` request cannot be placed in full, THE Change_Preview SHALL show how many minutes would remain unplaced
5. WHEN a `Work_Session` change would remove time from existing `Activity_Entry` records, THE Change_Preview SHALL name each affected entry and the duration it would lose
6. THE Change_Preview SHALL state the total duration that would be removed across all affected entries
7. WHEN a request would be rejected, THE Change_Preview SHALL show the reason and SHALL disable the confirm action
8. WHERE a request falls outside `Tracked_Time`, THE Change_Preview SHALL offer the choice between the `clip` and `extend` values of `Uncovered_Policy`, defaulting to `clip`
9. THE Worklog_UI SHALL NOT write anything until the user confirms the `Change_Preview`
10. WHILE the `Dry_Run` is in flight, THE Change_Preview SHALL show a loading state and SHALL keep the confirm action disabled

### Requirement 10: Uncovered Time Guidance

**User Story:** As a user writing up my day, I want the application to tell me which stretches still have no description, so that I know when I am finished.

#### Acceptance Criteria

1. THE day page SHALL state the total `Uncovered_Time` of the displayed day
2. THE day page SHALL list each stretch of `Uncovered_Time` with its times and duration
3. WHEN a listed stretch is activated, THE Worklog_UI SHALL open the `Activity_Dialog` prefilled with exactly that stretch
4. THE Worklog_UI SHALL omit stretches shorter than five minutes from the list, while still counting them in the total
5. WHEN the displayed day has no `Uncovered_Time`, THE Worklog_UI SHALL state that the day is fully described
6. THE timer page SHALL show the `Uncovered_Time` of the current `Logical_Day` as a prompt to finish the log

### Requirement 11: Project Management

**User Story:** As a user attributing work, I want to manage the list of projects, so that my logs stay tidy and my statistics group the way I expect.

#### Acceptance Criteria

1. THE projects page SHALL list every `Project` with its total `Covered_Time` over the last thirty `Logical_Day` values
2. THE projects page SHALL offer creation of a `Project` by name
3. IF a `Project` name already exists ignoring case and surrounding whitespace, THEN THE Worklog_UI SHALL show the error beside the field and SHALL NOT create a duplicate
4. THE projects page SHALL offer renaming a `Project`
5. THE projects page SHALL offer archiving and unarchiving a `Project`, and SHALL hide archived projects from the list by default
6. THE Project_Picker SHALL offer only non-archived projects
7. THE projects page SHALL offer deletion of a `Project` that no `Activity_Entry` references
8. IF deletion is attempted on a `Project` that is referenced, THEN THE Worklog_UI SHALL explain that it is in use and SHALL offer archiving instead
9. THE Worklog_UI SHALL show each `Project` in the stable colour the server assigned it, used consistently on the `Activity_Lane`, in the `Project_Picker` and in the statistics
10. THE projects page SHALL let the user change a `Project` colour by choosing from the eight palette slots
11. THE Worklog_UI SHALL show a `Project` colour beside its name, never as the only way to tell two projects apart

### Requirement 12: Statistics

**User Story:** As a user looking back over a period, I want to see how my time was distributed, so that I can tell where the work actually went.

#### Acceptance Criteria

1. THE statistics page SHALL offer a day, a week and a month range
2. THE statistics page SHALL show the total `Tracked_Time` and the total `Covered_Time` of the selected range
3. THE statistics page SHALL show the share of `Tracked_Time` that is described, as a percentage
4. THE statistics page SHALL show the `Covered_Time` per `Project` for the selected range, using each project's assigned colour
5. WHEN the range covers more than one `Logical_Day`, THE statistics page SHALL show one bar per day, stacked by `Project`
6. WHEN the range covers more than one `Logical_Day`, THE statistics page SHALL show the average `Tracked_Time` per day that holds at least one `Work_Session`
7. WHEN a day in a multi-day chart is activated, THE Worklog_UI SHALL navigate to that day page
8. WHEN the selected range holds no records, THE statistics page SHALL show an empty state rather than an empty chart
9. THE statistics page SHALL present every chart's underlying numbers as text as well, so the information does not depend on colour alone

### Requirement 13: Internationalization

**User Story:** As a Czech speaker who sometimes shows the tool to others, I want the interface in Czech by default and switchable to English, so that it reads naturally to whoever is looking.

#### Acceptance Criteria

1. THE Worklog_UI SHALL provide every user-facing string in Czech and English through Paraglide message keys
2. THE Worklog_UI SHALL contain no user-facing literal text outside the message files
3. THE Worklog_UI SHALL default to Czech when the browser expresses no usable preference
4. WHEN the `Locale_Switcher` changes the language, THE Worklog_UI SHALL apply it without reloading the page, without a visible flash, and without losing scroll position
5. THE Worklog_UI SHALL persist the chosen language and SHALL apply it on the next visit
6. THE Worklog_UI SHALL keep the `lang` attribute of the document in step with the active language
7. THE Worklog_UI SHALL format dates, times and durations according to the active language
8. WHEN the server returns an error carrying a message key, THE Worklog_UI SHALL render the translation of that key

### Requirement 14: Responsiveness, Interaction and Accessibility

**User Story:** As a user who starts the timer on a phone and writes the log on a desktop, I want the interface to work properly on both.

#### Acceptance Criteria

1. THE Worklog_UI SHALL render without horizontal page scrolling at viewport widths from 320 pixels upwards
2. THE Worklog_UI SHALL give every interactive control a touch target of at least 44 by 44 pixels
3. THE Worklog_UI SHALL show a pointer cursor and a distinct hover and active state on everything clickable
4. THE Worklog_UI SHALL make every action reachable and operable by keyboard alone, with a visible focus indicator
5. THE Worklog_UI SHALL use only SVG icons
6. THE Worklog_UI SHALL space elements on a 4, 8, 12, 16, 24, 32, 48, 64 pixel scale
7. THE Worklog_UI SHALL animate hover states over about 200 milliseconds and panels over about 300 milliseconds
8. WHEN the user has asked for reduced motion, THE Worklog_UI SHALL disable non-essential animation
9. THE Worklog_UI SHALL meet a contrast ratio of at least 4.5 to 1 for body text in both themes
10. THE Worklog_UI SHALL convey no information by colour alone

### Requirement 15: Feedback, Loading and Error States

**User Story:** As a user, I want to know what the application is doing and what went wrong, so that I am never left guessing whether something saved.

#### Acceptance Criteria

1. WHILE a page's data is loading for the first time, THE Worklog_UI SHALL show a skeleton shaped like the content rather than a spinner
2. WHILE a submitted action is in flight, THE Worklog_UI SHALL disable the submit control and show progress on it
3. WHEN an action succeeds, THE Worklog_UI SHALL confirm it briefly without demanding a dismissal
4. WHEN an action fails, THE Worklog_UI SHALL show the reason and SHALL keep the user's input intact
5. WHEN the server reports an overlap conflict, THE Worklog_UI SHALL name the conflicting records and offer to open one of them
6. WHEN a write succeeds but part of it was discarded or left unplaced, THE Worklog_UI SHALL report that explicitly rather than presenting an unqualified success
7. IF the server is unreachable, THEN THE Worklog_UI SHALL say so and offer to retry without losing the user's input
8. THE Worklog_UI SHALL show a confirmation before any destructive action, naming what will be lost
