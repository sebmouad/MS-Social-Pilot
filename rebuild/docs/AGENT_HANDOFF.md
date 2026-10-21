# Shared agent handoff

Updated 2026-10-21 against local HEAD `a910d774` (rounds 10–12 appended after
round 9 below; deployed release recorded as `a910d774`, schema **120**, an
owner/integrator statement not re-observed here). Earlier text reviewed `ffdb1cdf`
and where it names `ffdb1cdf`/118 as current, the rounds 10–12 section supersedes
it. Reviewed source, round 7–12 diffs and dated release/browser records. This
supersedes the `960831df` continuation. The contract is unchanged; the full goal remains active.
No fresh database, browser, provider or production observation was made by this
documentation worker; production facts below are owner/integrator records.

## Design v2 handoff (2026-10-21)

The owner asked for a simpler, more efficient UI. The complete target and build plan are in
[design-v2/](design-v2/README.md): IA and route map, tokens, components, screen specs,
copy, QA, UI/REST/MCP parity findings, batches B0–B10, a paste-ready
[handoff prompt](design-v2/HANDOFF_PROMPT.md) and a clickable
[prototype](design-v2/prototype.html). Nothing is built yet. Start with B0: token and
accessibility fixes from [DESIGN_AUDIT_2026-10-21.md](DESIGN_AUDIT_2026-10-21.md).
Tools: `scripts/preview-screenshots.cjs` and `scripts/parity-inventory.mjs`.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work reads ../DESIGN.md and
../UX-CONTRACT.md; migration/release work reads CUTOVER.md and the dated results
in RELEASE_GATES_PLAN.md. Revalidate deployed SHA and migration ownership before
release work; source and historical receipts do not identify current deployment.

## Production record

Deployed release (owner/integrator statement): `ffdb1cdf`, configuration schema **118**,
with migration `20261031180000_rebuild_ads_ad_creation` applied in production
(owner/integrator record; not observed here, and no receipt such as a
`_prisma_migrations` row or CHECK probe is in the repository; confirm it). Owner cutover: 2026-10-20 22:09 CEST, release `5f1e52d7`, via
`rebuild/scripts/prod-cutover.sh`, origin https://social.newsgeet.com. Rebuild
web/worker recorded active/enabled; legacy inactive/disabled, retained for rollback
at `/srv/ms-social-pilot`. Releases use `rebuild/scripts/prod-deploy.sh`; legacy
`socialpilot-deploy` is guarded. Keep one publisher. `app.publicOrigin` is the
proxy-facing same-origin source; do not substitute internal listener addresses.

The dated release log records backup/migrations/ownership repair, owner sign-in,
AI checks and Chrome sweep, then MariaDB read-only access, image/JPEG storage and
80 planned recipe posts across 10 Pages. First live 07:00 Europe/Paris batch:
10/10 published, 10/10 comments, one Page inspected in owner browser. The first full
recipe day (07:00, 11:00, 15:00, 17:00) published 40/40 posts with 40/40 first
comments and no errors; 70 plans remain pending on the rolling horizon. The original
comment included an article preview; the owner subsequently removed the link.

Post-cutover rollback drill (2026-10-21, `prod-rollback-drill.sh`): a backup
restored into scratch database `social_pilot_drill`; legacy (`/srv/ms-social-pilot`)
and the installed rebuild started on spare ports against it. **ROLLBACK DRILL PASS**
(restore 2 s, legacy 3 s, rebuild 2 s, total 7 s); scratch database/role removed;
live rebuild web/worker stayed active and legacy inactive. This proves a restorable
backup and startable rollback artifacts. It does not prove a proxy cutback, media
restoration, a restore of the newest migrations, or worker/systemd shutdown timing.
`2e23223a` records backed-up/audited updates to 80 scheduled comments and changes
truncation to preserve a link only when the template contains `{link}`. Do not
restore that link based on old prose or equate planning with delivery.

Live Graph v26.0 post-insights probe accepts `post_media_view`,
`post_total_media_view_unique`, `post_reactions_by_type_total`, `post_clicks`,
`post_clicks_by_type`; rejects `post_impressions`, `post_impressions_unique`,
`post_engaged_users`. `63207a7c`/`954e80cb` fix time-window paging. Recorded probe:
no failures, views/unique 3, one like; summary edge 0 versus insight 1 remains
unexplained (lag is a hypothesis). This is limited eligibility evidence, not full
history/metric coverage. OpenAI/Gemini have earlier limited live success;
Anthropic was blocked by account credit. Mail and live recovery remain open.

