# 02. Foundations (tokens)

`src/styles/tokens.css` stays the single runtime source of tokens, and
`src/lib/themes.ts` owns theme names, swatches and modes. The four themes
(Vivid, Meta blue, Warm, Clean) × light/dark × system stay. **Clean is the default for new users** (owner decision 2026-10-21; Root `theme.default`), so every spec and screenshot must look right in Clean first. v2 changes are
listed here. Each one must land in `tokens.css`, the contrast tests and
`DESIGN.md` in the same batch.

**Rule zero.** Delete the "round 4" override layer at the end of
`src/styles/components.css` (from the comment "Design pass 2026-10-21 (round 4)"
to the end of the file). Fold its intended values into the original
declarations. One value per property, no `!important`, and no selectors on
hashed CSS-module names (`[class*="_card__"]`, `section[class*="_listPane__"]`).

## 1. Colour

### 1.1 Fixes required by the audit (batch 0)

| Token / rule | Change | Why |
|---|---|---|
| Field borders | `.ui-input`, `.ui-select__trigger`, `select`, sidebar inputs, `.ui-segmented`, `.ui-filter-chip`, `.ui-menu__trigger` use `--control-border`, never `--line-strong`. | `--line-strong` measures 1.49–2.02:1 on the surface in all 8 palettes. WCAG 1.4.11 needs 3:1. |
| `--on-mod` (new) | Defined per palette and mode: light `#ffffff`; dark `var(--canvas)`. Every icon or text on a solid `--mod` / `--area` fill uses it. | Removes the `[data-mode="dark"]` rules that miss system-dark (`tokens.css:944`, `components.css:392`). |
| System mode | Any mode-dependent rule outside a palette block is forbidden. Use tokens. If unavoidable, write the `@media (prefers-color-scheme: dark) { :root[data-mode="system"] … }` twin. Enforce with a test that greps for `data-mode="dark"` outside palette blocks. | The system-dark bug class. |
| `--success`, `--success-soft` (new, per palette) | Positive states: published, connected, passed. Replace `--ui-good*` and stop using `--accent` for "ok". | Brand accent and "success" are different meanings; in Meta blue, "published" looked like a link. |
| `--mod-soft` icon contrast | The icon on a soft chip uses `--mod-ink` (72% mix toward ink), not `--mod`. | `--mod` on `--mod-soft` is 2.81–2.89:1 in light palettes. |
| Chart slots | Each light palette's `--chart-1…8` reaches ≥3:1 on `--surface`. Today: Vivid 7–8, Meta blue 4/6/7/8, Warm 2/4/6, Clean 4 fail. Darken those slots. | WCAG 1.4.11 for graphical objects. |
| Raw colours | Remove `var(--danger, #b3261e)` fallbacks (Tasks, Feeds, Agency). Make label swatches (`labels.module.css`) theme tokens `--label-<name>` with light/dark values. | Rule "no raw colour in screen styles". |

### 1.2 Area colours (replace module identity in navigation)

v2 navigation shows **areas**, not modules, so identity colours attach to areas:
`--area-home`, `--area-content`, `--area-inbox`, `--area-insights`, `--area-tasks`,
`--area-agency`, `--area-settings`, `--area-root`. Initially alias existing
tokens (`--area-content: var(--mod-publishing)`, `--area-insights: var(--mod-analytics)` …).
Keep `--mod-*` for module icons inside an area, such as the Ads tab icon.

Rules, enforced by a new uniqueness test:

- The 8 area colours are pairwise distinct in every palette and mode.
- `--on-mod` on each area colour is ≥3:1 for icons, and ≥4.5:1 if text sits on it.

Fix today's collisions:

| Palette | Collision | Suggested fix |
|---|---|---|
| Vivid light/dark | home = analytics `#7F77DD`; dark settings = root | `--area-home: var(--accent)` (`#534AB7` light, `#AFA9EC` dark); dark root `#5F5E5A` |
| Meta blue | home = analytics `#378ADD`/`#85B7EB`; dark settings = root | home `var(--accent)`; dark root `#8C8A84` |
| Warm | publishing = analytics (`#D85A30`); home = ads | results `#7C5CDB` light / `#AFA9EC` dark; home `var(--accent)` |
| Clean | none | — |

## 2. Typography

The font is **Inter**, loaded with `next/font/google` (variable, `display: swap`,
subsets latin + latin-ext), and exposed as `--font-sans`. Today it is
declared but never loaded. The fallback stack stays.

