# Worklog — Visual Design Reference

This directory is the **visual contract** for the application. The specifications in
`.kiro/specs/` define behaviour; this directory defines what it looks like. When the two
disagree, that is a defect to be resolved — not a choice left to whoever is implementing.

```
.design/
├── DESIGN.md          this file — the tokens and rules, in prose
├── artboards/         the approved screens as .dc.html, plus canvas.json
└── screens/           the same artboards rendered to PNG for at-a-glance comparison
```

**How to use it when the app is built:** render the implemented screen at the artboard's
frame size and put it beside the matching PNG in `screens/`. The layout, proportions and
palette are expected to match. Copy and mock data are not — the artboards carry an
invented Friday 21 August as their example day.

**Regenerating the PNGs** after editing an artboard: the render script reads
`artboards/canvas.json` for each frame size and screenshots at `deviceScaleFactor: 2`.
The artboards are near-standalone HTML — the `<x-dc>` and `<helmet>` wrappers are inert
outside the design canvas, and the `<style>` and `<link>` inside `<helmet>` still apply,
so a browser renders them faithfully. `support.js` is absent and unnecessary.

---

## 0. What is settled

Everything below was decided in conversation and is settled. Four decisions were taken
after the first version of this file and are already reflected in the artboards:

1. The **corrected project palette** (§ 2) replaces the drawn one, which failed the
   data-viz validator. The artboards now carry the corrected hexes.
2. The **add-task dialog keeps its third mode** (`Od posledního`). Requirement 6.2, which
   forbade it, is being rewritten.
3. **Timeline blocks stay at 36px** desktop / 26px mobile, as an explicit exception to the
   44×44 touch-target rule.
4. **The gauge gap stays bare even when the circle closes.** `GaugeNonstop` was redrawn:
   the arc runs all the way round, but no graduation or numeral is ever added to the gap.

Several acceptance criteria in `.kiro/specs/002-worklog-ui/` still **contradict** these
artboards. They are listed in § 9 and are being reconciled.

---

## 1. Theme tokens

Two themes, both first-class. Every value below is lifted from the artboards.

### Dark — "Midnight"

| Token | Value |
|---|---|
| `--bg` | `#0F1319` |
| `--text` | `#E6EAF2` |
| `--text-dim` | `rgba(230,234,242,0.55)` |
| `--text-faint` | `rgba(230,234,242,0.40)` |
| `--accent` | `#D18A6A` |
| `--accent-hover` | `#E2A88D` |
| `--ink-on-accent` | `#1A0F0A` |
| `--panel` | `rgba(255,255,255,0.043)` |
| `--dialog` | `#171B22` |
| `--scrim` | `rgba(9,11,15,0.72)` |
| `--field` | `rgba(255,255,255,0.05)` |
| `--field-active` | `rgba(209,138,106,0.10)`, inset `1px rgba(209,138,106,0.40)` |
| `--divider` | `rgba(255,255,255,0.05)` |
| `--destructive` | `#E06A5E` |

### Light — "Daylight"

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
| `--destructive` | `#A8321F` |

The dim and faint opacities are **deliberately higher in the light theme** (0.78 / 0.66
against 0.55 / 0.40). At the dark theme's values they computed to contrast ratios of 4.17
and 2.99 against `#F3EEE6` — under AA. They are not a copy of the dark theme's numbers and
must not be "unified" back.

**One collision the implementation must not accidentally merge.** `--accent` carries both
*primary action* and *uncovered time / attention*. That is deliberate.

The second collision has been resolved: the artboards originally drew delete controls in
the pink *project* colour, so recolouring a project would have recoloured every trash icon.
`--destructive` is now its own token (5.67:1 on the dark ground, 5.79:1 on the light one)
and must never be derived from the palette.

---

## 2. Project palette

Assigned automatically by `color_index` 0–7, overridable by the user.

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

**The originally drawn palette** (`#5D8AC4 #C4708A #5FA37F #D6A55C #B07FC4 #6FA9B5
#A8A05C #C4776A`) was run through the data-viz validator against each theme's surface and
failed on four checks — most seriously green↔pink at deuteranope ΔE **1.7**, meaning a
red-green colourblind user cannot tell two adjacent projects apart at all. Four colours also
fell below the chroma floor (reading as grey) and three sat outside the lightness band. The
artboards have been repainted with the table above.