## Integrated source and automated scope

- Copy (`38ab34f4`, `fb42b056`, `93944199`, `5e6841ee`): typed Root EN/FR catalogs
  across Publishing, Inbox, Analytics, Ads, Home, Tasks, Agency, Feeds, Media and
  Sharing; last three include service/public error localization. `configOrDefault`
  validates runtime or registry default; `configValueOrDefault` checks outer shape
  only. Residual literals/prompts/dynamic labels and stale OAuth metadata remain
  in CONFIG_LITERAL_AUDIT. Schema version is now **118**; historical version numbers below describe their batches.
- Appearance (`2b42470b`): global shell and Settings save through confirmed
  appearance service; theme in users, mode under exact account key, transaction
  audit, Root-lifetime cookie cache and validated-session fallback in layout.
  Former direct-cookie/cookie-only missing-source claims are superseded.
- Parity (`f5c21c96`, `acb56bd7`, `e105bff5`, `8f423ec7`): Inbox bulk REST exists;
  draft aliases and canonical session REST/MCP share api-writes lifecycle, and
  v1 create now requires exact CREATE POST consent. Guard checks 238 customer/
  person tools plus 51 Root tools and resource mappings. All 48 former Root
  exceptions removed; 24 exact auth/protocol exceptions remain. Root create/
  rename MCP and workspace directory GET added. Inventory closure does not prove
  all services own identity/limits/confirmation; follow MCP_PARITY boundary list.
- Recipes (`d68fc5c1`, `e43d16d2`, `6c2b7a6f`): date/ID order, retry/reconciliation,
  pause-cancel via Publishing, cached pool estimates, worker summaries, origin
  badges/filters, Feeds sidebar link, bilingual status/supply/next-time card and
  Root visibility bounds. Fake/unit/render evidence for follow-ups, not live
  recovery. Round 6 closes refused-batch starvation and channel/time reconciliation at
  unit level (details below). Claims lacking a stored post id remain uncertain.
  Preserve uncertain ledgers; live recovery is unproven.
- Reliability (`e0584777`, `d511e39c`): Facebook Inbox, Page analytics/history and
  Ads fetch outside locked writes; current binding/access/purge rechecks before
  persistence. Signals stop claims, request safe stops, drain with Root grace/
  poll settings, then abort/release abandoned leases. Unit evidence supersedes
  missing-source reports; production stop duration/systemd/DB contention unproven.
- Data (`4b13204b`, `83b26ba9`, `46c6bdae`): recent-table ownership catalog and
  explicit OAuth/profile/account hooks, exact appearance cleanup, Root/unverified
  deletion hooks. Partial account export is now exposed: session-only
  `GET /api/settings/account/export`, installed MCP tool `export_account_data`
  and a bilingual Account download with explicit included/excluded coverage;
  bearer credentials are refused. Coverage stays **partial** (not the owner ZIP).
  Supplementary purge migration `20261031150000_rebuild_supplementary_purge_gates`
  still needs rehearsal pins and PostgreSQL proof; no complete export/erasure claim.
- Settings/Root boundaries (`46c6bdae`): single and batch connection selection and
  disconnect callers (browser, REST, MCP) call `changeConnectionSelections` /
  `changeConnectionDisconnect`; the browser sends the named retain/delete consent.
  Root workspace create/rename, directory (actor-checked), configuration save
  (exact confirmation, in-transaction actor recheck, availability inventory for
  every caller) and error resolution moved to `src/modules/root/server/`
  (`workspace-controls`, `directory`, `configuration`, `errors`); `src/server/root/*`
  re-export them. Mocked/unit evidence (`tests/root-config-authority.test.ts`,
  `root-workspace-controls.test.ts`, `root-directory.test.ts`); no PostgreSQL
  transaction, real MCP client or browser evidence.
- Ads (`46c6bdae`, `960831df`, `ffdb1cdf`): paused `ad.create` through shared
  management for UI, session REST and MCP, Facebook-owned transport, missing-grant
  reconnect notice and hierarchy. The former ledger CHECK gap is closed by
  `20261031180000_rebuild_ads_ad_creation` (source/checksum tests and owner-recorded
  production application). Management is off by default; live `ads_management`
  grant/write/cleanup evidence remains open. Runtime copy is resolved per request,
  but entry points still omit customer locale. Recovery authority/scope follow-up
  and residual policy distinction are detailed in round 9 below.
