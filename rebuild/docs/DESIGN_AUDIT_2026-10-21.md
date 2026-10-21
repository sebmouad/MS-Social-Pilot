# Design audit — 2026-10-21

Scope: the shared design system and the shared controls owners asked about
(charts, menus, filters, dropdowns, density, tables), plus the theme
palettes. Read against [../DESIGN.md](../DESIGN.md) and
[../UX-CONTRACT.md](../UX-CONTRACT.md) at `99c4155`.

**Evidence kind:** source reading and computed WCAG contrast ratios from the
hex values in `src/styles/tokens.css`. The script is not committed; its
formula is the standard WCAG 2.x relative-luminance ratio. No browser,
screenshot or assistive-technology run was made. Use this to choose fixes,
not as browser evidence.

Severity: **P1** breaks accessibility or a contract rule for many screens ·
**P2** visible inconsistency or defect in a shared control · **P3** polish or
maintenance debt.

## Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| 1 | P1 | Forms | Round-4 layer moved every input, select and sidebar-filter border to `--line-strong` (1.49–2.02:1). WCAG 1.4.11 needs 3:1 |
| 2 | P1 | Themes | Two dark-mode overrides miss `data-mode="system"`, so system-dark gets white icons on pastel chips (≈2:1) |
| 3 | P1 | Tables / menus | Row-action menus open inside the table's scroll box, so they are clipped on the last rows and in short tables |
| 4 | P1 | i18n | Navigation, shell landmarks, `PostPreview`, and shared-control defaults are English-only. `PostPreview` dates are forced to `en-US` |
| 5 | P2 | Module colour | Several themes give two modules the same colour, so module identity breaks |
| 6 | P2 | Charts | The time axis is categorical, so gaps in dates are squeezed out. The comparison series is matched by position, not by date |
| 7 | P2 | Charts | 2–4 series colours per light theme fall below 3:1 on the surface, and series are told apart by colour alone |
| 8 | P2 | Dropdowns | Three dropdown styles exist side by side (custom `Select`, `select.ui-input`, raw native `<select>`) |
| 9 | P2 | Filters | Filters behave differently in each module: apply vs auto-apply, full reloads, chip location, one chip that clears all |
| 10 | P2 | Density | Control heights differ (36/38/40/42/44 px), and "compact" tables are only 10 px shorter than default |
| 11 | P2 | Tables | Sticky tables become a nested 78vh scroller. Zebra, hover and selected tints are almost invisible. The actions header is mislabelled |
| 12 | P2 | Menus | `disabledReason` only reaches mouse users. Menus have no separators, so danger items sit right next to safe ones |
| 13 | P2 | Typography | Inter is declared but never loaded. The CSS uses about 60 distinct font sizes, and some text is 9–10.5 px |
| 14 | P3 | CSS architecture | Global selectors match hashed CSS-module class names, and the CSS has 25 `!important`s. The `.eyebrow` rules conflict |
| 15 | P3 | Tokens | The radius scale drifted (14 values). Raw colour fallbacks and theme-blind label swatches remain |
| 16 | P3 | Docs | DESIGN.md and UX-CONTRACT.md disagree with the code on radii, content width and themes |

## Findings

### 1. P1 — Field borders fail non-text contrast in all eight palettes

`src/styles/components.css:452` (round-4 layer):

```css
.ui-input, .ui-select__trigger, .ui-filter select, .shell-sidebar-filter select,
.shell-sidebar-filter input:not([type=checkbox]) { border-color: var(--line-strong); }
```

`--line-strong` is the decorative line token. Measured on `--surface`:

| Palette | `--line-strong` (now) | `--control-border` (intended) |
|---|---|---|
| Vivid light / dark | 1.66 / 2.02 | 4.27 / 3.29 |
| Meta blue light / dark | 1.57 / 2.01 | 3.94 / 3.41 |
| Warm light / dark | 1.66 / 1.91 | 3.87 / 3.42 |
| Clean light / dark | 1.49 / 1.66 | 3.97 / 3.37 |