The palette above keeps every approved hue within 0–20° (only violet moved 20°) and lifts
lightness and chroma into the band. Measured, all pairs, both themes:

| Projects | CVD ΔE | Normal ΔE | Verdict |
|---|---|---|---|
| 2 | 13.8 | 25.1 | passes |
| 3 | 10.4 | 20.9 | passes |
| 4 | 10.4 | 16.8 | passes |
| 5 | 10.4 | 16.5 | passes |
| 6 | 8.3 | 8.9 | at the floor — the name must appear beside the colour |
| 7 | 4.8 | 8.8 | colour alone is not sufficient |
| 8 | 4.6 | 7.3 | colour alone is not sufficient |

**Eight mutually distinguishable categorical colours do not exist.** This was not assumed —
a search over OKLCH found the mathematical optimum for each palette size, and even the best
possible eight-colour set reaches only ΔE 6.0. Five is the practical ceiling.

The consequence is a **rule, not a caveat**: colour never carries project identity on its
own. Every surface that shows a project colour also shows the project name — the timeline
blocks, the stats breakdown, and the legend under the gauge already do. The gauge arcs are
the one exception and need a hover/tap label to close the gap.

---

## 3. Typography

**Inter Tight**, weights 300 / 400 / 500 / 600, falling back to `system-ui, sans-serif`,
with `-webkit-font-smoothing: antialiased`. Every numeric readout uses
`font-variant-numeric: tabular-nums` so digits do not jitter as the timer ticks.

| Role | Size / weight |
|---|---|
| Elapsed time (hero) | 68px / 300 / `-0.035em` — mobile 56 |
| Stats KPI | 30px / 300 / `-0.03em` |
| Timer KPI | 26px / 300 / `-0.02em` |
| Page heading | 20px / 500 |
| Dialog heading | 17px / 500 |
| Brand | 15px / 600 |
| Summary value | 15px / 500 |
| Nav, form fields | 14px |
| Project name in a block | 14px / 500 — mobile 13 |
| Buttons | 13.5px, primary 600 |
| Description | 12.5px |
| Times | 12px |
| Gauge numerals | 12px |
| Caps label (`.lbl`) | 11px / `letter-spacing: 0.16em` / uppercase — mobile 10 |

Durations read as `14 h 15 min`. Mobile drops the unit on the hero only: `14 h 15`.

---

## 4. Dimensions

Radii: 5 (bar) · 9 (icon box, segment) · 10 (block) · 11 (field, swatch) · 12 (segment
group) · 14 (panel) · 20 (dialog) · 9999 (pills).

Heights: field 44 · dialog button 42 · quick-log pill 50 · header 84 desktop / 56–60 mobile ·
bottom nav 66–68 · FAB 54 · stats strip 22.

Widths: day-page side column **290** · projects content max **940**.

**Start/stop button: 104px, icon 42** (mobile 98 / 40), halo `0 0 0 12px rgba(accent,0.09)`.
It was deliberately reduced from 132; at 132 it overpowered the gauge. There must be **66px
of clear space** between it and the inner project ring. Do not enlarge it back.

**Timeline block heights** run 98 / 96 / 74 / 60 / 38 / **36** px on desktop and
62 / 58 / 48 / 44 / **26** px on mobile. The 36px floor is a deliberate choice — a
twenty-minute task stays readable and clickable. It conflicts with the 44×44 touch-target
rule in the spec; see § 9.

The artboards use spacing values outside the 4/8/12/16/24/32/48/64 scale the spec
mandates — 7, 9, 11, 13, 14, 18, 22, 26, 30, 56, 84, 290, 940. The design does not follow
that scale.

---

## 5. The Day Gauge

The centrepiece, and the part with the most exact geometry.

**24 hours = 360°, so one hour = 15°.** A given clock time always sits at the same angle,
on every day. `angle(t) = 45 + t × 0.25` in degrees, with `t` in minutes from midnight.

The **window** is 06:00 → 00:00 — 18 hours, so a **270° track**. The remaining 6 hours
(00:00–06:00) are a **90° bare gap** at the bottom, centred on 03:00. Verified from the
SVG: 06:00 sits at 135°, 09:00 at 180°, 15:00 at the top, 21:00 at the right, 00:00 at 45°.