- Performance (`245683ce`): migration `20261031160000_rebuild_read_path_indexes`
  under root prisma/migrations adds three Posts and one Page-insights indexes;
  Analytics exact-scope read reuse/request limits, Publishing adapter reuse and
  parallel Home cards/channel histories. Source/query-shape tests only; no applied
  target receipt, EXPLAIN/volume/timing evidence or measured production gain.
- Legacy (`23b7be84`, `6ef753e4`, `b725c415`): response reports add stored root-
  comment replies/slowest and business-hour response/resolution, pre-period
  context and audited historical reopen/resolve cycles, then source-specific
  comment/conversation shares/durations and member business-hour medians. Same
  UI/REST/MCP report workflow, bilingual artifacts, unknown/zero and partial-history
  semantics; unit/mocked evidence, no complete provider history/live downloads.
- Responsive/CSS (`78493189`, `eff49d35`, `4cccd55f`): shared phone layout, border-
  box, sidebar contrast, hidden-table overflow and Home/calendar contrast fixes.
  `6fb0e57f` fixes Ads client directive and guards top-level directives.
  `36946d9e` adds missing-image fallback and saved-view expired-session feedback.
- Error pages and browser fixes (`497fda18`, `46c6bdae`): shared bilingual themed
  `ErrorState`; `error.tsx` (retry re-requests the server, way home) and
  `global-error.tsx` (layout/database failure, documented bootstrap catalog);
  queue cancel, Root activity, two-step wording, tokenless join, verify-email/
  password-recovery text and calendar badge contrast fixes
  (`tests/browser-findings-fixes.test.ts`, `tests/ui-copy-coverage.test.ts`).
  These have unit/render evidence; round 5 reran Chromium on `46c6bdae` (below).
- Round 6 (`6d3347fb`; source and unit tests with fakes, no browser, PostgreSQL,
  provider or production run):
  - Ads copy: Facebook-owned `ads-copy.ts` (EN/FR labels, name validation, confirmation
    templates) behind new Root key `meta.adsCopy` (placeholders validated); Ads
    `copy.ts` customer strings. The missing ledger CHECK at that round was closed
    in round 8; the live
    `ads_management` grant remains unverified.
  - Join: preview answers `{ invitation: null }` (200) for a missing/unknown token and
    `join-form.tsx` shows "link needed" from it (no 404; a 429 from the per-token limit
    is still possible).
  - Queue: `cancelScheduledPostAction` throws on failure instead of redirecting, so
    `CancelScheduleForm` keeps filters, reschedule input and its inline notice.
  - Recipe recovery: uncertain slots reconcile by the ledger's stored post id (never
    by channel+time; a manual post is not adopted, a cancelled post is still found,
    unknown identity stays uncertain, settlement guarded by expected post id). A
    refused pause-cancel is rotated behind untouched work (`deferCancellation`,
    least-recent-attempt order), so the earlier starvation gap is closed at unit level;
    `remaining` is no longer forced false.
  - New tests: `feeds-recipe-recovery-verification`, `publishing-scheduling-
    verification` (mixed native/app holds, stale due-worker claim, comment failure
    after confirmed publish, reschedule timeout, contributor approval),
    `facebook-ads-copy`, `browser-matrix-round5`. They are not live scheduling or
    recipe recovery evidence.

- Round 7 (`5e7749c3`; source and unit tests with fakes/mocks; schema 116):
  - Publishing findings: saved-view save without a session now says the session
    ended (`saved_sessionEnded`, EN/FR; `SavedViews.tsx` maps 401/`unauthorized`);
    published calendar posts use a dashed edge and quieter fill instead of opacity
    (the warm-light 4.35:1 "View post" finding); an unknown post id on the
    collaboration detail screen calls `notFound()`.
  - Facebook error codes/copy: `FacebookAdsValidationError` carries a stable
    `issueCode` (wording never decides behavior) and `ads-copy.ts` gains the
    validation, ownership, unconfirmed-creation/creative and transport messages
    (EN/FR), threaded as `text` through `ads-ops` and the creative executor.
    Behavior is unchanged; provider failures still do not expose raw provider text.
  - Post metric collection: `meta.postHistoryPolicy` default metrics now also request
    `post_clicks`, `post_video_views`, `post_video_view_time`; video metrics are asked
    only for positively identified video posts (status or attachments). Reactions keep
    separate observations (insight, summary edge, per-type edges) with
    `reactionProvenance` and a conflict flag instead of mixing them; lifetime
    insight responses are not paged and use the requested end as snapshot anchor.
    That round's saved-list replacement is superseded by round 9 below.
  - Reports: Published posts views (destination content log with attempt counts,
    daily UTC counts, currently failed destinations) through the existing confirmed
    UI/REST/MCP generator; new key `analytics.reports.publicationDetails`. Tests
    `report-publication-details`, `publishing-browser-findings`,
    `facebook-post-history`, `facebook-data-coverage`, `facebook-ads-copy`.
