# Design Document: Worklog UI

## Overview

The `Worklog_UI` is the browser half of the Worklog SvelteKit application. It reads through load functions, writes through form actions, and reaches the REST routes from `001-worklog-domain-api` only where an interactive round trip is genuinely needed: the `Dry_Run` behind every `Change_Preview`, the timer state refresh, and inline project creation.

The interface is organized around one idea: **the day is a picture, not a list**. It is drawn twice, for two different jobs.

The `Day_Gauge` on the timer page answers *what shape did today have* — a circle where a given clock time always sits at the same angle, so a glance tells you whether the day was one long block or six scattered ones, and whether it ran past your usual hours. The `Day_Timeline` on the day page answers *what did I do and where do I still owe a description* — one `Work_Block` per session stacked vertically, breaks collapsed to a labelled row so a four-hour evening gap costs one line instead of a fifth of the screen.

They are deliberately different. The gauge keeps time proportional everywhere and sacrifices legibility of short entries; the timeline keeps entries legible and sacrifices proportionality across breaks. Each is right for its own question, and having both is what lets each stay honest about what it gives up.

The second idea is that **nothing is written blind**. Because the server reconciles every write against the timer frame, a change can remove time the user did not intend to touch. Every such write goes through a `Dry_Run` first, and the result is shown as a `Change_Preview` the user has to confirm. The browser never recomputes the reconciliation itself — it would be a second implementation of the hardest logic in the project, and it would drift.

The third idea is that **the appearance is settled**. `.design/DESIGN.md` and the artboards beside it are the `Design_Contract`; the `Design_Tokens` and Page Layouts sections below transcribe it into the values the implementation uses. Nothing about colour, type or arrangement is invented here.

**Key design decisions:**

- **Load functions and form actions by default.** Reads happen in `+page.server.ts`; writes are form actions with `sveltekit-superforms` and the Zod schemas declared by `001`. This gives progressive enhancement and keeps validation in one place. `fetch` is reserved for the `Dry_Run`, the timer refresh and inline project creation.
- **One core, two entry points.** Form actions and the REST routes call the same store and domain modules and share the same Zod schemas, so the interface and an external script cannot diverge in behavior.
- **Server owns the timer.** The elapsed readout ticks locally, but the authoritative state comes from `GET /api/sessions/current` on load and on tab focus. Closing the browser does not stop the timer, and a reload never invents state.
- **`Change_Preview` is always server-computed.** It renders the `Dry_Run` response verbatim. The browser holds no clipping logic.
- **Two themes, one token set.** Every colour is a CSS custom property with a `dark` and a `light` value. Nothing draws from a literal.
- **No inline styles anywhere.** The production `Content-Security-Policy` from `001` carries no `unsafe-inline`, so project colours and computed block heights are applied through precompiled classes, not through `style=` attributes.

```mermaid
graph TD
    subgraph browser [browser]
        TP[timer page<br/>DayGauge]
        DP[day page<br/>DayTimeline]
        PP[projects page]
        SP[stats page]
        DLG[ActivityDialog · SessionDialog<br/>+ ChangePreview]
    end

    subgraph server [SvelteKit server]
        LD[+page.server.ts<br/>load + actions]
        API[routes/api<br/>REST]
        CORE[lib/server/store + domain<br/>spec 001]
    end

    DP --> DLG
    TP --> DLG
    TP -.->|form action| LD
    DP -.->|form action| LD
    DLG -.->|fetch: dry run| API
    TP -.->|fetch: timer state| API
    LD --> CORE
    API --> CORE
```

## Architecture

### Read and Write Paths

| Interaction | Path | Why |
|---|---|---|
| Loading a day, the projects list, statistics | `+page.server.ts` `load` | server-rendered, no client round trip, no loading flash on navigation |
| Start / stop timer | form action | works without JavaScript, one round trip, invalidates the page data |
| Create / edit / delete an activity or session | form action | superforms keeps field-level errors and the user's input on failure |
| `Change_Preview` | `fetch` to `/api/…` with `dryRun: true` | needs a result *before* submitting, so it cannot be a form action |
| Timer refresh on tab focus | `fetch` to `/api/sessions/current` | no navigation, no page data invalidation needed |
| Project creation from inside the `Project_Picker` | `fetch` to `/api/projects` | must not navigate away from the open dialog |
| `Quick_Log` | form action posting in `Open_Mode` | the server resolves the interval; the browser sends only the project |

### File Ownership Across the Two Specifications

Two files are split down the middle, and the split is exact:

| File | Owned by | Note |
|---|---|---|
| `src/app.html` | **002** | 002 creates the file, including the `%sveltekit.nonce%` placeholder and the pre-paint theme script; 001 only fills the nonce in through `transformPageChunk` |
| `src/routes/login/+page.server.ts` | 001 | the form action, the passphrase check, the cookie |
| `src/routes/login/+page.svelte` | **002** | the page that renders it |
| `src/routes/logout/+page.server.ts` | 001 | ends the stored session |
| `src/routes/logout/+page.svelte` | **002** | the confirmation view for a no-JavaScript logout |
| `src/hooks.server.ts` | 001 | `Auth_Hook`, CSP, rate limiting — 002 never edits it |
| `src/lib/contracts/schemas.ts` | 001 | the shared Zod schemas, client-safe by construction; 002 imports, never edits |
| `src/hooks.client.ts` | **002** | reports an uncaught client error through the interface's own error surface |
| `messages/{cs,en}.json`, `project.inlang/` | **002** | 001 emits `messageKey` values; 002 owns the translations |

### The Shared Zod Schemas

`001` declares one Zod schema per write and forbids a second copy. `002` therefore has **no `schema.ts` of its own** in any module — form actions import `createActivitySchema`, `patchActivitySchema`, `createSessionSchema`, `patchSessionSchema`, `deleteSessionSchema`, `createProjectSchema` and `patchProjectSchema` from `src/lib/contracts/schemas.ts`.

That file is owned by `001` and sits deliberately **outside** `src/lib/server/`: it is a pure module importing nothing from `$env`, Drizzle or the server layer, so superforms can import it in the browser for the validation Requirement 6.10 asks for. `002` imports from it and never edits it.

The same applies to the **domain types**. Every component signature in this document is written in terms of `Interval`, `WorkSession`, `ActivityEntry`, `ActivitySegment`, `Project`, `DaySummary` and `DayResponse`; those types are declared by `001` in `src/lib/contracts/models.ts`, beside the schemas and equally client-safe, and `002` imports them from there. A type under `src/lib/server/` cannot be imported by a `.svelte` file at all, so this is a build requirement rather than a preference.

### The Two Dialog Flows

The two write dialogs do **not** share one flow, because they answer different questions. `ActivityDialog` is composing something new, so the preview belongs under the form as continuous feedback. `SessionDialog` is destroying something that exists, so the preview belongs in front of the save as a gate.

**`ActivityDialog` — live preview under the form.** Every change to a time, a duration or the `Untracked_Policy` schedules a debounced `Dry_Run`; the result renders in a panel beneath the fields, headed *uloží se takto*. The save action stays enabled unless the `Dry_Run` returned a rejection.

```mermaid
stateDiagram-v2
    [*] --> Editing
    Editing --> Previewing : field changed, debounce elapsed
    Previewing --> Editing : preview rendered under the form
    Editing --> Saving : user submits
    Saving --> [*] : success, dialog closes
    Saving --> Editing : server rejected, errors shown
```

**`SessionDialog` — preview as a confirmation state.** A change to the start or the end runs the same debounced `Dry_Run`, but its result takes over the dialog: the footer's save action becomes *confirm and save* beside *back to editing*, and the body shows what disappears.

```mermaid
stateDiagram-v2
    [*] --> Editing
    Editing --> Confirming : fields valid, user submits
    Confirming --> Editing : user goes back
    Confirming --> Saving : user confirms
    Saving --> [*] : success, dialog closes
    Saving --> Confirming : STALE_PREVIEW, preview recomputed
    Saving --> Editing : server rejected, errors shown
    Editing --> Saving : no segment is affected
```

The `Editing → Saving` shortcut exists in both: for an activity, a change to only a description or a `Project` cannot move a segment; for a session, a `Dry_Run` reporting no `reclipped` entries and `removedSeconds: 0` has nothing to confirm.

### Two Readings of One Day

**The gauge** maps twenty-four hours onto 360°, so an hour is 15° and a clock time always lands at the same angle. The `Gauge_Track` covers only the `Gauge_Window`; the rest of the circle is bare. With the default `06:00 → 00:00` that is 270° of track and a 90° opening at the bottom, centred on 03:00.

```
              12        15
         09  ╌╌┼╌╌╌╌╌╌╌╌┼╌╌  18
       ╱                        ╲
     06                          21        track: graduated, numbered
       ╲                        ╱          gap:   nothing at all
         ╌╌╌╌╌╌      ╌╌╌╌╌╌╌╌╌╌
        00 ┘  bare gap  └ (work here
                          reads as overtime)
```

Work outside the window is drawn in the gap with no track under it, so it visibly leaves the dial rather than continuing along it — and because there is no scale there, the arc carries its own end label.

**The timeline** stacks one `Work_Block` per session, each with its own local axis, and collapses the break between two blocks into a single `Break_Marker`:

```
08:00 – 12:30  ·  4 h 30 min v kuse
 ┃ ┌──────────────────────────┐
 ┃ │ Trindade CRM             │   proportional inside the block
 ┃ │ Oprava filtrů ve flotile │
 ┃ │ 08:00 – 10:15 · 2 h 15   │
 ┃ ├──────────────────────────┤
 ┃ │ Worklog                  │
 ┃ └──────────────────────────┘
 ╌╌╌╌╌  pauza 4 h 00 min · 17:00 – 21:00  ╌╌╌╌╌   one row, not a fifth of the screen
21:00 – 03:00  ·  6 h 00 min v kuse · noční
 ┃ ┌──────────────────────────┐
```

The `┃` is the `Session_Rail` — one 8 px rounded bar per `Work_Session`, spanning the height of that block's segment column. There is no second lane and no shared axis: `Untracked_Time` is never drawn as empty space, it is the `Break_Marker` row.

Every segment gets a floor on its rendered height, so a twenty-minute task stays readable and clickable instead of collapsing to a sliver.

Both readings render blocks in chronological DOM order, each a `<button>` with an `aria-label` carrying its times, project and description — the picture is never the only way to read the day.

## Design_Tokens

Transcribed from `.design/DESIGN.md` §§ 1–4. Declared once in `src/lib/theme/theme.css` and mapped into Tailwind through an `@theme` block in `src/app.css`. Nothing below is a suggestion.

### Theme: dark — "Midnight"

| Token | Value |
|---|---|
| `--bg` | `#0F1319` |
| `--text` | `#E6EAF2` |
| `--text-dim` | `rgba(230,234,242,0.62)` |
| `--text-faint` | `rgba(230,234,242,0.50)` |
| `--accent` | `#D18A6A` |
| `--accent-hover` | `#E2A88D` |
| `--ink-on-accent` | `#1A0F0A` |
| `--panel` | `rgba(255,255,255,0.043)` |
| `--dialog` | `#171B22` |
| `--scrim` | `rgba(9,11,15,0.72)` |
| `--field` | `rgba(255,255,255,0.05)` |
| `--field-active-bg` | `rgba(209,138,106,0.10)` |
| `--field-active-ring` | `inset 0 0 0 1px rgba(209,138,106,0.40)` |
| `--divider` | `rgba(255,255,255,0.05)` |
| `--destructive` | `#E06A5E` |
| `--rail` | `rgba(230,234,242,0.30)` |
| `--arc-closed` | `rgba(230,234,242,0.34)` |
| `--groove-outer` · `--groove-inner` | `rgba(255,255,255,0.055)` · `rgba(255,255,255,0.045)` |
| `--dial-hour` · `--dial-3h` · `--dial-6h` | `rgba(230,234,242,0.14)` · `…,0.24)` · `…,0.30)` |
| `--dial-numeral` | `rgba(230,234,242,0.17)` |
| `--uncovered-dash` | `rgba(209,138,106,0.65)` |

### Theme: light — "Daylight"

