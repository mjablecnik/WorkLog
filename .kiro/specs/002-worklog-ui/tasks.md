# Implementation Plan: worklog-ui

## Overview

Build the `Worklog_UI` — the browser interface of the Worklog SvelteKit application — on top of the domain, data layer and REST API delivered by `001-worklog-domain-api`, against the `Design_Contract` in `.design/`. Work proceeds outside-in: dependencies, `Design_Tokens`, both themes, the design system and i18n first, then the `Day_Timeline` that everything else hangs off, then the write dialogs with their `Change_Preview`, then the timer page with its `Day_Gauge`, then projects and statistics.

Reads are load functions and writes are form actions with `sveltekit-superforms` and the Zod schemas `001` declares; `fetch` is used only for the `Dry_Run` behind a `Change_Preview`, the timer refresh, and inline project creation. Pure geometry and formatting are unit tested in node, three design properties are covered by `fast-check`, components with `@testing-library/svelte` in jsdom, and the reconciliation-visible behavior end to end with Playwright. Four checkpoints mark the phase boundaries.

## Tasks

- [ ] 1. Foundations — dependencies, tokens, themes, shell
  - [x] 1.1 Add the interface dependencies
    - Runtime: `sveltekit-superforms` ^2.27 and its Zod adapter, `tailwindcss` ^4 with `@tailwindcss/vite`
    - Dev: `@testing-library/svelte` ^5, `@testing-library/jest-dom`, `jsdom`, `@axe-core/playwright`
    - `001` already declares `@sveltejs/kit`, `svelte`, `vite`, `zod`, `@inlang/paraglide-js`, `vitest`, `fast-check` and `@playwright/test` — do not duplicate or re-pin them
    - Commit the dependency change on its own, as `chore: add interface dependencies`
    - _Requirements: 6.10, 14.5, 14.10_

  - [x] 1.2 Self-host the Inter Tight faces
    - Download the `woff2` files for weights 300, 400, 500 and 600, `latin` + `latin-ext` subset — `latin-ext` is what Czech diacritics need — into `static/fonts/`
    - Declare the four `@font-face` rules in `src/lib/theme/theme.css` with `font-display: swap` and the same family name the artboards use
    - Do **not** link `fonts.googleapis.com`: the CSP carries no third-party style or font host, so a linked webfont is blocked and the whole type scale silently falls back to `system-ui`. The artboards link it because they are previews opened from disk
    - Confirm with `001` that the served CSP includes `font-src 'self'`
    - _Requirements: 1.24, 17.13_

  - [x] 1.3 Port the `Design_System` subset into `src/lib/ui/`
    - Rewrite every token reference as you port: surface → `--panel`, elevated → `--dialog`, border → `--divider`, muted → `--text-dim`, subtle → `--text-faint`, primary → `--accent`, on-primary → `--ink-on-accent`, danger → `--destructive`, input → `--field`. No aliasing shim and no second vocabulary
    - `BottomNav`, `Fab`, `TimeInput` and `SettingsMenu` do not exist in the template — write them from the artboards. `Modal` exists but is desktop-only and gains the full-screen mobile behaviour, and the modality of Requirements 14.20–14.24 is asserted here rather than assumed from it
    - `TimeInput`: a text field accepting `HH:MM` with keyboard stepping, 44 px tall (48 on mobile), parsing through `parseTimeOfDay` in the server's zone
    - `Fab`: a 54 pixel round accent button fixed above the bottom bar, with its own drawn halo `0 0 0 10px rgba(accent,0.09)` — the FAB is not on the timer control's ratio
    - Take into the `Design_System` from `template-crm/src/lib/ui/` only what this project uses: `elements/` (Button, Badge, Icon, Input, Select, Checkbox, Spinner, Tooltip, flags), `forms/` (FormField, DatePicker, SearchInput), `layout/` (Shell, Topbar, PageHeader, Section), `overlays/` (Modal, ConfirmDialog, Toast, ToastContainer, LoadingSkeleton, toast-store), `components/` (StatCard, EmptyState, DataTable). `layout/` holds six files of which `Sidebar` and `Breadcrumbs` are dropped; it holds **no** `BottomNav` and **no** `Fab`, and `forms/` holds no `TimeInput` — those three are written, not ported, per the bullet above
    - Do **not** port a generic `Chart` component — every statistics visual in this project is bespoke
    - Keep the Svelte 5 runes API — `$props()`, `$bindable()` — and the 44 pixel minimum touch target for everything except the `Day_Timeline` blocks
    - Mark every required field as required, and give every control a pointer cursor with distinct hover, active and disabled states from the one derivation rule
    - Every segmented control is a `radiogroup`: one tab stop for the group, arrow keys between its options
    - Take icons from the artboards — they are the source of truth for their geometry — and substitute no icon set
    - _Requirements: 14.2, 14.4, 14.6, 14.13, 14.18, 14.19_

  - [x] 1.4 Write the theme stylesheets and the Tailwind entry
    - `src/lib/theme/theme.css` declares the `Design_Tokens` of the design's two token tables as CSS custom properties on `:root`, `[data-theme='dark']` and `[data-theme='light']` — background, text, dim, faint, accent, accent hover, ink on accent, panel, dialog, scrim, field, active field, divider, destructive, rail, arc, groove, dial and dash tokens
    - Each theme carries its own measured dim and faint opacities — dark **0.62 / 0.50**, light **0.78 / 0.66** — and neither pair is copied onto the other; the dark values were raised after faint measured 3.38:1, under the 4.5:1 the spec demands
    - Declare the surface tokens too — `--chip`, `--menu-border`, `--menu-shadow`, `--dialog-shadow`, `--grabber`, `--group`, `--segment-active`, `--footer`, `--row`, `--track`, `--meter-track`, `--hairline` — in both themes from the design's Surface Tokens table; no component may write a bare `rgba(255,255,255,…)`
    - Implement the interaction states as one rule, not per control: hover raises the surface alpha by 0.03 and the text one level, active by 0.06, disabled is `opacity: 0.4` with no hover and `aria-disabled`, focus is the ring. On accent-filled controls hover is `--accent-hover` and active drops the halo to 0.06
    - Give every typographic role its `line-height` from the design's table — the layout budget counts it. The 29 px block head is `round(13 × 1.4) + BLOCK_HEAD_PAD_PX` (11 desktop, 7 mobile), **not** the artboard's 8 px padding; export `BLOCK_HEAD_PAD_PX` beside `BLOCK_HEAD_PX` so the two cannot drift
    - Take the light dialog tokens from the design's table exactly — `--dialog` `#FBF7F1`, `--scrim` `rgba(43,36,32,0.38)`, `--field` `rgba(0,0,0,0.05)`, `--field-active` `rgba(165,82,46,0.10)` with an inset `1px rgba(165,82,46,0.45)`, `--divider` `rgba(0,0,0,0.07)` — all of them drawn in `AddTaskLight`, none computed
    - `--destructive` is `#E06A5E` dark and `#A8321F` light, its own token, never derived from a `Palette_Slot`; add `--hairline`, `--meter-track` and `--segment-active` (`rgba(209,138,106,0.16)` dark, `rgba(165,82,46,0.14)` light — the light accent is darker and needs less of itself)
    - `src/app.css` imports Tailwind and the theme and declares an `@theme` block mapping the tokens to Tailwind tokens
    - Declare the type scale of the design's typography table, Inter Tight 300/400/500/600 with a `system-ui, sans-serif` fallback, `-webkit-font-smoothing: antialiased`, and `font-variant-numeric: tabular-nums` on every numeric readout class
    - Declare the caps label class at 11 px / `letter-spacing: 0.16em` / uppercase (mobile 10)
    - Take radii, heights and widths from the design's dimensions section; use the 4/8/12/16/24/32/48/64 scale only where the `Design_Contract` states no value
    - Declare the five motion tokens — `--ease-standard: cubic-bezier(0.2,0,0,1)`, `--ease-exit: cubic-bezier(0.4,0,1,1)`, `--dur-hover: 200ms`, `--dur-panel: 300ms`, `--dur-shimmer: 1.2s` — and animate **exactly** the surfaces the design's Motion table lists; nothing else transitions, and the theme swap is never animated
    - The `prefers-reduced-motion: reduce` block sets every transform- and opacity-based transition to `0s` with no transform, freezes the skeleton shimmer to a flat `--panel` fill, draws the gauge arcs unswept, jumps the meter and bar widths, and drops the press scale — keeping only the `--dur-hover` colour transitions, which signal state rather than movement
    - Add a styled `::selection`
    - The focus ring is `0 0 0 2px var(--focus-gap), 0 0 0 4px var(--accent)`, with `--focus-gap` set per surface — `--bg` on the page, `--dialog` in a dialog, `--panel` in a panel, the block's `--pj-tint` on a `Segment_Block` — so the ring stays visible on accent-filled controls and on tinted blocks
    - Every interactive control gets an activation area of at least 44 × 44 through padding or a transparent `::after`, while its drawn shape stays at the size the design gives it (chip 30, icon buttons 32, day controls and segmented items 34, dialog buttons 42)
    - Author mobile-first with 768 pixels as the single breakpoint
    - _Requirements: 14.5, 14.7, 14.8, 14.9, 14.12, 17.1, 17.2, 17.3, 17.15_

  - [x] 1.5 Generate the palette and block-height stylesheets
    - `src/lib/theme/palette.css`: eight classes `pj-0` … `pj-7` per theme, each carrying `--pj` (the slot hex) and `--pj-tint` — the same colour at **0.16 alpha in the dark theme and 0.13 in the light one** — generated from `src/lib/viz/palette.ts` rather than hand-written
    - `src/lib/theme/timeline-heights.css`: classes `tl-h-26` … `tl-h-320` in 2 pixel steps — a continuous ladder, so every height the artboards draw (26, 36, 38, 44, 48, 58, 60, 62, 74, 96, 98, **106**) is a member — plus **`tl-h-fill`** (`flex: 1 1 auto`) for a block over 320 pixels, which a day with a single entry easily is
    - Generate both files with a script under `scripts/`, **commit them**, and make `bun run check` fail when regenerating produces a diff — committed so a clean checkout renders, generated so the hexes live in one place
    - No `.pj-*` class may reference `--destructive`, and no destructive control may reference a `.pj-*` class — the pink slot and the destructive colour sit close together and must stay separable
    - Distinguish a primary action from `Uncovered_Time` by shape: a filled accent pill or circle against a dashed accent outline on a 6 % accent fill
    - _Requirements: 11.9, 17.11, 17.12, 17.13, 17.14_

  - [x] 1.6 Replace the `src/app.html` scaffold `001` task 1.1 created with the server-substituted placeholders
    - Create `src/app.html` with `<html lang="%lang%" data-theme="%theme%">` plus `%sveltekit.head%`, `%sveltekit.body%` and `%sveltekit.nonce%`
    - **`002` writes the placeholders; `001` substitutes `%lang%` and `%theme%`** in its `transformPageChunk`, from the language and `Theme` its hook resolved out of the cookies. `%sveltekit.nonce%`, `%sveltekit.head%` and `%sveltekit.body%` are filled by SvelteKit itself — `kit.csp` stamps the nonce, and `001` must not inject it. Neither half does the `%lang%`/`%theme%` pair alone
    - `001` picks `%theme%` from `worklog_theme`, and only when that says `system` from `worklog_theme_resolved`; with neither it renders `DEFAULT_RENDER_THEME` (`dark`)
    - The only inline script is one nonced line for the case the server cannot know: on a first visit it resolves `prefers-color-scheme`, corrects the attribute and writes `worklog_theme_resolved`. That single correction is the one flash the interface permits, and every later visit is right in the first byte
    - No other inline script and no inline style goes into this file
    - _Requirements: 1.23, 17.5, 17.7, 17.8, 17.9, 17.10, 17.14_

  - [x] 1.7 Implement the theme store
    - `src/lib/theme/theme.svelte.ts` with `ThemePreference` (`system` | `light` | `dark`), `Theme` (`dark` | `light`), `resolveTheme(preference)`, `setThemePreference()` and a `theme` rune exposing both the preference and the resolved theme
    - **Two cookies, never one.** `worklog_theme` holds the `Theme_Preference` and is written **only** when the user touches the switcher; `worklog_theme_resolved` holds the last resolved `light`/`dark` and is written by the client from `matchMedia('(prefers-color-scheme: dark)')`, and again whenever that query changes. Merging them destroys the preference the first time the client writes
    - Never `localStorage`: the server cannot read it
    - Writing `data-theme` on `<html>` is the only way a theme is applied
    - _Requirements: 17.4, 17.5, 17.6, 17.7, 17.10_

  - [x] 1.8 Build the `Settings_Menu`
    - `src/lib/ui/layout/SettingsMenu.svelte` — one component for both presentations, taking `density`
    - The trigger is a round gear chip at the right end of the top bar: 30 pixels desktop, 32 mobile, on `rgba(255,255,255,0.07)`, holding a 16 pixel gear at `stroke-width: 1.7` in `--text`. It replaces the `CS` label the artboards used to carry
    - Desktop: a 268 pixel menu anchored under the chip at the page's right padding — `--dialog`, radius 14, `1px solid rgba(255,255,255,0.06)`, `0 18px 44px rgba(0,0,0,0.55)`, `padding: 16`, `gap: 16`
    - Mobile: the same content as a bottom sheet — `--dialog`, radius `20px 20px 0 0`, `padding: 10px 22px 26px`, `gap: 20`, with a 38 × 4 grabber of radius 9999 in `rgba(255,255,255,0.14)` centred at the top
    - Content in order: `MOTIV` over the three-way `Theme_Switcher` (Systém / Světlý / Tmavý), `JAZYK` over the two-way `Locale_Switcher` (Čeština / English), a 1 pixel `rgba(255,255,255,0.06)` divider, and `Odhlásit se` in `--destructive` with an exit icon. Segmented items are 34 tall at radius 9 and 13 px on desktop, 44 tall at radius 10 and 14 px on mobile, in a group on `rgba(255,255,255,0.04)` at radius 11 / 13 with `padding: 4` and `gap: 4`; the selected item is `rgba(209,138,106,0.16)` with accent text at 500
    - On mobile the sheet is **modal**: the scrim covers the page content *and* the bottom navigation at a lower layer than the sheet. Set **no** `opacity` on the page content or on the tab bar — an opacity creates a stacking context and the tab bar then paints over the sheet. All dimming comes from the scrim
    - Escape, an activation outside the container and choosing logout all close it, returning focus to the chip; the logout row submits the logout form action and is the only logout control in the interface
    - _Requirements: 1.6, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22, 2.5, 13.10, 17.4_

  - [x] 1.9 Set up Paraglide and the message files
    - Replace the `project.inlang/settings.json` scaffold `001` task 1.1 created: `baseLocale: "en"`, `locales: ["en","cs"]`, `pathPattern: "./messages/{locale}.json"`, the message-format and m-function-matcher plugins
    - Wire `paraglideVitePlugin` into `vite.config.ts` after `tailwindcss()` and `sveltekit()`, compiling into `src/lib/paraglide/`
    - **Do not resolve the locale at all.** `001`'s hook reads `worklog_locale`, falls back to `Accept-Language`, falls back again to Czech and puts the answer on `locals.locale`, which also fills `%lang%`. `002` seeds its rune from `locals.locale`; put no `Accept-Language` logic in `+layout.server.ts` — Czech is the single fallback in all three places, and `baseLocale: "en"` is only what Paraglide compiles message ids against, never a user-facing default
    - `src/lib/core/i18n/state.svelte.ts` overrides `getLocale`/`setLocale` over a `$state` rune seeded from `locals.locale`; `switchLocale()` writes the `worklog_locale` cookie (one year, `SameSite=Lax`, readable by the client), strips the hash with `history.replaceState` and updates `document.documentElement.lang`
    - Declare every message that carries a count with plural forms, so Czech selects one / few (2–4) / many (5+) — `2 záznamy` against `5 záznamů`, `část 2 ze 3`, `6 ze 7 dnů`, `Bloky práce 3`. A flat string with the number interpolated is wrong in Czech for most of the values it can take
    - The `Locale_Switcher` indicates the active language and changes it without a reload, without a flash and without losing scroll position
    - Create **no** `src/hooks.ts`: there is no `reroute`, no `deLocalizeUrl` and no locale prefix in any URL — the language is a cookie, and a prefix would be a second source of truth
    - Extend the `messages/cs.json` and `messages/en.json` scaffolds `001` task 1.1 created — which hold only `001`'s own error keys — to the design's full **Message Catalogue** — every key it lists, both languages, nothing invented and nothing omitted. A string that is not in the catalogue does not go on screen; if one is missing, add it to the catalogue first
    - Include the three statistics observation keys with both languages exactly as the design's table gives them: `stats_observation_nights` — `Práce po {eveningHour} padla na {nights, plural, one {# den} few {# dny} other {# dnů}} z {workdays}.` / `Work after {eveningHour} fell on {nights, plural, one {# day} other {# days}} of {workdays}.`; `stats_observation_longest` — `Nejdelší nepřerušený úsek: {duration}, {weekday}.` / `Longest unbroken stretch: {duration}, {weekday}.`; `stats_observation_idle` — `Bez práce: {idleDays, plural, one {# den} few {# dny} other {# dnů}}.` / `No work on {idleDays, plural, one {# day} other {# days}}.`
    - Two rules that hold for **every** message, not only those three: a countable noun always goes through a plural form, and **no verb ever follows a number** — Czech verb agreement would then depend on the count as well. Write noun phrases (`Nejdelší nepřerušený úsek: …`), never `Nejdelší úsek trval …`
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.9, 13.10, 13.12, 13.13, 13.14_

  - [x] 1.10 Build the application shell
    - `src/routes/+layout.svelte` renders the shell and calls `initLocale()` in `onMount`; `src/routes/+layout.server.ts` loads the current session state so the `Running_Indicator` can appear where it belongs
    - Desktop top bar: `grid-template-columns: 1fr auto 1fr`, height 84, brand left, navigation centred with the four targets, and at the right — `gap: 14` — the `Running_Indicator` (6 pixel accent dot plus elapsed in 13 px tabular figures, internal `gap: 8`) followed by the `Settings_Menu` chip
    - Mobile top bar 56–60: brand, `Running_Indicator` at 12 px, `Settings_Menu` chip
    - The `Running_Indicator` appears on the day, projects and statistics pages and **not** on the timer page, whose hero readout already states the elapsed time
    - Under 768 pixels: a bottom bar of four tabs, each an SVG icon above its label, plus the `Fab` slot for a page's create action
    - The active target carries `aria-current`, is full-strength text on the desktop bar and the accent colour on the mobile bar
    - `src/routes/+error.svelte` offers a link back to the timer page; `src/routes/offline/+page.svelte` is reached only when a page `load` fails with `SERVICE_UNAVAILABLE` or no response, carrying `?next=<path>` whose retry returns there. A later failure never navigates — it surfaces in place, so a filled-in dialog is not lost
    - Read `event.locals.today` — the current `Logical_Day` and its bounds, resolved by `001` — in the root `+layout.server.ts` and put it in context. The browser never computes a day boundary, a rollover or a zone conversion of one
    - Read the `worklog_viewport` cookie in the same load and resolve `density` and `availablePx` from it, defaulting to 1440 × 900 (desktop, `availablePx = 712`) when it is absent; on mount, measure and rewrite the cookie **only if it differs**
    - Load the server's `TIMEZONE`, `DAY_START_HOUR`, `Gauge_Window`, `MAX_OPEN_SESSION_HOURS` and `Evening_Hour` from `/api/health` once in the root layout and put them in context — all five are configurable and none may be hard-coded; every wall-clock rendering and parse uses that zone, and the shell says which zone it is when it differs from the device
    - Navigation between pages stays on the client — no full document reload
    - Render every user-supplied value through Svelte's escaping; never `{@html}` a `Project` name or an `Activity_Entry` description
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.25, 14.16, 14.17_

  - [x] 1.11 Build the login and logout pages
    - `src/routes/login/+page.svelte` — the page half only; `001` owns `login/+page.server.ts`. One password input **named `passphrase`**, a hidden **`next`** field seeded from the `next` query parameter — both declared by `001`'s `loginSchema`, which is `.strict()` and would reject any other field — and `errors_login_failed` as the one generic message on failure, for a wrong and for an empty passphrase alike
    - After success the page navigates to the carried path, or to the timer page when there was none
    - `src/routes/logout/+page.svelte` — the page half only; `001` owns `logout/+page.server.ts`. Posts the logout action reached from the `Settings_Menu` and lands on login with no authenticated view state left
    - Render `auth_session_expired` only when the login URL carries `reason=session_expired`; a redirect issued by the `Auth_Hook` carries the path alone and shows no message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

  - [x] 1.12 Implement the palette and formatting helpers
    - `src/lib/viz/palette.ts` with `PROJECT_PALETTE` — the eight `Palette_Slot` values in both themes exactly as the design table lists them — plus `PALETTE_SIZE`, `projectSlotClass(colorIndex)` wrapping at eight, and `projectColor(colorIndex, theme)` for the `Day_Gauge`, which writes SVG attributes
    - Do not add `projectColorVar` or `labelInkOn`: the first writes an inline custom property the CSP forbids, and no text is ever placed on a filled slot
    - `src/lib/viz/format.ts` with **four** duration forms and one home each: `formatClock` (`5:12:08`, hero and tab title, not localised), `formatDuration` (`2 h 14 min`, everywhere else, `< 1 min` below a minute, never a bare decimal), `formatDurationShort` (`14 h 15`, mobile hero and mobile timer figures only) and `formatDelta` (`−2 h 00 min`, preview deltas only)
    - Plus `formatTimeOfDay`, `parseTimeOfDay` and `formatDayLabel(date, locale, today, form)` with `form` one of `relative` (`dnes` / `včera`, else long), `long` (`pátek 21. srpna`) and `short` (`pá 21.`) — all locale aware and all taking the server time zone explicitly
    - _Requirements: 11.9, 13.7, 17.11_

  - [ ] 1.13 Point the form actions at the shared Zod schemas
    - Import `createActivitySchema`, `patchActivitySchema`, `createSessionSchema`, `patchSessionSchema`, `createProjectSchema` and `patchProjectSchema` from `src/lib/contracts/schemas.ts`, which `001` owns and places outside `src/lib/server/` precisely so superforms can import it in the browser
    - There is **no** `deleteSessionSchema`. A delete carries its dry-run flags as the `dry_run` and `preview_token` query parameters, validated by `deleteSessionQuery` and `deleteActivityQuery` — used by the dry-run client of task 5.1, not by superforms
    - Import the domain types the same way — `Interval`, `WorkSession`, `ActivityEntry`, `ActivitySegment` and `Project` from `src/lib/contracts/models.ts`, and `DaySummary`, `DayResponse`, `DaysRangeResponse`, `CoverageResponse`, `ActivityResponse`, `ActivityListResponse`, `SessionChangePreview`, `CurrentSessionResponse` and `HealthResponse` from `src/lib/contracts/responses.ts`. `001` splits models from response shapes across two files; both are client-safe, and a type under `src/lib/server/` cannot be imported by a `.svelte` file at all
    - Create no `schema.ts` in any `src/modules/` directory and do not edit `src/lib/contracts/schemas.ts` — it belongs to `001`
    - Feed the same schema to `superValidate` on the server and to the superforms client adapter, so browser and server validation cannot drift
    - _Requirements: 6.10_

  - [x] 1.14 Write tests for the palette, formatting, themes and i18n
    - `tests/lib/viz/palette.test.ts`: eight slots; both theme values match the design table exactly; `projectSlotClass(8)` wraps to `pj-0`; no slot equals the destructive token in either theme
    - `tests/lib/viz/format.test.ts`: durations in both locales — zero, under a minute, over a day, the mobile short form; `formatDayLabel` says today for the current `Logical_Day`; a time renders in the server zone rather than the device zone
    - `tests/lib/theme/theme.test.ts`: both themes define the same token set with no missing key; dim and faint are 0.62 / 0.50 dark and 0.78 / 0.66 light, and neither pair equals the other; `resolveTheme('system')` follows `prefers-color-scheme` and falls back to `dark`, while `light` and `dark` ignore it
    - `tests/lib/theme/contrast.test.ts`: compute the measured ratio of `--text-dim` and `--text-faint` against `--bg` in both themes and assert each clears 4.5:1 — the check that would have caught dark faint at 3.38:1
    - `tests/lib/i18n.test.ts`: `cs.json` and `en.json` hold identical key sets and both cover the design's Message Catalogue exactly — no key missing, none invented; every `ErrorCode` from `001` has its base `errors_*` key present, variants included; every message carrying a count declares Czech plural forms and renders correctly for 1, 2 and 5; every key `messageKeyFor` can emit exists in both; no `.svelte` file under `src/` carries a user-facing string literal outside a message call; no `.svelte` file uses `{@html}` on a project name or description
    - `tests/lib/ui/settings-menu.test.ts`: the menu renders the three-way `Theme_Switcher`, the two-way `Locale_Switcher` and exactly one logout control, in that order; Escape closes it and focus returns to the chip; at mobile density a scrim is rendered over the bottom navigation and neither the page content nor the tab bar carries an `opacity`; the timer page renders no `Running_Indicator` while the day page does
    - `tests/lib/csp.test.ts`: no `.svelte` file under `src/` contains a `style=` attribute
    - _Requirements: 1.8, 1.12, 1.15, 1.18, 1.19, 1.20, 1.21, 13.1, 13.2, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 14.10, 17.1, 17.3, 17.5, 17.10_

