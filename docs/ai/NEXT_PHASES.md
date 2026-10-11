# Next phases — build plan (written 2026-10-11, start here)

The owner's request for the next sessions, verbatim intent:

> Better design and user experience. Analytics for **all connected profiles**,
> and show or hide per **single or multiple selection** of profiles. **All
> metrics from the Meta API.** Planned, posted or any information must use **the
> same selection**. Design must be better.

Work the phases in order. Each phase: build → unit + Playwright → deploy
(`scripts/deploy/deploy.sh`) → verify live in the owner's Chrome with real Pages
→ tick it in this file and in `STATUS.md`. Load the skills named in each phase.

---

## Where the code stands (facts to start from)

- **Calendar and Posts** already filter by Pages through `PagesSidebar`
  (`src/components/PagesSidebar.tsx`) with URL params `group` and `pages`, read
  server-side by `loadPageFilter()` in `src/lib/page-filter.ts` (always clamped
  to the member's `pageScope`). Groups: `src/lib/page-groups.ts`.
- **Analytics** (`src/app/(app)/analytics/page.tsx`) shows **one Page at a time**
  (`?target=<id>`, falls back to the first Page). The workspace overview and
  "compare Pages" exist but are separate views; `group` is only passed to some
  parts.
- **Dashboard, Queue, Reports, Ads, Inbox, Comments, Reviews, Videos** do not read
  the shared selection.
- Metric catalogue: `src/lib/facebook/metrics.ts` (`PAGE_METRICS`,
  `POST_METRICS`, `VIDEO_METRICS`, `IG_ACCOUNT_METRICS`, `IG_MEDIA_METRICS`,
  `AD_INSIGHT_FIELDS`, `REMOVED`, `CATEGORY_LABELS`). Fetching:
  `facebook/insights.ts`, `facebook/analytics.ts`; plain names in
  `src/lib/analytics.ts` (`PLAIN_NAMES`). Real-data facts: `META_API_NOTES.md`.

---

## Phase A — One profile selection, everywhere (highest priority)

Skills: `profile-selection`, `frontend-design`, `ux-copy-house`, `run-tests`.

**Goal:** a single "which profiles am I looking at" choice that every screen
obeys, kept as you move around the app.

### A1. Selection model (server)
- Keep the URL as the source of truth (`?group=<id>&pages=<id,id>`; `pages`
  absent = all of the group / all Pages). Add **persistence**: when a screen is
  opened with no params, use the last selection from a cookie
  `msp_sel_<workspaceId>` (ids only; re-clamped to `pageScope` on every read,
  unknown ids dropped). Writing the cookie happens on change, client-side.
- Extend `loadPageFilter()` → `loadSelection()` returning
  `{ group, ids, all: boolean, pages, networks }`; also accept a `net` param
  (facebook, instagram, bluesky, …) to filter by network.
- One helper `selectionWhere(selection)` for Prisma (`targetId in ids`) used by
  every list query; one `selectionQuery(selection)` to build links so
  navigation keeps the selection (sidebar links in `AppShell` must carry it).

### A2. Selection UI
- **`ProfileScope` bar** at the top of the content area (not a top nav — the
  left sidebar stays): stacked avatars (max 5 + "+N"), label "All profiles (23)"
  / "3 profiles" / Page name, ▾ opens a popover:
  search · group chips ("All", groups, "+ New group") · network filter pills ·
  list with checkbox + avatar + network mark + name + 👁 · "Select all" /
  "Clear" · each row has **"Only"** on hover (select just this one) · footer
  "Show 3 profiles" (applies) and "Save as group". Simplified refs:
  `screens/02-account-picker.jpg`, `20-publishing-list.jpg`,
  `39-account-groups.jpg`.
- `PagesSidebar` (Calendar/Posts column) becomes a second view of the **same**
  state: toggling 👁 there updates the bar and vice versa. Hidden = greyed, still
  listed.
- Phone: the bar collapses to one pill "3 profiles ▾" opening a bottom sheet.
- Keyboard: popover is a listbox with type-ahead; Escape closes; focus returns.
- Empty selection is not allowed: clearing all shows "Pick at least one profile"
  and disables Apply.

### A3. Every screen obeys the selection
Dashboard, Calendar, Posts (list/feed/grid), Queue, Drafts/Approvals, Analytics
(all views), Reports (default scope of a new report), Ads (ad accounts linked to
the selected Pages), Inbox / Comments / Reviews, Videos, Exports (CSV/Excel),
public API `?pages=` parity. Each screen shows the bar; counts in headings say
what is filtered ("12 scheduled posts · 3 profiles").

### A4. Tests
- Unit: `loadSelection` clamping (ids outside `pageScope` dropped; cookie vs URL
  precedence; group + pages intersection; network filter).
- e2e: select 2 of 3 seeded Pages on Calendar → go to Posts, Analytics,
  Dashboard: only those 2 appear everywhere; reload keeps it; a viewer with a
  restricted scope can't widen it by editing the URL; phone sheet has no
  horizontal scroll.
- Live: with the owner's Pages, select DIY Page 3 alone → calendar, posts and
  analytics all show only it.

---

## Phase B — Analytics for all selected profiles

Skills: `analytics-dashboard`, `dataviz`, `meta-api-integration`,
`frontend-design`.

### B1. Modes driven by the selection
- **1 profile selected** → today's deep Page view (all sections).
- **2+ profiles** → **Aggregate** view by default with a segmented switch
  **Total · Compare · Table**:
  - *Total*: KPI cards summed with the correct rule (below), one line per KPI.
  - *Compare*: KPI card selects the metric; chart = one line per profile
    (max 8 lines; beyond that top 8 + "Others"), legend toggles lines (show/hide
    per profile without changing the global selection).
  - *Table*: one row per profile × chosen metrics, sortable, totals row, export.
- Ranking widgets: "Top profiles by engagement / growth", "Top posts across the
  selection" (post table already exists — make it multi-Page with a Page column).

### B2. Aggregation rules (must be in code and in ⓘ tooltips)
| Metric kind | Rule across profiles |
|---|---|
| Counts (views, engagements, reactions, comments, shares, clicks, posts, new/lost follows, video views) | Sum |
| Unique people (viewers / reach `*_unique`) | **Not additive.** Show the sum labelled "up to N people (people who saw several Pages are counted once per Page)", and per-profile values in Compare/Table |
| Followers (lifetime level) | Sum of each profile's latest value; change = sum of changes |
| Rates (engagement rate, CTR, CPC, CPM) | Recompute from summed numerators/denominators, never average the rates |
| Demographics (country/city follows) | Sum per country/city across profiles (period=day caveat, see META_API_NOTES) |
| Money (ads) | Sum per currency; never mix currencies — group by currency |

### B3. All metrics from the Meta API
- **Metric explorer**: a "All metrics" view listing every metric of
  `PAGE_METRICS`/`POST_METRICS`/`VIDEO_METRICS`/`IG_*`/`AD_INSIGHT_FIELDS` by
  `CATEGORY_LABELS`, plain name + ⓘ definition + level + availability
  (available / needs permission / withdrawn by Meta with date from `REMOVED`).
  Tick metrics to add them as KPI cards or chart series; the choice is saved per
  user (Prisma `UserPreference` or JSON column).
- Withdrawn metrics are shown greyed with "Meta stopped providing this on <date>"
  — never as empty charts.
- Budget: aggregate fetches go through the existing `budget.ts`; prefer stored
  snapshots (sync job) over live calls for 2+ profiles; show "Updated 12 min
  ago" + `SyncButton`.

### B4. Design upgrade of analytics (Simplified refs 01, 05, 19, 42, 44)
- KPI card = label · big value · change pill (arrow + %) · sparkline; cards are
  toggles for the big chart (several on = several lines, one axis per unit).
- Two plain-language insight tiles at top: best day, best posting frequency.
- Date range picker shows and edits the comparison period.
- Shared hover tooltip listing every series at that date.
- Every chart has a table view (`ChartFrame`) and ⓘ.

### B5. Tests
Aggregation unit tests for each rule (including unique-reach labelling and
currency grouping); e2e for mode switching and legend toggles; live check that
the summed followers equal the sum of the Pages' numbers on Facebook.

---

## Phase C — Publishing views on the same selection, better design

Skills: `frontend-design`, `profile-selection`.
- Calendar: profile colour dots on chips, filter by status (planned / posted /
  failed / draft / review) as pills next to the bar, drag-and-drop rescheduling,
  collapse the Pages column (ROADMAP UX backlog), day hover actions (ref 40).
- Posts: list / feed / grid share one toolbar; bulk select → reschedule, label,
  delete (with `useConfirm` and counts).
- Per-network status chips on post cards.
- Compose: default destinations = current selection; first comment shown in the
  Facebook preview.

## Phase D — Design system pass

Skills: `frontend-design`, `design:design-critique`,
`design:accessibility-review`.
- Critique every signed-in screen at 1440 px and 375 px against Simplified
  screens; fix hierarchy, spacing, empty states. Record results in `DESIGN.md`.
- Tokens: add elevation and spacing scale, dark mode (tokens are in
  `tailwind.config.ts`).
- Connections page: tabs or anchor chips.

## Phase E — Blocked on owner / Meta (unchanged)
Meta App Review step 2 → Live mode; Resend + Anthropic keys; LinkedIn / Threads
/ X / Pinterest developer apps; first live Bluesky / Mastodon posts. See
`ROADMAP.md`.

## Phase F — Later
Analytics for non-Meta networks (into the same selection and aggregation rules),
competitor tracking, unified inbox, AI images, YouTube/TikTok, GDPR export —
details in `ROADMAP.md`.