| Token | Value |
|---|---|
| `--bg` | `#F3EEE6` |
| `--text` | `#2B2420` |
| `--text-dim` | `rgba(43,36,32,0.78)` |
| `--text-faint` | `rgba(43,36,32,0.66)` |
| `--accent` | `#A5522E` |
| `--accent-hover` | `#8A4724` |
| `--ink-on-accent` | `#FBF7F1` |
| `--panel` | `rgba(0,0,0,0.045)` |
| `--dialog` | `#FBF7F1` |
| `--scrim` | `rgba(43,36,32,0.38)` |
| `--field` | `rgba(0,0,0,0.05)` |
| `--field-active-bg` | `rgba(165,82,46,0.10)` |
| `--field-active-ring` | `inset 0 0 0 1px rgba(165,82,46,0.45)` |
| `--segment-active` | `rgba(165,82,46,0.14)` — dark `rgba(209,138,106,0.16)` |
| `--divider` | `rgba(0,0,0,0.07)` |
| `--hairline` | `rgba(0,0,0,0.20)` — dark `rgba(255,255,255,0.14)` |
| `--meter-track` | `rgba(0,0,0,0.09)` — dark `rgba(255,255,255,0.07)` |
| `--destructive` | `#A8321F` |
| `--rail` | `rgba(43,36,32,0.32)` |
| `--arc-closed` | `rgba(43,36,32,0.34)` |
| `--groove-outer` · `--groove-inner` | `rgba(0,0,0,0.07)` · `rgba(0,0,0,0.055)` |
| `--dial-hour` · `--dial-3h` · `--dial-6h` | `rgba(43,36,32,0.18)` · `…,0.28)` · `…,0.34)` |
| `--dial-numeral` | `rgba(43,36,32,0.24)` |
| `--uncovered-dash` | `rgba(165,82,46,0.75)` |

**Every token above is drawn and measured. None is derived.** `AddTaskLight` paints the light dialog, so the six values that were once computed — dialog, scrim, field, active field, divider and destructive — are now taken from an artboard and measured against the surface they actually sit on:

| Token | Value | On `#FBF7F1` |
|---|---|---|
| `--text` | `#2B2420` | 14.30:1 |
| `--text-dim` | `rgba(43,36,32,0.78)` | 7.18:1 |
| `--text-faint` | `rgba(43,36,32,0.66)` | 4.85:1 |
| `--accent` | `#A5522E` | 5.12:1 |
| `--destructive` | `#A8321F` | 6.26:1 |

The active segmented item is the one place the two themes take different alphas for the same job: `rgba(209,138,106,0.16)` dark against `rgba(165,82,46,0.14)` light. The light accent is the darker colour, so it needs less of itself to reach the same weight. `--destructive` is its own token in both themes — 5.67:1 on the dark ground, 6.26:1 on the light dialog — and is never derived from a `Palette_Slot`.

**Both themes reached AA with their own numbers, and neither set may be copied onto the other.**

| | dim | faint |
|---|---|---|
| dark on `#0F1319` | 0.62 → 6.44:1 | 0.50 → 4.63:1 |
| light on `#F3EEE6` | 0.78 → 6.84:1 | 0.66 → 4.69:1 |

Both pairs started lower and were raised after measurement. The light pair computed to 4.17 and 2.99; dark faint — which carries every block time, every break label and every caps label — sat at **3.38:1**, under the 4.5:1 Requirement 14.10 demands. Dark dim moved up with it so the two levels stay visibly apart instead of collapsing into one. Four numbers, four measurements; do not "unify" them.

**Two collisions the implementation must not merge.**

1. `--accent` carries *primary action* **and** *uncovered / attention*. Both are legitimate; they are told apart by shape — a primary action is a filled pill or circle in `--accent` with `--ink-on-accent` text, uncovered time is a dashed outline with an accent title on a 6 % accent fill. Never by colour.
2. The pink `Palette_Slot` (`#B7466C` / `#CC5A7F`) sits close to `--destructive`. A destructive control is styled from `--destructive` and never from a slot; a project swatch is styled from its slot and never from `--destructive`. A project that happens to be pink is not a warning.

### Project Palette

Assigned by `color_index` 0–7, overridable by the user (Requirement 11.10).

| Slot | Name | Dark | Light |
|---|---|---|---|
| 0 | blue | `#3899EA` | `#2287D7` |
| 1 | pink | `#B7466C` | `#CC5A7F` |
| 2 | green | `#09AF72` | `#006640` |
| 3 | amber | `#A67102` | `#B27A00` |
| 4 | violet | `#7C5CC0` | `#613FA0` |
| 5 | teal | `#019FB5` | `#0191A6` |
| 6 | olive | `#A19201` | `#7F7302` |
| 7 | clay | `#BA4939` | `#CB5848` |

These replace the palette the artboards were drawn with. That earlier set failed the data-viz validator on four checks — most seriously green↔pink at deuteranope ΔE 1.7, meaning a red-green colourblind user could not separate two adjacent projects at all.

Measured separation of the palette above, all pairs, both themes:

| Projects in use | CVD ΔE | Normal ΔE | Verdict |
|---|---|---|---|
| 2 | 13.8 | 25.1 | passes |
| 3 | 10.4 | 20.9 | passes |
| 4 | 10.4 | 16.8 | passes |
| 5 | 10.4 | 16.5 | passes |
| 6 | 8.3 | 8.9 | at the floor — the name must appear beside the colour |
| 7 | 4.8 | 8.8 | colour alone is not sufficient |
| 8 | 4.6 | 7.3 | colour alone is not sufficient |

**Eight mutually distinguishable categorical colours do not exist.** A search over OKLCH found the mathematical optimum for each palette size; even the best possible eight-colour set reaches only ΔE 6.0. Five is the practical ceiling.

That makes the following a **rule, not a caveat**: *colour never carries the identity of a project on its own.* Every surface showing a project colour also shows the project name. The `Segment_Block` elements, the statistics breakdown, the `Project_Legend` and the `Project_Picker` satisfy it by construction. The `Day_Gauge` arcs are the one surface that cannot show a name inline, which is why Requirement 16.16 gives every inner arc a hover and focus label.

Beyond eight projects `color_index` wraps and two projects share a hue — another reason the name is never optional. Charts fold everything past the top seven by `Covered_Time` into an "Other" slot in muted ink rather than cycling.

**No text is ever placed on a filled `Palette_Slot`.** A `Segment_Block` is a 16 % tint of its slot with `--text` on it and a 3 px full-strength left border; a swatch carries no label; a gauge arc carries no label. This is why there is no per-slot label ink table: the situation that would need one does not arise, and if a future surface introduces one, its ink must be measured per slot before it ships.

### Typography

**Inter Tight**, weights 300 / 400 / 500 / 600, falling back to `system-ui, sans-serif`, with `-webkit-font-smoothing: antialiased`. Every numeric readout carries `font-variant-numeric: tabular-nums` so digits do not jitter as the timer ticks.

| Role | Size / weight / tracking |
|---|---|
| Elapsed time (hero) | 68 / 300 / `-0.035em` — mobile 56 |
| Stats KPI figure | 30 / 300 / `-0.03em` |
| Timer figure | 26 / 300 / `-0.02em` — mobile 19 |
| Page heading | 20 / 500 — mobile 15 |
| Dialog heading | 17 / 500 |
| Brand | 15 / 600 |
| Summary value | 15 / 500 |
| Nav, form fields, project row | 14 |
| Project name in a `Segment_Block` | 14 / 500 — mobile 13 |
| Buttons | 13.5, primary 600 |
| Block head time | 13 / 500 — mobile 12 |
| Description, preview prose | 12.5 |
| Times, legend, gauge numerals | 12 — mobile 10.5–11 |
| Break label, short | 11.5 / 400 `--text-faint` — mobile 10.5 |
| Break label, `Long_Break` | 12 / 500 `--text-dim` — mobile 11 / 500 |
| Caps label (`.lbl`) | 11 / `letter-spacing: 0.16em` / uppercase / `--text-faint` — mobile 10 |

Durations read as `14 h 15 min`. Mobile drops the unit on the hero and the timer figures only: `14 h 15`.

### Radii, Heights, Widths

Radii: 2 (legend swatch) · 4 (rail) · 5 (bar) · 9 (icon box, segment control item, mobile block) · 10 (block) · 11 (field, swatch, inner panel) · 12 (segment control group) · 14 (panel) · 20 (dialog) · 9999 (pills, round buttons).

Heights: field 44 · dialog button 42 · segment control item 36 · quick-log pill 50 · header 84 desktop (88 on the day page) / 56–60 mobile · bottom nav 66–68 · FAB 54 · rhythm strip 22 · meter 4 · breakdown bar 8.

Widths: day-page side column **290** · projects content max **940** · `Session_Rail` 8 desktop / 6 mobile · segment left border 3.

**Start/stop button: 104 px with a 42 px icon** (mobile 98 / 40), halo `0 0 0 12px rgba(accent,0.09)`. It was deliberately reduced from 132, where it overpowered the gauge.

The rule is a **ratio, not a distance**: the control's diameter stays at or below **0.31 of the gauge box** (104 / 340 desktop, 98 / 300 mobile). The clear space that leaves between the halo and the inner arc is a consequence of the box size — about 66 px at the desktop's 340 and about 48 px at the mobile's 300, because the gauge scales through its `viewBox` while the control does not. Quoting 66 px as an absolute would make the mobile gauge look broken when it is correct. Do not enlarge the control past the ratio.

**Block heights.** Desktop blocks run 98 / 96 / 74 / 60 / 38 / **36**; mobile 62 / 58 / 48 / 44 / **26**. `MIN_BLOCK_PX` is **36 on desktop and 26 on mobile** — see Requirement 14.3 for why this is an explicit exception to the 44 × 44 rule rather than an oversight.

**Spacing.** The `Design_Contract` uses values off the 4/8/12/16/24/32/48/64 scale — 7, 9, 11, 13, 14, 18, 22, 26, 30, 56, 84, 290, 940 — and it wins wherever it speaks (Requirement 14.7). The scale governs only new surfaces the artboards do not cover.

### Applying Tokens Without Inline Styles

The production CSP from `001` carries `style-src 'self' 'nonce-…'` with no `unsafe-inline`. An inline `style=` attribute is not covered by a nonce — it is simply forbidden. Three consequences:

1. **Project colour** goes through one precompiled class per slot, not through a custom property written into the element:

```css
/* src/lib/theme/palette.css — generated once, eight of these per theme */
.pj-0 { --pj: #3899EA; --pj-tint: rgba(56,153,234,0.16); }   /* light theme: alpha 0.13 */
```

`projectSlotClass(colorIndex)` returns `pj-0` … `pj-7` (wrapping at eight); `Segment_Block` uses `background: var(--pj-tint); border-left-color: var(--pj)` from its own stylesheet. `projectColorVar()` — which built an inline custom property — is deleted.

2. **Computed block heights** are quantised to a 2 px ladder and applied through precompiled classes `.tl-h-26` … `.tl-h-320`, a continuous sequence in which every drawn height — 26, 36, 38, 44, 48, 58, 60, 62, 74, 96, 98, 106 — is a member by construction. `layOutDay` returns an exact `heightPx`; the component rounds it **down** to the ladder step and gives the remainder to the last block of the group, so the sum still fits the available height. 148 rules in the compiled stylesheet cost less than one nonce round trip. If a future layout needs a height outside the ladder, the alternative is a single nonced `<style>` element rendered from `locals.nonce` — never an inline attribute.

3. **SVG is unaffected.** `d`, `stroke`, `stroke-width`, `stroke-dasharray`, `fill`, `x`, `y` are SVG presentation attributes, not CSS, and no CSP directive applies to them. The `Day_Gauge` may therefore compute its geometry per render and write it straight onto the elements. The `Day_Rhythm_Strip` may not — its segment offsets are CSS percentages, so it renders as an inline SVG with `<rect>` elements instead of positioned `<div>` elements.

## Page Layouts

Transcribed from `.design/DESIGN.md` § 6 and the artboards named beside each item.

### Application Shell

**Top bar** (`Main`, `DayCollapsed`, `Stats`) — `grid-template-columns: 1fr auto 1fr`, height 84 (88 on the day page), horizontal page padding 48. Brand `Worklog` 15/600 at the left; navigation centred with `gap: 30`, items 14 in `--text-faint`, the active one 14/500 in `--text`; at the right, `gap: 14`, the `Running_Indicator` (6 px round accent dot + elapsed in 13 tabular `--text-dim`, internal `gap: 8`) and the `Settings_Menu` chip.