- [ ] 2. Checkpoint — the shell runs
  - Run `bun run check && bun run test tests/lib` and confirm the application starts, login works, the shell renders in both themes, the theme survives a reload without a flash, and the language switches without a reload

- [ ] 3. Day timeline
  - [x] 3.1 Implement the day layout in `src/modules/day/components/timeline-geometry.ts`
    - `layOutDay(sessions, entries, uncovered, availablePx, density, now, maxOpenSessionHours)` returns one block per `Work_Session` with its segments, plus the breaks between them
    - Follow the design's five-step algorithm exactly, because it is normative and the artboard heights are only illustrative: reserve the fixed rows — `BLOCK_HEAD_PX`, `HEAD_GAP_PX`, `BREAK_MARKER_PX`, `BLOCK_TO_BREAK_PX` **and** `BLOCK_GAP_PX`, since leaving the two gap constants out makes Property 2 false — distribute the remainder proportionally inside each block, lift anything under `MIN_BLOCK_PX` and repay the deficit from the unpinned segments in descending height order one step at a time, quantise each height **down** to `HEIGHT_STEP_PX` inside `layOutDay` and give each block's remainder to that block's tallest segment. Quantise in this one place only — the component reads `heightPx` and picks a class, it does not round
    - `availablePx` comes from the server's `viewport` cookie on first render and from the client's own measurement afterwards — a budget, not a limit: when every segment is pinned and the total still exceeds it, return the larger total and let the page scroll
    - Set `showsDescription` true only at desktop density and at 60 pixels or more; mobile never shows a description at any height
    - Produce no block for an uncovered stretch shorter than `MIN_UNCOVERED_SECONDS`, leaving it as unclaimed space inside its `Work_Block` while every total still counts it
    - Export `DESCRIPTION_MIN_PX`, `BLOCK_HEAD_PX`, `HEAD_GAP_PX`, `BLOCK_TO_BREAK_PX`, `HEIGHT_STEP_PX` and `MIN_UNCOVERED_SECONDS` alongside the existing constants
    - Keep a sub-`MIN_UNCOVERED_SECONDS` stretch in the **denominator** of the proportional split even though it gets no block, so the drawn blocks still sum to their session
    - Repay the floor deficit one `HEIGHT_STEP_PX` at a time from the tallest unpinned segment, re-sorting after each step, and do it **before** quantising
    - Mark the one block per column that exceeds 320 pixels so the component can give it `tl-h-fill` instead of a ladder class
    - Mark a segment with its part index and part count when its `Activity_Entry` was split
    - Mark a break `long` at `LONG_BREAK_SECONDS = 3600` or more
    - Mark a block `running` for an `Open_Session`, `continues` when the session runs past the displayed `Logical_Day`, and `capped` when the session is a `Stale_Session` — a capped block ends at `startedAt + MAX_OPEN_SESSION_HOURS`, the limit read from the `Health_Endpoint`, which is exactly where the server stops counting it, so the picture cannot exceed the figure beside it
    - Export `MIN_BLOCK_PX`, `BLOCK_GAP_PX`, `BREAK_MARKER_PX` and `LONG_BREAK_SECONDS`; plain TypeScript with no DOM access
    - _Requirements: 4.2, 4.3, 4.8, 4.9, 4.17, 4.18, 4.19, 4.20, 4.21, 4.23, 4.25, 10.4_

  - [x] 3.2 Write unit tests for the day layout
    - `tests/modules/day/components/timeline-geometry.test.ts`: one block per session; breaks between blocks become markers and a break of an hour or more is `long`; heights proportional within a block; a twenty-minute segment gets `MIN_BLOCK_PX` at both densities; `showsDescription` is true at 60 px desktop and false at 59, and false at every mobile height; an uncovered stretch of 2 minutes produces no block; a stale open session ends at `startedAt + MAX_OPEN_SESSION_HOURS`; a day of 08:00–03:00 with a four-hour break fits the available height; and the three extremes — fifty entries, one entry, one break — behave as the design's table says
    - _Requirements: 4.2, 4.3, 4.9, 4.18, 4.19, 4.21, 4.23, 4.25_

  - [x] 3.3 Write the day-layout property test
    - `tests/modules/day/components/timeline-geometry.property.test.ts` with `fast-check`, tagged `Feature: worklog-ui, Property 2: Layout budget and clickable floor`
    - **Property 2: A laid-out day fits its budget and keeps every block clickable** — for any sessions and segments, and any `availablePx` of at least `MIN_BLOCK_PX × segments + BLOCK_HEAD_PX × blocks + HEAD_GAP_PX × blocks + BLOCK_GAP_PX × (segments − blocks) + BREAK_MARKER_PX × breaks + BLOCK_TO_BREAK_PX × 2 × breaks`, the sum of every height, head, marker and gap is at most `availablePx` **and** every segment height is at least `MIN_BLOCK_PX`
    - The premise must name all four terms: two segments in two sessions at `availablePx = 72` satisfies `MIN_BLOCK_PX × 2` and is still impossible, because two heads and a marker have to go somewhere — a generator built on the shorter premise fails on its first case for a reason that is not a defect
    - **Validates: Requirements 4.3, 4.20, 4.23, 14.3**

  - [x] 3.4 Build `WorkBlock`, `SegmentBlock` and `BreakMarker`
    - `WorkBlock` renders the head — start, end and total duration, `13/500` tabular beside `4 h 30 min v kuse` at 12 faint — then a row holding the `Session_Rail` (8 pixels desktop, 6 mobile, radius 4, spanning the segment column) and the segment column with a 4 pixel gap
    - `SegmentBlock` renders one `Segment_Block` per `Activity_Segment`: radius 10 (mobile 9) with `--pj-tint` background and a 3 pixel `--pj` left border applied through the `pj-<n>` class, never an inline style, and carries project name → description → times. The description appears only where `showsDescription` is true — 60 pixels and above, desktop only; **mobile never draws one**. At `MIN_BLOCK_PX` the name and times share a single row
    - The head is 29 pixels tall (24 mobile) and adds `· noční` when any part of its session falls at or after the `Evening_Hour` of its `Logical_Day`
    - `Split_Marker`: every block of a split entry carries the part counter as text through a pluralised message (`část 2 ze 3`, `· 2/3` when collapsed), a 7 pixel `--pj` continuation notch on the edge facing the break, and a shared `data-entry-id` that raises the tint of all parts by half again (0.16 → 0.24 dark, 0.13 → 0.20 light) and outlines them on hover or focus of any one of them
    - `Uncovered_Marker` in its four variants — desktop tall, desktop at the floor with a `doplnit` action at the right, mobile at 44 pixels or more with the `doplnit` pill, mobile below 44 down to `MIN_BLOCK_PX` with title and duration only and the whole block as the target — all on the 6 % accent fill with a `1px dashed` accent border (0.45 dark, **0.52 light**) and the accent title. A stretch under `MIN_UNCOVERED_SECONDS` gets no block at all
    - `BreakMarker` collapses the `Untracked_Time` between two blocks into a centred label between dashed `--hairline` rules indented past the rail; a short break is 11.5 faint, a `Long_Break` is 12/500 dim with more vertical padding; the desktop label carries the bounds, mobile drops them
    - Apply the computed height through a `tl-h-<px>` class, or `tl-h-fill` for the one block over 320 pixels
    - Follow the design's element tree exactly: a `<section>` per block, the head's button beside the rail rather than around it, the rail a container of three sibling buttons (two 12 pixel edges and the middle), the segments an `<ol>` of `<li>` each holding one button, and the `Break_Marker` a `role="separator"` with a label. **A button inside a button is invalid HTML** and is what the naive nesting would produce
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 4.18, 4.19, 4.20, 4.21, 4.22, 4.24, 4.25, 7.1, 7.2, 10.2, 10.7, 11.9, 11.11, 14.3, 14.11, 17.11_

  - [x] 3.5 Build `DayTimeline` and wire the activation handlers
    - Render the blocks and `Break_Marker` rows in chronological DOM order from `layOutDay`; every block is a `<button>` with an `aria-label` carrying its times, project, description and part counter
    - Props carry `density`, not `orientation` — the timeline is vertical at every width and differs only in density; there is no `compact` variant and no `bounds` prop
    - An `Open_Session` is drawn continuing to now and marked as running; a `Stale_Session` block additionally states that the timer is running but no longer counting; a session continuing past the day is marked as continuing and its true end is named in the head
    - Props are `density` and four callbacks — there is no `editable` and no `onSessionResize`, both leftovers of the dropped drag. Activation is emitted, not handled: `onActivityActivate` from a `SegmentBlock`, `onSessionActivate` from a block head or the rail's middle, `onSessionEdgeActivate` with `'start' | 'end'` from a rail edge, `onUncoveredActivate` from an uncovered stretch carrying that exact interval. The day page opens the dialogs in tasks 5.5 and 5.6, so the timeline never depends on a component built later
    - Hover or focus on a block reveals its times, project and description; keyboard focus moves between blocks in chronological order
    - An empty `Logical_Day` renders an empty state inviting the user to start the timer
    - Measure the column height and pass it as `availablePx`, recomputing on resize; when the layout exceeds it the column scrolls rather than compressing a block below the floor. The mobile artboard's `overflow: hidden` is a drawing convenience, not the contract
    - _Requirements: 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.23, 14.5_

  - [x] 3.6 Write component tests for `DayTimeline`
    - `tests/modules/day/components/day-timeline.test.ts`: one block per session and per segment; uncovered stretches marked; blocks in chronological DOM order; every block has an accessible name containing its times; an entry split into two segments shows the part counter on both parts and links them on hover; a running session is marked; a block at the floor renders one line; a mobile block never renders a description; a session touching the `Evening_Hour` is marked `noční`; the empty day shows the empty state
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 4.8, 4.14, 4.15, 4.16, 4.21, 4.24, 7.1, 7.2_

  - [x] 3.7 Build the day page and its navigation
    - `src/routes/day/[date]/+page.server.ts` loads the day from the store; `+page.svelte` renders `DayPage`
    - The heading line carries the date, the day's first and last tracked instant and its total `Tracked_Time`
    - `DayNav` offers previous and next day controls and a date picker, disables next on the current `Logical_Day` and draws it at reduced opacity, and labels the current day as today; on desktop the controls sit left of the date in the heading line, on mobile they are the 44 pixel date row
    - An invalid date in the URL renders the error page
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.8 Build the day summary panels
    - `DaySummaryPanels` renders the 290 pixel side column on desktop and moves below the timeline on mobile
    - *souhrn dne*: `Tracked_Time`, `Covered_Time` and `Uncovered_Time` as label-value rows with the uncovered value in the accent, a 4 pixel meter on `--meter-track` showing the described share, that share as a sentence, and a statement that the day is fully described when there is no `Uncovered_Time` left
    - *tvar dne*: the number of `Work_Block` groups, the longest uninterrupted `Work_Session`, and the `Tracked_Time` after the `Evening_Hour`
    - *mimo výkaz* — the `Orphan_Panel`, drawn in `DayCollapsed` and rendered **only when the day holds at least one `Orphaned_Entry`**: `--panel` at radius 14, `padding: 16`, `gap: 11`, with a `1px solid rgba(209,138,106,0.28)` accent border that the other two panels do not have. Head: the caps label `mimo výkaz` in `--accent` with the count at 11 `--text-faint` right, then the explanation at 12 `--text-dim`. One row per entry at `padding: 9px 11px`, radius 9, `rgba(255,255,255,0.035)`, a 3 pixel `--pj` left border, the project at 12.5/500 over `žádáno 17:00 – 18:30 · zbylo 0 min` at 11.5 `--text-faint`. Two equal actions at the foot, `gap: 8`, radius 8, 12 px: **Přepsat čas** on a `rgba(209,138,106,0.14)` accent tint at 500, **Smazat** on `rgba(255,255,255,0.05)` in `--text-dim`
    - It needs its own place because an entry with no `Activity_Segment` has no position on the `Day_Timeline` at all; when the day holds none, render no panel at all rather than an empty one
    - Build **no** `ActivityList` and **no** `UncoveredList`: the `Day_Timeline` is the day's list of both, and a second rendering of the same records would be two things to keep in sync
    - _Requirements: 7.9, 7.10, 7.11, 10.1, 10.5, 10.8_

