# Browser appearance matrix, 2026-10-21

Scope: real Chromium (Playwright) against a **local production build** (`next build` + `next start`, :3200) with the
**synthetic** preview PostgreSQL database. Not production, not live-provider evidence. Harness:
`scripts/verify-browser-matrix.ts` (extended; unit tests in `tests/browser-matrix-extended.test.ts`).

The harness is read-only: loopback only, external requests blocked, no non-GET after sign-in (the one exception is the
read-only `/join` invitation-preview POST, public group only). Run it with `npx tsx scripts/verify-browser-matrix.ts`
(env: `BASE_URL`, `QA_EMAIL`/`QA_PASSWORD` or `QA_CREDENTIALS_FILE`, `BROWSER_MATRIX_REPORT`, `BROWSER_MATRIX_SHOTS`,
optional `MATRIX_ONLY=/prefix,...` narrows the route list (the report then covers just those routes)). `BROWSER_MATRIX_SCOPE=customer`
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

# Round 2 (2026-10-21): dynamic pages, session states, system mode, keyboard, empty/not-found/failure states

Same environment as round 1: real Chromium against a local **production build** (`next build` + `next start`, :3200, HEAD `4cccd55f` + this lane) and
the **synthetic** preview PostgreSQL database. Not production, not live-provider evidence. The preview database predates the newest migrations
(`wordpress_recipe_sources` is missing; the server logged that error while pages rendered), so Feeds data paths were not exercised.

Run: `npx tsx scripts/verify-browser-matrix.ts run.json` where `run.json` is a local JSON object of settings (`BASE_URL`, `QA_CREDENTIALS_FILE`,
`MATRIX_FIXTURES`, `BROWSER_MATRIX_SCOPE=round2:<dynamic|states|notfound|empty|system|keyboard|failure>`, `BROWSER_MATRIX_REPORT`,
`BROWSER_MATRIX_SHOTS`; optional `MATRIX_GROUPS`, `MATRIX_ONLY`, `MATRIX_SHOT`, `FAILURE_COMBOS`). A run narrowed by `MATRIX_GROUPS`/`MATRIX_ONLY` is
complete for what it names; a narrowed keyboard run can report `KEYBOARD_COVERAGE_MISSING` for control kinds that live on other routes.
`MATRIX_FIXTURES` points at a local, uncommitted JSON file (validated by `parseFixtures`) with the synthetic ids and fixture session tokens below.

Local-only fixtures seeded in the preview database (and removed afterwards): known share-link tokens for the three seeded links (review, calendar,
portal), one error event, one OAuth client, and four sessions: a user with no membership, a user with an empty workspace, a pending second-step
session and a pending enrolment session. Injected failures are fulfilled by Playwright route interception, so they never reach the server.

## Results

| Part | Scope | Cells | Findings |
| --- | --- | --- | --- |
| dynamic | collaboration post (2), Root error/module/platform detail (4), bio, three share kinds; 4 themes × light/dark × 2 viewports | 160 / 160 | 96, all one cause (below) |
| states | `/`, `/access-limited`, `/oauth/authorize` (invalid request and consent URL), `/no-workspace`, `/two-step`, `/two-step/enroll` in the sessions they need, plus signed-out redirects | 176 / 176 | **0** |
| notfound | unknown route, Root/collaboration/bio/share unknown ids, signed in and out | 128 / 128 | 128, two causes (below) |
| empty | all 41 customer pages as a user with an empty workspace | 656 / 656 | 3 (calendar badge) |
| system | 22 representative pages, modes light, dark, system+light, system+dark (colour scheme emulated; also flipped live after load) | 768 / 768 | 138: calendar badge, `/join`, share media 404; **0 `SYSTEM_MODE_MISMATCH`, 0 `SYSTEM_MODE_NOT_LIVE`** |
| keyboard (customer) | 41 pages × 16 combos; 19,807 Tab stops walked | 656 / 656 | **0** |
| keyboard (Root, public, dynamic, states) | same walk | 672 / 672 | **0** (one `KEYBOARD_COVERAGE_MISSING: tabs` because the split run has no tab strip; the customer run exercised it) |
| failure | 62 pages, 5 injected scenarios, meta/dark/1440 and warm/light/390 | 640 / 640 | 48 (below) |