**Mobile shell** (`TimerMobile`, `DayMobile`, `SettingsMobile`) — top bar 56–60 with the brand, the `Running_Indicator` (12 px elapsed) and the `Settings_Menu` chip; bottom navigation 66–68 with a 1 px top divider and four tabs, each an icon of 20 above a 10 px label; the active tab is drawn in `--accent`, not in full-strength text. A create action appears as a 54 px round accent FAB, 18 from the right and 12 above the bottom bar, with the same halo as the timer control.

The two "active" treatments are deliberate: on desktop the accent is reserved for the timer and for uncovered time, so the active nav item earns its emphasis from weight and full-strength ink; on the bottom bar there is no room for that and the accent is the only legible signal.

**Settings** (`Settings`, `SettingsMobile`) — the `Theme_Switcher`, the `Locale_Switcher` and logout sit behind **one** control, not three in the bar: a round gear chip at the right end of the top bar, 30 px on desktop and 32 on mobile, on `rgba(255,255,255,0.07)`, holding a 16 px gear at `stroke-width: 1.7` in `--text`. The right cluster is therefore the `Running_Indicator` and then the chip, `gap: 14`.

Activating it opens a **268 px menu** anchored under the chip at the page's right padding on desktop — `--dialog` at radius 14 with a `1px solid rgba(255,255,255,0.06)` border, `0 18px 44px rgba(0,0,0,0.55)`, `padding: 16`, `gap: 16` — and the **same content as a bottom sheet** on mobile: `--dialog`, radius `20px 20px 0 0`, `padding: 10px 22px 26px`, `gap: 20`, opened by a 38 × 4 grabber of radius 9999 in `rgba(255,255,255,0.14)` centred at the top.

| Row | Desktop | Mobile |
|---|---|---|
| `MOTIV` — three-way `Theme_Switcher`: Systém / Světlý / Tmavý | items 34 tall, radius 9, 13 px; group radius 11 | items 44 tall, radius 10, 14 px; group radius 13 |
| `JAZYK` — two-way `Locale_Switcher`: Čeština / English | as above | as above |
| hairline `rgba(255,255,255,0.06)` | 1 px | 1 px |
| `Odhlásit se` in `--destructive` with a 15 px exit icon | row 34 tall, 13.5 px | row 44 tall, icon 17, 14.5 px |

Both groups sit on `rgba(255,255,255,0.04)` with `padding: 4` and `gap: 4`; the selected item is `rgba(209,138,106,0.16)` with accent text at 500 — the same segmented-control treatment the `AddTask` dialog uses.

**One control rather than two switchers, for three reasons.** The mobile top bar is 56–60 px and already carries the day navigation — one chip fits there, two do not, and settings must not live in a different place on each width. **Logout finally has a home**: the requirements demanded it and no artboard had ever drawn it, so one menu closes three gaps at once. And the four navigation destinations are places you *work*; a control set once a year does not belong beside them. The cost is that switching language is no longer one click, which for something set once is the right trade.

**The sheet is modal, and the dimming has exactly one source.** The scrim (`--scrim`) covers the page content **and** the bottom navigation at `z-index: 2`; the sheet sits over it at `z-index: 3`. Neither the page content nor the tab bar may carry an `opacity` of its own: an opacity creates a stacking context, and the bottom navigation then paints *over* the sheet. This is a real trap, not a hypothetical one — it was hit while the artboard was drawn. Dim through the scrim, never through the layers underneath it.

**The `Running_Indicator` is not on the timer page.** It appears in the top bar of the day, projects and statistics pages, and is deliberately absent from `Main`, `TimerLight` and `TimerMobile`, where the 68 px hero already states the elapsed time — two copies of one number in one view is noise. The `Settings` artboard draws the cluster with the indicator because it is demonstrating the menu, not the timer page.

### Timer Page (`Main`, `TimerLight`, `TimerMobile`)

Centred column, in this order, `gap: 18` (mobile 20):

1. **Hero elapsed** 68/300 tabular, and beneath it the caps caption `běží od 21:00`
2. **`Day_Gauge`** — 340 × 340 (mobile 300), with the `Timer_Control` absolutely centred on the arc centre
3. **Three figures** — `odpracováno` / `popsáno` / `chybí popis`, 26/300 tabular under caps labels, `gap: 56`; the third is drawn in `--accent`. On mobile they spread across the full width at 19/300 with shortened labels
4. **`Quick_Log` pill** — 50 tall, fully rounded, `--field` background, a 34 px round icon box, `Zapsat 01:30 → teď` at 14 `--text-dim`, and the outstanding `Uncovered_Time` at 13 `--text-faint` (dropped on mobile)
5. **`Project_Legend`** — 12 `--text-faint` items with `gap: 22`, each an 8 × 8 swatch of radius 2 beside the project name, closing with a 14 px dashed accent rule labelled `bez popisu`

### Day Page, Desktop (`DayCollapsed`, `DayCollapsedLight`)

Heading line: the date at 20/500 beside `08:00 – 03:00 · odpracováno 14 h 15 min` at 13 `--text-faint`. Below it a two-column layout, `gap: 24`: the `Day_Timeline` growing to fill, and a fixed **290 px** column at the right holding two panels of radius 14 on `--panel`, `gap: 14`:

- **`souhrn dne`** — worked / described / missing as label-value rows (13 `--text-dim` against 15/500 tabular, the missing value in `--accent`), a 4 px meter on `--meter-track` filled to 81 %, and `81 % odpracovaného času má popis` at 12 `--text-faint`
- **`tvar dne`** — work blocks (`sessionCount`), longest unbroken (`longestBlockSeconds`), time after the `Evening_Hour` (`eveningSeconds`)
- **`mimo výkaz`** — the `Orphan_Panel`, present only when the day holds an `Orphaned_Entry`: one row per emptied entry with its project, its originally requested interval and a sentence saying nothing of it remains inside the timer frame, each offering deletion or re-entry

The `Orphan_Panel` exists because an `Orphaned_Entry` has no `Activity_Segment` and therefore **cannot** appear on the `Day_Timeline` — it has no position to be drawn at. Everything else that used to be listed beside the timeline is now the timeline: there is no `ActivityList` and no `UncoveredList`. A `Segment_Block` already carries the project, the description, the times and the duration, and an `Uncovered_Marker` already carries its stretch; a second rendering of the same records beside the picture was two things to keep in sync and one of them redundant.

Inside the timeline, per `Work_Block`: a head of `08:00 – 12:30` at 13/500 tabular beside `4 h 30 min v kuse` at 12 `--text-faint` (a night block adds `· noční`); then a row of `gap: 14` holding the `Session_Rail` and the segment column with `gap: 4`. A `Segment_Block` is radius 10, padding `9px 13px`, `--pj-tint` background, 3 px `--pj` left border, and carries project name 14/500 → description 12.5 `--text-dim` → `08:00 – 10:15 · 2 h 15 min` 12 `--text-faint` tabular. At `MIN_BLOCK_PX` it collapses to one row: name 13/500 and times 12 `--text-faint` side by side.

The desktop day page draws **no** date navigation in the artboards even though Requirement 5.2 needs it; it goes into the heading line, left of the date, as two 34 px round icon buttons matching the mobile treatment.

### Day Page, Mobile (`DayMobile`)

Date navigation is a 44 px row: a 34 px round back button, the date 15/500 centred over `08:00 – 03:00 · 14 h 15 min` at 10 `--text-faint`, and a forward button at `opacity: 0.3` when the day is today. Blocks are radius 9, padding `8px 11px`, `gap: 4`, rail 6 wide; the head drops to 12/500 + 11. The two side panels move below the timeline.

### Break Markers

A `Break_Marker` is a centred label between two dashed hairlines that run to both edges of the timeline column, indented to clear the rail (`padding-left: 22` desktop, 18 mobile). The rule is `--hairline` — `rgba(255,255,255,0.14)` dark, `rgba(0,0,0,0.20)` light. The light value is higher on purpose, exactly as the text tokens are.

| | Duration | Label | Vertical padding |
|---|---|---|---|
| short break | < 1 h | 11.5 `--text-faint` tabular | 11 |
| `Long_Break` | ≥ 1 h | 12 / 500 `--text-dim` tabular | 13 |

**`LONG_BREAK_SECONDS = 3600`.** The threshold is one hour because that is what separates a coffee or a lunch — which the reader skims past — from the evening gap that changes the shape of the day and is worth stopping at. Desktop labels carry the bounds (`pauza 4 h 00 min · 17:00 – 21:00`); mobile drops them for width (`pauza 4 h 00 min`).

### The Night Marker

A `Work_Block` whose session has any part at or after the `Evening_Hour` of its `Logical_Day` adds `· noční` to its head. Deliberately the same hour the statistics measure `eveningSeconds` against — one configured value, one meaning, so a block called noční on the day page is a block contributing to *v noci po 21:00* in the statistics. Crossing midnight is not the test: 22:00–23:30 is a night block and 06:00–09:00 is not, whatever date it started on.

### The Focus Ring

`box-shadow: 0 0 0 2px var(--focus-gap), 0 0 0 4px var(--accent)` — an inner ring of the **surrounding** background before the accent ring. Without that gap the indicator disappears exactly where it matters most: on the `Timer_Control`, the FAB and every primary button, which are themselves filled with `--accent`, and on a `Segment_Block`, whose ground is a `--pj-tint`.

`--focus-gap` is set per surface rather than globally — `--bg` on the page, `--dialog` inside a dialog or the settings menu, `--panel` inside a panel, and the block's own `--pj-tint` on a `Segment_Block`. It is the one token whose value depends on where the element sits.

### The Split Marker

The `Split_Marker` is specified here in full rather than in an artboard. When one `Activity_Entry` produced several `Activity_Segment` records, **every** `Segment_Block` of that entry carries all three of:

1. **A part counter in text** — `část 2 ze 3` appended to the meta line at 12 `--text-faint` (`· 2/3` on a collapsed block). Text, so the marker survives greyscale, colour blindness and a screen reader; the same phrase goes into the `aria-label`.
2. **A continuation notch** — a 7 px triangle in `--pj` centred on the edge facing the break: on the bottom edge of every part but the last, on the top edge of every part but the first. It reads as "this block continues past the gap" without a legend.
3. **A linked hover and focus state** — hovering or focusing any part raises the `--pj-tint` of *all* parts of that entry by half again (0.16 → 0.24 dark, 0.13 → 0.20 light) and draws a 1 px `--pj` outline around each. The blocks share a `data-entry-id`, which is what the component keys the state on.

Three mechanisms, because the first is the accessible one, the second is the glanceable one, and the third is what proves the connection when several entries are split in the same block.

### Uncovered_Marker

One treatment — the `Uncovered_Marker` — in four variants, all built from the same tokens: fill `rgba(209,138,106,0.06)`, border `1px dashed rgba(209,138,106,0.45)`, title in `--accent`. The light theme keeps the 0.06 fill over `165,82,46` but takes the border to **0.52**, the same reason its text tokens sit higher.

| Variant | Where | Content |
|---|---|---|
| tall block | desktop, ≥ 60 px | `Zatím bez popisu` 13/500 accent, then `01:30 – 03:00 · 1 h 30 min — klikni a doplň` 12 `--text-faint` |
| short block | desktop, at the floor | `Bez popisu` 13/500 accent · times 12 `--text-faint` · flexible gap · `doplnit` 12 accent at the right edge |
| mobile pill | mobile | title 12.5/500 accent over times 10.5 `--text-faint`, with `doplnit` as a rounded 11 px accent pill on `rgba(209,138,106,0.14)` |

### Dialogs (`AddTask`, `AddTaskLight`, `AddTaskMobile`, `SessionEdit`)

Scrim `--scrim` over the page, dialog `--dialog` at radius 20 with `0 28px 70px rgba(0,0,0,0.6)`, header `22px 26px 18px` with the title at 17/500 and a 32 px round close button, body `0 26px 22px` with `gap: 18`, footer `16px 26px` on `rgba(255,255,255,0.02)` carrying a hint at 12 `--text-faint`, a ghost pill and a primary pill, both 42 tall.