- [ ] 4. Checkpoint — the day is visible
  - Seed a day with a break and an activity spanning it, then confirm the timeline draws two `Work_Block` groups with the `Break_Marker` between them, the split blocks carry the part counter, the uncovered stretch is drawn in place, and the summary panel's totals match what the timeline shows

- [ ] 5. Writes and the change preview
  - [x] 5.1 Implement the dry-run client in `src/modules/day/dry-run.ts`
    - Five functions, because five writes can destroy something: `previewCreateActivity`, `previewPatchActivity`, `previewCreateSession`, `previewPatchSession` and `previewDeleteSession`. Each maps the response into `ActivityPreview` or `SessionPreview`, keeping the server's field names and holding the segments inside `entry`
    - `DELETE /api/sessions/{id}` has no body, so it carries `dryRun` and `previewToken` as **query parameters**
    - Carry `anchor` and `slivers` through from the successful response: the anchor is what the dialog displays as the inferred start, and a sliver is time that disappears — a preview that hides it lies by omission
    - Take `lostUncoveredSeconds` and `lostUncovered` from the `SessionChangePreview` response like every other figure; neither function takes the day data, and nothing in the preview is computed in the browser
    - Abort an in-flight request when the input changes again, so a stale preview can never be confirmed
    - Debounce by 400 ms; treat a non-2xx response as a `rejection` carrying the server's `messageKey`, not as a transport failure; carry `previewToken` into the confirming write and recompute on `STALE_PREVIEW`
    - _Requirements: 9.1, 9.13, 9.14, 9.15_

  - [x] 5.2 Build `ChangePreview`
    - Render in order: what will be stored, what will be lost, what is unresolved — resulting segments and their count, discarded stretches with durations, unplaced minutes, and for a session change each affected entry with its segments now beside what they would become and the duration it loses
    - The headline total is **one** number, `removedSeconds + lostUncoveredSeconds`, broken into its two parts directly beneath it; any count of affected records counts `Activity_Entry` records only, because uncovered time is not a record. This is where the artboard's `−2 h 00 min` beside `2 záznamy` comes from
    - Render `slivers` beside `discarded`, with the minimum that caused them; an entry that would be emptied is described in prose rather than as a before-and-after pair; the server's `lostUncovered` stretch is rendered last with its duration, marked as `Uncovered_Time` rather than as an entry, described in prose, and ticked in the accent rather than in a `Palette_Slot`
    - A rejection replaces the body with the translated reason and disables confirm; a loading state also keeps confirm disabled
    - When the preview reports discarded time, offer the `Untracked_Policy` choice inline with `clip` selected and `extend` available, re-running the `Dry_Run` when the choice changes
    - Write nothing until the user confirms; state in the footer that the server computed the preview
    - The body is `aria-live="polite"` and carries `aria-busy` while the `Dry_Run` is in flight, so the debounced intermediate renders are not announced and the settled outcome is announced once (Requirement 15.14)
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.16, 15.14_

  - [x] 5.3 Write component tests for `ChangePreview`
    - `tests/modules/day/components/change-preview.test.ts`: a two-segment split states the part count; discarded time is shown with its duration; unplaced minutes are shown; a session change lists each affected entry with before and after; the headline total is the sum of `removedSeconds` and `lostUncoveredSeconds` with both parts shown, while the record count counts only entries; an emptied entry is described in prose; a lost uncovered stretch appears as its own row marked as uncovered; a rejection disables confirm and shows the reason; the loading state disables confirm; changing the policy triggers a new preview
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.12_

  - [x] 5.4 Build `ActivityDialog`
    - A segmented control switches between **three** modes — `Explicit_Mode`, `Duration_Mode` and `Open_Mode` — all first class, matching the `AddTask` artboard's `Přesně od–do` / `Jen délka` / `Od posledního`
    - `Explicit_Mode` requires start and end; `Duration_Mode` requires a duration and leaves the start optional; `Open_Mode` offers neither an end nor a duration and submits with the project alone
    - In `Duration_Mode` and `Open_Mode` without a start, show the `anchor` the **successful** `Dry_Run` response carries, labelled as an inference rather than an input — never computed in the browser and never read out of an error payload
    - When an entry's stored segments differ from what was requested, state it above the field row at 12.5 `--text-faint` from `requestedStartedAt` / `requestedEndedAt` / `requestedDurationMinutes` — a statement, not a field
    - Lay the field row out per mode: `Explicit_Mode` day + from + to + project, `Duration_Mode` day + duration + project, `Open_Mode` day + project. The day field appears in all three
    - Below 768 pixels the dialog fills the screen exactly as `AddTaskMobile` draws it: no scrim and no radius, a 58 pixel header with a 34 pixel close button, body padding `0 20px` that scrolls, fields 48 tall at 15 px one per row, caps labels 10, the description field 62, segmented items 40 at 12.5 px with shortened labels (`Od–do`), and a footer pinned at `padding: 14px 20px 24px` over a `--divider` hairline with the buttons **stacked** — the 50 pixel primary above the 46 pixel `Zrušit`, `gap: 10`
    - The `Change_Preview` keeps its full form on mobile — resulting blocks, warning and `Uncovered_Policy` control — because it is the reason the dialog exists
    - Require a `Project`, accept an optional description, and default both from the most recent entry of the day unless a prefill overrides
    - Validate in the browser through superforms before submitting, showing messages beside the field without clearing input
    - Render the `Change_Preview` live beneath the form, updating as the input changes — not as a separate confirmation step
    - Escape dismisses the dialog and focus returns to the control that opened it; the footer states that nothing is saved until the user confirms
    - Assert the modality rather than inheriting it from the ported `Modal`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on its heading, focus moved in on open and Tab confined, `document.body` at `overflow: hidden` and the page root `inert` while open, and a scrim activation that does **nothing** — a write dialog holds unsaved input (Requirements 14.20–14.24). The same clause applies to `SessionDialog` and to every confirmation dialog
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.15, 6.16, 6.19, 7.3, 14.15, 14.20, 14.21, 14.22, 14.23, 14.24_

  - [x] 5.5 Implement activity create, edit and delete actions
    - Form actions **in `src/routes/day/[date]/+page.server.ts` itself**, using `superValidate` with the shared Zod schemas and returning message keys rather than prose. Create no `src/modules/day/actions.ts`: only `+page.server.ts` and `+server.ts` may import `lib/server/**`, and the boundary test enforces exactly that
    - Each action validates, then calls the matching `src/lib/server/services/` function `001` declares — `createActivity`, `patchActivity`, `deleteActivity`, `createSession`, `patchSession`, `deleteSession` — and maps a thrown `ApiError` to its message key. **Write no orchestration here:** the transaction, the clipping, the re-clipping, the `Idempotency-Key` and the `Preview_Token` check all live in the service, which is the same function `routes/api/**` calls
    - The day page offers the action that opens the dialog for a new entry — the desktop button and the mobile `Fab`
    - A metadata-only edit saves without a preview; a change to the interval or duration goes through `Change_Preview` first; an entry opened for editing is prefilled with its current values
    - Deletion sits behind a confirmation naming what will be removed
    - After any write the `Day_Timeline` updates without a full page reload
    - _Requirements: 6.1, 6.14, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ] 5.6 Build `SessionDialog` and the frame-editing actions
    - Editable start and end, a changed value shown beside the previous one struck through, reached from a `+ úsek` ghost pill in the day heading on desktop and from the mobile FAB's two-item sheet, and deletion as an inline control styled from the destructive token — never from a `Palette_Slot` — behind a confirmation naming the interval
    - A change altering existing segments shows the `Change_Preview` as a distinct confirmation state: the save action becomes confirm-and-save beside a way back to editing
    - An overlap shows which sessions conflict and does not save; an inverted interval shows the error beside the field
    - Deleting a session previews every entry that would lose time, every one that would be emptied, and the uncovered stretch that would fall outside the frame
    - The `Day_Timeline` updates without a full page reload after a change; below 768 pixels the dialog fills the screen on the same terms as the `Activity_Dialog`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 9.7, 14.15, 14.20, 14.21, 14.22, 14.23, 14.24, 17.8_

  - [ ] 5.7 Wire the session rail edges to the dialog
    - **Implement no dragging.** A block's height is proportional only within its block and every segment is clamped at `MIN_BLOCK_PX`, so the axis is non-linear the moment anything is pinned and no pixel-to-minute mapping exists that would not misreport the time being set
    - The rail's top and bottom 12 pixels are their own buttons: activating one opens the `Session_Dialog` with that end's field focused and its content selected. The rail's middle opens the same dialog with neither field focused
    - **Below a block height of 60 pixels render no edges at all** — the rail becomes one target. Three stacked targets inside 36 pixels cannot be hit reliably, and the dialog is still one activation away on the block. The edges take the same activation-area exception as a `Segment_Block`
    - Every boundary change therefore passes through a field and a `Change_Preview`
    - _Requirements: 8.7, 8.8_

  - [x] 5.8 Build the `Quick_Log` control
    - The 50 pixel pill on the timer page posts in `Open_Mode` with only the `projectId` — the server resolves the start from the `Placement_Anchor` and the end from now
    - Take `projectId`, `projectName`, `colorIndex` **and** the interval from `DayResponse.quickLog`, all resolved by the server; name the project and the interval on the pill. Never call `/api/activities` to work out a recent project, and never derive the interval
    - WHEN `quickLog` is `null` — nothing to log, or no project exists at all — the pill posts nothing: with no project it opens the `Activity_Dialog` in `Open_Mode` focused on the `Project_Picker`, and otherwise it is disabled with the reason shown
    - Display the interval the control expects from the already-loaded day data, labelled as what the server will use rather than as an input, with the outstanding `Uncovered_Time` beside it on desktop
    - Offer opening the full `Activity_Dialog` instead — the same `Open_Mode` request with a description and a project picker attached — and surface `NOTHING_TO_LOG` and `NO_PLACEMENT_ANCHOR` as plain explanations
    - _Requirements: 6.12, 6.13, 6.17, 6.18_

  - [x] 5.9 Write component tests for `ActivityDialog`
    - `tests/modules/day/components/activity-dialog.test.ts`: the mode switch offers three modes and changes the required fields; `Duration_Mode` with no start shows the inferred anchor; `Open_Mode` offers neither end nor duration; prefill from a gap fills both times exactly; defaults come from the most recent entry; a validation failure keeps the typed input; the preview renders under the form; Escape closes and returns focus to the opener
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.9, 6.10, 6.11, 6.15_

