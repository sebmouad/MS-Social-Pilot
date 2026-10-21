# Shared delivery plan

Updated 2026-10-21 against local HEAD `a910d774`; the sections below were reviewed
at `960831df` (rounds 6–8) and rounds 9–12 are summarised in the next block.

## Rounds 9–12 delta (HEAD `a910d774`, schema 120)

Deployed release is recorded by the owner/integrator as `a910d774` (schema 120);
this lane did not observe it. Items below are source/unit evidence unless marked.

- **Live-defect fixes:** `806a0ef5` (Facebook analytics targets report the platform
  id, not the Page id, so the Analytics post explorer was empty) and `6e111754`
  (the post explorer reads synced insights for app-published Facebook posts).
  Regression tests are mocked; no fresh production observation is recorded here.
- **Facebook OAuth:** `c0e5386a` uses the Root public origin for callback checks
  and redirects (behind the proxy the internal listener made the redirect point at
  localhost). Reconnect is **pending the owner's retry**; unverified until a
  successful connection is observed.
- **Recipe captions:** `a47a339c` decodes the HTML5 entity catalog, keeps nonbreaking
  spaces and adds the audited preview/apply repair service; `a910d774` maps the C0
  control (seen U+0016) before French high punctuation to U+202F and drops other C0
  controls. Seven WordPress captions were affected; one already-published post is
  kept as it is. Recipe supply (reuse settings, supply card) and Feeds reviewer
  notices come from rounds 10–11.
- **Rounds 10–11:** Facebook Page collection wiring, publication distributions and
  link report details, media rename REST, Publishing/Settings and Ads/Home/Root
  polish, MCP scoped-key matrix tests, schema 119 and 120.
- **Browser round 6:** the lane hung. Only the harness (WebKit uses Option+Tab on
  macOS, end-of-tab-order detection) and a date/time focus ring were committed
  (`d24fcd40`). No round 6 result exists; rounds 6–12 UI changes remain unrerun.
- **Order changes:** batch 1 now also confirms `a910d774` and migration receipts;
  batch 5 reruns the browser matrix from scratch; add a successful Facebook
  reconnect check after the OAuth fix.
Goal remains active: [GOAL.md](GOAL.md). Binding target:
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md), unchanged. Current source
and evidence: [ARCHITECTURE.md](ARCHITECTURE.md).

## Position

Owner-recorded cutover occurred 2026-10-20; rebuild serves social.newsgeet.com,
legacy web/worker are recorded disabled, releases use `rebuild/scripts/prod-deploy.sh`
and legacy deployment is guarded. The deployed release is recorded as `960831df`,
schema 117, with migration `20261031180000_rebuild_ads_ad_creation` applied
(integrator/owner statement; this lane made no production calls and did not re-observe
it). Preserve one publisher and rollback assets. RELEASE_GATES_PLAN's dated results
are evidence, not proof every gate passed.

Merged progress in rounds 6–8 (`6d3347fb`, `5e7749c3`, `960831df`; source and
unit/mocked evidence unless stated):

- **Ads:** the `ad.create` ledger CHECK migration is authored (recorded applied in
  production by the owner/integrator). Ads copy is Root-managed and resolved per
  request through `configuredOperations(locale)`, but UI/REST/MCP callers do not
  pass the customer locale yet; the cutover-rehearsal script and tests lack the new
  migration; a recovery scope gap is noted in the Ads README. No live
  `ads_management` grant or live write.
- **Browser findings (source):** themed bilingual `not-found.tsx`, saved-view
  session wording, published-card contrast, `notFound()` on unknown collaboration
  post ids, Inbox/Analytics focus/table polish. Not rerun in a browser.
- **Facebook:** richer post-metric collection (clicks, video metrics for video
  posts, reaction provenance), shipped metric label defaults merged under saved
  labels, ad error codes and EN/FR copy. Reports: Published posts and Top post
  content (Root keys `analytics.reports.publicationDetails`, `...topPostContent`).
- **Recipe recovery and scheduling (round 6):** ledger-id reconciliation and
  pause-cancel rotation at unit level only.

Merged progress in the earlier snapshot (`1240a9ce` to `46c6bdae`):

- **Rollback drill (production host, owner-recorded):** `prod-rollback-drill.sh`
  restored a 2026-10-21 backup into a scratch database and started legacy and the
  installed rebuild on spare ports: PASS (restore 2 s, legacy 3 s, rebuild 2 s),
  scratch resources removed, live services untouched. It proves a restorable
  backup and startable rollback artifacts, **not** a proxy cutback, media
  restoration or latest-migration restore.
- **Recipes (production, owner-recorded):** the first full day published 40/40
  posts with 40/40 first comments (07:00, 11:00, 15:00, 17:00 Europe/Paris), 70
  plans pending on the rolling horizon. Recovery paths (retry, pause-cancel,
  supply exhaustion) are still unit evidence only.
- **Browser rounds 3–4 (local build, synthetic data):** Firefox and WebKit
  extended matrices (496 cells each, two themes), system mode on every page
  (Chromium), server-rendered failure, page-level error boundary and dynamic/
  empty/not-found/failure parts in both new engines. Layout, accessible names and
  theme application held; hydration and module findings remain (see below).
- **Error pages:** `error.tsx` and new `global-error.tsx` use the shared themed,
  bilingual `ErrorState` with retry that re-requests the server and a way home.
  A themed `not-found.tsx` was absent then and was added in round 8 (`960831df`).
- **Browser-finding fixes (source, unit):** queue cancel failure, Root activity
  controls, two-step failure wording, tokenless join preview, verify-email/
  password-recovery raw text and calendar today-badge contrast
  (`tests/browser-findings-fixes.test.ts`). Not rerun in a browser.