- Round 8 (`960831df`; source and unit tests with fakes/mocks; schema 117):
  - Themed 404: `src/app/not-found.tsx` renders the shared bilingual `ErrorState
    kind="not-found"` (link home, no retry); jsdom render test `not-found-page`. The
    file now exists at source; it does not give real 404 statuses to unknown
    share/bio/Root ids or add a boundary inside the shell.
  - Ads ledger: migration `20261031180000_rebuild_ads_ad_creation` (root `prisma/
    migrations`) replaces `ads_operations_operation_kind` to allow `ad.create`.
    Checks: `ads-ad-create-migration` (source/checksum), `ads-ad-create`,
    `ads-ledger74.integration`. Production application is the owner's record; it is
    not a live `ads_management` grant or a live Ads write.
  - Ads runtime copy: neutral `PlatformAdsHost.configuredOperations(locale)`;
    `platformAds(provider, locale)` returns a request-local host (no singleton
    mutation); `withPlatformAdsLocale` / `withAdsErrorBoundary(operation, locale)`
    carry EN/FR through nested calls via `server/platforms/host.ts` (AsyncLocalStorage,
    default English). A failing configured factory does not fall back to the static
    engine. **The UI, REST and MCP entry points do not yet pass the customer locale**
    (`CampaignsScreen.tsx`, `api/ads/management/route.ts`, `ads/mcp.ts`), so Ads
    messages stay English there, and recovery does not repeat the creation-only unrestricted-channel
    requirement; round 9 adds current scope/authority rechecks under lock. See `src/modules/ads/server/README.md`; test `ads-runtime-host`.
  - Facebook metric config: `FACEBOOK_METRIC_LABEL_DEFAULTS` adds Page/post/reaction
    labels; `meta.metricLabels` merges saved entries over shipped defaults so older
    stored catalogs gain new labels (`facebook-metric-config`).
  - Reports: Top posts content (destination saved text, ordered image/video refs,
    Root-switchable image previews, saved article link/title/description) through the
    same confirmed workflow; new key `analytics.reports.topPostContent` (see
    `reports/TOP_POST_CONTENT.md`); tests `report-top-post-content*`. It shows saved
    local state, not a remote snapshot.
  - Inbox/Analytics polish: focus rings, focusable labelled table regions, scroll
    limit on long channel lists, locale for "Last synced", chart wrapper, phone layout
    (`inbox-analytics-ux-polish`, source-level assertions). No browser run.
  - Root keys added in these rounds: `analytics.reports.publicationDetails` (116) and
    `analytics.reports.topPostContent` (117). This documentation lane adds none.

Round 9 (`ffdb1cdf`; source and unit/mocked/query-shape evidence; schema 118;
no fresh browser, PostgreSQL or live-provider verification by this lane):

- Ads recovery checks current account/channel visibility and independent key
  ceilings before disclosing state/confirmation, then repeats manager authority
  and account visibility under the account/ledger locks before settlement/audit.
  Creative recovery checks the exact target; retained disabled accounts do not
  need active provider grants for local attestation. Tests cover narrowed scope,
  revoked role, empty ceilings and invisible-account refusal. This closes the
  stale-authority/disclosure gap. A limited manager whose scope reaches the
  account connection is still permitted to recover ad/ad-set creations; the
  unrestricted-channel rule for creating them is not repeated. Reconcile that
  remaining policy distinction rather than claiming identical creation/recovery
  scope (see ADS_PARITY.md).
- Facebook Page presentation reads Root `meta.metricLabels` and new
  `meta.pageAnalyticsCopy` for EN/FR metric/audience labels, provenance,
  latest-per-channel/category text and overlap notes. Saved labels override
  shipped defaults, which now also include Page likes and older impressions.
  Ads/dynamic-label English literals remain; this is not full analytics copy
  extraction or provider completeness.