- [ ] 6. Timer page and the day gauge
  - [x] 6.1 Implement the elapsed store in `src/modules/timer/elapsed.svelte.ts`
    - A rune-based store holding **one** number — the elapsed seconds of the open session, which is exactly what `GET /api/sessions/current` returns — ticking once per second, with `sync()` replacing it from the server response, plus whether the session is stale
    - Do **not** keep `trackedSecondsToday` in the store: the endpoint does not return it, so nothing could refresh it. The day's totals come from the page data
    - Never treat the local count as truth: sync on load, on `visibilitychange` back to visible, and after every start and stop, and invalidate the page data on the same `visibilitychange` so the day's figures and the timer are fresh together
    - Schedule one timer for the end of `locals.today.bounds`, which the server supplied; on firing, invalidate the page data so the server hands back the new `Logical_Day`. The browser never computes the boundary itself
    - _Requirements: 3.3, 3.10, 3.12, 3.18_

  - [x] 6.2 Implement the gauge geometry in `src/modules/timer/components/gauge-geometry.ts`
    - `createGaugeGeometry(window, date, timeZone, cx, cy)` maps twenty-four hours onto 360° — `angleOf(t) = 45 + minutesSinceMidnight × 0.25` — so one hour is 15° and a clock time always lands at the same angle on any date
    - `arc(from, to, r)` returns an SVG path; `pointAt(angle, r)` returns a point; `graduations()` returns marks **inside the window only**, each carrying its level 1, 3 or 6 and a two-digit label on every third hour, never a label for `03`
    - Place the gap at the bottom of the circle; an instant beyond the window returns an angle past `trackEnd` — never clamped, never rescaled
    - Take the window from the server's `/api/health`, never assume it
    - Plain TypeScript with no DOM access
    - _Requirements: 16.1, 16.2, 16.3, 16.7, 16.8, 16.9, 16.10, 16.17, 16.18_

  - [x] 6.3 Write unit tests for the gauge geometry
    - `tests/modules/timer/components/gauge-geometry.test.ts`: one hour is exactly 15°; the same clock time gives the same angle on any date; the default `06:00 → 00:00` window yields a 270° track and a 90° gap centred on 03:00; the three graduation levels appear at the right hours with the right lengths; numerals are two-digit hours and `03` is never labelled; an instant past the window returns an angle beyond `trackEnd`; a 24-hour day closes the circle
    - _Requirements: 16.1, 16.2, 16.3, 16.7, 16.8, 16.9, 16.10, 16.12_

  - [x] 6.4 Write the gauge geometry property tests
    - `tests/modules/timer/components/gauge-geometry.property.test.ts` with `fast-check`
    - **Property 1: The gauge mapping is monotone and turns exactly once per day** — for any pair of instants in one day, the angular difference equals the elapsed minutes × 0.25, is strictly positive, and reaches exactly 360 over 24 hours; tagged `Feature: worklog-ui, Property 1: Gauge mapping`
    - **Property 3: The gap is never graduated** — for any window the server can report and any coverage up to a full 24 hours, `graduations()` returns only marks inside `[trackStart, trackEnd]`; tagged `Feature: worklog-ui, Property 3: Bare gap`
    - **Validates: Requirements 16.1, 16.2, 16.9, 16.12, 16.18**

  - [x] 6.5 Build `DayGauge`
    - Box 340 × 340 (mobile 300), `viewBox="-22 -22 364 364"`, centre 160/160, outer radius 138 at stroke 10, inner radius 118 at stroke 6; the `Gauge_Track` grooves cover the `Gauge_Window` only
    - Closed `Work_Session` arcs in `--arc-closed`, the `Open_Session` in `--accent`, inner arcs in their slot colour, `Uncovered_Time` dashed `3 6` with a round cap at the reduced accent opacity
    - Graduations from r = 146 outward — hourly to 150, three-hourly to 154, six-hourly to 156 — with the lengths, widths and inks of the design table; numerals in `--dial-numeral` at **tick end plus 12**, so r = 166 at the three-hourly marks and r = 168 at the six-hourly ones
    - Write arc colours as `stroke="var(--pj)"` on an element carrying the slot class, not as a resolved hex: the SVG then re-colours with the theme by itself and the gauge needs no knowledge of which theme is active
    - Every number here is a `viewBox` unit, not a CSS pixel: the 364-unit box paints into 340 px desktop and 300 mobile, so a 12-unit numeral renders at 11.2 px and 9.9 px. Say so wherever the contrast argument is made
    - The `Gauge_Gap` carries no groove, no mark and no numeral at any coverage, including a closed circle — `GaugeNonstop` draws exactly this and is the reference
    - Work outside the window renders as an `Overtime_Arc` floating in the `Gauge_Gap` — **one per stretch, so a day that began before `GAUGE_START` and ran past `GAUGE_END` draws two** — each with a filled `r=4` accent dot at the track end it left and its own 12/500 accent label at **r = 162** on its far end
    - At full coverage emit the outer arc as a `<circle>`: an arc path back to its own start point is degenerate and paints nothing
    - **Floor every arc at 1.5°** — six minutes — drawn centred on its true midpoint. At 0.25°/minute a two-minute segment is 0.5°, about one unit at r = 118, under a 6-unit round cap that would then be six times the mark it caps. The floor is cosmetic and changes no reported number: `arc()` returns the drawn sweep **and** the true seconds, so no caller can accidentally report the floored value
    - **Paint order is fixed**, because floored arcs may overlap: inner arcs in chronological order of their interval start, then the `Uncovered_Time` dashes **last of all** — undescribed time is what the page exists to surface and must never end up hidden under a floored segment. On the outer ring the accent `Open_Session` is emitted after the closed arcs, for the same reason
    - Hovering an inner arc shows a label naming the project and the arc's times — a pointer enhancement, not the accessible path
    - The gauge is one `role="img"` whose `aria-label` is `timer_gauge_label` (worked, described, undescribed, and whether the timer is running); the arcs are `aria-hidden`, because an SVG `<path>` is not focusable and thirty announced arcs would be unusable. Project identity is carried in text by the `Project_Legend` beneath
    - The `Timer_Control` sits at the exact centre — 104 pixels with a 42 pixel icon (mobile 98 / 40) and the `0 0 0 12px` accent halo. The rule is a **ratio**: the control stays at or below 0.31 of the gauge box, which leaves about 66 pixels of clear space at the desktop's 340 and about 48 at the mobile's 300, because the gauge scales through its `viewBox` and the control does not
    - A day whose sessions are all closed draws every arc in `--arc-closed` and shows the **start** icon; the accent appears only while a session is open
    - The elapsed readout sits above the circle
    - Write geometry into SVG presentation attributes, never into a `style` attribute
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.15, 16.16, 16.19_

  - [x]* 6.6 Write a component test for `DayGauge`
    - `tests/modules/timer/components/day-gauge.test.ts`: a day inside the window draws no arc past `trackEnd`; a day ending at 03:00 draws one and labels it; a 24-hour day emits a `<circle>` and still leaves the gap empty of `<line>` and `<text>`; the control sits at the centre coordinates; an open session draws in the accent while a closed one does not; the gauge carries `role="img"` with a summarising label and its arcs are `aria-hidden`
    - _Requirements: 16.5, 16.9, 16.10, 16.11, 16.12, 16.13, 16.19_

  - [x] 6.7 Build `TimerControl` and the timer page
    - A single start action when no `Open_Session` exists and a single stop action when one does, both form actions with `use:enhance` applying the change optimistically and rolling back with the reason on failure; reachable by tab and activated by both Enter and Space
    - The page lives at the root path `/`, so opening the application lands on the timer
    - Lay the page out in the artboard's order: hero figure above the circle, its caption, the `Day_Gauge` with the control at its exact centre, the three figures, the `Quick_Log` pill, the `Project_Legend`
    - **Two states, one layout.** Running: the hero is the session's elapsed time via `formatClock`, captioned `timer_running_since`. Stopped: the hero is the day's `Tracked_Time` via `formatDuration` in the same face, captioned `timer_stopped_at` — or `timer_idle_caption` on a day with no session — and the centre control shows the start icon. The gauge draws the day's arcs identically either way; `GaugeNormal` is the resting reference, and the application spends most of the day in this state
    - The three figures are `Tracked_Time`, `Covered_Time` and `Uncovered_Time` in that order, 26/300 tabular under caps labels, the third in the accent; mobile drops to 19/300 with shortened labels
    - `ProjectLegend` names every project drawn on the gauge beside its swatch, taking each colour from the `colorIndex` the day payload carries, and closes with a dashed entry for `Uncovered_Time`. It is the gauge's text alternative for project identity, so it is not optional
    - The timer page carries **no** `Running_Indicator`: the hero readout is already the elapsed time
    - A `Stale_Session` shows the notice above the hero: a `--panel` box with the accent border, a 15 pixel warning icon, the explanation at 13 `--text-dim`, a 44 pixel time field prefilled with `startedAt + MAX_OPEN_SESSION_HOURS`, and one 42 pixel accent pill that stops the session at that time — no dismiss action
    - A start refused for an existing or overlapping session explains which session is in the way
    - _Requirements: 1.8, 1.9, 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.13, 3.14, 3.15, 3.16, 3.17, 3.19, 3.20, 10.6, 11.9, 16.13, 16.14_

  - [x] 6.8 Implement the tab title
    - While an `Open_Session` exists, write the running elapsed time into `document.title` from the same store that feeds the on-screen readout, so the two cannot disagree
    - Restore the plain title when the timer stops
    - _Requirements: 3.11_

  - [ ] 6.9 Write component tests for the timer
    - `tests/modules/timer/components/timer-control.test.ts`: start shown when idle and stop when running; the elapsed readout advances; `sync()` overrides a drifted local count; a failed action restores the previous state and shows the reason; Enter and Space both activate; the three figures render in order with the uncovered one in the accent
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 3.10, 3.13, 3.15_

