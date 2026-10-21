# 03. Components

All shared components live in `src/components/` and export from `src/components/index.ts`. Styles go in `src/styles/components.css`; screen CSS modules hold layout only.
A screen must use these components instead of route-local controls. Each component takes required copy props (no English defaults) or reads the locale through `useCopy()` (new, section 4).

## 1. Inventory decision

| Component | Decision | Notes |
|---|---|---|
| `AppShell` | **Replace** with `AppFrame` = `AppSidebar` + `TopBar` + `BottomBar` + content | Keep focus trap, Escape, inert and scroll-lock logic from today's drawer |
| `SidebarDock` | **Delete** after migration (27 users) | Its contents move to `PageHeader` actions, `FilterButton` or the composer action bar |
| `FilterPanel`, `FilterChips`, `DatePresets` | **Refactor** into `FilterButton` + `FilterSheet` + `FilterChips` | |
| `Filters.tsx` | **Delete** (no importers) | |
| `Menu`, `Select` | **Change**: render the popup through `Popover` (portal + fixed positioning) | Fixes clipping inside tables, dialogs and sidebars |
| `usePopupPlacement` | **Move** into `Popover` | |
| `DataTable` | **Change**: density, `aria` fixes, built-in pagination footer, bulk bar, compact phone rows | See 2.6 |
| `MetricCard` | **Replace** with `MetricTile` | Value, delta, ⓘ, optional sparkline |
| `PageHeader` | **Change**: title, count, actions, tabs slot, filter row | See 2.4 |
| `Tabs` | **Change**: link variant (URL) and panel variant; no mixing | |
| `RouteNotice`, `Toast` | **Unify**: `Toast` for transient success; `Notice` (inline) for errors and warnings near the action | One feedback system |
| `ModeToggle` | **Move** into the user menu (Theme: Light, Dark, Match device) | A 3-state cycle can look like a no-op |
| `Breadcrumbs` | **Keep** only for detail pages (`/content/post/[id]`, Root detail) | |
| `Dialog`, `ModalDialog`, `ConfirmDialog`, `useConfirm`, `Drawer` | **Keep**; `Drawer` → `Sheet` (side or bottom) | |
| `PostPreview` | **Change**: localize copy and dates (today `en-US`); stop importing from `modules/publishing` (move the needed helpers into a neutral `src/lib/post-preview`) | Shared → module dependency inversion |
| `EmptyState`, `ErrorState`, `Skeleton`, `Badge`, `StatusChip`, `ChannelBadge`, `Avatar`, `PostThumb`, `AutoTextarea`, `FormValidation`, `Forms`, `InlineEdit`, `LocalTime`, `CsvExportButton`, `IndeterminateCheckbox`, `charts/*` | **Keep**, restyle with v2 tokens | |
| New | `AppSidebar`, `ChannelScopeList`, `ScopeSheet`, `TopBar`, `BottomBar`, `Popover`, `InfoTip`, `FilterButton`, `FilterSheet`, `DateRangePicker`, `MetricTile`, `SplitButton`, `ActionBar`, `Sheet`, `SidePanel`, `ListRow`, `Notice`, `useCopy` | Specs below |

## 2. Specifications

Token names refer to [02-FOUNDATIONS.md](02-FOUNDATIONS.md).

### 2.1 AppSidebar

| Part | Spec |
|---|---|
| Size | `--sidebar-w` expanded; `--sidebar-w-rail` collapsed. The collapse button sits at the bottom (`aria-expanded`), and the choice is remembered in a cookie. Background `--rail-bg`; text `--rail-ink`. |
| Order | Workspace switcher (only if >1 workspace) → Create (primary button, full width, icon-only when collapsed) → areas → `CHANNELS` section → footer (Settings, Help, user menu). |
| Area item | 40 px tall (44 coarse); 20 px icon in a 28 px chip filled with `--area-*` and icon `--on-mod`; label `--text-sm` 600; optional count badge (Inbox unread, Approvals pending). Active: `--rail-active-bg`, `aria-current="page"`. Collapsed: icon only, with the label as a tooltip and `aria-label`. |
| Channel item | 36 px tall; 24 px avatar with a status dot (`--success` ok, `--warning` reconnect, `--danger` revoked); name truncates with an ellipsis (full name in a tooltip). Click = scope to this channel. ⌘/Ctrl-click or a hover checkbox = multi-select. Selected: `--rail-active-bg`. "All channels" is first. More than 8 channels: show 8 plus "Show all (N)", with a search field at more than 15. |
| Footer | Settings link; Help (opens the docs link); user menu (`Popover`, `role="menu"`): Account, Theme ▸, Language ▸, Root (owner only), Sign out. |
| Keyboard | Tab order: skip link → workspace → Create → areas → channels → footer. Arrow keys move within the areas and channels lists (roving tabindex). `[` toggles collapse. |
| Root mode | Areas: Overview, People, Modules, Operations, Activity. No channel list. A "Root" badge sits in the TopBar. |