**Below 768 px both dialogs fill the screen** (`AddTaskMobile`, 390 × 844). There is no scrim and no radius: the dialog *is* the viewport, so nothing shows through behind it.

| | desktop | mobile |
|---|---|---|
| header | `22px 26px 18px`, close button 32 | **58 px** tall, `padding: 0 20px`, close button 34 |
| body padding | `0 26px 22px` | `0 20px`, scrolls |
| field height / type | 44 / 14 | **48 / 15** |
| caps label | 11 | 10 |
| field layout | grid per mode | **one field per row**, `gap: 14` |
| description field | 66 | **62** |
| segmented item | 36, 13 px | **40, 12.5 px** |
| footer | one row: hint, ghost pill, primary pill | pinned to the bottom, `padding: 14px 20px 24px`, separated by a `--divider` hairline over `rgba(255,255,255,0.02)` |
| footer buttons | side by side | **stacked**: primary 50 px on top, `Zrušit` 46 px beneath, `gap: 10` |

The bigger fields and type are a touch decision, not a scaling accident: 48 px clears the activation floor by itself and 15 px is the smallest comfortable value in a field a thumb is aiming at. The mode labels shorten to fit (`Od–do` for `Přesně od–do`).

**The `Change_Preview` keeps its full form on mobile** — the resulting blocks, the warning and the `Uncovered_Policy` control, all of it. It is the reason the dialog exists; shrinking it away on the smaller screen would remove the point of the screen. `SessionDialog` follows the same rules, with its preview replacing the body as it does on desktop.

**Add task.** Segmented control of three modes (`Přesně od–do` / `Jen délka` / `Od posledního`), items 36 tall and radius 9 inside a radius-12 group on `rgba(255,255,255,0.04)`; the active item is `rgba(209,138,106,0.16)` with accent 13/500 text. The field row is a grid whose columns follow the mode, because the modes need different fields: `Explicit_Mode` shows day, from, to and project (`1fr 0.8fr 0.8fr 1.4fr`), `Duration_Mode` shows day, duration and project (`1fr 1fr 1.2fr`, the layout the artboard draws), and `Open_Mode` shows day and project alone (`1fr 1.6fr`) since the server resolves both ends. The day field appears in all three — `Explicit_Mode` composes its timestamps from it, and the other two send it as the `Target_Day`. Fields are `gap: 12`, each 44 tall at radius 11 on `--field`; the field the active mode derives is drawn with `--field-active-bg` and `--field-active-ring`. The description field is 66 tall. An inference is explained in a tinted note with an info icon. The live preview panel is radius 14 on `--panel`, headed by an eye icon and the caps label `uloží se takto` in accent, and renders the resulting segments as miniature blocks, then a dashed accent warning for anything that does not fit, then the `Untracked_Policy` segmented control (`Zahodit` / `Prodloužit timer`). Footer hint: `Esc zavře · nic se neuloží, dokud nepotvrdíš`.

**Edit session.** Start and end as two 44 px fields; the changed one carries the new value with the old one struck through at 12 `--text-faint`. The consequence panel is radius 14 on `rgba(209,138,106,0.07)` with a `1px solid rgba(209,138,106,0.28)` border: a warning row naming the loss with **one** total at 15/500 accent — `removedSeconds + lostUncoveredSeconds`, which is where the artboard's `−2 h 00 min` comes from, being 30 min taken from an entry plus 1 h 30 of uncovered time — then one row per affected entry inside a radius-11 `--panel` box — a 3 × 18 slot-coloured tick, the project name at 13.5/500, the loss at 12.5 accent, and beneath it a `1fr 20px 1fr` grid of *teď* → *po úpravě* with an arrow between. An entry that would be emptied — becoming an `Orphaned_Entry` — gets prose instead of columns, and so does the `Uncovered_Time` row (see below). The panel closes with `Celkem 2 záznamy · 2 h 00 min zmizí z výkazu.` — the **duration** is the combined total, while the **count** counts `Activity_Entry` records only, because uncovered time is not a record. Directly under the headline total the two parts are broken out, so no reader has to work out why the headline is larger than the entries listed beneath it. Deletion is an inline `--destructive` text link. Footer hint: `Počítá to server, ne prohlížeč — co vidíš, to se stane`.

**The uncovered row in a session preview.** The artboard lists `Zatím bez popisu` among the affected records, and it stays. `Uncovered_Time` is not an `Activity_Entry`, so it is not one of the `reclipped` entries — it arrives as its own pair of fields on `SessionChangePreview`: `lostUncoveredSeconds` and `lostUncovered`, the intervals that would fall outside `Tracked_Time`.

The browser computes none of it. It could — the intersection of the day's `uncovered` intervals with the interval the change removes is arithmetic over data the page already holds — but that would be the one place a figure in the report was derived on the client, and the whole `Dry_Run` rests on the rule that it never is. The server performs the write and rolls it back to build the preview anyway, so it has both numbers for free.

The row is rendered last, marked as `Uncovered_Time` rather than as an entry, described in prose, with its tick in `rgba(209,138,106,0.6)` rather than a `Palette_Slot`. It refreshes with the rest of the preview whenever the `Dry_Run` is recomputed.

### Statistics (`Stats`)

Heading row: `Statistiky` 20/500, the range segmented control, the resolved range at 13 `--text-faint`. Then, `gap: 22`:

- **`KPI_Row`** — `repeat(4, 1fr)`, `gap: 18`, panels of radius 14 padded `18px 20px`, each a caps label over a 30/300 tabular figure. The four are: `odpracováno` (`Tracked_Time`), `popsáno` (`Covered_Time`), `podíl popsaného` (percentage plus a 4 px meter), `mimo obvyklé hodiny` (`Overtime`, summed from `overtimeSeconds`, with its share of `Tracked_Time` at 11.5 `--text-faint` beneath). The artboard's fourth card showed the `Evening_Hour` figure; that number moves to the rhythm panel, and the card's shape is unchanged.
- **`Day_Rhythm_Strip`** — a panel headed `Kam v čase práce padla` with the sub-line `každý řádek je jeden logický den, 03:00 → 03:00` (rendered from the server's `DAY_START_HOUR`, not from a literal) and the project legend at the right. One row per day: the day label in a 58 px gutter, a 22 px strip of radius 5 on `rgba(255,255,255,0.05)` with three recessive tick lines, the day's segments, and the day total in a 62 px right gutter.

**What the segments are drawn from.** Each `DaySummary` in an `include=intervals` response carries `covered[]` — intervals with a `projectId` and its `colorIndex` — and `uncovered[]`. A covered interval draws as a `<rect>` in its slot colour; an uncovered interval draws in the same geometry with a **hatch**: a 45° `<pattern>` of 1 px accent lines 4 px apart at 45 % over a 6 % accent fill, so a day that was worked but never described reads differently from one that was described, in texture as well as in colour. Today's row is labelled in `--accent` and the strip carries `inset 0 0 0 1px rgba(209,138,106,0.30)`; a day with no work shows an empty strip and an em dash. Beneath the rows, an axis line of five labels from `DAY_START_HOUR` back to `DAY_START_HOUR`. The strip is drawn **only** when the response carries the per-day intervals — see *When the server omits the intervals* below.
- **Breakdown and rhythm panel** — `grid-template-columns: 1.4fr 1fr`. The breakdown lists projects descending: a 9 × 9 swatch, the name at 14, the duration at 14/300 tabular, the share at 12 `--text-faint` in a 42 px gutter, and beneath each a 8 px track of radius 4 filled to that project's **share of the range's total `Covered_Time`**. Below a divider, `Bez popisu` as a plain figure in `--accent` — never a bar. The rhythm panel lists days worked, average per working day, longest day, longest unbroken block, total blocks, and time after the `Evening_Hour`, closing with the observation line at 12.5 `--text-faint`.

**The observation line is three fixed templates.** Exactly one renders — the first whose condition holds — and when none holds the line is **omitted**, not replaced by filler and not left as blank space.

| # | Condition | Key | Czech | English |
|---|---|---|---|---|
| 1 | `nights ≥ 1` | `stats_observation_nights` | `Práce po {eveningHour} padla na {nights, plural, one {# den} few {# dny} other {# dnů}} z {workdays}.` | `Work after {eveningHour} fell on {nights, plural, one {# day} other {# days}} of {workdays}.` |
| 2 | `longest ≥ 2 h` | `stats_observation_longest` | `Nejdelší nepřerušený úsek: {duration}, {weekday}.` | `Longest unbroken stretch: {duration}, {weekday}.` |
| 3 | `idleDays ≥ 1` | `stats_observation_idle` | `Bez práce: {idleDays, plural, one {# den} few {# dny} other {# dnů}}.` | `No work on {idleDays, plural, one {# day} other {# days}}.` |

Two rules these templates follow deliberately, and both hold for **every** message in the interface, not only these three:

1. **A countable noun always goes through a plural form.** Czech needs one / few / other, and a noun interpolated beside a bare number is wrong for two of the three.
2. **No verb ever follows a number.** Czech verb agreement would then depend on the count as well, turning one plural choice into two coupled ones. Every template above is a noun phrase for exactly that reason — `Nejdelší nepřerušený úsek: …`, never `Nejdelší úsek trval …`.

The bar and the printed percentage state the same quantity. The artboard drew bars relative to the largest project (100/54/14 %) while printing shares of the total (59/32/9 %); two scales in one row is a misreading waiting to happen, and the share is the number the reader is being given.

**The ranges are a day, a week and a month — deliberately, and there is no year.** A year on the rhythm strip would be 365 rows of two-pixel marks, which is unreadable, and that is the same reason the server caps interval payloads at `MAX_INTERVAL_RANGE_DAYS` (62 days). This is a closed decision, not a gap waiting to be filled.

**The cap is still not dead code.** `GET /api/days` returns per-day intervals only for `include=intervals` and only inside that cap; beyond it the server answers **HTTP 200** with the summaries, drops the intervals and says so with `intervalsIncluded: false`. That branch protects a route the interface is not the only caller of — scripts and phone shortcuts hit `/api/days` too, and a year-long request from a shell script has to come back with summaries rather than fail. The interface simply never asks for more than a month, so it never sees the flag set; it handles it in one place anyway, because a public route's contract is not conditional on who calls it. One criterion, no dedicated test.

### Surfaces the artboards do not draw

Nine surfaces are specified here in tokens rather than as artboards. All nine are fully pinned below — there is nothing left to choose while implementing them.

**Confirmation dialog.** The dialog shell at its smallest: `--dialog` at radius 20, `max-width: 420`, header 17/500, body 13.5 `--text-dim` naming exactly what will be lost, footer as the write dialogs have it — a ghost pill and, for a destructive confirmation, a filled pill in `--destructive` with `--ink-on-accent` text rather than the accent. Never a bare "are you sure": the body names the record and the duration.

**Toast.** Bottom centre on mobile, bottom right on desktop, 16 from the edge, `--dialog` at radius 14 with the dialog's shadow, `padding: 12px 16px`, text 13.5, a 15 px leading icon, `max-width: 420`. A success carries no action and dismisses itself after about four seconds; an error carries a text action in `--accent` and stays until dismissed. Failures never auto-dismiss — a message the user did not see is the same as no message.

**Empty state.** Centred in the space its content would have filled: a 20 px icon in `--text-faint`, a line at 14 `--text-dim`, and where there is an obvious next step, one filled accent pill. `padding: 48px 24px`, `gap: 12`. Every empty state in this interface has a next step — start the timer, create the first project, pick another range.

**Skeleton.** The shape and radius of the block it stands in, on `--panel`, with a 1.2 s shimmer sweeping left to right; never a spinner.

**Login, error and offline pages.** The page shell with a centred column at `max-width: 420`, `gap: 16`: a 20/500 heading, a line at 14 `--text-dim`, then the form or the single action as a filled accent pill. The login page adds the passphrase field at the standard 44 px (48 on mobile); the offline page adds a ghost *retry* pill beside the primary action.

**Timezone notice.** One line at 12 `--text-faint` directly under the top bar, centred on the page width, shown only while the device zone differs from the server's.

**Focus ring.** As defined under *The Focus Ring* above — `0 0 0 2px var(--focus-gap), 0 0 0 4px var(--accent)`.

### Projects (`Projects`)

Content max 940. Rows of `padding: 16px 18px` separated by 1 px dividers, each with a 32 px icon box of radius 9 tinted from the project's slot and carrying a 13 px rounded swatch, the name, the thirty-day `Covered_Time`, a share bar, and row actions. The colour control opens a row of eight swatches, each 38 tall at radius 11, the current one ringed with `0 0 0 2px var(--dialog), 0 0 0 4px var(--text)`.

## Project Structure

Files owned by this specification; everything else comes from `001-worklog-domain-api`.

```
worklog/
├── messages/
│   ├── cs.json                          # Czech — the primary language
│   └── en.json                          # English fallback
├── project.inlang/settings.json         # baseLocale en, locales [en, cs]
├── src/
│   ├── app.css                          # Tailwind 4 entry + @theme tokens
│   ├── app.html                         # 002 owns it; carries %sveltekit.nonce%
│   │                                    #   and the nonced pre-paint theme script
│   ├── hooks.client.ts                  # handleError → the interface error surface
│   ├── hooks.ts                         # reroute via deLocalizeUrl
│   ├── lib/
│   │   ├── core/i18n/                   # locale state, init, switch
│   │   │   ├── state.svelte.ts
│   │   │   └── index.ts
│   │   ├── theme/
│   │   │   ├── theme.css                # both themes as custom properties
│   │   │   ├── palette.css              # .pj-0 … .pj-7, generated from palette.ts
│   │   │   ├── timeline-heights.css     # .tl-h-26 … .tl-h-320, the 2 px ladder
│   │   │   └── theme.svelte.ts          # ThemePreference rune, resolution, persistence
│   │   ├── ui/                          # Design_System, ported subset
│   │   │   ├── elements/                # Button, Badge, Icon, Input, Select,
│   │   │   │                            #   Checkbox, Spinner, Tooltip, flags/
│   │   │   ├── forms/                   # FormField, DatePicker, TimeInput, SearchInput
│   │   │   ├── layout/                  # Shell, Topbar, BottomNav, Fab, SettingsMenu,
│   │   │   │                            #   PageHeader, Section
│   │   │   ├── overlays/                # Modal, ConfirmDialog, Toast, ToastContainer,
│   │   │   │                            #   LoadingSkeleton, toast-store.svelte.ts
│   │   │   └── components/              # StatCard, EmptyState, DataTable
│   │   └── viz/
│   │       ├── palette.ts               # the eight Palette_Slot values, slot → class
│   │       └── format.ts                # duration, time and date formatting
│   ├── modules/
│   │   ├── timer/
│   │   │   ├── actions.ts  elapsed.svelte.ts
│   │   │   ├── components/DayGauge.svelte
│   │   │   ├── components/gauge-geometry.ts   # PURE: angleOf, arc, graduations
│   │   │   ├── components/TimerControl.svelte
│   │   │   ├── components/ProjectLegend.svelte
│   │   │   └── pages/TimerPage.svelte
│   │   ├── day/                         # the centrepiece
│   │   │   ├── actions.ts  query.ts  dry-run.ts
│   │   │   ├── pages/DayPage.svelte
│   │   │   └── components/
│   │   │       ├── timeline-geometry.ts       # PURE: layOutDay, MIN_BLOCK_PX
│   │   │       ├── DayTimeline.svelte
│   │   │       ├── WorkBlock.svelte
│   │   │       ├── SegmentBlock.svelte
│   │   │       ├── BreakMarker.svelte
│   │   │       ├── ActivityDialog.svelte
│   │   │       ├── SessionDialog.svelte
│   │   │       ├── ChangePreview.svelte
│   │   │       ├── DaySummaryPanels.svelte    # souhrn dne · tvar dne · Orphan_Panel
│   │   │       └── DayNav.svelte
│   │   ├── projects/
│   │   │   ├── actions.ts  query.ts
│   │   │   ├── pages/ProjectsPage.svelte
│   │   │   └── components/ProjectPicker.svelte, ProjectRow.svelte
│   │   └── stats/
│   │       ├── query.ts
│   │       ├── pages/StatsPage.svelte
│   │       └── components/KpiRow.svelte, ProjectBreakdown.svelte,
│   │                       DayRhythm.svelte, RhythmPanel.svelte, CoverageMeter.svelte
│   └── routes/
│       ├── +layout.svelte  +layout.server.ts  +error.svelte
│       ├── +page.svelte  +page.server.ts               # timer
│       ├── day/[date]/+page.svelte  +page.server.ts
│       ├── projects/+page.svelte  +page.server.ts
│       ├── stats/+page.svelte  +page.server.ts
│       ├── offline/+page.svelte                        # connection error page
│       ├── login/+page.svelte                          # server half owned by 001
│       └── logout/+page.svelte                         # server half owned by 001
└── tests/
    ├── lib/                                          # shared code, node + jsdom
    ├── modules/{timer,day,projects,stats}/           # logic and components, mirrored
    └── e2e/                                          # Playwright
```

Route files stay thin: `+page.server.ts` is the only place that touches `RequestEvent` and the stores, and `+page.svelte` renders the module's page component with props. `actions.ts` holds the form-action bodies a route delegates to; `query.ts` holds the read-side aggregation a load function delegates to. Modules never import from `src/routes/`.

Test files mirror the source tree exactly — `tests/modules/day/components/day-timeline.test.ts` for `src/modules/day/components/DayTimeline.svelte`, `tests/lib/viz/format.test.ts` for `src/lib/viz/format.ts`. There is no `tests/components/` directory.

## Components and Interfaces

### 1. Colour Palette (`src/lib/viz/palette.ts`)

```ts
export type PaletteSlot = { readonly dark: string; readonly light: string };

export const PROJECT_PALETTE: readonly PaletteSlot[] = [
  { dark: '#3899EA', light: '#2287D7' },  // 0 blue
  { dark: '#B7466C', light: '#CC5A7F' },  // 1 pink
  { dark: '#09AF72', light: '#006640' },  // 2 green
  { dark: '#A67102', light: '#B27A00' },  // 3 amber
  { dark: '#7C5CC0', light: '#613FA0' },  // 4 violet
  { dark: '#019FB5', light: '#0191A6' },  // 5 teal
  { dark: '#A19201', light: '#7F7302' },  // 6 olive
  { dark: '#BA4939', light: '#CB5848' }   // 7 clay
] as const;

export const PALETTE_SIZE = PROJECT_PALETTE.length;   // 8

/** `pj-0` … `pj-7`, wrapping at eight. The class is precompiled in palette.css. */
export function projectSlotClass(colorIndex: number): string;

/** The slot a color_index resolves to, for the gauge, which writes SVG attributes. */
export function projectColor(colorIndex: number, theme: 'dark' | 'light'): string;
```

There is no `projectColorVar` and no `labelInkOn`. The first wrote an inline custom property, which the CSP forbids; the second answered a question the design never asks, because no text is ever placed on a filled slot.

**Where `colorIndex` comes from.** Every read shape that names a project carries it: `ActivityEntry.colorIndex` for a `Segment_Block` and a gauge arc, `ProjectTotal.colorIndex` for the statistics breakdown, the `Project_Legend` and the projects page, and the interval attribution of a `DaySummary` for the `Day_Rhythm_Strip`. The interface never looks a colour up by joining the projects list against an id — a join would be wrong for an archived project missing from that list, and stale for one recoloured in another tab.

`palette.css` is generated from this module, not maintained by hand — one class per slot per theme, carrying `--pj` and `--pj-tint`. The tint alpha is **0.16 in the dark theme and 0.13 in the light one**: the lighter ground needs less of it to read at the same weight.

### 2. Timeline Geometry (`src/modules/day/components/timeline-geometry.ts`)

Pure TypeScript, no DOM, unit and property tested as a function.

```ts
type Interval = { start: Date; end: Date };

export const MIN_BLOCK_PX = { desktop: 36, mobile: 26 } as const;
/** Below this a block shows name and times only. Desktop only — mobile never shows one. */
export const DESCRIPTION_MIN_PX = 60;
export const BLOCK_GAP_PX = 4;
export const BLOCK_HEAD_PX = { desktop: 29, mobile: 24 } as const;
export const BREAK_MARKER_PX = { short: 38, long: 42 } as const;
export const LONG_BREAK_SECONDS = 3600;
export const MIN_UNCOVERED_SECONDS = 300;
/** The ladder step every rendered height is snapped to. */
export const HEIGHT_STEP_PX = 2;

export type Density = 'desktop' | 'mobile';

/** One layout group per Work_Session, with the breaks between them collapsed. */
export type DayLayout = {
  blocks: {
    session: WorkSession;
    segments: LaidOutSegment[];
    /** Sum of the segment heights plus the gaps between them. */
    heightPx: number;
    /** True when the session is open and still counting. */
    running: boolean;
    /** True when the session is open but past MAX_OPEN_SESSION_HOURS — Requirement 4.9. */
    capped: boolean;
    /** True when the session continues past the displayed Logical_Day — Requirement 4.17. */
    continues: boolean;
  }[];
  breaks: { after: number; interval: Interval; long: boolean }[];   // index of the block it follows
};

export type LaidOutSegment = {
  segment: ActivitySegment | null;   // null for an Uncovered_Time stretch
  entry: ActivityEntry | null;
  /** Quantised to HEIGHT_STEP_PX, never below MIN_BLOCK_PX for the density. */
  heightPx: number;
  /** True when heightPx >= DESCRIPTION_MIN_PX and the density is desktop. */
  showsDescription: boolean;
  partIndex: number | null;          // "part 2 of 3" when the entry was split
  partCount: number | null;
};

export function layOutDay(
  sessions: WorkSession[],
  entries: ActivityEntry[],
  uncovered: Interval[],
  availablePx: number,
  density: Density,
  now: Date,
  maxOpenSessionHours: number       // from the Health_Endpoint — the capped-session rule
): DayLayout;
```

A single proportional axis over the whole day was tried and rejected: on a real day of 08:00–03:00 with a four-hour evening break, the break consumed 21 % of the height while showing nothing, and a twenty-minute task rendered 13 px tall — unreadable and unclickable. Collapsing the break costs the property that distance equals time *across* blocks; proportions still hold *inside* a block, which is where the reading happens. The shape of the whole day is read from the `Day_Gauge` instead.

**`availablePx` is the height of the timeline column, measured by the component** — the viewport height less the shell, the page heading and the page padding — and passed in. It is re-measured on resize and on an orientation change, and the layout is recomputed; nothing about it is stored. It is a **budget, not a limit**.

**The algorithm, which is normative.** The heights drawn in the artboards illustrate it; they do not define it, and reproducing them exactly is not a requirement (Requirement 17.13).

1. **Reserve the fixed rows.** `fixed = Σ BLOCK_HEAD_PX + Σ BREAK_MARKER_PX + Σ BLOCK_GAP_PX` over every block, break and inter-segment gap. What remains, `flex = availablePx − fixed`, is what the segments share.
2. **Distribute proportionally.** Each segment gets `flex × its seconds / total segment seconds`.
3. **Lift to the floor.** Any segment below `MIN_BLOCK_PX` is raised to it and pinned. The deficit this creates is taken back from the unpinned segments **in descending height order, one step at a time**, so the tallest gives first and no segment is pushed below the floor by the repayment. Repeat until the deficit is settled or every segment is pinned.
4. **Quantise.** Round each height **down** to `HEIGHT_STEP_PX`. The remainder — at most 2 px per segment — is given back to the tallest segment of each block, so the block's own total is exact.
5. **The floor outranks the budget.** If every segment is pinned and the total still exceeds `availablePx`, the layout returns the larger total and the page scrolls. A block too small to read is worse than a page that scrolls, and this is why Property 2's premise is `MIN_BLOCK_PX × segments + Σ heads + Σ breaks + Σ gaps ≤ availablePx` — outside that premise there is nothing to prove.

**The extremes, so none of them is a surprise:**

| Day | Outcome |
|---|---|
| fifty short entries | every segment is pinned at `MIN_BLOCK_PX`; the column is ~2 000 px and the page scrolls |
| one entry all day | one segment takes the whole of `flex`; there is no upper cap, and a very tall block is correct |
| one session, one break, one session | two heads, one `Break_Marker`, and `flex` split between two blocks in proportion to their worked time |
| a day with no sessions | no blocks, no breaks; the empty state replaces the timeline entirely |

The mobile artboard puts `overflow: hidden` on the timeline column. That is a drawing convenience, not the contract — the column scrolls.

An `Open_Session` extends to `now`. When the server reports it as a `Stale_Session`, the drawn end is instead `session.startedAt + MAX_OPEN_SESSION_HOURS`, and the block is marked `capped`. That is exactly where `001` stops counting an abandoned timer towards `Tracked_Time`, so the picture and the figure beside it cannot disagree. The limit is read from the `Health_Endpoint` along with the time zone, the `DAY_START_HOUR`, the `Gauge_Window` and the `Evening_Hour`, and put in layout context once — never guessed, never hard-coded, and never reconstructed from the day's totals. Every one of those five values is configurable on the server, and every place that needs one takes it from context.

### 3. Day Timeline (`src/modules/day/components/DayTimeline.svelte`)

```ts
type DayTimelineProps = {
  sessions: WorkSession[];
  entries: ActivityEntry[];         // each carrying its segments
  uncovered: Interval[];
  maxOpenSessionHours: number;      // from the Health_Endpoint, through layout context
  now: Date;
  density: Density;                 // 'desktop' | 'mobile' — chosen by the caller
  editable: boolean;                // drag handles, add-session affordance
  onActivityActivate: (entryId: string) => void;
  onSessionActivate: (sessionId: string) => void;
  onUncoveredActivate: (range: Interval) => void;
  onSessionResize: (sessionId: string, next: Interval) => void;
};
```

There is no `orientation` prop: the timeline is vertical at every width, and desktop and mobile differ in density — block floor, padding, type sizes and whether the break label carries its bounds. There is no `compact` prop either: the timer page shows the `Day_Gauge`, never a second timeline. There is no `bounds` prop: `layOutDay` never used it, because a block's axis is its own session.

The component renders `WorkBlock` and `BreakMarker` in DOM order and owns nothing else. `WorkBlock` renders the head, the `Session_Rail` (with drag handles when `editable` and density is `desktop`) and its `SegmentBlock` children. `SegmentBlock` carries `data-entry-id` so the `Split_Marker` hover state can link the parts of one entry.

**Dragging a rail edge versus clicking the rail.** The top and bottom 12 px of the `Session_Rail` are drag handles; the rest of it is a plain target that opens the `Session_Dialog`. A press on a handle becomes a drag only after the pointer has moved **4 px**; released below that it counts as a click and opens the dialog. Both thresholds are needed because the rail is 8 px wide and a session edge is a precise thing to grab — without the movement threshold every mis-grab would silently move a boundary. A drag snaps to five-minute steps. On release the component does **not** commit — it calls `onSessionResize`, which opens the `SessionDialog` already carrying the dragged values, so the change still passes through a `Change_Preview`.

### 4. Day Gauge (`src/modules/timer/components/DayGauge.svelte`, `gauge-geometry.ts`)

The timer page's centrepiece. Twenty-four hours map onto a full circle, so **one hour is a fixed 15°** and a given time of day always sits at the same angle. The `Gauge_Track` is drawn only over the `Gauge_Window`; everything outside it is bare.

```ts
export type GaugeGeometry = {
  /** Angle in degrees for an instant: 45 + minutesSinceMidnight × 0.25. Absolute. */
  angleOf(t: Date): number;
  /** SVG path for an arc between two instants at a given radius. */
  arc(from: Date, to: Date, radius: number): string;
  /** Point on the circle at an angle and radius — for marks, dots and numerals. */
  pointAt(angleDeg: number, radius: number): { x: number; y: number };
  /** Marks inside the window only — the gap carries none. */
  graduations(): { angle: number; hour: number; level: 1 | 3 | 6; label: string | null }[];
  trackStart: number;   // degrees
  trackEnd: number;     // degrees
};

export function createGaugeGeometry(
  window: { start: string; end: string },   // GAUGE_START / GAUGE_END from the server
  date: string,                             // the Logical_Day being drawn
  timeZone: string,
  cx: number, cy: number
): GaugeGeometry;
```

The mapping is a function of the **clock time**, not of the `Logical_Day` length — that is what makes it survive DST, as `001`'s design explains: a 23-hour or 25-hour day does not move a single graduation, because the hour lost or gained falls inside the bare gap.

**Geometry, fixed by the artboards.** Box 340 × 340 (mobile 300), `viewBox="-22 -22 364 364"`, centre 160/160, outer radius 138, inner radius 118. Graduations run outward from r = 146: to 150 hourly, to 154 three-hourly, to 156 six-hourly.

**Every number in this section is a `viewBox` unit, not a CSS pixel.** The 364-unit box is painted into 340 px on desktop and 300 on mobile, so the scale is 0.934 and 0.824: a 12-unit numeral renders at **11.2 px** desktop and **9.9 px** mobile. That matters wherever contrast is argued from size — the dial numerals are smaller on screen than their nominal 12.

Label radii follow **the end of the tick plus 12**, which is why they differ by level: three-hourly numerals sit at r = 166 (tick ends at 154), six-hourly at r = 168 (tick ends at 156). The overrun's end label has no tick to measure from and sits at r = 162. A text element is placed at its radius and its baseline shifted by +0.35 em, which is why the drawn `y` is about 4.2 units past the geometric point.

| Level | Occurs | Length | Width | Ink |
|---|---|---|---|---|
| 1 | every hour | 4 | 1.1 | `--dial-hour` |
| 3 | every 3 h — 09, 15, 21 | 8 | 1.3 | `--dial-3h` |
| 6 | every 6 h — 06, 12, 18, 00 | 10 | 1.5 | `--dial-6h` |

Numerals are **two-digit hours with no minutes** — `06 09 12 15 18 21 00` — at 12 units in `--dial-numeral` (about 1.5:1, deliberately below body text; 11.2 CSS px desktop, 9.9 mobile). Three-hourly numerals sit at r = 166, six-hourly at r = 168 — tick end plus 12 in both cases. **`03` is never drawn**: it falls in the gap.

| Element | Treatment |
|---|---|
| Outer groove | `--groove-outer`, 10 px, round cap, over the window only |
| Inner groove | `--groove-inner`, 6 px, round cap, over the window only |
| Closed `Work_Session` | `--arc-closed`, 10 px |
| `Open_Session` | `--accent`, 10 px — the accent marks **running**, not overtime |
| `Activity_Segment` | `--pj` of its slot, 6 px |
| `Uncovered_Time` | `--uncovered-dash`, 6 px, `stroke-dasharray="3 6"`, `stroke-linecap="round"` |
| `Gauge_Gap` | nothing at all — no groove, no mark, no numeral, at any coverage |
| `Overtime_Arc` | same stroke widths, floating in the gap; a filled `r=4` accent dot at the track end and the reached time at 12/500 accent at **r = 162** on the arc's end angle |
| Centre | the `Timer_Control`: 104 px (mobile 98), icon 42 (40), halo `0 0 0 12px rgba(accent,0.09)` |
| Elapsed | above the circle, never inside it |

At 24 hours of work the arc closes into a complete circle — **and the gap stays bare**. Requirement 16.12 is deliberate: the reason the gap carries no scale is that work there is outside the expected day, and that reason does not stop applying when the day happens to be full. `GaugeNonstop` draws exactly this and is correct.

A closed ring cannot be drawn as an arc back to its own start point — that path is degenerate and paints nothing. At full coverage the outer arc is emitted as a `<circle>` instead.

`GaugeNormal` shows the other end of the range: a day whose sessions are all closed draws every arc in `--arc-closed` and the control carries the **start** icon. The accent appears only while a session is open.

**Accessibility.** The whole gauge is one `role="img"` with an `aria-label` summarising the day — worked, described and undescribed totals, and whether the timer is running. The arcs inside it are `aria-hidden`: an SVG `<path>` is not focusable, and thirty individually announced arcs would be unusable even if it were. Project identity is carried in text by the `Project_Legend` directly beneath, which is why the legend is not optional.

On top of that, an inner arc responds to **hover** with a label naming the project and the arc's times. That is an enhancement for a pointer, not the accessible path.

`angleOf`, `arc`, `pointAt` and `graduations` are pure and live in `gauge-geometry.ts`, so the mapping is unit and property tested without a DOM. The component writes their output straight into SVG presentation attributes, which no CSP directive touches.

### 5. Change Preview (`src/modules/day/components/ChangePreview.svelte`, `src/modules/day/dry-run.ts`)

```ts
export type ActivityPreview = {
  kind: 'activity';
  /** The entry as it would be stored, carrying its resulting segments — the server's shape. */
  entry: ActivityEntry;
  discarded: Interval[];
  extendedSessions: WorkSession[];
  unplacedMinutes: number;
  removedSeconds: number;
  previewToken: string;
  rejection: Rejection | null;
};

export type SessionPreview = {
  kind: 'session';
  session: WorkSession | null;      // null for a delete
  reclipped: {
    entryId: string; projectName: string; description: string;
    before: Interval[]; after: Interval[]; removedMs: number; orphaned: boolean;
  }[];
  removedSeconds: number;
  /** Uncovered_Time that would fall outside Tracked_Time — from the server, never derived here. */
  lostUncoveredSeconds: number;
  lostUncovered: Interval[];
  previewToken: string;
  rejection: Rejection | null;
};

export type Rejection = { code: string; messageKey: string; details?: Record<string, unknown> };
export type Preview = ActivityPreview | SessionPreview;

/** POSTs the pending change with dryRun: true and maps the response. Computes nothing locally. */
export function previewActivity(input: CreateActivityInput, signal: AbortSignal): Promise<ActivityPreview>;
export function previewSessionChange(input: SessionChangeInput, signal: AbortSignal): Promise<SessionPreview>;
```

Both shapes mirror `001`'s `ActivityResponse` and `SessionChangePreview` field for field, including `lostUncoveredSeconds` and `lostUncovered`. The single addition is `rejection`, the client's mapping of a non-2xx envelope — the server has no such field. `segments` is not a field: the segments live inside `entry`, exactly as the server returns them, so the interface cannot hold a second opinion about them. Neither function takes the day data, because neither computes anything from it.

The component renders, in this order: what will be stored, what will be lost, and what is unresolved. A rejection replaces the whole body with the translated `messageKey` and disables the confirm action. In-flight requests are aborted when the user edits a field again, and a new `Dry_Run` is requested only after a 400 ms pause in typing, so editing a time field cannot exhaust the rate limit.

Every preview carries the `previewToken` the server computed it against, and the confirming write sends it back. If another device changed the frame in between, the write returns `STALE_PREVIEW`, the component recomputes and asks again — so what the user confirmed is always what happens.

When a preview reports `discarded` intervals, the component offers the `Untracked_Policy` choice inline — `clip` selected, `extend` available — and re-runs the `Dry_Run` when the choice changes, so the user sees the consequence of each option before picking one.

### 6. Activity Dialog (`src/modules/day/components/ActivityDialog.svelte`)

```ts
type ActivityDialogProps = {
  mode: 'create' | 'edit';
  entry?: ActivityEntry;            // edit only
  prefill?: { range?: Interval; projectId?: string; description?: string };
  date: string;                     // the Logical_Day being edited
  projects: Project[];
  open: boolean;
  onClose: () => void;
};

type EntryMode = 'explicit' | 'duration' | 'open';
```

The mode switch is a segmented control with **three** items, all first class: `Přesně od–do` (`Explicit_Mode`), `Jen délka` (`Duration_Mode`) and `Od posledního` (`Open_Mode`). In `Duration_Mode` and `Open_Mode` with no start given, the dialog shows the `Placement_Anchor` **the `Dry_Run` returned**, labelled as an inference rather than as an input. It is not computed in the browser: the anchor is a reconciliation rule, the preview already runs on every field change, and a second implementation of that rule would drift from the server exactly like a second implementation of clipping. In `Open_Mode` neither an end nor a duration is offered at all: the request carries the project, the description and the date, and the server resolves the interval.

**Which project `Quick_Log` sends.** `projectId` is required by the server, and the pill has no picker, so it resolves one before posting: the `Project` of the most recent `Activity_Entry` of the displayed `Logical_Day`; failing that, the most recent of any day, which the day payload's project totals and the projects list together answer; and failing *that* — a database with no project in it at all — the pill does not post. It opens the `Activity_Dialog` in `Open_Mode` with focus on the `Project_Picker`, which is also where the first project gets created. The pill always names the project it will send, so a one-tap log is never a blind one.

`Open_Mode` is reachable **from both** the dialog and the `Quick_Log` pill. The pill is the one-tap path for the common case; the dialog's third mode is the same request with a description and a project picker attached. Both post the identical body, so the anchor rule stays in exactly one place — on the server, where a shell script gets the same behaviour.

Prefill sources, in precedence order: an explicit `prefill` from a clicked gap; then the `Project` and description of the most recent entry of the day; then empty.

### 7. Timer Control (`src/modules/timer/`)

```ts
// elapsed.svelte.ts — a rune-based store
export function createElapsed(initial: { openedAt: Date | null }): {
  readonly runningSeconds: number;      // ticks locally once per second
  readonly stale: boolean;
  sync(state: CurrentSessionResponse): void;
  start(): void;
  stop(): void;
};
```

The store holds **one** number: the elapsed seconds of the open session, which is exactly what `GET /api/sessions/current` returns. It carried a `trackedSecondsToday` as well, and that was a mistake — the endpoint does not return it, so nothing could refresh it. The day's totals come from the page data, and the page data is invalidated on the same `visibilitychange` that syncs the timer, so both are fresh at the same moment and neither is derived from the other.

The store ticks with `setInterval` but never treats its own count as truth: `sync()` replaces it whenever the server answers — on load, on `visibilitychange` back to visible, and after every start or stop. The tab title is written from the same store, so it cannot disagree with the on-screen readout.

**The logical day rolls over while the page is open.** At `DAY_START_HOUR` the current `Logical_Day` changes, and a page left open overnight would otherwise show yesterday's totals beside a running timer that now belongs to today. The layout schedules a single timer for the next boundary, computed in the server's zone, and on firing re-resolves the current day and invalidates the page data. For a user who routinely works past midnight this is a nightly event, not an edge case.

Start and stop are form actions with `use:enhance`; the store applies the change optimistically and rolls back if the action fails, showing the reason.

`ProjectLegend.svelte` renders the swatch-and-name row beneath the gauge from the day's `byProject` totals, closing with the dashed `Uncovered_Time` entry.

### 8. Project Picker (`src/modules/projects/components/ProjectPicker.svelte`)

A combobox over non-archived projects with substring search, keyboard navigation, and a "create <typed name>" row when nothing matches. Creation posts to `/api/projects` and inserts the result without closing the surrounding dialog. Each option shows its `Palette_Slot` swatch next to the name, never the swatch alone.

### 9. Statistics (`src/modules/stats/`)

| Component | Form | Why this form |
|---|---|---|
| `KpiRow` | four figures in panels | the four totals of the range, read before anything is compared |
| `CoverageMeter` | 4 px meter under the percentage | one ratio reads better as a figure with a bar than as a chart |
| `ProjectBreakdown` | one row per project: swatch, name, duration, share, bar | comparing magnitudes across a nominal category; a donut makes small shares unreadable |
| `DayRhythm` | one 22 px strip per `Logical_Day` on a shared `DAY_START_HOUR → DAY_START_HOUR` axis | shows **where in the day** the work fell — the thing totals cannot tell you, and why a night pattern is visible at a glance |
| `RhythmPanel` | plain figures | days worked, average, longest day, `longestBlockSeconds`, total blocks, `eveningSeconds` — the time after the `Evening_Hour` |

```ts
/** What `query.ts` hands the page, mapped straight from GET /api/days?include=intervals. */
type StatsRange = {
  days: DaySummary[];               // date, trackedSeconds, coveredSeconds, uncoveredSeconds,
                                    //   sessionCount, longestBlockSeconds, overtimeSeconds,
                                    //   eveningSeconds, byProject[] — and intervals when included
  /** False when the range exceeded MAX_INTERVAL_RANGE_DAYS and the server dropped the intervals. */
  intervalsIncluded: boolean;
  suggestedWindow: { start: string; end: string };
};

type DayRhythmProps = {
  days: DaySummary[];               // each carrying its intervals
  /** From the server, never a literal — the axis runs dayStartHour → dayStartHour. */
  dayStartHour: number;
  timeZone: string;
  today: string;
  onDayActivate: (date: string) => void;
};
```

`DayRhythm` is rendered only when `intervalsIncluded` is true, so it never has to defend itself against missing intervals. The page, not the component, owns that branch.

**The window suggestion is advice, not a control.** `GAUGE_START` and `GAUGE_END` are server configuration with no write endpoint, so the suggestion renders as the two values to put in `.env` followed by a restart — never as a button, which would look broken the moment it was pressed. If the window ever becomes editable it becomes a `001` endpoint first.

The figures the statistics page reads by name, so no one has to guess which field carries which number: `trackedSeconds`, `coveredSeconds`, `uncoveredSeconds` for the `KPI_Row` and the coverage meter; `overtimeSeconds` for the fourth card; `sessionCount`, `longestBlockSeconds` and `eveningSeconds` for the rhythm panel; `byProject[]` for the breakdown. `eveningSeconds` is measured against the `Evening_Hour` the server is configured with — the interface renders that hour in the panel's label and never assumes 21:00.

`DayStack` — a stacked vertical bar per day — is **not** part of this design. The `Day_Rhythm_Strip` replaced it: a stacked bar repeats what the `KPI_Row` and the breakdown already say, while the strip answers a question nothing else does.

All five components follow the mark specs: 2 px surface gaps between adjacent segments and bars, rounded data-ends, recessive gridlines, hover tooltips, and a legend whenever two or more projects appear. Every chart is accompanied by its numbers in text, which is also what satisfies Requirement 12.13.

`DayRhythm` strips are activatable and navigate to that day page. Because their segment offsets would otherwise be inline percentage styles, the strip renders as an inline `<svg>` with `<rect>` elements — an SVG attribute is not CSS and the CSP does not touch it.

### 10. Theme (`src/lib/theme/theme.svelte.ts`, `src/app.html`)

```ts
/** What the user chose. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is actually painted. */
export type Theme = 'dark' | 'light';

/** Resolves a preference to a Theme; 'system' reads prefers-color-scheme, defaulting to 'dark'. */
export function resolveTheme(preference: ThemePreference): Theme;
/** Sets data-theme on <html>, persists the preference, and updates the runes. */
export function setThemePreference(next: ThemePreference): void;
export const theme: { readonly preference: ThemePreference; readonly current: Theme };
```

The distinction matters: the `Theme_Switcher` is three-way (`Systém` / `Světlý` / `Tmavý`) and its default is `system`, so what is persisted is the **preference**, not the resolved theme. While the preference is `system` the store listens to `matchMedia('(prefers-color-scheme: dark)')` and re-resolves when the browser flips at dusk — a stored `dark` would not do that.

Both themes live in `theme.css` as `[data-theme='dark']` and `[data-theme='light']` blocks over a `:root` default, so switching is one attribute write with no reload and no flash.

The first paint is handled in `app.html` by a **nonced** inline script — `<script nonce="%sveltekit.nonce%">` — that reads the persisted preference, resolves it against `prefers-color-scheme` and sets `data-theme` before the body renders. `001` fills the nonce through `transformPageChunk`, so the script satisfies `script-src 'self' 'nonce-…'` without weakening the policy. This is the only script in `app.html`, and it does nothing but set one attribute.

### 10a. Settings Menu (`src/lib/ui/layout/SettingsMenu.svelte`)

```ts
type SettingsMenuProps = {
  /** Below 768 the menu renders as a modal bottom sheet, above it as an anchored menu. */
  density: Density;
};
```

One component for both presentations, because the content is identical and only the container differs: an anchored popover positioned under the chip, or a sheet pinned to the bottom edge over a full-viewport scrim. It owns the `Theme_Switcher`, the `Locale_Switcher` and the logout form — the only logout control in the interface.

Modality on mobile is where this component earns its own section. The scrim covers the page content **and** the bottom navigation, and the sheet sits above the scrim. **Nothing beneath the scrim may carry an `opacity` of its own**: any value below 1 creates a stacking context, and the bottom navigation then paints over the sheet no matter what `z-index` the sheet is given. Dimming comes from the scrim and from nowhere else. The same rule already applies to the two write dialogs; it is stated here because this is the surface that has an element pinned above the page underneath it.

Escape, an activation outside the container, and choosing logout all close it, and focus returns to the chip. Open state is component-local — there is nothing to persist about a menu.

### 11. Internationalization (`src/lib/core/i18n/`)

Follows the workspace pattern exactly: `@inlang/paraglide-js` with flat snake_case keys in `messages/cs.json` and `messages/en.json`, compiled into `src/lib/paraglide/`, imported as `import * as m from '$lib/paraglide/messages'`.

**The locale is resolved on the server, exactly like the theme.** Resolving it in `onMount` over an English base would server-render English and switch to Czech on hydration — the same flash the theme avoids — and would emit the wrong `lang` on `<html>` for the whole SSR pass, which is a correctness problem for a screen reader, not only a visual one.

So: `switchLocale()` writes a `locale` cookie (a year, `SameSite=Lax`, not `HttpOnly` — the client reads it too); the root `+layout.server.ts` reads that cookie, falls back to `Accept-Language`, and falls back again to **Czech**; the resolved locale goes into `app.html` through the same mechanism as the theme, so `<html lang>` is correct in the first byte. Client-side switching stays instant through `overwriteGetLocale` / `overwriteSetLocale` over a `$state` rune in `state.svelte.ts`; `switchLocale()` strips the hash with `history.replaceState` before changing and updates `document.documentElement.lang`.

**Czech is the fallback everywhere.** Not Czech in one place and English in another: the cookie, the `Accept-Language` negotiation and the final default all end at Czech. `baseLocale` stays `en` because that is what Paraglide compiles message ids against — it is not a user-facing default and must not be read as one.

**Plurals are not optional in Czech.** Czech selects between one / few (2–4) / many (5+), and this interface counts things constantly: `2 záznamy` against `5 záznamů`, `Bloky práce 3`, `6 ze 7 dnů`, `část 2 ze 3`. Every message carrying a count is declared with plural forms and called with the number; a flat string with the count interpolated is wrong in Czech for two thirds of the values it can take. The English forms are the trivial two-way case, which is precisely why this breaks silently if only English is checked.

Key naming follows the workspace's domain prefix convention: `common_*`, `errors_*`, `timer_*`, `day_*`, `activity_*`, `session_*`, `projects_*`, `stats_*`.

The server sends the key: every error envelope carries `messageKey` beside the English `message`, so the interface renders `m[messageKey]()` and never derives, parses or displays the raw `error` code. `001` owns the code-to-key mapping in one function; a test asserts every key it can emit exists in both message files.

### 12. Formatting (`src/lib/viz/format.ts`)

```ts
/** "2 h 14 min" — never a bare decimal of hours. Below a minute renders as "< 1 min". */
export function formatDuration(seconds: number, locale: string): string;
/** "14 h 15" — the hero and timer-figure form on mobile, unit dropped. */
export function formatDurationShort(seconds: number, locale: string): string;

/**
 * Every wall-clock rendering and every parse goes through these, in the SERVER's
 * zone — never the device's. `/api/health` reports it; the root layout loads it once.
 */
export function formatTimeOfDay(t: Date, locale: string, timeZone: string): string;
export function formatDayLabel(date: string, locale: string, today: string): string;
export function parseTimeOfDay(text: string, date: string, timeZone: string): Date;
```

Passing the zone explicitly is what closes a whole class of bugs: a laptop set to the wrong zone would otherwise render times in local time while the day boundaries came from Prague, and a hand-typed "14:00" would be sent with the device offset and clipped away as outside `Tracked_Time`. When the two zones differ the shell says which one the times are in.

Timestamps arrive as RFC 3339 strings and are revived into `Date` at the boundary — the load function for server-rendered data, `dry-run.ts` for `fetch` responses. Nothing downstream handles a string where the types say `Date`.

## Data Models

The interface adds no persistent state. It holds four pieces of client state:

| State | Lives in | Lifetime |
|---|---|---|
| Active locale | `state.svelte.ts` rune, mirrored to `localStorage` | across visits |
| `Theme_Preference` and the `Theme` it resolves to | `theme.svelte.ts` runes, the preference mirrored to `localStorage` | across visits |
| Elapsed tick, dialog and `Settings_Menu` open state, pending preview | component-local runes | the page view |
| Aborted-request controllers | `dry-run.ts` module scope | one dialog session |

Nothing about the timer, the day or the projects is cached in the browser. Requirement 3.10 exists because a cached timer state that survives a server-side change is worse than no cache at all.

## Correctness Properties

### Property 1: The gauge mapping is monotone and turns exactly once per day

*For any* pair of instants `a < b` within one calendar day, `angleOf(b) − angleOf(a)` SHALL equal `(b − a)` in minutes × 0.25, SHALL be strictly positive, and SHALL equal exactly 360 when `b − a` is 24 hours — so the mapping is strictly increasing, uniform, and completes exactly one turn per 24 hours regardless of the `Gauge_Window`.

**Validates: Requirements 16.1, 16.18**

### Property 2: A laid-out day fits its budget and keeps every block clickable

*For any* set of `Work_Session` and `Activity_Segment` records and any `availablePx` at least

```
MIN_BLOCK_PX × segmentCount  +  Σ BLOCK_HEAD_PX  +  Σ BREAK_MARKER_PX  +  Σ BLOCK_GAP_PX
```

— that is, at least the space the fixed rows and the floors already claim — the layout returned by `layOutDay` SHALL satisfy both invariants at once: the sum of every block height, every block head, every `Break_Marker` and every gap SHALL be at most `availablePx`, **and** every `LaidOutSegment.heightPx` SHALL be at least `MIN_BLOCK_PX` for the density.

The premise has to name all four terms. Two segments in two sessions at `availablePx = 72` satisfies `MIN_BLOCK_PX × 2` and is still impossible — two heads and a `Break_Marker` have to go somewhere — so a generator built on the shorter premise fails on its first case for a reason that is not a defect. Below the premise the floor wins and the page scrolls, which is a stated behaviour rather than an invariant to prove.

**Validates: Requirements 4.3, 4.20, 4.23, 14.3**

### Property 3: The gap is never graduated

*For any* `Gauge_Window` the server can report and any coverage of the day up to and including 24 hours, `graduations()` SHALL return only marks whose angle lies within `[trackStart, trackEnd]`, and SHALL never return a mark or a label for an instant inside the `Gauge_Gap`.

**Validates: Requirements 16.2, 16.9, 16.12**

## Error Handling

Server error codes from `001` map to interface behavior:

| Code | Where it surfaces | Behavior |
|---|---|---|
| `VALIDATION_ERROR` | beside the field named in `details.fields` | keeps the user's input, focuses the first bad field |
| `INVALID_INTERVAL` | beside the time fields | inline message |
| `AMBIGUOUS_MODE` | the dialog's mode switch | cannot occur through the interface; treated as an internal error if it does |
| `ACTIVITY_OVERLAP` | `Change_Preview` and on submit | names each conflicting entry and offers to open it |
| `SESSION_OVERLAP` | `Session_Dialog` | names the conflicting sessions, confirm stays disabled |
| `OUTSIDE_TRACKED_TIME` | `Change_Preview` | shown with the `Untracked_Policy` choice, since `extend` resolves it |
| `NO_PLACEMENT_ANCHOR` | `Activity_Dialog` in `Duration_Mode` or `Open_Mode`, and `Quick_Log` | explains that the day has nothing to anchor to and asks for an explicit start |
| `SESSION_ALREADY_RUNNING` · `NO_SESSION_RUNNING` | `Timer_Control` | resyncs from the server and shows what the real state is |
| `PROJECT_EXISTS` | beside the name field | inline message |
| `PROJECT_IN_USE` | projects page | explains and offers archiving instead |
| `PROJECT_ARCHIVED` | `Project_Picker` | explains the project is archived and offers unarchiving it |
| `FUTURE_TIMESTAMP` | beside the offending time field | inline message; the field caps at now |
| `INTERVAL_TOO_SHORT` | beside the time fields | states the minimum |
| `STALE_PREVIEW` | `Change_Preview` | recomputes the preview and asks for confirmation again |
| `NOTHING_TO_LOG` | `Quick_Log` and `Open_Mode` in the dialog | explains there is nothing new since the last entry |
| `RANGE_TOO_LARGE` | statistics range control | falls back to the last valid range |
| `NOT_FOUND` | any list or dialog | says the record is gone, refreshes the day |
| `PAYLOAD_TOO_LARGE` | `Activity_Dialog` | points at the description length |
| `RATE_LIMITED` | toast | shows the retry delay |
| `INTERNAL_ERROR` | toast with a retry action | keeps the input, offers to report the `requestId` |
| `UNAUTHORIZED` | any browser-issued request | navigates to `/login?next=<path>&reason=session_expired` |
| network failure | connection error page or toast with retry | the dialog stays open with its input intact |
| uncaught client error | `hooks.client.ts` → `+error.svelte` | the same surface as a failed request, never a blank page |

A write that succeeds but reports `discarded` intervals or `unplacedMinutes` is **not** shown as a plain success. The confirmation names what did not fit and offers to open the affected day range, satisfying Requirement 15.6.

**The session-expired message.** `001`'s `Auth_Hook` redirects an unauthenticated *navigation* to the login route carrying only the requested path, so a server-issued redirect cannot say whether a session expired or never existed, and the login page stays silent. The message exists for the other case: when the browser's own `fetch` — a `Dry_Run`, the timer refresh, inline project creation — receives `UNAUTHORIZED`, the interface navigates to the login route itself and appends `reason=session_expired`. That is the only source of the message, and Requirement 2.7 pins it.

## Testing Strategy

**Unit tests** (Vitest, node) — `tests/modules/timer/components/gauge-geometry.test.ts` pins the mapping: one hour is exactly 15°; the same clock time yields the same angle on any date; the default window produces a 270° track and a 90° gap; graduations exist only inside the window and carry the three levels with the right lengths; `03` is never labelled; an instant past the window returns an angle beyond `trackEnd` rather than being clamped; a full day closes the circle without adding a graduation.

`tests/modules/day/components/timeline-geometry.test.ts` covers `layOutDay`: one block per session; breaks between blocks become markers and a break of an hour or more is marked `long`; segment heights are proportional **within** a block; a twenty-minute segment still receives `MIN_BLOCK_PX`; `showsDescription` is true only at 60 px and above and never at mobile density; an uncovered stretch under `MIN_UNCOVERED_SECONDS` produces no block; a stale open session ends at `startedAt + MAX_OPEN_SESSION_HOURS` however long ago it was opened; a day of 08:00–03:00 with a four-hour break lays out without exceeding the available height; and the three extremes — fifty entries, one entry, one break — behave as the algorithm's table says.

`tests/lib/viz/format.test.ts` covers duration, time and day-label formatting in both locales, including "today" and the mobile short form, and pins that a time renders in the server zone rather than the device zone. `tests/lib/viz/palette.test.ts` asserts the eight slots match the design table exactly in both themes, that `projectSlotClass` wraps an index of 8 to `pj-0`, and that no slot equals `--destructive` in either theme.

**Property tests** (Vitest + `fast-check`, node) — one file per property, tagged in the test name so a failure traces back to the design: `tests/modules/timer/components/gauge-geometry.property.test.ts` for Properties 1 and 3, `tests/modules/day/components/timeline-geometry.property.test.ts` for Property 2. Property 2 is the invariant that killed the proportional axis, and it is not optional.

**Component tests** (Vitest, jsdom, `@testing-library/svelte`) — mirrored under `tests/modules/<feature>/components/`. `DayTimeline` renders one block per session and per segment, marks uncovered stretches, orders blocks chronologically in the DOM, gives every block an accessible name containing its times, and shows the part counter on a split entry. `ChangePreview` renders both preview shapes and keeps confirm disabled while loading and on rejection. `ActivityDialog` switches between all three modes, prefills from a gap, and closes on Escape returning focus to its opener. `ProjectPicker` filters, creates inline, and is keyboard navigable. `DaySummaryPanels` renders the `Orphan_Panel` only when the day holds an `Orphaned_Entry`. `DayGauge` draws nothing in the `Gauge_Gap` and places the control at the centre. `SettingsMenu` renders the three-way `Theme_Switcher`, the two-way `Locale_Switcher` and one logout control in that order, closes on Escape returning focus to the chip, and — at mobile density — renders a scrim over the bottom navigation while setting no `opacity` on the page content or the tab bar.

**Theme and CSP tests** — `tests/lib/theme/theme.test.ts` asserts both themes define the full token set with no missing key, that the light dim and faint values are not the dark ones, that `resolveTheme('system')` follows `prefers-color-scheme` and falls back to `dark`, and that `light` and `dark` preferences ignore it. `tests/lib/theme/contrast.test.ts` computes the measured ratio of `--text-dim` and `--text-faint` against `--bg` in both themes and asserts each clears 4.5:1 — the check that would have caught dark faint at 3.38. A source-level test asserts that no `.svelte` file under `src/` contains a `style=` attribute, so the no-inline-style rule cannot rot.

**Message coverage test** — `tests/lib/i18n.test.ts` asserts that `cs.json` and `en.json` hold exactly the same key set, that every error code from the `001` table has a message in both, and that no `.svelte` file under `src/` contains a user-facing string literal outside a message call.

**E2E tests** (Playwright, `tests/e2e/`) — against a real database seeded by fixtures, `workers: 1` with a `resetDb` fixture, following the workspace pattern. Scenarios:

1. **The day in the requirements** — start the timer, stop it at the break, start again, stop at the end; then log `13:00–16:00` on a project and assert the timeline shows two blocks with the `Break_Marker` between them, the split blocks carry the part counter, and the entry list states it was split.
2. **Duration mode** — log "2 hours" with no start over the same frame and assert the segments total exactly 120 minutes across the break.
3. **Open mode from both entry points** — log through the `Quick_Log` pill and through the dialog's third mode, and assert both produce the same interval.
4. **Frame edit with preview** — shorten a session that carries an activity, assert the `Change_Preview` names the entry and the minutes it will lose and lists the lost uncovered stretch separately, cancel, assert nothing changed, then repeat and confirm, asserting the timeline updates.
5. **Filling a gap** — click an uncovered stretch, assert the dialog opens prefilled with exactly that range, save, assert the uncovered total drops to zero and the day reports itself fully described.
6. **Conflict** — log an activity overlapping an existing one and assert the conflict is named and nothing is written.
7. **Locale switch** — switch to English mid-page and assert the text changes without a reload and without losing scroll position.
8. **Settings menu** — open it from the chip on both widths; assert the desktop menu is anchored under the chip and the mobile sheet is modal with the bottom navigation under the scrim and neither the content nor the tab bar carrying an `opacity`; switch to the light theme, assert `data-theme` changes with no reload; reload and assert the light theme is applied before the first paint; switch the preference back to `system` and assert it follows the emulated `prefers-color-scheme`.
9. **Logout and session expiry** — log out from the `Settings_Menu` and assert the login page follows; then clear the cookie and assert a browser-issued request redirects to login with the session-ended message.

**Accessibility checks** — the Playwright suite runs an axe pass on the timer, day, projects and statistics pages in **both themes**, and a keyboard-only walk of the day page that reaches every block, opens a dialog, and completes a save without a pointer.

**Visual conformance** — the artboards in `.design/artboards/` are the acceptance reference. `canvas.json` holds 19; **14 are screens and all 14 are compared** (`Main`, `TimerLight`, `TimerMobile`, `DayCollapsed`, `DayCollapsedLight`, `DayMobile`, `AddTask`, `AddTaskLight`, `AddTaskMobile`, `SessionEdit`, `Projects`, `Stats`, `Settings`, `SettingsMobile`), each rendered at its own frame size against the matching PNG in `.design/screens/`. The other five — `GaugeNormal`, `GaugeOverrun`, `GaugeNonstop`, `Demo`, `DemoSideBySide` — explain the gauge and are not compared. Arrangement, relative proportion and palette must match; **exact pixel heights need not** — the block heights an artboard draws illustrate the layout algorithm rather than fixing its output, and the algorithm is what is normative. Copy and example data need not match either. This pass is **not optional**: it is the only check covering the surfaces no automated test can see.