- [ ] 7. Projects
  - [x] 7.1 Build the projects page
    - List every `Project` with its total `Covered_Time` over the last thirty `Logical_Day` values — summed in `src/routes/projects/+page.server.ts` from the store's day summaries over that range, not from a second endpoint — its swatch beside the name in a 32 pixel tinted icon box, and a share bar; content max 940
    - Draw each row's bar as that project's **share of the range's total** `Covered_Time`, the same quantity the statistics breakdown uses, not relative to the largest project as the artboard drew it
    - Drop the artboard's `naposledy dnes 01:30` line: no criterion asks for it, and no endpoint exposes a per-project last-used timestamp. The one cross-day "most recent" answer the server gives is `DayResponse.quickLog.project`, which is about the write the pill would make, not about the row
    - Leave the delete control **enabled** on every project: the list carries no reference count to disable it from, and a disabled button explains nothing. Let the attempt run and explain `PROJECT_IN_USE` when it comes back, which is what the criterion asks for anyway
    - Create by name, rename, archive and unarchive, hiding archived by default
    - A duplicate name differing only in case or surrounding whitespace shows the error beside the field
    - Delete an unreferenced project; a referenced one explains that it is in use and offers archiving instead
    - The colour control lives **inside the row it changes**: activating that row's swatch expands the eight `Palette_Slot` swatches within the row — 38 tall at radius 11, the current one ringed — and choosing one saves and collapses it. The artboard shows the strip as a standalone panel to display all eight at once; a page-level picker could not say which project it meant
    - An empty state covers the case of no projects at all, offering to create the first one
    - Below 768 pixels follow the design's *Statistics and Projects, Mobile* section: content padding 16 with no 940 cap, the row on two lines inside `padding: 12px 14px`, a 28 px icon box, and the three row actions behind one 32 px overflow button opening the settings-sheet treatment. Assert no horizontal overflow at 320
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 11.14, 14.25, 15.10_

  - [x] 7.2 Build the `Project_Picker`
    - `ProjectPicker.svelte` is a combobox over non-archived projects with substring search and keyboard navigation
    - A "create <typed name>" row when nothing matches, posting to `/api/projects` and inserting the result without closing the surrounding dialog
    - Each option shows its swatch next to the name, never the swatch alone
    - When the entry being edited references an archived project, that project is offered as the current value marked as archived, so fixing a typo never forces re-assigning the record
    - With no projects at all the picker offers creating the first one instead of an empty list
    - _Requirements: 6.8, 11.6, 11.9, 11.12, 11.13, 14.11_

  - [x] 7.3 Write component tests for `ProjectPicker`
    - `tests/modules/projects/components/project-picker.test.ts`: filtering by substring; archived projects absent; inline creation inserts and selects without closing the dialog; full keyboard navigation; every option names the project as text
    - _Requirements: 6.8, 11.6, 14.5, 14.11_

