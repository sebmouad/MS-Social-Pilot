# Simplified → MS Social Pilot: patterns to copy (and not copy)

Distilled from `README.md`, `AUDIT.md`, `COMPARISON.md`, `CRAWL-2026-10-11.md`
(every non-social route, inbox stream, notification matrix, home, Riley) and
`screens/`. Use this
as the checklist when building a screen. Structure from Simplified, look from
Facebook (`docs/ai/DESIGN.md`). Navigation stays the left sidebar.

## 1. Profile selection (drives everything) — screens 02, 20, 24, 39
- **Account picker**: search at top, "Overview of all accounts" first row, one
  row per account (avatar + network badge + name + type), "Add account" at the
  bottom. → our `ProfileScope` popover (NEXT_PHASES Phase A).
- **Accounts column** on publishing screens: group switcher ("All accounts ▾"),
  counter "1/3", 👁 per row (hidden rows greyed, still listed), ⋮ per row
  (settings, reconnect, new post, shuffle queue, clear queue/drafts, delete in
  red). → our `PagesSidebar` + `PageMenu`.
- **Selected accounts strip**: stacked avatars above the content + ⋮ (add, open
  full list). → the collapsed state of `ProfileScope`.
- **Account groups**: "All accounts" + "New account group". → `page-groups.ts`.
- Do better than Simplified: the selection **persists across screens** (theirs
  resets per module) and analytics accepts **several** accounts at once.

## 2. Analytics — screens 01, 03, 05, 06, 07–09, 19, 41–44
- Header: picker · centre view tabs (we use `.segmented`) · date range · "New
  report ▾" (Excel download in the ▾).
- KPI card (19): label, big number, change pill, sparkline with end dot in the
  KPI colour. **Cards toggle series** of the big chart; several can be on.
- Insight tiles: "Best day to post — Thursday", "Best frequency — 5 a day", with
  a faint chart behind and one sentence of why.
- Date popover (03, 43, 44): Presets / Custom tabs, two-month calendar, footer
  shows the **comparison period** with an edit control.
- Shared-axis hover tooltip listing every series (42).
- Deprecated metric tooltip (41): they show it; we grey it and say since when.
- Demographics (06): ranked table + world choropleth; switch fans / reach.
- Posts table (07, 08): thumbnail + 2-line caption, sortable headers, source
  filter (via app / external), 10/25/50 pagination; row → insights modal (09)
  with "Open post".
- ⚠ Don't copy: engagement column showing 500–1700 % (their bug), metric names
  straight from the API, empty tabs that cannot fill.

## 3. Reports — screens 10–17
Templates gallery → builder (modules list left, live preview right), branding
(logo, colours), PDF/PNG export, KPI and best-posts modules. Ours: `/reports`.

## 4. Publishing — screens 20–22, 27–32, 40
- Calendar with day-hover actions (+ post, see day); list and feed previews.
- Composer: per-network preview, schedule options (now / date / queue / draft),
  first comment with delay (29), media library (30), background colours (31 —
  not possible via Graph API, skip).
- Drafts board (32) as columns by status.

## 5. Collaboration — 33–36, 47–50
Shared calendars, client review, client portal, roles and seats, per-account
permissions. Ours: share links, approvals, portal, `pageScope`.

## 6. Visual tokens they use (for comparison only)
Measured values are in `README.md §1`. We keep Facebook blue `#1877f2`, white
cards on `#f0f2f5`, `shadow-surface`, rounded pills.

## 7. Quality bar per screen (tick before shipping)
- [ ] Obeys the shared profile selection and shows it.
- [ ] Every number has a plain name + ⓘ definition; withdrawn metrics explained.
- [ ] Empty state says what fills it; no tab that can't fill.
- [ ] Every action reports its outcome.
- [ ] 1440 px and 375 px screenshots on real data compared with the matching
      Simplified screen.