`tests/theme-contrast-semantic.test.ts:41` states this exact rule: form-field
boundaries use `--control-border`, not `--line-strong`. The tests check tokens,
not the token each selector actually applies, so the override got through.
The same layer turns the hover border into `--control-border`, so the
compliant border shows only on hover.

**Fix:** drop `border-color` from that rule, or set it to
`var(--control-border)`. Add a test that no field selector assigns
`--line-strong`. The same 1.5–2:1 token is used by `.ui-menu__trigger`,
`.ui-segmented`, `.ui-select__popup` and `.ui-filter-chip`. Segmented and
filter-chip edges identify controls, so they should use `--control-border`
too.

### 2. P1 — The "system" mode misses two dark overrides

These rules match only `[data-mode="dark"]`. Users on `system` with a dark OS
get the light-mode rule:

- `tokens.css:944` `.shell-subnav__link.is-active .shell-subnav__glyph { color: var(--canvas) }`. The result is a white icon on the dark-mode module colour.
- `components.css:392` `.ui-page-header__chip { color: var(--canvas) }`. The result is a white icon on the page-header chip.

In the dark palettes, white on the module colour measures 2.01–2.23 in Meta
blue and Warm, and 1.11–2.53 in Clean (`mod-root` 1.11). Every token block
already duplicates `system` under `@media (prefers-color-scheme: dark)`. These
two component rules don't.

**Fix:** add the `@media (prefers-color-scheme: dark) { :root[data-mode="system"] … }`
twin for each rule. A better fix is a theme token `--on-mod`, set once per
palette, so components never pick an icon colour by mode.

Related: in light themes, `.ui-mod-chip`, `.ui-state__icon` and the Clean
page-header chip draw `--mod` on `--mod-soft` at 2.81–2.89:1 (worst
`mod-inbox` / `mod-ads`). That is just under 3:1 for meaningful icons. Raise
the mix to around 72% ink, as `--mod-ink` already does.

### 3. P1 — Row-action menus are clipped by the table

`DataTable` renders `<Menu>` inside `.ui-table-wrap`, which is `overflow: auto`.
With `stickyHeader` (the default) it also has `max-height: min(78vh, 780px)`.
`.ui-menu__list` is `position: absolute`, and `usePopupPlacement` measures
only the **viewport**. On the last rows, or in a two-row table, the menu
opens below the row and inside the scroll box. It is then cut off, or the
user has to scroll inside the table to reach it. The same thing happens to
`Select` inside dialogs (`.ui-dialog { overflow: auto }`) and in the
contextual sidebar (`.shell-context-content { overflow: auto }`). That is
where most filters live.

**Fix:** render the popups in a portal with `position: fixed`, or use the
native Popover API with anchor positioning. Measure against the viewport
from there. This is the one structural fix that resolves the table, dialog
and sidebar cases.

### 4. P1 — Shared chrome and shared controls are English-only

- Module and page titles and descriptions come from manifests as single
  English strings (`modules/*/manifest.ts`, `lib/product.ts`). The rail,
  sidebar headings, mobile bar and "More" menu therefore stay English in a
  French session.
- `AppShell.tsx` hardcodes "Skip to content", "Modules", "Main sections",
  "Mobile sections", "Close navigation and filters", "App", "Root",
  "Account", "More" and the "Social Pilot" wordmark.
- `PostPreview.tsx` hardcodes "First comment", "View post", "Destinations"
  and "Open attachment". Line 83 formats every timestamp with `'en-US'`.