- [ ] 8. Statistics
  - [x] 8.1 Build the statistics queries and range control
    - `src/routes/stats/+page.server.ts` reads the day summaries from the store for the selected day, week or month range — **not** through `/api/days`, which exists for scripts — asking for the per-day intervals only when the `Day_Rhythm_Strip` will be drawn
    - Put the aggregation in `src/modules/stats/aggregate.ts` as pure functions over `DaySummary[]`, importing nothing from `lib/server/`; the load function passes data in
    - Offer three ranges and no more: day, week, month — each anchored on the current `Logical_Day` from context, the week beginning **Monday**
    - For a **one-day** range render neither the `Day_Rhythm_Strip` nor `RhythmPanel`, and lay the page out in one column of `KPI_Row` and breakdown: a one-row strip says nothing the day page does not, and every rhythm figure compares days that are not in the range. There is deliberately **no year** — 365 rows of two-pixel marks on the rhythm strip is unreadable, which is the same reason the server caps interval payloads at 62 days
    - Map the response into `StatsRange`, carrying `intervalsIncluded` through to the page: a range wider than `MAX_INTERVAL_RANGE_DAYS` comes back **HTTP 200** with the summaries and without the intervals, and that is a success, never an error path. The interface never asks for such a range, but `/api/days` is also called by scripts and phone shortcuts, and the branch belongs to the route's contract rather than to the caller
    - Read each figure by name — `trackedSeconds`, `coveredSeconds`, `uncoveredSeconds`, `sessionCount`, `longestBlockSeconds`, `overtimeSeconds`, `eveningSeconds`, `byProject[]` — rather than recomputing any of them
    - A segmented control switches the range and the resolved date range is named beside it
    - Fold everything past the top seven projects by `Covered_Time` into an "Other" slot so no chart cycles the palette
    - Include archived projects holding time in the range, so the per-project figures reconcile with the total
    - Offer the server's `suggestedWindow` when it differs from the configured `Gauge_Window` by more than 30 minutes at either end — as the two values to put in the server's `.env` and restart with, never as a control the interface can apply, because the window has no write endpoint
    - _Requirements: 12.1, 12.14, 12.15, 12.16, 12.19, 12.20_

  - [x] 8.2 Build `KpiRow`, `CoverageMeter` and `ProjectBreakdown`
    - `KpiRow` is four panels built from the summaries alone, so it renders whether or not the intervals came back: `Tracked_Time`, `Covered_Time`, the described share as a percentage over a 4 pixel `CoverageMeter`, and the range's `Overtime` with its share of `Tracked_Time` beneath it — the artboard's fourth card carried the `Evening_Hour` figure, which moves to the rhythm panel
    - `ProjectBreakdown` lists projects descending — swatch, name, duration, share — each over an 8 pixel track filled to that project's **share of the range's total `Covered_Time`**, so the bar and the printed percentage state the same quantity
    - `Uncovered_Time` appears below a divider as a plain accent figure, never as one of the bars
    - Apply the mark specs: 2 pixel surface gaps between adjacent bars, rounded data-ends, recessive gridlines, hover tooltips, and a legend whenever two or more projects appear
    - Present every figure as text beside its bar, and show an empty state rather than an empty chart for a range with no records
    - Below 768 pixels the `KPI_Row` is `repeat(2, 1fr)` at `gap: 12` with the figure at 22/300, the range control spans the full width, and a breakdown row wraps to two lines — per the design's *Statistics and Projects, Mobile* section. Assert no horizontal overflow at 320
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.12, 12.13, 12.18, 14.25_

  - [x] 8.3 Build `DayRhythm` and `RhythmPanel`
    - `DayRhythm` draws one 22 pixel strip per `Logical_Day` on a shared axis running from the server's `DAY_START_HOUR` back to it — never a hard-coded `03:00` — with three recessive ticks, the day label in a 58 pixel gutter and the day total in a 62 pixel gutter
    - Label the axis from that hour too: both ends at `DAY_START_HOUR` and interior ticks at 25 %, 50 % and 75 % of the span, so a `DAY_START_HOUR` of 5 reads `05:00 · 11:00 · 17:00 · 23:00 · 05:00`. The artboard's `08:00 / 14:00 / 20:00` is a drawing convenience
    - Draw the segments from the fields the response carries: each covered interval as a `<rect>` in the `Palette_Slot` of the `colorIndex` beside its `projectId`, each uncovered interval in the same geometry filled with the hatch `<pattern>` the design defines — a 6 × 6 `userSpaceOnUse` pattern rotated 45°, holding one 3 × 6 accent `<rect>` at `fill-opacity: 0.5`, with **no fill beneath** — so a worked-but-undescribed day is distinguishable at a glance. An SVG pattern, not a CSS gradient: the strip is inline SVG
    - Render the strip as an inline `<svg>` with `<rect>` elements, because a percentage offset written as a CSS style would need an inline style attribute
    - Today's row is labelled in the accent and its strip carries the accent inset outline; a day with no `Tracked_Time` renders an empty strip and an em dash; activating a strip navigates to that day page
    - `RhythmPanel` gives days worked, average per working day, longest day, `longestBlockSeconds`, total `Work_Block` groups and `eveningSeconds` — the `Tracked_Time` after the `Evening_Hour` read from context, with that hour named in the label rather than assumed to be 21:00
    - Close it with **exactly one** observation line, the first of three fixed templates whose condition holds, and omit the line entirely when none does — no filler, no blank space:
      1. `stats_observation_nights` when `nights ≥ 1` — `Práce po {eveningHour} padla na {nights, plural, one {# den} few {# dny} other {# dnů}} z {workdays}.`
      2. `stats_observation_longest` when `longest ≥ 2 h` — `Nejdelší nepřerušený úsek: {duration}, {weekday}.`
      3. `stats_observation_idle` when `idleDays ≥ 1` — `Bez práce: {idleDays, plural, one {# den} few {# dny} other {# dnů}}.`
    - Each variable is one field of the range payload: `nights` = days with `eveningSeconds > 0`, `workdays` = days with `trackedSeconds > 0`, `longest` = `max(longestBlockSeconds)` and `weekday` its day, `idleDays` = days with `trackedSeconds === 0`, `eveningHour` from context
    - Render `DayRhythm` only when `intervalsIncluded` is true; when it is false the panel keeps its heading and its place and its body is one sentence naming the range over which the strip is available — no empty strip, no partial strip, no error state. `RhythmPanel` and the rest of the page are unaffected, because none of their figures needs an interval
    - Present the same numbers as text so nothing depends on colour
    - Below 768 pixels the label gutter is 40, the total gutter 46 and the strip 18 tall, and the axis carries **three** labels rather than five — the rule stays even divisions of the span, only the count drops, because five do not fit. Breakdown and rhythm panel stack at `1fr`
    - _Requirements: 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.13, 12.17, 12.18, 13.12, 14.25_

  - [x] 8.4 Write component tests for the statistics
    - `tests/modules/stats/components/stats.test.ts`: the breakdown sorts descending, folds an eighth project into Other, and draws each bar to its share of the total rather than of the largest; the `KPI_Row` shows overtime with its share; `DayRhythm` places a 21:00–03:00 session in the right part of the strip, marks today, renders an empty day as a dash, and takes its axis from a `dayStartHour` of 4 as readily as 3; activating a strip navigates; the empty range shows the empty state; the window suggestion appears only when it differs by more than 30 minutes
    - `intervalsIncluded: false` renders no strip while leaving every other panel populated and raising no error — one assertion, since the interface's widest range is a month and the flag cannot be false through the UI today
    - An uncovered interval renders hatched and a covered one does not; the observation sentence picks the first matching template and is omitted when none matches
    - The rhythm panel labels its evening figure with the `Evening_Hour` from context, so a server configured to 20:00 does not render "21:00"
    - _Requirements: 12.2, 12.4, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12, 12.13, 12.15, 12.17, 12.18, 12.19_