| Token | Size / line height / weight | Use |
|---|---|---|
| `--text-2xs` | 11 / 16 / 600 | Badges, chart axis labels only (never body copy) |
| `--text-xs` | 12 / 16 / 500 | Help text, table meta, timestamps |
| `--text-sm` | 13 / 20 / 500 | Table cells, sidebar links, secondary text |
| `--text-md` | 14 / 22 / 400 | Body, form inputs (16 on phones to stop iOS zoom) |
| `--text-lg` | 16 / 24 / 650 | Card titles, dialog titles |
| `--text-xl` | 20 / 28 / 700 | Section titles |
| `--text-2xl` | 24 / 32 / 700 | Page titles (phone) |
| `--text-3xl` | 28 / 36 / 750, tracking −0.02em | Page titles (desktop) |
| `--text-metric` | 32 / 36 / 750, tabular nums | KPI figures |

Rules:

- Only these 9 sizes. Lint module CSS for raw `font-size`, which today has about 60 distinct values.
- Weights: 400, 500, 600/650, 700, 750. No 720/740/780.
- Sentence case everywhere, including table headers and phone card labels. No uppercase except the 11 px section labels in the sidebar.
- Numbers use `font-variant-numeric: tabular-nums`.

## 3. Space, size, density

| Token | Value | Use |
|---|---|---|
| `--space-1…8` | 4, 8, 12, 16, 20, 24, 32, 40 | Existing scale; add `--space-10: 48`, `--space-12: 64` |
| `--control-h-sm` | 32 | Compact buttons, chips, table actions (desktop, fine pointer) |
| `--control-h` | 40 | Default buttons, inputs and selects on desktop |
| `--control-h-touch` | 44 | All controls under `pointer: coarse` or ≤760 px |
| `--row-h` | 48 | Comfortable table row |
| `--row-h-compact` | 36 | Compact table row (Queue, Inbox list, Ads objects, Root tables) |
| `--sidebar-w` | 248 | Expanded sidebar |
| `--sidebar-w-rail` | 64 | Collapsed sidebar |
| `--topbar-h` | 56 | Desktop top bar (phone 52 + safe area) |
| `--bottombar-h` | 64 | Phone bottom bar + safe area |
| `--content-max` | 1280 | Work area cap (lists, results) |
| `--form-max` | 720 | Forms and composer editor column |
| `--gutter` | 32 desktop / 24 tablet / 16 phone | Content inset |

**Rule:** inputs and buttons that share a row have the same height. Today inputs are 44 px and buttons 40 px.

## 4. Shape, elevation, motion

| Token | Value |
|---|---|
| `--radius-xs` | 6 (chips inside controls) |
| `--radius-sm` | 8 (controls, buttons, inputs) |
| `--radius-md` | 12 (cards, tables, popovers) |
| `--radius-lg` | 16 (dialogs, sheets, composer) |
| `--radius-full` | 999 (badges, avatars) |
| `--shadow-card` | Today's `--card-lift`; dark uses the inset highlight |
| `--shadow-pop` | Popovers, menus, toasts |
| `--shadow-sheet` | Dialogs, composer, bottom sheets |
| `--ease-fast` | 120 ms `cubic-bezier(.2,.8,.2,1)` (hover, press) |
| `--ease` | 180 ms (popovers, tabs) |
| `--ease-sheet` | 240 ms (sheets, sidebar collapse) |

Only these 5 radii. `prefers-reduced-motion` turns transitions off, except opacity.

## 5. Focus

All interactive elements use one treatment: `outline: 2px solid var(--focus); outline-offset: 2px`.
Inputs may add the soft halo, but they keep the 2 px outline. The 35% halo alone
measures 1.5–2.1:1. The sidebar on a dark rail uses `--rail-active-ink`.

## 6. Charts

Charts keep ECharts through `src/components/charts/*` with `--chart-*` tokens (docs/CHARTS.md). Required changes:

- **Time axis.** Use a `time` axis, or fill missing dates with `null` at the chosen granularity. Never compress gaps.
- **Comparison series.** Align by date offset (`t − periodLength`), not array position.
- **Not colour alone.** Above 2 series, show symbols or a dash pattern per series, or label line ends.
- **Palette exhaustion.** More than 8 series or slices: group the remainder as "Other".
- **Donut.** Show the percentage in the legend.
- **Visible data.** A "Show data" toggle reveals the existing hidden table to everyone.