- Post-history metric lists now merge saved additions with shipped defaults and
  apply explicit `excludedMetrics` last (including future names). Legacy absence
  is not an exclusion. Read normalization is pure; a confirmed Root save persists
  normalized policy with the existing audit. The same Page-policy schema exists,
  but `facebook/module.ts` still registers `meta.pageInsightMetrics` as an array;
  `runtime.ts`, `adset.ts` and `ads-ops/index.ts` still consume arrays. Integrating
  that declaration and all `.metrics` projections is outstanding.
- Destinations reports add per-link lifetime inventory, retained period clicks
  and independent daily UTC retained counts through the existing confirmed
  UI/REST/MCP generator (`runReportNow`). New Root
  `analytics.reports.linkDetails` bounds link/day rows; the existing bilingual
  report-document catalog discloses clipping and retention gaps. The cohort is
  posts currently published to the selected channel within the report period,
  not clicks on every older post. Unattributed legacy links qualify only with
  exactly one published destination; ambiguous links are excluded. No visitor
  metadata, destination URL or slug is projected. Zero means no retained click
  records; lifetime counters are separate. See
  `../src/modules/analytics/reports/LINK_REPORTS.md`.
- Relevant tests: `ads-parity-management`, `facebook-page-labels`,
  `facebook-metric-config`, `facebook-analytics-selection`,
  `facebook-post-history`, `root-config-authority`, `report-link-details*`.
  No new screen, route, MCP tool or migration for these report details.

## Rounds 10–12 (HEAD `a910d774`; schema 120)

Evidence kinds are labelled per item. Nothing here is a fresh database, browser
or provider run by this documentation lane.

- **Round 10 (`75923335`, schema 119; source/unit):** Facebook Page insight
  metric resolution before transport construction
  (`configuredFacebookPageInsightMetrics`, `page-insights.ts`; the `.metrics`
  projection gap in item 7 of the next actions is not shown closed here), media
  rename REST (`/api/media-library/[id]`), feed preview disclosure and
  reviewer notices (new active key `feeds.approvalNotificationsEnabled`, default
  true; the local queued count is not SMTP delivery), Publishing/Settings
  polish, and the Published-posts weekday/hour/attempt distributions (typed fields
  inside `analytics.reports.publicationDetails`, no new key; see
  `PUBLICATION_DISTRIBUTIONS.md`).
- **Round 11 (`d6ff1f17`, schema 120; source/unit/mocked):** new Root keys
  `feeds.wordpress.reuseEnabled` (false) and `feeds.wordpress.reuseCooldownDays`
  (365) with the shared recipe supply view (details in FEEDS.md), supply card and
  warning, Ads/Home/Root polish, and `mcp-scope-feeds-service` /
  `mcp-scope-host-matrix` scoped-key tests (mocked ports; not a real MCP client).
  `RecipeSupplyCard` is built; mounting it on Home was a stated integration need.
  Confirm that mount before claiming the Home warning.
- **Live-defect fixes (source plus regression tests; fakes):**
  - `806a0ef5`: the Facebook analytics target reported the remote Page id as the
    provider id, so the host lookup failed and no channel had post performance.
    The target now reports the platform id. `6e111754`: the post explorer also
    reads synced insights for posts the application published.
  - `a47a339c`: Analytics no longer lists identifier-like metrics; the post
    explorer is lighter with local dates (`facebook-analytics-live-defects`,
    `analytics-posts-table-live-defects`). Whether production now shows post
    performance has not been observed by this lane; the owner should confirm.
- **Facebook OAuth (`c0e5386a`; source/unit):** callback checks, redirects and the
  secure state cookie use the Root public origin (`app.publicOrigin`), not
  `request.url`, which is the internal listener behind the proxy and had sent
  browsers to localhost. **Reconnect is pending the owner's retry**; there is no
  recorded successful connection after the fix.
- **Recipe captions (`a47a339c`, `a910d774`; unit/mocked):** WordPress caption
  text decodes the HTML5 named catalog and numeric references once and keeps
  U+00A0/U+202F. The caption plugin stores a C0 control (seen U+0016) where French
  typography needs U+202F, and Facebook rendered it as `0`. `stripCaptionControls`
  maps such controls before `? ! : ; »` (and after `«`) to U+202F and drops other
  C0 controls. Seven WordPress captions were affected (owner/integrator record).
  One already-published post is kept as it is; the audited preview/apply repair
  service (`caption-repair.ts`, `CAPTION_REPAIR.md`; owner/admin, dry-run receipt
  then exact confirmation, planned/never-attempted posts only) cannot and does not
  edit published content. The repair outcome for the other six is not recorded
  here: confirm each stored caption privately without logging the text. The
  independent RSS decoder in `feeds.ts` still maps `&nbsp;` to an ordinary space.
