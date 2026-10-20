# UI polish audit: shared design system

Date: 2026-10-20. Scope: `src/styles/tokens.css`, `src/app/globals.css`, `src/components/**`.
Authority: [../DESIGN.md](../DESIGN.md), [../UX-CONTRACT.md](../UX-CONTRACT.md). Evidence level:
source review plus unit tests (token contrast arithmetic). No browser, screenshot or
assistive-technology run was made in this batch.

## Findings and fixes

| Area | Finding | Fix |
| --- | --- | --- |
| Contrast | Muted text (`--ink-faint`) on `--accent-soft` was 4.41:1 in Clay and 3.89:1 in Nightfall (chips, active sub-nav). | Clay `#765e51`, Nightfall `#a6b6bd`; DESIGN.md updated. New test covers accent, warning, danger, focus ring and field border pairs in all four themes. |
| Hardcoded colour | Auth card buttons used `white` text; on the light Nightfall accent this is poor contrast. `white` fallbacks on primary/danger buttons and the home action. | All use `--on-accent` / `--on-danger`. |
| Duplicate base rules | `globals.css` repeated box-sizing, body, form font and focus ring from `tokens.css`. | Removed duplicates; `tokens.css` is the single source. |
| Radius / type scale | Buttons and filter selects used a literal 9px radius; rail labels were 10px. | Use `--radius-sm`; new `--text-xs..lg` scale used by buttons, rail and filters; rail labels 11px. |
| Motion | Literal `.15s` transitions. | `--ease` token. Reduced-motion rule already neutralises all animation, including the new skeleton and busy spinner. |
| Buttons | No hover for danger; no busy state. | Danger hover; `aria-busy="true"` on `Button` shows a spinner and progress cursor (API unchanged, props already pass through). |
| Forms | `.ui-input` had no hover, placeholder, readonly, textarea or select treatment. | Added; select gets a themed chevron instead of the browser-default control. |
| States | No shared empty/error/loading primitives; pages hand-rolled them. | `.ui-skeleton`, `.ui-state`, `.ui-state--error` classes for pages to adopt. |
| Tables | Single density; 620px minimum width on phones (local scroll, kept). | `.ui-table--compact`; overscroll contained to the wrapper. |
| Touch | 32px small buttons and 40px sub-nav links on touch devices. | `pointer: coarse` raises small buttons, inputs, filters and sub-nav links to 40-44px. |
| Forced colors | No handling. | Borders and an active-item outline use system colours; focus ring uses `Highlight`. |
| Small screens | Auth card padded 36px at 390px; page title 27px minimum. | 24/18px padding and 26px title at 500px and below. |

## Gaps not fixed

- Many module-local stylesheets and inline styles still use literal font sizes and colours; adopt the `--text-*` scale gradually. `.ui-channel__mark` keeps `#fff` on provider brand colours (brand-defined backgrounds).
- `DataTable` has no sticky header or scroll-affordance shadow on phones.
- `loading.tsx` is a single spinner; route-specific skeletons belong to module owners (use `Skeleton` or `DataTable loading`).
- Shell and shared component default copy ("Skip to content", "Menu & filters", "Close dialog", "Nothing to show yet.", "Loading your workspace…") is English-only and `<html lang>` is fixed to `en`; there is no shared locale mechanism in `src/lib`. French needs one, then these strings should come from it. New components take copy via props (`label`, `loadingLabel`, `emptyMessage`).
- `src/app/error.tsx` (not in this lane) offers only "Try again"; a link home would help when retry keeps failing.
- Shell labels such as `.shell-workspace-label` and `.shell-subnav__label` are still 10px; below the 12px floor the design asks for on interactive text, but they are non-interactive caps labels.
- `.panel` still carries the heavy `--shadow-panel`; DESIGN.md reserves it for raised panels. `--shadow-raised` exists for a follow-up once the visual change is reviewed in a browser.
- Needs a browser pass: four themes at 1440px and 390px, keyboard focus order, forced-colors, and the new select chevron in Nightfall.

## Verification

`npx vitest run tests/theme-contrast.test.ts tests/theme-contrast-semantic.test.ts tests/screen-table-overflow.test.ts tests/browser-matrix.test.ts tests/root-platform-publication-action-ui.test.ts`: 53 pass, 1 skipped. `npx tsc --noEmit -p .` completed with no reported errors.
