# Shared agent handoff

Updated 2026-10-21 against local HEAD `6d3347fb` (round 6), reviewing
`git log 46c6bdae..HEAD`, the round 6 diff, dated release and browser records and
selected current source. This supersedes the previous `46c6bdae` continuation. The binding contract is unchanged; the full goal remains active. No
fresh database, browser, provider or production observation was made by this
documentation worker; production facts below are owner/integrator records.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work reads ../DESIGN.md and
../UX-CONTRACT.md; migration/release work reads CUTOVER.md and the dated results
in RELEASE_GATES_PLAN.md. Revalidate deployed SHA and migration ownership before
release work; source and historical receipts do not identify current deployment.

## Production record

Deployed release (integrator statement): `6d3347fb`, configuration schema **115**
(not independently observed; confirm the applied migrations). Owner cutover: 2026-10-20 22:09 CEST, release `5f1e52d7`, via
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
  in CONFIG_LITERAL_AUDIT. Schema version is now **115**, not 104–114.
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
  recovery. Refused first cancel batches can starve later posts; slot matching
  can accept manual posts or miss cancelled drafts. Preserve uncertain ledgers.
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
- Ads (`46c6bdae`): neutral paused `ad.create` through the shared management
  service for UI (`AdCreateForm`), session REST and MCP, with a Facebook-owned
  implementation; reconnect notice when the `ads_management` grant is absent;
  Campaigns hierarchy path. Mocked/fixture tests only. **No migration at HEAD
  extends the ledger operation-kind CHECK to `ad.create`** (searched
  `prisma/migrations`), so ad creation fails closed before any provider call until
  one is authored and applied. Management is off by default; the live
  `ads_management` grant is pending; no live Ads write has been made.
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
    `copy.ts` customer strings. `ad.create` is still blocked by the missing ledger
    CHECK migration and `ads_management` grant.
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

Unresolved (not rerun after round 6): `not-found.tsx` is still missing from
`src/app/` (round 5 saw HTTP 404 and no check findings, not a themed bilingual page);
unknown bio/share/collaboration/Root ids answered HTTP 200 in round 4; raw server
text on Tasks, Labels, Templates, Analytics goals and Inbox moderation; saved-view
session wording; calendar warm-light contrast; error boundary above the shell;
WebKit hydration; share-media 404s from seed data. Round 6 changes to `/join` and
the queue cancel failure have unit evidence only. `46c6bdae` fixed Root activity,
two-step wording, verify-email/recovery text at source only. Not covered: keyboard/system-mode runs in
Firefox/WebKit, all four themes there, real Safari/iOS, screen readers, long content,
client-render throws and every later merge. Read the report for exact routes/checks
rather than summing cells into a completion percentage. Historical production Chrome
and WAVE1 checks retain their dates.

## Next actions / edits outside this documentation lane

1. Release owner verifies the exact deployed SHA, migrations and ownership (purge-
   gate, read-index, inbox-metadata and trigram migrations), media backup coverage
   and a proxy-level cutback; extend the rollback drill to the exact release;
   measure worker/systemd shutdown timing.
2. Database owner authors and applies a root `prisma/migrations` migration adding
   `ad.create` to `ads_operations_operation_kind` (`objectType` already allows `ad`).
   Then obtain the live `ads_management` grant on a test account and exercise paused
   ad creation, status/budget/creative changes, recovery and cleanup with exact
   confirmations. Keep management off by default until then.
3. Agency owner (workspace switching: REST versus MCP confirmation) and Sharing
   owner (copy-only saves) reconcile with the service contract. Run a current
   cross-module auth/scope/confirmation matrix and real MCP client checks. The Root
   boundary gaps recorded in MCP_PARITY are closed at source; verify in PostgreSQL.
4. Pin supplementary purge gates/checksum/functions in cutover rehearsal as in
   `src/server/data-control/README.md`; prove isolated PostgreSQL triggers,
   deletion, partial-export content and concurrency; verify the Account download in
   a browser and `export_account_data` with a real client. No secrets in artifacts.
5. App owner adds `src/app/not-found.tsx` (`'use client'`, `ErrorState kind="not-found"`
   with `useErrorLocale`), real 404 statuses for unknown detail ids (fix the
   `loading.tsx` streaming order) and a boundary inside the shell. Module owners
   remove raw server text, fix hydration formatting, saved-view session wording
   (`SavedViews.tsx`) and warm-light calendar published-card contrast. Rerun the
   matrix in all three engines, including keyboard walks, all four themes, the
   round 6 `/join` and queue-cancel changes and the Ads/Feeds forms.
6. Integration owner tests mixed scheduling and recipe retry/pause/recovery,
   metrics/history, live REST/MCP scope, provider outcomes/cleanup and index plans/
   volume. Preserve unresolved photo-canary ledger/Page lock; failed Graph lookup
   is not absence proof. Unknown remote effects must not be blindly resent.
7. Documentation outside ownership: FEEDS.md needs the 15:00/17:00 slots, the 40/40
   day and the link-removal outcome; CONFIG_LITERAL_AUDIT needs latest catalogs/error
   localization; operation docs should add data gates/read-index migration status
   without claiming target application. Legacy round narratives retain historical
   version-bump text; version 114 is current.

## Current lane validation

Only the six assigned docs are owned; LEGACY_CAPABILITY_PARITY changes are limited
to the header date and existing Rebuild state cells. No contract, registry,
source/test, migration, server, deploy, push or production edits/calls. No new Root
keys; `CONFIG_SCHEMA_VERSION` is read as 114 from `src/lib/config/registry.ts` and
not edited. Pre-existing untracked node_modules links are not task changes.
Validation results are in the lane report. Changes remain uncommitted in this
worktree for integration; nothing was pushed.
