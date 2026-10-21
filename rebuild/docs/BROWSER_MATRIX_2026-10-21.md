# Browser appearance matrix, 2026-10-21

Scope: real Chromium (Playwright) against a **local production build** (`next build` + `next start`, :3200) with the
**synthetic** preview PostgreSQL database. Not production, not live-provider evidence. Harness:
`scripts/verify-browser-matrix.ts` (extended; unit tests in `tests/browser-matrix-extended.test.ts`).

The harness is read-only: loopback only, external requests blocked, no non-GET after sign-in (the one exception is the
read-only `/join` invitation-preview POST, public group only). Run it with `npx tsx scripts/verify-browser-matrix.ts`
(env: `BASE_URL`, `QA_EMAIL`/`QA_PASSWORD` or `QA_CREDENTIALS_FILE`, `BROWSER_MATRIX_REPORT`, `BROWSER_MATRIX_SHOTS`,
optional `MATRIX_ONLY=/prefix,...` for subsets, which reports INCOMPLETE_MATRIX by design). `BROWSER_MATRIX_SCOPE=customer`
runs the earlier customer-only keyboard gate.

## Matrix

4 themes (vivid, meta, warm, clean) × data-mode light/dark × 1440×900 / 390×844 = 16 combinations over:

| Group | Routes | Cells |
| --- | --- | --- |
| Customer (signed in) | 41 static customer pages | 656 |
| Root (installation owner) | 16 static Root pages | 256 |
| Public (signed out) | /sign-in, /sign-up, /password-recovery, /verify-email, /join | 80 |
| **Total** | | **992 / 992 executed** |

Per cell: `data-theme` and `data-mode` applied, HTTP status/redirect, console and page errors, hydration warnings,
failed same-origin requests (status ≥ 400), horizontal overflow (with culprit elements), accessible names on controls,
contrast spot check (every visible text node up to 600 per page; WCAG 4.5:1, 3:1 for large text; colours resolved
through canvas, translucent backgrounds composited, gradient/image backgrounds skipped) and a screenshot of any failing cell.

Excluded (dynamic, need ids/tokens): `/bio/[slug]/view`, `/share/[token]/view`, `/publishing/collaboration/post/[postId]`,
`/root/errors/[id]`, `/root/modules/[id]`, `/root/platforms/[id]`. Also not covered: `/`, `/oauth/authorize`, `/no-workspace`,
`/access-limited`, `/two-step*` (session-state dependent). Keyboard/dialog checks are not part of this extended run; the
customer gate (`BROWSER_MATRIX_SCOPE=customer`, 4 themes, default mode) remains the keyboard evidence and was **not re-run**.
Contrast is a spot check of computed colours, not a full WCAG audit (no hover/focus states, no images, no charts).

Setup notes: the QA user was made installation owner in the local preview database so Root renders (local only). `next dev`
repeatedly ran out of heap (even at 8 GB) while compiling ~1,000 route/theme cells, so the final runs used the production build.

## Results

| Run | State | Findings |
| --- | --- | --- |
| 1 | baseline, before fixes | 269 |
| 2 | after global border-box reset + subnav contrast | 216 |
| 3 | after hidden-table overflow fix | **176** (each console error / failed request counts separately) |

Run 3 (final, 992 cells): **FAIL, 0 overflow, 0 accessible-name, 0 theme/mode-not-applied, 0 redirects, 0 HTTP failures.**
All Root pages (16 × 16) passed with no findings. Remaining findings, all outside the shared CSS/components owned by this lane:

| Finding | Where | Cells | Cause / owner |
| --- | --- | --- | --- |
| CONTRAST_LOW 3.1–4.3:1 | `/home` "Open inbox/Ads/Analytics…" links (and "Publishing" open link in vivid dark) | 10 | `src/modules/home/ui/home.module.css` uses the module tone token (`--mod-*`/`--chart-*`) directly as text colour. Suggest `color: color-mix(in srgb, var(--tone) 70%, var(--ink))` |
| CONTRAST_LOW 3.7–3.9:1 | `/publishing/calendar` today badge ("21", "Today") white/indigo on coral; "View post" 4.35:1 | 6 | `calendar.module.css` (Publishing UI): coral fill with white text; use `--on-accent`-safe pairing or darker coral |
| CONSOLE_ERROR + 404 | `/publishing/posts`, `/queue`, `/approvals` request `/api/media/<id>` | 16 + 16 + 16 | Synthetic seed posts reference media ids with no stored file. Data issue in the preview DB, not CSS; the UI should still show a fallback for missing media (not verified) |
| CONSOLE_ERROR + 404 | `/join` calls `/api/auth/invitations/preview` with no token | 16 | Home/auth module: the page requests a preview unconditionally; 404 for a missing token should be handled without a console error |

## Defects fixed (src/styles/tokens.css)

1. **No global `box-sizing`.** Authored widths/min-heights excluded padding and border: the sign-in/up/recovery/verify/join cards
   overflowed phones (7–106 px, card cut off at the right edge) and every `.ui-input` rendered ~66 px tall instead of the intended 44 px.
   Added `*, *::before, *::after { box-sizing: border-box; }`. Cleared HORIZONTAL_OVERFLOW on all five public pages and the
   mobile-nav cells' overflow component. Spot-checked Home at 1440 px, layout intact; other pages were not visually compared before/after.
2. **Active sidebar link contrast** (Inbox in meta/warm light 4.32–4.42:1; Settings pages in one warm cell 4.46:1):
   active text now `color-mix(in srgb, var(--mod-ink) 80%, var(--ink))`. Cleared.
3. **Hidden chart-data tables widened the page** (`table.ui-visually-hidden` ignores width/overflow; 41–437 px on Ads, Ads campaigns,
   Agency, Analytics, Demographics at 390 px). Added `table.ui-visually-hidden { display: block; }`. Row semantics were still
   exposed to the accessibility tree in Chromium (rows counted via role); not re-tested in other browsers/screen readers.

Tests: `tests/browser-matrix.test.ts`, `tests/browser-matrix-extended.test.ts` (new), `tests/responsive-shared-css.test.ts`,
`tests/theme-contrast*.test.ts` all pass; `npx tsc --noEmit -p .` 0 errors.

## Not proven

Keyboard/dialog behaviour in the new modes, system mode, failure/empty states, pages needing dynamic ids, long-content and
non-synthetic data, other browsers, Firefox/Safari layout of the global box-sizing change, and screen-reader behaviour of the
display-block table. Nothing here is live-provider or production evidence.