- **Settings/Root service boundaries (source, mocked):** single and batch
  connection selection and disconnect callers (UI, REST, MCP) use the confirmed
  services; Root workspace create/rename, directory (actor-checked), configuration
  save (exact confirmation, in-transaction actor recheck) and error resolution now
  live in `src/modules/root/server/` with `src/server/root/*` re-exports. Partial
  account export is exposed as a session-only route, MCP tool and bilingual
  Account download, explicitly partial.
- **Ads (source, mocked):** paused `ad.create` through the shared management
  service for UI, session REST and MCP; a reconnect notice when `ads_management`
  is absent; hierarchy path in Campaigns. Management stays off by default and the
  live `ads_management` grant is pending. No migration at HEAD adds `ad.create`
  to the ledger operation-kind CHECK, so writes fail closed until one exists.
- Earlier merges (Root EN/FR catalogs, account appearance, worker fetch-then-write,
  read-path indexes, response-report rounds, Facebook post metrics) are described
  in ARCHITECTURE.md and are unchanged in status.

## Next reviewable batches

| Order | Work | Required evidence / owner |
| --- | --- | --- |
| 1 | Reconcile deployed release, migrations and recovery | Release owner confirms deployed SHA, target migration/ownership (recent purge-gate, read-index, inbox-metadata and trigram migrations), media backup coverage and a proxy-level cutback. Extend the rollback drill to the exact release; do not replay cutover |
| 2 | Ads management activation | Migration `20261031180000_rebuild_ads_ad_creation` is recorded applied; add it to the cutover rehearsal script/tests, pass the customer locale from UI/REST/MCP, and enforce channel scope in recovery. Release owner obtains the live `ads_management` grant on a test account; exercise paused creation, status/budget/creative changes and cleanup with exact confirmations. Integration owner runs real scoped MCP/key checks |
| 3 | Close remaining service/transport differences | Agency owner (workspace switching confirmation) and Sharing owner (copy-only saves) reconcile with the service contract; run a cross-module auth/scope/confirmation matrix and real MCP client checks |
| 4 | Prove data controls | Release owner pins supplementary purge gates in rehearsal; prove recent-table export/erasure, account deletion, partial-export content and trigger concurrency on isolated PostgreSQL. Keep coverage explicitly partial |
| 5 | Fix and rerun browser findings | App owner: real 404 statuses for unknown share/bio/Root ids (themed `not-found.tsx` exists since round 8; collaboration posts call `notFound()`); a boundary inside the shell. Module owners remove raw server text (Tasks, Labels, Templates, Analytics goals, Inbox moderation, Root errors), fix WebKit hydration (`root-time.ts`, Sharing `LinksManager`). Rerun Chromium, Firefox and WebKit including keyboard walks in the new engines, all four themes, and the round 6–8 fixes (saved-view wording, calendar contrast, `/join`, themed 404, Inbox/Analytics polish) |
| 6 | Verify scheduling and recipe recovery | Publishing/Feeds/Facebook owners exercise mixed native/app holds, approval, cancel/reschedule, first comments, retry of uncertain claims, pause-cancel refused batches and supply exhaustion. Preserve ledger/locks and clean up identifiable test effects |
| 7 | Verify reliability and performance at runtime | Worker owner measures stop/drain versus systemd timeout, database contention and stale binding/purge races. Database owner checks query plans and representative volume/timing for the new indexes |
| 8 | Complete legacy/provider/configuration scope | Per-module work in LEGACY_CAPABILITY_PARITY; full Facebook collection/metadata, remaining connectors/format eligibility, live mail/security, complete Root/copy controls, report history/scale and actual REST/MCP/provider outcomes with cleanup |

## Browser evidence and limits

[BROWSER_MATRIX_2026-10-21.md](BROWSER_MATRIX_2026-10-21.md) records local production
builds with synthetic PostgreSQL data. Chromium round 1: 992 cells, no overflow
after shared CSS fixes, 176 findings. Round 2: dynamic, session, not-found, empty,
representative system mode, keyboard walks and injected failures; scoped system and
keyboard checks passed. Round 3: Firefox and WebKit (496 cells each; WebKit shows 16
hydration warnings), Chromium system mode on every page (992 cells, no mismatch),
and server-rendered failure, which was found failing and fixed (0 findings in three
engines afterward, but only with `src/app/` files that round did not commit; the
committed `error.tsx`/`global-error.tsx` supply that coverage now, without a database-
outage rerun). Round 4: page-throw boundary (16 cells per engine, 0 findings), retry
recovery in Firefox, and dynamic/empty/not-found/failure parts in Firefox and WebKit
on a migrated preview database. Unresolved: soft 404s and unbranded unknown-route page,
raw server text, WebKit hydration, boundary above the shell, calendar contrast in
some warm/dark cases, share-media 404s from seed data. Not covered: keyboard and
system-mode runs in Firefox/WebKit, real Safari/iOS, screen readers, long content,
production or provider outcomes, other themes in the new engines, and the round-5
fixes. Historical matrices remain dated.

## Delivery discipline

Current schema version is 117; this documentation lane adds no Root keys and does
not edit the registry version. Historical lane instructions to bump old versions are
not current integration work. Recheck current source instead of replaying reports.
Product logic belongs to modules, Facebook rules to its platform, shared hosts
stay neutral. Services own current auth/scope, exact consent and domain audit.
Keep source, automated, browser, provider and production evidence distinct; no
invented completion percentages. Lane authorization: owned documentation only,
no whole suite, servers, deploy, push or production. Leave verified working-tree
changes for integration if Git metadata is outside writable roots.