- Defaults in shared controls are English: `Select` ("Select…", "Search", "No
  match"), `DataTable` ("Nothing to show yet.", "Loading…", "Row actions"),
  `FilterPanel` ("Reset filters", "Remove filter"). A caller that forgets
  the prop gets English silently.

**Fix:** add a shell copy catalog through the existing Root-editable
mechanism and add bilingual titles to the manifests. Make the copy props
required on shared controls, or have the controls read the locale from
context, so English defaults stop leaking.

### 5. P2 — Module identity colours collide

The DESIGN.md signature is "one solid colour chip per module". Duplicates:

| Palette | Same colour |
|---|---|
| Vivid light/dark | home = analytics (`#7F77DD`); dark: settings = root |
| Meta blue light/dark | home = analytics; dark: settings = root |
| Warm light/dark | home = ads, publishing = analytics; dark: settings = root |
| Clean | none |

In Vivid, `--chart-1` is also `#7F77DD`. Home's first chart series then
looks like Analytics' identity colour.

**Fix:** give each theme nine distinct module colours. Add a uniqueness
assertion to `theme-contrast*.test.ts`.

### 6. P2 — The time-series axis distorts time

`charts/TimeSeriesChart.tsx` builds a **category** x-axis from the union of
timestamps that actually exist. Dates with no row are removed, so equal
spacing implies equal time when it isn't. For example, data on the 1st,
2nd and 30th draws three evenly spaced points. `alignComparison` maps the
previous period by **array position**, not by date offset. If the two
periods have different missing days, the dashed line is shifted against
the dates it is drawn over.

**Fix:** use a `time` axis, or fill the full calendar range with
`null`s at the chosen granularity. That way gaps show as breaks, and
`connectNulls: false` already handles breaks. Align the comparison by
`t - periodOffset`.

Other chart notes:

- The keyboard tooltip always sends `seriesIndex: 0`. For an axis tooltip
  that is fine, but item charts (donut, funnel) depend on series 0 being
  the only series.
- The donut has no slice labels and no "Other" bucket. Past eight slices,
  colours repeat silently because the palette cycles at 8. Show percentages
  in the legend, and group the long tail.
- The data table behind each chart is visually hidden. Sighted keyboard and
  low-vision users have no "Show data" toggle. Analytics has its own tables,
  but Home, Agency and Ads charts don't.
- Stacked areas use 0.16 fill opacity per layer, so overlaps blend into
  muddy colours. In a stack each layer is disjoint, so use solid, lighter
  fills.

### 7. P2 — Series colours fail 3:1 and rely on colour alone

Measured on `--surface` (needs 3:1 for graphical objects):

- Vivid light: chart-7 2.01, chart-8 2.20
- Meta blue light: chart-4 2.17, chart-6 2.11, chart-7 2.01, chart-8 2.20
- Warm light: chart-2 2.14, chart-4 2.16, chart-6 1.98
- Clean light: chart-4 2.38

Lines have no symbols (`showSymbol` only when there is one point) and no
dash variation except the comparison series. Multi-series charts are told
apart by hue alone, which breaks DESIGN.md's "must not rely on color alone".

**Fix:** darken the light-palette chart slots to at least 3:1. Turn on
symbols or a shape per series when there are more than two series, or
label line ends directly.

### 8. P2 — Three dropdown styles

| Kind | Where | Look |
|---|---|---|
| `Select` (custom listbox) | Tasks, Agency, Inbox filters, Team, Labels, composer hold | Themed popup, search, check marks |
| `select.ui-input` | 11 files | Native popup, CSS-drawn chevron |
| Raw `<select>` | Publishing Posts/Calendar filters, Feeds, Media, Templates, Fields, Comparison, Ads filters | Native popup, OS chevron, module-local styling |

Publishing is the busiest module, and its Posts and Calendar sidebar filters
use the third kind. The Inbox sidebar next to it uses the first. Heights
differ too: `.ui-filter select` is 38 px, `Select` and `.ui-input` are 44 px.

**Fix:** decide on one style. The cheapest consistent option is
`select.ui-input` everywhere for short lists, with `Select` only for
searchable, icon or description lists. Then migrate the raw `<select>`
files. Document the rule in DESIGN_COMPONENTS.md.

`Select` itself:

- When the search query changes, `active` resets to 0 even if option 0 is
  disabled.
- `disabled` options cannot carry a reason.
- With a `name`, the hidden `<input>` posts a value but the visible control
  is a `<button>`. A `<label>` wrapper therefore doesn't name it, which is
  why every caller passes `aria-label` twice.

### 9. P2 — Filters behave differently in each module

| Module | Control | Applies | Reset |
|---|---|---|---|
| Publishing Posts/Calendar | raw `<select>`, no `FilterPanel` | Submit button | — |
| Inbox | `Select` in `FilterPanel` | Auto-submit plus buttons | `window.location.assign` (full reload) |
| Tasks, Agency | `Select` in `FilterPanel` | Submit | full reload |
| Analytics | `FilterPanel` | Links/submit | — |
| Ads | raw `<select>` in `FilterPanel` | Submit, chips in sidebar | full reload |
| Root | `FilterPanel` | Auto | `router.push` |

Defects:

- `AgencyFilters.tsx:40`: every chip's remove button goes to
  `/agency/clients`. Removing one filter clears all of them.
- Active-filter chips appear in the content area in Agency but in the
  sidebar in Ads.
- `FilterPanel`'s count badge has `aria-label={activeCount}`, so a screen
  reader hears a bare "3".
- Resets via `window.location.assign` reload the whole page, losing scroll
  and focus and flashing the shell.

**Fix:** use one pattern. That means `FilterPanel` in `SidebarDock`, one
apply model (auto-apply for single selects, Apply for ranges and text),
chips always in the content area above results, and resets through
`router.push`. Give the count an accessible phrase such as "3 active
filters".

### 10. P2 — Density and control-height drift

Desktop control heights: menu trigger 36, `.ui-filter select` 38, subnav link
38, button 40, primary sidebar action 42, `.ui-input` and `Select` 44. An
input and a button on the same row are misaligned by 4 px. Inputs use the
44 px touch height even with a fine pointer, although `--control-height`
(40) exists for that purpose.

Tables: comfortable rows are 54 px and compact rows 44 px. "Compact" saves
only 10 px a row, even though `DataTable` documents it for "long
operational lists". The round-4 pass also widened gutters (36 px), enlarged
metric figures (34 px) and narrowed content to 1480 px. Together these make
operational screens (Queue, Inbox, Ads objects, Root lists) noticeably
sparser than the "social operations desk" in DESIGN.md.

**Fix:** use one height scale (32 small, 40 default, 44 under
`pointer: coarse` and ≤760 px), applied through the existing tokens. Make
compact rows about 36 px with 12 px type, and use compact on Queue, Inbox
list, Ads objects and Root tables. Consider a user density toggle stored
with appearance.

### 11. P2 — Table details

- **Nested scroll.** Because `stickyHeader` is on by default, every table
  gets its own scroll box up to 78vh. That gives a double scrollbar, and on
  a long page the header sticks only inside the box, not to the page. It
  also adds a `tabIndex=0` stop per table even when nothing overflows.
  Prefer page-level sticky (`top` under the top bar) without `max-height`.
- **Tints.** Hover (`--surface-hover`) is 1.06–1.22:1 against the surface.
  Even zebra rows sit at about the same tint, so hover disappears on every
  other row. Selected rows use `--accent-soft`, so a selected row looks like
  the "Published/OK" chip tone.
- **Actions header.** `DataTable.tsx:73` names the actions column with the
  table **caption**. A screen reader announces "Posts" as the column
  header. Use an "Actions" label.
- **Phone cards.** Stacked-card labels are still 11 px uppercase with
  tracking. Round 4 changed desktop headers to sentence-case 12 px, so the
  two layouts now disagree.
- There is no shared pagination or bulk-action bar, even though UX-CONTRACT
  requires total/range and a paging strategy. Each module builds its own.

### 12. P2 — Menu details

- `disabledReason` is passed only as `title`. Keyboard, touch and
  screen-reader users never get it. Render it as secondary text, or link it
  through `aria-describedby`.
- `MenuItem` has no separator or group. DESIGN.md says "Danger stays
  separated from frequent safe actions", but a danger item ends up flush
  against the others. Add `{ type: 'separator' }` and auto-insert one
  before the first danger item.
- There is no type-ahead in menus, while `Select` has it.

### 13. P2 — Typography

- `--font-sans` starts with **Inter**, but nothing loads it: no
  `next/font` and no `@font-face`. Most users see Segoe UI, SF or Roboto.
  The round-4 tracking (−0.028 to −0.04em) and weights 720/740/780 were
  tuned for Inter. On system fonts those weights snap to 700/800 and the
  tight tracking crowds the text. Load Inter with `next/font` (variable,
  `display: swap`), or retune the scale for the system stack.
- The CSS has about **60 distinct `font-size` values**: px, rem, `clamp()`
  and half-pixels (10.5, 11.5, 12.5, 13.5). `--text-*` tokens are used about
  45 times out of about 900 declarations. There are 21 uses of 10 px and 3
  of 9 px, which is below a comfortable minimum for status chips, compact
  chips and labels.
- **Fix:** use one scale (11/12/13/14/16/20/24/29), point the tokens at it,
  and lint for raw `font-size` in module CSS.

### 14. P3 — CSS architecture

- `components.css:422` `[class*="_card__"]` and `:461`
  `section[class*="_listPane__"]` select **hashed CSS-module class
  names**. This depends on Next's naming scheme. It hits any module that
  happens to name a class `card` (Tasks, Publishing, Home, Auth, Sharing),
  forces a 3 px top border, and uses `!important`. Replace it with an
  explicit shared `.ui-card` class or a `data-surface="card"` attribute.
- `globals.css:6` and `:12` define `.eyebrow` twice with different size and
  tracking. The first has `color … !important`, which overrides the module
  colouring rule in `tokens.css:955`. The module-colour eyebrow therefore
  never applies to `.eyebrow`.
- `globals.css` still holds `.page-heading`, `.quick-links`, `.home-start`
  and `.metric-card`, which have no or almost no users. `Filters.tsx` has
  no importers.
- `tokens.css` mixes palettes with about 200 lines of component rules. Round
  4 then re-declares tokens (`--radius-lg: 16px`) and component rules at the
  end of `components.css`, so it is hard to tell which value is current.
  Fold the round-4 values into the original declarations and delete the
  override layer.
- 22 `.tsx` UI components live under `src/server/root/` and
  `src/server/jobs/`. The shared `PostPreview` and `ThemeProvider` import
  from `modules/publishing` and `modules/settings`, so the shared layer
  depends on product modules.

### 15. P3 — Tokens and raw values

- Radii in use: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 and 20 px, plus
  `999px` and `50%`. The documented scale is 8/12/18. The code uses 16 for
  `lg`, 20 for dialogs and 10 for inputs and buttons (round 4).
- `var(--danger, #b3261e)` fallbacks appear in Tasks, Feeds and Agency.
  Every theme defines `--danger`, so these are dead raw colours.
- `labels.module.css:13-15`: the nine label swatches are fixed hex values,
  identical in light and dark. Yellow and gray are low-contrast on light
  surfaces.
- `calendar.module.css:26` and `:97` define `.todayTag` twice. The second
  wins.
- `--ui-good` is one green across all four themes. Status chips use
  `--accent` for "ok", so in Meta blue "published" looks blue, like a link
  or selection. Give each theme a `--success` token and use it for positive
  states.

### 16. P3 — Documentation drift

- DESIGN.md frontmatter `rounded` (8/12/18) and its colour block (an old
  green palette) do not match the code.
- DESIGN.md says content caps at 1600 px; round 4 changed it to 1480.
- It says icons are "line icons in AppShell.tsx"; they come from Tabler via
  `icons.tsx`.
- UX-CONTRACT still tells reviewers to check "Grove and Nightfall", which
  are retired themes.
- The UX-CONTRACT row "Table Selection: no shared owner" is outdated.
  `DataTable` `selection` and `IndeterminateCheckbox` exist.

## Suggested order

1. Findings 1 and 2 (CSS-only, small, P1), plus a test asserting which token
   each field selector applies.
2. Finding 3: a portal for `Menu` and `Select`.
3. Finding 5 and the chart slots in finding 7: palette values plus the
   uniqueness test.
4. Finding 4: shell and manifest copy, and required copy props.
5. Findings 8–11: a consolidation batch for dropdowns, filters, density and
   tables.
6. Findings 6, 12 and 13, then the P3 cleanup.

After each batch, rerun the browser matrix in all four themes, light/dark
**and system**, at 1440 and 390 px. This audit does not replace that run.