Geometry: box 340×340 (mobile 300), `viewBox="-22 -22 364 364"`, centre 160/160, outer
radius 138, inner radius 118. Graduations run from r=146 outward: hourly to 150, three-hourly
to 154, six-hourly to 156. Numerals sit at r≈166.

**Three levels of graduation**, not two:

| Level | Length | Width | Ink (dark) |
|---|---|---|---|
| hourly | 4 | 1.1 | 0.14 |
| every 3 h | 8 | 1.3 | 0.24 |
| every 6 h — 06, 12, 18, 00 | 10 | 1.5 | 0.30 |

Numerals are two-digit hours with no minutes (`06 09 12 15 18 21 00`), 12px, outside the
graduations, at `rgba(230,234,242,0.17)` — light theme `rgba(43,36,32,0.24)`. **03:00 is
never labelled**; it falls in the gap.

**Graduations exist only on the track.** The gap is bare. That is the whole point: when work
runs past midnight it does not continue along a scale, it hangs in empty space — which reads
as overtime rather than as more of the same day. Because there is nothing to read against
there, the overrun gets its own end label (filled dot r=4 in the accent at the track end, and
the time in 12px/500 accent at r≈166 on the arc's end angle).

Arc treatment: outer track groove `rgba(255,255,255,0.055)` dark / `rgba(0,0,0,0.07)` light;
inner groove `0.045` / `0.055`. **A closed session draws in `rgba(230,234,242,0.34)`; the
running session draws in the accent** — the accent marks *running*, not *overtime*.
Uncovered time is dashed: `stroke-dasharray="3 6"`, `stroke-linecap="round"`, accent at 65%
(light 75%). Stroke widths 10px outer / 6px inner.

At 24 hours of work the arc closes into a complete circle — but **the gap is still never
graduated**. The arc runs over it; no graduation and no numeral is ever added there.
Requirement 16.7 holds without exception, and `GaugeNonstop.dc.html` was redrawn to match.

A closed ring cannot be drawn as an SVG arc back to its own start point — that path is
degenerate and paints nothing. Use a `<circle>`.

**The angle is a function of the wall clock, not of position within the day.** That matters
on the two days a year that are 23 or 25 hours long: nothing about the track changes,
because the DST transition happens between 02:00 and 03:00, which is inside the gap.

---

## 6. Screen layouts

**Top bar** — `grid-template-columns: 1fr auto 1fr`: brand left, **navigation centred**,
running indicator and `CS` right. The running indicator is a 6px accent dot plus the elapsed
time in tabular figures. The active nav item is full-strength text on desktop but **the
accent colour on mobile's bottom bar** — two different treatments of "active".

**Timer page**, in order: hero elapsed time → `běží od 21:00` caption → gauge with the control
at its exact centre → **three** figures (worked / described / undescribed) → quick-log pill →
project legend. The middle figure (Covered_Time) and the legend are in the design but not in
the spec.

**Day page, desktop** — timeline left, a **290px column** right holding two panels: *souhrn
dne* (worked / described / undescribed, a 4px meter, and "81 % of worked time has a
description") and *tvar dne* (work blocks, longest unbroken, after 21:00).

The timeline is **one column of blocks with a thin 8px rail** at the left standing for the
session — not two lanes side by side. Each session is its own block with its own local time
axis; breaks between sessions collapse to a single named line
(`pauza 4 h 00 min · 17:00 – 21:00`). Long breaks are emphasised (12px/500 dim) over short
ones (11.5px faint).

Inside a block: project name 14/500 → description 12.5 dim → `08:00 – 10:15 · 2 h 15 min`
12px faint tabular. **Blocks at the 36px floor collapse to a single line** — name and time
side by side, description dropped.

Uncovered time is filled `rgba(209,138,106,0.06)` with a `1px dashed rgba(209,138,106,0.45)`
border and an accent title, in three variants: a tall block (`Zatím bez popisu` plus
`01:30 – 03:00 · 1 h 30 min — klikni a doplň`), a short block (`Bez popisu`, the time, and an
accent `doplnit` at the right), and a mobile pill.

**Mobile** — four-tab bottom navigation with custom SVG icons, a 54px `+` FAB bottom right,
and day-to-day arrows with the date centred (the next day at `opacity: 0.3`). The desktop day
page has **no** date navigation drawn, though the spec requires it.

The desktop day timeline is **already vertical**. The difference between desktop and mobile is
density, not orientation.

---

## 7. Dialogs

**Add task** — a segmented control with **three** modes: `Přesně od–do`, `Jen délka`,
`Od posledního`. Fields laid out `1fr 1fr 1.2fr`, description field 66px. The derived start
shows as a tinted box with an info icon. The preview sits **live beneath the form** and
renders the resulting segments as timeline blocks; the leftover policy is a segmented control
(`Se zbytkem:` / `Zahodit` / `Prodloužit timer`). Footer: `Esc zavře · nic se neuloží, dokud
nepotvrdíš`.

The third mode is Open Mode. **Requirement 6.2 explicitly forbids it as a dialog choice** and
routes it through Quick Log instead. Direct contradiction; see § 9.

**Edit session** — the screen the whole dry-run exists for. The new end value sits beside the
old one struck through. Each affected entry is shown in two columns, *now* → *after*, with the
total `−2 h 00 min` in the panel header, and a closing `Celkem 2 záznamy · 2 h 00 min zmizí
z výkazu.` An entry emptied completely gets prose instead of columns. Deletion is an inline
destructive-coloured text link — with no confirmation step drawn, though the spec requires one.

The two dialogs use **different preview patterns**: live-under-the-form here, a distinct
confirm state there. The design document describes only one.

---

## 8. Statistics

A four-card KPI row; a **day-rhythm strip** — one row per logical day on a shared 03:00 → 03:00
axis, hatched where undescribed, today emphasised with an accent label and
`inset 0 0 0 1px rgba(209,138,106,0.30)`, empty days as `—`; a project breakdown in project
colours descending, with `Bez popisu` separated below it; and a *rytmus týdne* panel (days
worked, longest day, total blocks), closing with a prose observation.

The bar widths in the breakdown are relative to the **largest** project while the percentages
are shares of the **total** — 100/54/14 % against 59/32/9 %. That needs deciding.

`DayStack` (a stacked bar per day) is in the spec but not in the design; the rhythm strip
replaced it. Overtime (12.12) has no home in the design.

---

## 9. Where the design and the specification disagree

These are contradictions, not omissions. Each needs a decision before implementation.

| # | Design says | Spec says | Resolution |
|---|---|---|---|
| 1 | Project palette as § 2 | `design.md` § 1 lists eight entirely different hexes, and tasks 1.6/1.7 test them | design wins — spec updated |
| 2 | Add-task dialog has three modes | Req 6.2 forbids Open Mode as a third choice | design wins — 6.2 rewritten |
| 3 | One column of blocks plus a rail | Req 4.1/4.4/4.5 describe two lanes over a shared axis | design wins |
| 4 | Desktop timeline is vertical | Req 4.13 makes vertical the sub-768px behaviour | design wins — the difference is density, not orientation |
| 5 | Blocks floor at 36px / 26px | Req 14.2 requires 44×44 targets | design wins — explicit exception |
| 6 | Timer page shows the gauge | Req 3.10 requires a compact timeline there | design wins — 3.10 dropped |
| 7 | Rhythm strip, no stacked bars | Req 12.5/12.7 require `DayStack`; 12.12 requires overtime | design wins — overtime moves into the KPI row |
| 8 | Circle closes at 24 h | Req 16.7 says the gap is never graduated | **spec wins** — artboard redrawn |
| 9 | Session edit lists uncovered time among affected entries | Uncovered time is not an `Activity_Entry`; the preview does not return it | open — needs a data decision |
| 10 | Spacing off the 4/8/12… scale | Req 14.6 mandates that scale | design wins |

Also missing from the specification entirely: the whole colour system, the typography, the
radii and component heights, the centred navigation, the project legend, the third timer
figure, the day-page side panels, and the fact that the application has two themes at all.

And drawn nowhere in the design: login and logout, the error and offline pages, the timezone
notice, stale-session and conflict states, the activity list, drag handles on session edges,
empty states, toasts, skeletons, confirmation dialogs, and the focus ring.