### 2.2 TopBar

56 px tall, `--surface` background, bottom `--line-subtle`. Left: on phone and tablet, the menu button and the **scope chip** ("All channels ▾" / "North Market ▾" / "3 channels ▾") opening `ScopeSheet`; on desktop, the page context (area › page) only on detail pages. Right: search/command (later), notifications bell (count), user avatar on phone only. It does **not** repeat the page title.

### 2.3 BottomBar (phone < 760 px)

`--bottombar-h` with safe-area padding, fixed. Five items: Home, Content, **Create** (56 px circle, `--accent`, raised by 8 px, `aria-label="Create post"`), Inbox (badge), Insights. Labels 11 px are always visible. Settings, Tasks and Agency move to the avatar menu.

### 2.4 PageHeader

```
[Title 28/750]  [count chip]                         [secondary] [Primary]
[Tabs: link variant ……………………………………………………………………………………………………]
[Filter ▾] [chip ×] [chip ×] [Clear all]          [search]
```

- Title: `h1`, `--text-3xl` (desktop) / `--text-2xl` (phone). No module icon chip and no description line. If a sentence is truly needed, it goes in an ⓘ next to the title.
- Actions: at most one primary and two secondary; extra actions go into a `Menu` ("More").
- On phone, actions collapse: the primary stays as a button, the others go to "More".
- Filter row: present only when the page has filters, search or views.

### 2.5 FilterButton, FilterSheet, FilterChips

- `FilterButton` shows "Filter" plus a count of active filters (`aria-label="Filter, 2 active"`).
- Desktop: opens a `Popover` 360 px wide. Phone: opens a bottom `Sheet`.
- The content is page-specific `FilterSection`s using shared `Select`, `DateRangePicker`, checkboxes and segmented controls.
- **Apply model:** single selects and checkboxes apply immediately and update the URL with `router.replace`, without a full reload. Text and date ranges apply on Enter, Apply or blur. The sheet footer has "Clear all" and "Done".
- `FilterChips` sit in the filter row, one per active filter: "Status: Draft ×". Removing a chip removes **only** that filter (today Agency clears all). "Clear all" resets to defaults.
- The channel scope is **not** a filter chip. It belongs to the sidebar and scope chip.

### 2.6 DataTable (changed)

| Topic | Spec |
|---|---|
| Density | `density="comfortable" | "compact"` → `--row-h` 48 / `--row-h-compact` 36. Lists default to comfortable; operational lists use compact. |
| Header | Sentence case `--text-xs` 600 `--ink-soft`; sticky to the **page** (top = `--topbar-h`). Do not create a nested 78vh scroll box; the wrapper only scrolls horizontally. |
| Row states | Hover `--surface-hover`, made visible: raise `--surface-hover` to ≥1.15:1 against the surface. Selected uses `--accent-soft` plus a 3 px `--accent` left edge (not the success tone). Zebra off by default. |
| Row actions | `Menu` in the last column, rendered through `Popover` so it is never clipped. Name it "Actions for <row name>"; the column header is "Actions" (visually hidden), not the caption. |
| Selection | Checkbox column plus a `BulkBar` that appears above the table: "3 selected · [Reschedule] [Delete] · Clear". |
| Pagination | Built-in footer: "1–25 of 132", page size (25/50/100), Previous/Next. Server-driven via `page` and `size`. |
| Empty | Distinguish "No posts yet" (with an action) from "No posts match these filters" (with Clear filters). |
| Phone | Below 760 px, render `ListRow`s: one 64–72 px row with thumbnail, two-line title, a meta line (channel avatars · status chip · time) and a trailing `Menu`. No uppercase label grid. |
| a11y | The wrapper only gets `tabIndex=0` when it actually overflows horizontally. |

### 2.7 Popover (new primitive)