- [ ] 9. Feedback, loading and error states
  - [x] 9.1 Build the feedback primitives
    - Build these **before** the pages, so every page consumes one implementation instead of inventing its own and being rewritten later
    - `LoadingSkeleton` takes the shape and radius of the block it stands in, on `--panel` with a 1.2 s shimmer — never a bare spinner. It has exactly three callers, because every first load is server-rendered and arrives complete: a client-side navigation, an `invalidate` after a write or on `visibilitychange`, and the statistics range switch
    - `EmptyState`: a 20 pixel icon in `--text-faint`, a line at 14 `--text-dim`, one filled accent pill for the obvious next step, `padding: 48px 24px`, `gap: 12`
    - `Toast` and the toast store: bottom centre on mobile, bottom right on desktop, `--dialog` at radius 14 with the dialog shadow, `padding: 12px 16px`, 13.5 text with a 15 pixel leading icon, `max-width: 420`; a success dismisses itself after about four seconds, a failure carries an accent text action and stays
    - Mount the container **empty in the root layout**, not on first use: `role="status"` `aria-live="polite"` for successes and `role="alert"` `aria-live="assertive"` for failures, each toast `aria-atomic`. A live region created at the moment its first message arrives is not announced by most screen readers, and nothing but a screen reader would reveal it. Nothing that ticks ever goes inside a live region (Requirements 15.13, 15.15)
    - `ConfirmDialog`: the dialog shell at `max-width: 420`, header 17/500, body 13.5 `--text-dim` naming exactly what will be lost, and a filled `--destructive` pill for a destructive confirmation
    - A submit control disables itself and shows progress while its action is in flight; required fields are marked required; leaving a form with unsaved input asks first
    - _Requirements: 14.13, 14.14, 15.1, 15.2, 15.8_

  - [ ] 9.2 Implement result and error feedback
    - Toasts: bottom centre on mobile, bottom right on desktop, `--dialog` at radius 14 with the dialog shadow, `padding: 12px 16px`, 13.5 text, a 15 pixel leading icon, `max-width: 420`. A success dismisses itself after about four seconds; a failure carries an accent text action and stays until dismissed — a message the user never saw is the same as no message
    - Confirmation dialogs: the dialog shell at `max-width: 420`, header 17/500, body 13.5 `--text-dim` naming exactly what will be lost, and for a destructive confirmation a filled `--destructive` pill rather than an accent one. Never a bare "are you sure"
    - A field-level rejection renders the key from `details.fields[name]` beneath the field at 12 px in `--destructive`, with the field taking `inset 0 0 0 1px var(--destructive)` and keeping its value. **Never render the validator's English sentence** — the schema is shared with a REST API whose prose is deliberately English
    - A success confirms briefly without demanding dismissal; a failure shows the reason and keeps the input intact
    - An overlap conflict names the conflicting records and offers to open one
    - A write reporting discarded or unplaced time is never presented as an unqualified success — the confirmation names what did not fit
    - An unreachable server says so and offers retry without losing input; every destructive action is preceded by a confirmation naming what will be lost
    - Map every code from the `001` error table to the behaviour in the design's Error Handling section, including `NOT_FOUND`, `NOTHING_TO_LOG`, `RANGE_TOO_LARGE`, `PAYLOAD_TOO_LARGE`, `STALE_PREVIEW`, `PROJECT_ARCHIVED`, `FUTURE_TIMESTAMP`, `INTERVAL_TOO_SHORT`, **`SERVICE_UNAVAILABLE`** and `INTERNAL_ERROR`; render the `messageKey`, never the raw code
    - Three codes carry a field that changes the sentence — `NOTHING_TO_LOG.reason`, `RATE_LIMITED.scope`, `SESSION_OVERLAP` on the open session — and each has its own catalogue key; read the field and pick, never compose
    - On `UNAUTHORIZED` from a browser-issued request, navigate to `/login?next=<path>&reason=session_expired`
    - `src/hooks.client.ts` sends an uncaught client error to the same surface as a failed request rather than leaving a blank page
    - _Requirements: 2.6, 13.11, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.11, 15.12_

- [ ] 10. Checkpoint — the interface is complete
  - Run `bun run check && bun run test` and walk the whole application by hand on a desktop and at a 375 pixel width, in both themes

- [ ] 11. End-to-end, accessibility and visual conformance
  - [ ] 11.1 Write the reconciliation E2E scenarios
    - `tests/e2e/day.spec.ts` against the `playwright.config.ts` and the `resetDb` fixture that `001` task 1.9 writes — `workers: 1`, a real database on `TEST_DATABASE_URL`
    - Start the timer, stop at the break, start again, stop at the end; log `13:00–16:00` and assert two `Work_Block` groups with the `Break_Marker` between them, the part counter on both split blocks, and a list entry stating it was split
    - Log two hours in `Duration_Mode` with no start over the same frame and assert the segments total exactly 120 minutes across the break
    - _Requirements: 4.1, 4.6, 6.4, 7.2_

  - [ ] 11.2 Write the preview and gap-filling E2E scenarios
    - `tests/e2e/preview.spec.ts`: shorten a session carrying an activity, assert the preview names the entry, the minutes it loses and the uncovered stretch that falls outside the frame, cancel and assert nothing changed, then repeat and confirm and assert the timeline updates
    - `tests/e2e/gaps.spec.ts`: click an uncovered stretch, assert the dialog opens prefilled with exactly that range, save, assert the uncovered total reaches zero and the day reports itself fully described
    - `tests/e2e/conflict.spec.ts`: log an activity overlapping an existing one and assert the conflict is named and nothing is written
    - _Requirements: 8.4, 9.1, 9.5, 9.7, 9.11, 10.3, 10.5, 15.5_

  - [ ] 11.3 Write the open-mode E2E scenario
    - `tests/e2e/open-mode.spec.ts`: log through the `Quick_Log` pill and log through the dialog's third mode over an equivalent frame, and assert both produce the same interval and the same stored segments
    - _Requirements: 6.6, 6.12, 6.13_

  - [ ] 11.4 Write the shell E2E scenarios
    - `tests/e2e/locale.spec.ts`: switch to English mid-page and assert the text changes with no reload and no lost scroll position
    - `tests/e2e/settings.spec.ts`: open the `Settings_Menu` from the chip at both widths — the desktop menu is anchored under the chip, the mobile sheet is modal with the bottom navigation beneath the scrim and no `opacity` on the content or the tab bar; Escape closes it and focus returns to the chip; switch to the light theme and assert `data-theme` changes with no reload; reload and assert it is applied before the first paint; set the preference back to `Systém` and assert it follows the emulated `prefers-color-scheme`
    - `tests/e2e/auth.spec.ts`: log out from the `Settings_Menu` and assert the login page follows; clear the cookie and assert a browser-issued request redirects to login with the session-ended message, while a plain navigation redirect shows no such message; a wrong passphrase shows the generic message
    - _Requirements: 1.16, 1.17, 1.19, 1.20, 1.21, 1.22, 2.3, 2.5, 2.6, 2.7, 13.4, 17.5, 17.6, 17.7_

  - [ ] 11.5 Write the accessibility and responsive pass
    - **Not optional.** This is the only place Requirement 14.1 is verified at all, and the two pages most likely to break it — statistics and projects — have no mobile artboard to compare against, so nothing else would catch an overflow
    - An axe run over the timer, day, projects and statistics pages in **both** themes
    - A keyboard-only walk of the day page reaching every timeline block, opening a dialog and completing a save with no pointer
    - Assert no horizontal page scrolling at 320 pixels **on every page**, and that every focused control shows a visible focus ring
    - Assert a success toast is announced through the live region and that the elapsed readout is not, and that under an emulated `prefers-reduced-motion: reduce` no element carries a transform transition
    - _Requirements: 14.1, 14.5, 14.10, 14.11, 14.25, 15.13, 15.15_

  - [ ] 11.6 Run the visual conformance pass
    - `canvas.json` is the list — an artboard added later joins the comparison by being in it. It holds **21** today: **16** are screens and every one is compared, at its own frame size, against the matching PNG in `.design/screens/`: `Main`, `TimerLight`, `TimerMobile`, `DayCollapsed`, `DayCollapsedLight`, `DayMobile`, `AddTask`, `AddTaskLight`, `AddTaskMobile`, `SessionEdit`, `Projects`, `Stats`, `Settings`, `SettingsLight`, `SettingsMobile`, `SettingsMobileLight`
    - The other **5** — `GaugeNormal`, `GaugeOverrun`, `GaugeNonstop`, `Demo`, `DemoSideBySide` — explain the gauge rather than showing a screen and are not compared
    - Compare arrangement, relative proportion and palette against `.design/screens/`. **Exact pixel heights are not compared** — the artboard's block heights illustrate the layout algorithm, and the algorithm in the design is what is normative. Copy and example data are not compared either
    - This pass is not optional: nine surfaces are specified in the design's tokens rather than drawn as artboards — confirmation dialogs, toasts, empty states, skeletons, the login, error and offline pages, the timezone notice and the focus ring — and this is the only check that looks at them at all
    - Record any deviation as a defect against this spec or against the `Design_Contract`, never as a local decision
    - _Requirements: 14.7, 17.16_

- [ ] 12. Checkpoint — ready to use
  - Run `bun run test:all`, then use the application for one real working day and fix whatever gets in the way

## Task Dependency Graph

**These waves are numbered within this specification and are not absolute.** `002` wave 0
may begin only once `001` wave 1 has landed `src/lib/contracts/` — tasks 1.12 and 1.13
import the types and schemas `001` task 1.8 and task 2.7 write. `002` wave 4 may begin
only once `001` wave 6 has landed the REST routes and the write services: task 1.10 reads
`/api/health`, and tasks 3.7, 5.5, 5.6 and 8.1 read the day, activity and range routes
while the form actions call `001`'s services. In a combined run, add 10 to every wave id
below and interleave with `001`'s graph.