- **Browser lane, round 6 (partial; harness only):** the lane hung. `d24fcd40`
  holds the matrix script changes (WebKit on macOS uses Option+Tab so links and
  buttons are reachable; end-of-tab-order detection replaces the false "trap" in
  Firefox/WebKit headless; layout-settled focus measurement), a date/time input
  focus ring in `tokens.css` and `browser-matrix-round6` jsdom tests. No matrix
  was completed, so rounds 6–12 have no browser result and the round 5 findings
  stay unrerun. A stray local `premium-audit.json` was untracked in `7095d92b`;
  keep it out of Git.
- **Production-side facts (owner/integrator, not re-observed):** deployed
  `a910d774`, schema 120. The migration receipts and the proxy cutback gaps in
  the next actions still apply.

## Browser evidence, not an all-green gate

BROWSER_MATRIX_2026-10-21 records local production builds against a synthetic
preview PostgreSQL database; none of it is production or provider evidence.

- Chromium round 1: 992/992 cells (four themes × light/dark × desktop/phone; 41
  customer, 16 Root, five public pages); no overflow/name/theme/status failures,
  176 findings. Round 2: dynamic (160), states (176), not-found (128), empty (656),
  system (768), keyboard (656 + 672) and failure (640) cells; scoped system-mode and
  keyboard checks passed and 121 injected-failure probes preserved input/dialogs.
- Round 3: Firefox and WebKit (Safari engine, not Safari) extended matrices, 496
  cells each on vivid and warm: 43 and 99 findings, no overflow/name/theme findings,
  16 WebKit hydration warnings (`root-time.ts` "at" separator; Sharing `LinksManager`
  locale formatting, a pattern in 15 more files). Chromium system mode on every page
  (992): no mismatch or non-live cases. Database-outage 500s rendered Next's unthemed
  English page and were fixed; 0 findings in three engines using temporary app files.
- Round 4 (preview database migrated through `20261031170000`, so Feeds paths
  render): page-throw boundary 16/16 per engine with 0 findings; "Try again"
  recovery verified in Firefox only; Firefox/WebKit dynamic, session, empty,
  not-found and failure parts reproduce the module findings.

- Round 5 (Chromium only, local build of `46c6bdae`, synthetic database with Feeds
  recipe rows): full matrix 992/992 cells over 62 routes incl. Ads and Feeds, **162
  findings** (none from Ads or Feeds); fixes check 72/72 cells (0 broken images, 10
  findings); unknown route 64/64 with HTTP 404 and 0 findings. Causes: 80 seeded-media
  404s (data), tokenless `/join` 404s/429s (addressed at source by round 6), warm-light
  calendar "View post" at 4.35:1 (published-card opacity `.88`), and saved-view save
  without a session still saying "check its name" (8/8 desktop cells; Publishing
  `SavedViews.tsx`/`saved_saveFailed` unchanged). Firefox/WebKit and the dynamic/
  empty/system/keyboard/failure parts were not rerun.

Unresolved (no browser run since round 5; rounds 6–9 have source/automated changes without a browser rerun):
`not-found.tsx` exists since round 8 (unit render test) but has not been seen in a
browser; unknown bio/share/Root ids answered HTTP 200 in round 4 (the collaboration
post screen now calls `notFound()`, unit evidence); raw server text on Tasks, Labels,
Templates, Analytics goals and Inbox moderation; error boundary above the shell;
WebKit hydration; share-media 404s from seed data. Source fixes awaiting a rerun:
saved-view session wording and calendar published-card contrast (round 7), `/join`
and queue-cancel (round 6), Inbox/Analytics focus and table-region polish (round 8). `46c6bdae` fixed Root activity,
two-step wording, verify-email/recovery text at source only. Not covered: keyboard/system-mode runs in
Firefox/WebKit, all four themes there, real Safari/iOS, screen readers, long content,
client-render throws and every later merge. Read the report for exact routes/checks
rather than summing cells into a completion percentage. Historical production Chrome
and WAVE1 checks retain their dates.