Portal to `document.body` with `position: fixed`. Place it from the anchor rect: flip and shift within the viewport, 8 px gap, and `max-height` limited to the available space. Close on Escape (return focus to the anchor), an outside pointer, or a scroll of the anchor's scroll parent when `closeOnScroll` is set. Enter animation: 180 ms opacity and 4 px translate. `Menu`, `Select`, `InfoTip`, `FilterSheet` (desktop), `DateRangePicker` and the user menu all use it. Native Popover API plus anchor positioning may replace the JS when browser support allows.

### 2.8 InfoTip (ⓘ)

- Trigger: a 20 px `ⓘ` button next to a number or title, `aria-label="About <metric name>"`.
- Opens a `Popover` (click or Enter; hover after 300 ms on fine pointers) of up to 320 px.
- Content blocks, in order, each optional:
  1. **What it is**, one sentence.
  2. **Period**, e.g. "Sep 22 – Oct 21 (UTC)".
  3. **Coverage**, e.g. "2 of 4 channels have data".
  4. **Missing data**, e.g. "Missing days are not counted as zero".
  5. **Source and freshness**, e.g. "From Facebook · synced Oct 21, 11:03".
  6. A "Learn more" link.
- **Warning variant:** when a result is partial (coverage < 100% or stale > 48 h), the ⓘ becomes ⚠ in `--warning` with the same content. A partial result never looks complete.

### 2.9 MetricTile

```
Label                          ⓘ
32/750 value      ▲ 12% vs previous
[sparkline 32 px tall, optional]
```

- Delta colours: up `--success`, down `--danger`, flat `--ink-soft`. When "down is good" (for example cost per click), colours invert through a `goodDirection` prop. The arrow and the sign always show (not colour alone).
- An unknown value shows "—" plus the ⚠ InfoTip, never 0.
- Currency values carry their code ("EUR 92.40"); mixed currencies show one tile per currency, never a sum.

### 2.10 SplitButton and ActionBar

- `SplitButton`: a primary action plus a menu of related actions. The composer uses "Schedule ▾" with Publish now, Add to queue and Schedule….
- `ActionBar`: sticky at the bottom of the composer and long forms. 64 px tall, `--surface` background, top line, `--shadow-sheet`. Left: a status text (autosave, validation summary). Right: the actions. On phone it spans the full width above the safe area.

### 2.11 Sheet, SidePanel

- `Sheet`: modal, full-screen on phone; side (480 px) or full-screen (composer) on desktop. It uses `ModalDialog` focus rules: initial focus, trap, Escape, restore focus.
- `SidePanel`: non-modal right panel (440 px) for list item details, such as a post opened from Content. The list stays usable, and Escape closes the panel. On phone it becomes a full page.

### 2.12 Notice and Toast

- `Notice`: inline, `role="status"` or `role="alert"` for errors. Tones: info, success, warning, danger. It sits next to the action that produced it and keeps user input.
- `Toast`: bottom-left on desktop (bottom above the BottomBar on phone). Success only, 5 s, with optional Undo. Not used for errors that need action.

### 2.13 DateRangePicker

A trigger shows the range ("Last 28 days ▾"). The popover lists presets from the owning module's Root policy (7, 28 and 90 days, this month, last month) plus a custom two-month calendar. Comparison is a toggle: "Compare with previous period". Times follow the workspace time zone. The UTC note moves into the ⓘ.

## 3. State matrix (every interactive component)

| State | Spec |
|---|---|
| Default | Token colours, `--control-h` |
| Hover | Background `--surface-hover` or `--accent-hover`; `--ease-fast` |
| Focus-visible | 2 px `--focus` outline, 2 px offset |
| Pressed | `translateY(1px)` for buttons; no colour flash |
| Disabled | `opacity .5`, `cursor: not-allowed`; the reason shows in a tooltip **and** in visible helper text when not obvious |
| Busy | `aria-busy`, spinner after 300 ms, same width, no duplicate submit |
| Invalid | `--danger` border, message below (`.ui-field-error`), focus moves to the first invalid field |
| Read-only | `--surface-muted` background |

## 4. Copy access

`useCopy(namespace)` (client) and `getCopy(namespace)` (server) return the current locale's strings from the module's Root-editable catalog (today's per-module `copy.ts` and `configOrDefault` pattern). Shared components receive copy through props or the shell catalog `shell.copy` (new Root key, EN/FR). No component ships English defaults.