```json
{
  "requires": {
    "spec": "001-worklog-domain-api",
    "wave0": "001 wave 1 — src/lib/contracts/",
    "wave4": "001 wave 6 — REST routes and write services"
  },
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.12", "1.13", "6.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.9", "3.1", "5.1", "6.2", "8.1"] },
    { "id": 2, "tasks": ["1.5", "1.7", "3.2", "3.3", "5.2", "6.3", "6.4", "9.1"] },
    { "id": 3, "tasks": ["1.6", "1.8", "3.4", "5.3", "6.5", "7.2", "8.2", "8.3"] },
    { "id": 4, "tasks": ["1.10", "1.14", "3.5", "5.4", "6.6", "6.8", "7.3", "8.4"] },
    { "id": 5, "tasks": ["1.11", "3.6", "3.7", "3.8", "5.8", "5.9", "7.1"] },
    { "id": 6, "tasks": ["5.5", "5.6", "6.7"] },
    { "id": 7, "tasks": ["5.7", "6.9", "9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster first version: the `DayGauge` component test (6.6). Everything else is load-bearing — in particular the three property tests, **the visual conformance pass**, which is the only check covering the surfaces the design specifies in tokens rather than in an artboard, and **the accessibility and responsive pass (11.5)**, which is the only check covering statistics and projects below 768 pixels, where no artboard exists to compare against.
- **`.design/` is the visual contract.** `DESIGN.md` holds the tokens and the rules, `artboards/` the approved screens, `screens/` their renders. Where this spec states a colour, a size or an arrangement it is transcribing that contract. A disagreement between the two is a defect to be raised, never a choice to be made while implementing.
- **The browser never computes the reconciliation, and there is no exception.** Every `Change_Preview` renders a server `Dry_Run` response verbatim, down to `lostUncoveredSeconds` and `lostUncovered`. The client could intersect the day's loaded `uncovered` intervals with the removed interval itself, and it deliberately does not: that would be the one figure in the report derived in the browser, and the whole preview rests on the rule that none is. If a preview seems slow, cache it; do not compute it locally.
- **The server owns the timer.** The elapsed readout ticks locally but is replaced by `sync()` on load, on tab focus and after every start and stop. Never persist timer state in the browser: a cached value that survives a server-side change is worse than no cache.
- **No inline `style` attribute, anywhere.** The production CSP from `001` carries no `unsafe-inline`, and a nonce does not cover an inline attribute. Project colours go through `pj-0` … `pj-7`, block heights through the `tl-h-*` ladder, and the `Day_Rhythm_Strip` through SVG `<rect>` elements. SVG presentation attributes — `d`, `stroke`, `stroke-width`, `stroke-dasharray` — are not CSS and are unaffected, which is why the `Day_Gauge` may compute its geometry per render.
- **Palette**: the eight slots are the ones in the design's palette table, not the ones the artboards were drawn with. They pass the data-viz validator in both themes, but only up to five projects; from six the separation is at the floor and from seven colour alone is insufficient. The **rule** is therefore absolute: every surface showing a project colour also shows the project name. Beyond eight projects the index wraps. Charts fold past the top seven into "Other" rather than cycling. No text is ever placed on a filled slot — if a future surface needs it, its ink must be measured per slot first.
- **Each theme has its own measured text opacities.** Dark is 0.62 / 0.50 and light 0.78 / 0.66; neither pair is the other inverted. Both started lower and were raised after measurement — light computed 4.17 and 2.99, and dark faint sat at 3.38:1 while carrying every block time, break label and caps label. `tests/lib/theme/contrast.test.ts` exists so that cannot recur. **No token is derived**: `AddTaskLight` draws the light dialog, so dialog, scrim, field, active field, divider and destructive are painted values measured on the surface they sit on. Take every one of them from the design's token tables as written.
- **One collision that must not be merged**: the accent carries both *primary action* and *uncovered time*, told apart by shape — a filled control against a dashed outline. The second collision is already resolved: `--destructive` is its own token, never derived from a `Palette_Slot`, so recolouring a project cannot recolour a delete control.
- **The artboards illustrate the layout algorithm; they do not define its output.** Block heights in particular are examples. The five-step algorithm in the design is normative, and visual conformance compares arrangement and proportion, not pixel heights.
- **Czech is the fallback in all three places** — the cookie, `Accept-Language`, and the final default. `baseLocale: "en"` is only what Paraglide compiles ids against. Every message carrying a count needs Czech plural forms (one / few / many); a flat interpolated string is wrong for most values it can take.
- **The `Day_Timeline` is the day's list.** There is no `ActivityList` and no `UncoveredList` — a `Segment_Block` already carries project, description, times and duration, and an `Uncovered_Marker` already carries its stretch. The one thing that cannot go on the timeline is an `Orphaned_Entry`, which has no segments and therefore no position, so it gets the `Orphan_Panel` in the side column.
- **Nothing about the reconciliation is computed in the browser, and that includes the `Placement_Anchor`.** It comes back from the `Dry_Run` like every other figure.
- **Reads are load functions, writes are form actions.** `fetch` is only for the `Dry_Run`, the timer refresh and inline project creation. Keep it that way — form actions are what give field-level errors and preserved input for free through superforms.
- **No second Zod schema.** Form actions import from `src/lib/contracts/schemas.ts`, which `001` owns and keeps outside `src/lib/server/` so superforms can validate in the browser from the same definition. No `src/modules/*/schema.ts` is created and that file is never edited here.
- **File ownership.** `002` owns `src/app.html` including the `%sveltekit.nonce%` placeholder and the pre-paint theme script, `src/hooks.client.ts`, and the `.svelte` halves of the login and logout routes. `001` owns `src/hooks.server.ts`, `src/lib/contracts/schemas.ts` and the `+page.server.ts` halves of login and logout. Neither spec edits the other's half.
- **Nothing that decides the first paint lives in `localStorage`.** `worklog_theme` (the preference, written only by the switcher), `worklog_theme_resolved` (the client's resolved value), `worklog_locale` and `worklog_viewport` are cookies, because the server has to read them: it renders `<html lang>` and `data-theme` itself and it resolves the timeline's density and budget. `localStorage` cannot be read by the server, and a pre-paint script cannot repaint SVG attributes, so the gauge would flash colours even if the page did not.
- **`002` writes the `%lang%` and `%theme%` placeholders; `001` substitutes them.** Same mechanism as `%sveltekit.nonce%`, same split of ownership: the file is `002`'s, the hook is `001`'s. **The language is resolved only by `001`** — cookie, `Accept-Language`, Czech — and `002` reads `locals.locale`. Two negotiations would disagree, and the one filling `lang` would not be `002`'s.
- **Pages read the server layer directly.** `+page.server.ts` calls the store; `/api` is for scripts and phone shortcuts. Reading your own REST route from a load function serialises everything twice and forces `Date` revival for nothing. This is also why there is no `modules/*/query.ts` and no `modules/*/actions.ts`: only `+page.server.ts` and `+server.ts` may import `lib/server/**`, and the boundary test enforces it.
- **The font is self-hosted.** Four `woff2` faces in `static/fonts/` with `font-display: swap`. The artboards link Google Fonts because they are file:// previews; production cannot, because the CSP has no third-party host and would leave the entire type scale on `system-ui`.
- **No dragging on the timeline, ever.** The axis is non-linear as soon as a segment is pinned at `MIN_BLOCK_PX`, so a drag would report a time it is not setting. Rail edges open the dialog with that field focused instead.
- **Interaction states come from one rule, not from thirty drawings.** Hover +0.03 surface alpha and one text level, active +0.06, disabled `opacity: 0.4`, focus is the ring. On accent-filled controls hover is `--accent-hover`. This is binding precisely because the artboards draw resting states only.
- **The Message Catalogue is the source of user-facing text.** Every string, both languages, in the design document. A string that is not there does not go on screen; add it to the catalogue first.
- **Everything the server knows, the server reports.** The time zone, `DAY_START_HOUR`, the `Gauge_Window`, `MAX_OPEN_SESSION_HOURS` and the `Evening_Hour` come from the `Health_Endpoint`; the current `Logical_Day` and its bounds come from `event.locals.today`; the day's `sessionCount`, `longestBlockSeconds` and `eveningSeconds`, the `Quick_Log` interval and the `Placement_Anchor` come from payloads already being loaded. All five are configurable; hard-coding any of them is the same defect twice, and `03:00` in a rhythm strip and `21:00` in a rhythm panel are the same mistake. Never reconstruct a limit from a total either — a stale open session is drawn to `startedAt + MAX_OPEN_SESSION_HOURS` because that is where the server stopped counting it.
- **An omitted interval list is a success, not a failure.** `GET /api/days` returns per-day intervals only for `include=intervals` and only up to `MAX_INTERVAL_RANGE_DAYS` (62 days). A wider range answers HTTP 200 with `intervalsIncluded: false`, and the statistics page then draws **no** `Day_Rhythm_Strip` and explains why in its place. A year of statistics must not fail, and a 365-row strip would be unreadable regardless — that is the whole reason for the cap. The `KPI_Row`, the breakdown and `RhythmPanel` read only summary fields and render unchanged.
- **Settings live behind one chip, not three controls in the bar.** `Settings` and `SettingsMobile` put the `Theme_Switcher`, the `Locale_Switcher` and logout inside one menu — anchored under the gear chip on desktop, a modal bottom sheet on mobile. That chip replaced the `CS` label in every artboard. Logout had no home anywhere in the design until now; this is it, and it is the only one.
- **Never dim with `opacity`.** While the settings sheet is open, the scrim does all the dimming. An `opacity` on the page content or on the tab bar creates a stacking context, and the bottom navigation then paints *over* the sheet no matter its `z-index`. This was hit for real while the artboard was drawn — it is in the spec so it is not hit again.
- **The `Running_Indicator` is not on the timer page.** It rides the top bar of the day, projects and statistics pages. The timer page's 68 px hero already states the elapsed time, and a second copy in the same view is noise. The `Settings` artboard shows the indicator because it is demonstrating the menu, not the timer page.
- Error `message` values from the server are Paraglide keys, not prose. Render the translation; never show a raw code to the user.
- The session-ended message has exactly one source: a browser-issued request that receives `UNAUTHORIZED` and navigates to the login route with `reason=session_expired`. A redirect from the `Auth_Hook` carries only the requested path and shows no message.
- `Interval` is half-open `[start, end)` in the interface exactly as on the server. A session ending at 12:00 and the next starting at 12:00 do not overlap, and the timeline must not draw a break between them.
- **The gauge and the timeline answer different questions and give up different things.** The gauge keeps time proportional everywhere so the shape of a day is comparable; the timeline collapses breaks so entries stay readable. Do not "fix" either by making it behave like the other.
- **The gauge's gap is bare on purpose, including at full coverage.** Graduating the whole circle would make work past the window read as further along the scale instead of outside the day. That is also why an `Overtime_Arc` needs its own end label. `GaugeNonstop` draws it correctly: the arc runs the whole way round and the gap stays empty. At full coverage emit a `<circle>`, since an arc back to its own start point is degenerate and paints nothing.
- The proportional day axis was tried and rejected: with a real 08:00–03:00 day and a four-hour evening break it spent 21 % of the height showing nothing and rendered a twenty-minute task 13 px tall. That is why Property 2 exists and why `MIN_BLOCK_PX` is an explicit exception to the 44 × 44 touch-target rule rather than an oversight.
- **Docker in this sandbox**: `docker compose` is blocked. Start PostgreSQL for E2E with plain `docker run` on the sandbox's own network and reach it by container name. The `sandbox-docker-net` skill has the details.
- Playwright browsers are already installed at `/opt/playwright-browsers`. Never run `playwright install` in this sandbox.
- **Test paths mirror the source tree** — `tests/modules/day/components/day-timeline.test.ts` for `src/modules/day/components/DayTimeline.svelte`, `tests/lib/viz/format.test.ts` for `src/lib/viz/format.ts`, `tests/e2e/` for Playwright. There is no `tests/components/` directory.
- Commits follow Conventional Commits with the author `Martin Jablečník <martin.jablecnik@email.cz>` and carry no tool attribution trailers.