New per-cell checks: system mode renders exactly like its explicit mode (computed colours of body/main/nav) and restyles live when the device
preference changes; expected final path and status per state/not-found page; and a single full Tab walk per page that records every stop.
The walk requires: a visible focus ring on **every** stop, every stop inside the viewport, no keyboard trap (date/time segments allowed), skip link first and
moving focus into `main`, Menu (open, arrows, Home/End, Escape restores focus; items are never activated), Select (open, arrow, Escape), Tabs (arrow moves and
selects, back), dialogs (phone drawer, calendar post dialogs, Tasks editor, Inbox `?` guide: open, contain focus, ring, Escape closes, focus restored), and the
sidebar or `main` holding a reachable page action. Counts across the customer run: menu 64, select 72, tabs 16, dialog 352, form submit 272 passed.
Failure scenarios: write 500, write offline, write 401, read 500, read offline. Writes submit up to three forms per page and the Tasks/labels/templates
creation dialogs with generated values; reads fail client fetches during load.

## Defects fixed in my owned paths

None needed: every shared-CSS/component check (focus rings, skip link, Menu/Select/Tabs/Dialog keyboard behaviour, system mode, empty states) passed. The only
harness corrections were false positives in my own checks (native date inputs spending several Tabs on one element; pages with no controls; empty `main` pages whose
actions live in the sidebar).

## Findings for module/app owners (not fixed here)

| Severity | Finding | Where | Owner |
| --- | --- | --- | --- |
| High | Unknown ids/tokens return **HTTP 200** with the default Next.js 404 body ("soft 404"): `/bio/<missing>/view`, `/share/<missing>/view`, `/root/{modules,platforms,errors}/<missing>`, collaboration post. `src/app/loading.tsx` streams a shell before `notFound()` runs. Public pages should answer 404. | `src/app/loading.tsx`, detail screens | App shell / Sharing / Root |
| High | No `not-found.tsx`: unknown routes show the unbranded Next default (white in light, black in dark by browser preference, ignores selected theme/mode, no way back, English only). Wanted: a themed `.route-state` page with a link home, EN/FR. `src/app/error.tsx` has the same English-only copy. | `src/app/not-found.tsx` (missing), `src/app/error.tsx` | App shell |
| High | `/two-step` reports **any** failed response (500, 401, offline-adjacent) as "The code was not accepted". Only a real rejection should say that; server/network failure needs "could not verify, try again". | `src/app/two-step/verify-form.tsx` | Auth |
| Medium | Raw error text from the response body is shown on screen for 500 responses: Tasks (new task, checklist), Labels, Templates, Analytics Goals, `/password-recovery`, `/verify-email`; and for failed reads in `/inbox/moderation` and `/root/errors`. UIs should map status to a safe sentence. | those UIs | Tasks, Publishing, Analytics, Auth, Inbox, Root |
| Medium | A failed write replaces the page with the global error boundary ("We couldn't load this page") and loses typed input: `/root/activity` (second form on the page), `/publishing/queue` (first form on the page) on 401/500. | Root activity and Publishing queue UIs | Root, Publishing |
| Medium | 401 (expired session) is reported as an unrelated validation message: saved-view dialogs on Calendar, Posts ("Check its name and try again"). Expected: say the session expired and offer sign-in. | `SavedViews` | Publishing |
| Medium | `/publishing/calendar` today badge ("21"/"Today", white on coral) is 3.9–4.1:1 in warm light/dark, meta dark and clean dark at desktop width (round 1 note persists after `4cccd55f`, in dark modes and warm light). | `calendar.module.css` | Publishing |
| Low | `/join` requests `/api/auth/invitations/preview` without a token and logs a 404 console error (round 1, still present). | Auth | Auth |
| Low | Seeded media with no stored file make `/share/<token>/media/<id>` return 404 (console error on share pages); the pages themselves show no broken image. Data issue; fallback visual not verified with a real missing file. | preview data | n/a |
| Info | Share pages (`/share/*/view`, `/bio/*/view`) are neutral and not theme-coloured; not evaluated against DESIGN.md. | Sharing | Sharing |

Everything the injected-failure run **passed** counts too: 121 form/dialog probes surfaced a failure message, kept input, left no stuck pending state and
kept dialogs open, including sign-in, sign-up, join and the Tasks dialogs on offline failure ("The result is unknown. Refresh the list...").

## Still not proven (round 2)

Server-rendered 500 pages (no safe way to make the production build throw; `error.tsx` was only seen via the client-side boundary), Firefox/Safari,
screen readers, long/non-synthetic content, hover states, Feeds/WordPress pages against a migrated database, forms behind confirmations that need real
provider state, and any live-provider or production behaviour. Keyboard checks cover the first Menu, Select, Tabs and dialog opener found on each page;
menu items are never activated. System mode was compared on 22 representative pages, not every route.