## Next actions / edits outside this documentation lane

1. Release owner verifies the exact deployed SHA (recorded `ffdb1cdf`), migrations
   and ownership (purge-gate, read-index, inbox-metadata, trigram and ad-creation
   migrations; keep a receipt), media backup coverage and a proxy-level cutback;
   extend the rollback drill to the exact release (including the newest CHECK);
   measure worker/systemd shutdown timing.
2. Ads activation: the ledger migration is authored and recorded as applied.
   Remaining: append it to `scripts/cutover-rehearsal.sh` (approved list, SHA-256
   from `src/modules/ads/server/README.md`, history-refusal parameter list, post-apply
   CHECK probe) with `tests/cutover-rehearsal.test.ts`; pass the customer locale from
   the Ads UI/REST/MCP entry points; reconcile the creation-only unrestricted-channel rule with limited-scope
   recovery (round 9 already rechecks current role/account/channel/key scope
   before disclosure and under lock); then obtain the live `ads_management` grant on a test account and
   exercise paused creation, status/budget/creative changes, recovery and cleanup
   with exact confirmations. Keep management off by default until then.
3. Agency owner (workspace switching: REST versus MCP confirmation) and Sharing
   owner (copy-only saves) reconcile with the service contract. Run a current
   cross-module auth/scope/confirmation matrix and real MCP client checks. The Root
   boundary gaps recorded in MCP_PARITY are closed at source; verify in PostgreSQL.
4. Pin supplementary purge gates/checksum/functions in cutover rehearsal as in
   `src/server/data-control/README.md`; prove isolated PostgreSQL triggers,
   deletion, partial-export content and concurrency; verify the Account download in
   a browser and `export_account_data` with a real client. No secrets in artifacts.
5. App owner: real 404 statuses for unknown share/bio/Root detail ids (fix the
   `loading.tsx` streaming order) and a boundary inside the shell (`not-found.tsx`
   exists since round 8). Module owners remove raw server text and fix hydration
   formatting. Rerun the matrix in all three engines, including keyboard walks, all
   four themes, the themed 404, saved-view wording, calendar contrast, `/join`,
   queue-cancel, Inbox/Analytics polish and the Ads/Feeds forms.
6. Integration owner tests mixed scheduling and recipe retry/pause/recovery,
   metrics/history, live REST/MCP scope, provider outcomes/cleanup and index plans/
   volume. Preserve unresolved photo-canary ledger/Page lock; failed Graph lookup
   is not absence proof. Unknown remote effects must not be blindly resent.
7. Facebook owner: register `facebookPageMetricPolicySchema`/defaults in
   `src/platforms/facebook/module.ts` for `meta.pageInsightMetrics` and project
   `.metrics` in `runtime.ts`, `adset.ts`, `ads-ops/index.ts`; add consumer tests.
   Do not infer exclusions from absent legacy entries or persist from reads.
8. Documentation outside ownership: GOAL.md and DELIVERY_PLAN.md still name
   `960831df`/117 and pre-round-9 recovery/metric/report status; MCP_PARITY.md and
   LEGACY_CAPABILITY_PARITY.md need the scoped recovery/new policy distinction.
   The Ads server README's recovery bullet must distinguish closed locked
   visibility/authority rechecks from the remaining unrestricted-creation rule.
   LINK_REPORTS.md's historical request to bump the schema is already integrated
   (118). Operation docs still need exact target receipts/rehearsal coverage;
   do not manufacture them from source or the owner's deployment statement.

## Current lane validation

Only ADS_PARITY.md, FEEDS.md, CONFIG_LITERAL_AUDIT.md, ARCHITECTURE.md and
AGENT_HANDOFF.md are owned. No source, tests, registry, contract, migration,
server, deploy, push or production edits/calls. No new Root keys in this lane;
round 9's existing `meta.pageAnalyticsCopy` and `analytics.reports.linkDetails`
are documented, with `CONFIG_SCHEMA_VERSION` read as 118 and left unchanged.
`npx tsc --noEmit -p .` passed with zero errors; `git diff --check` passed.
No test file was changed or added. A focused six-file Vitest run passed 190
tests (Ads recovery, Page labels/metric configuration, short-link reports and
recipe recovery), using unit/mocked/query-shape evidence only. Pre-existing untracked node_modules links are untouched. Changes
remain uncommitted for integration; nothing was pushed under this lane's explicit
no-push instruction.
