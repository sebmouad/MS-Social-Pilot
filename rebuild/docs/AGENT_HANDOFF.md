# Shared agent handoff

Updated 2026-10-21 against local HEAD `99c41554`, schema **123**. Full goal
remains active. No browser, provider, database or production call by this lane.
Historical records below retain their dates; current source reconciliation wins.

## Current HEAD reconciliation — 2026-10-21

Reviewed source: `99c41554`; registry schema **123**. This section supersedes
older present-tense source claims below. It does not identify the deployed SHA.
The last dated deployment statement in these docs names `a910d774`/120; confirm
the actual release and migration receipts in a separately authorized session.
The full contract remains active and incomplete.

- **Ads inventory (`e050b3a6`):** neutral `ads_objects` stores objects independently
  of delivery insights. Confirmed creates/renames/status/deletes update inventory
  with audit/settlement; deletes retain hidden tombstones. Facebook account-edge
  discovery populates campaigns/ad sets/ads without delivery, rejects incomplete
  pagination and rechecks access before writes. Campaigns/Objects and existing
  REST/MCP directory/management services can manage paused objects with no daily
  rows; ownership and scope checks remain. Migration
  `20261101120000_ads_object_inventory` is authored, not verified applied here.
  Rehearsal pins/probes, export/erasure coverage, stale-sync/database rollback and
  externally deleted-object reconciliation remain open; see the Ads server README.
- **Live Ads (owner report in this lane request):** create, rename and delete were
  verified in Ads Manager. This supersedes the blanket claim of no live Ads write
  or pending grant for that run only. Object levels/identities, test account, exact
  consent/audit receipts, final cleanup and zero spend are not supplied here; this
  is not proof of every budget, status, creative, recovery or MCP operation.
- **Contract fixes (`8d9ccbe7`):** connection lifecycle and account policy now live
  in Settings; residual draft helpers live in Publishing, with shared compatibility
  re-exports. Ads runtime locale, bilingual management transport/captions,
  configurable recovery/creative/parent-id bounds and Facebook Ads presentation
  copy are integrated. `storage.mediaPresentationPolicy`, `ui.loadingCopy` and
  `root.errorCopy` are registered (old lane requests to register them are stale).
  Shared validation has EN/FR defaults, but `shared.formValidationCopy` registration
  and serialized Root delivery are still absent. Agency service now requires
  `SELECT WORKSPACE <id>`; **AppShell still posts only workspaceId**, so switching
  there is blocked until the caller sends the service confirmation. Sharing
  copy-only edits now require exact service confirmation and preserve the address.
  Audit report annotations and module handoffs retain historical pending claims;
  use current source to determine what remains.
- **Numbers (`d1702ef9`, `99c41554`):** channel Analytics excludes paid metrics;
  Ads has separate reporting. Home spend uses retained numeric spend rather than
  re-parsing provider fields. Empty stock totals stay unknown; daily stocks take
  the latest observation per resource/day instead of summing overlapping windows.
  Synthetic fixture checks cover currency separation, ratios, audience coverage
  and retained-day freshness. See `src/modules/home/server/NUMBERS_EVIDENCE.md`.
  Remaining adapter gaps: Home Page-only performance, external destination metric
  coverage/deduplication, audience trend identity and nested reaction breakdowns.
- **Design/accessibility/French:** merged Publishing/Inbox redesigns, Settings and
  Root passes, thumbnails, Inbox scrolling/media URL recognition, table/focus and
  EN/FR copy tests are source/unit/DOM evidence. The requested design rounds 1–2
  are not a completed two-round browser record: HEAD includes the shared layer
  labelled round 4 (`design-pass-round4.test.ts`). No new visual browser, keyboard,
  contrast or screen-reader result was collected. Round 6 browser harness remains
  partial; earlier matrix findings retain their dated scope.
- **Smoke/performance/MCP:** auto-discovered page/route smoke checks exercise
  anonymous/owner/member/viewer in EN/FR with synthetic mocks and server rendering.
  They are not real browser or live HTTP/MCP tests. Known waivers include
  signed-in 401 versus 403, sign-out Origin acceptance, validation-before-auth and
  joined-row fixtures. Read-path/query-budget and Inbox search tests do not prove
  production speed. Scoped MCP host/service and HTTP tests are execution evidence
  with mocks, not a real authenticated MCP-client run.
- **Requested work absent at this HEAD:** Instagram has discovery/metric helpers
  and selection tests, but `PLATFORM_MODULES` installs Facebook only; no complete
  Instagram module. Facebook Groups publishing/discovery is absent (Settings
  channel groups are organization only). AI writing/recap/sentiment exists, but
  rebuild AI agent management does not. Posts CSV is a bounded synchronous
  `exportPublishingPosts` download, not an asynchronous export job; workspace ZIP
  is separate. Do not mark these legacy capabilities complete.
- **Missing sweep input:** `LEGACY_SWEEP_2026-10-21.md` is absent from this checkout.
  Its missing rows cannot be reconciled from an unavailable report. Keep the
  Instagram, Groups, AI-agent and async-CSV gaps above explicit; integrator must
  supply the report and reconcile every additional row without reducing scope.

## Design v2 B1: shell (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B1. Evidence: typecheck 0 errors; full suite (excluding the Facebook diagnostic transport file) 704 files passed, 49 skipped, 11,403 tests passed; jsdom tests `app-shell`, `shell-v2`, `route-redirects`, `popup-placement-avatar`. **No browser, screenshot, keyboard-in-browser or screen-reader run.**

- **Shell:** `AppShell` is one collapsible sidebar (areas Home, Content, Inbox, Insights; Tasks and Agency only when used; Settings and the account menu in the footer; collapse to a 64 px rail, remembered in `sp_sidebar`), a top bar (menu and channel-scope chip below 1024 px, Page tools, command palette), a phone `BottomBar` with a raised Create button, and area link tabs above the content (overflow into "More"). Workspace switching now sends the exact `SELECT WORKSPACE <id>` confirmation (closes DELIVERY_PLAN item 1). Theme moved into the account menu; `ModeToggle` is no longer mounted (file kept for `appearance-provider-persistence` test; delete in B9).
- **Channel scope:** `src/lib/channel-scope.ts` (`channel` URL parameter, legacy names read, cookie `sp_scope_<workspaceId>`, validation notice). `PageFrame` loads the member's selected channels (`modules/shell/server/channels.ts`). The sidebar and the scope chip share one state. **Pages do not yet read it:** each area batch must call `requestChannelScope()` (`server/context.ts`) and drop its own `channel`/`channelId`/`target*` query names. A multi-channel `channel=a,b` is unknown to today's single-channel pages until they migrate.
- **Page tools (transitional adapter):** the old `sidebar` prop and every `SidebarDock` portal render inside a modal sheet (side on desktop, bottom on phone) that stays mounted, so docked form state survives closing it. B9 deletes `SidebarDock` and the adapter. Root keeps its section navigation inside the sidebar (`installationMode`).
- **Components:** new `Popover` (fixed position, no portal; inline so dialogs and tests work), `InfoTip`, `ChannelScopeList`, `BottomBar`, `SidePanel`, `ListRow`, `SplitButton`, `ActionBar`, `DateRangePicker`, `FilterButton`, `LinkTabs`, `ShellCopyProvider`. `Menu` and `Select` now use `Popover`; `usePopupPlacement` is deleted. `PageHeader` has no icon chip and gains `count`, `info`, `tabs`, `filters` (descriptions still show as text; moving them into ⓘ is per-screen work in B2 to B8). `MetricCard` gains `info`. `Drawer` gains `variant="sheet"`. `DataTable` is unchanged (B3).
- **Config:** new Root keys `home.shellCopy` (EN/FR chrome and page-tab labels, keyed by page id) and `home.shellPolicy` (list lengths, tab overflow, cookie names and lifetimes, hover delay). Page labels live in the catalog, not in manifests (only `area` was added to manifests). Integrator bumps `CONFIG_SCHEMA_VERSION` (unchanged).
- **Routes:** manifests may declare `redirects`; `src/lib/route-redirects.ts` and the middleware serve them as 308 with parameter mapping. None are declared yet (B2 starts with `/publishing/compose` to `/create`). Sign-in already lands on Home; deep-link return is unchanged.
- **Open:** unread/pending badges on Inbox and Content, owner switch for Tasks and Agency in Settings, language switch in the account menu, Help target, tablet overlay and rail in a real browser, `DataTable` phone rows, `Notice` unification, all screenshots and the 06 §4 checklist.

## Design v2 B2 (Create) and B3 (Content) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B2 and B3. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) 706 files / 11,438 tests passed, 0 failed; jsdom and server-render tests (`post-composer-ui`, `composer-queue-ui`, `publishing-ui-round2`, `content-v2`, `content-v2-server`, `post-attachments`, `calendar-board-ui`, `route-redirects`, `app-shell`). **No browser, screenshot, keyboard-in-browser or screen-reader run; no server, migration, deploy or provider call.**

- **Routes:** Publishing pages moved to `/content` (Posts), `/content/calendar` (+ `/dates`, `/seasons`, `/trends`, `/feeds`), `/content/queue`, `/content/approvals`, `/content/library` (Media) with sections `/content/library/{templates,labels,fields,feeds}`, `/content/post/[postId]`, `/content/ai-studio`, and `/create`. The publishing manifest declares the 308 redirects (`/publishing/*` → new routes, `collaboration/post/*` → `/content/post/*`, `collaboration` → `library/fields`; `channelId`/`target`… map to `channel`). `route-redirects.test.ts` asserts every redirect points at a route file that exists. `src/app/publishing/**` is deleted. Templates, Labels, Fields and Feeds are `navigation: false` pages (Library section tabs, not area tabs); `AppShell` keeps the parent tab current for them and for post pages; Library's tab label comes from `home.shellCopy` (`publishing/media`: Library / Bibliothèque).
- **Create (`ui/compose/*`):** `PostComposer` is a full-screen modal sheet (top bar with close and Templates, Edit | Preview switch on phones, editor + sticky preview, `ActionBar`). Channels are toggle chips (scope from the sidebar pre-selects them; a lone postable channel is chosen for you; channels that cannot publish show "Reconnect"). Text, Media (drop zone, Upload, From library via `LibraryPicker` on `GET /api/media`, Add link), collapsed first comment, and a "More options" disclosure (format per channel, who sends). Action bar: Save draft and a `SplitButton` Schedule ▾ with Publish now (confirmation dialog), Add to queue (shows the next slot; retries when queue times cannot be read) and Schedule… (popover with date, time and Best-time chips). **Publish now is a schedule `publishNowLeadMinutes` (default 2) ahead, sent through the same `schedule` intent and server action; the delivery worker then publishes it.** Closing with unsaved content asks first. All save paths are the existing actions (`createPostWithRecoveryAction`, `saveQueueComposerAction`, `autosaveDraftAction`); a failure keeps every field and shows an alert in the action bar.
- **Content:** Posts (`PostsScreen`, `PostsHeaderTools`, `PostsTable`): one Filter button (status, created by, saved views), chips, search, Export (drawer), Import CSV, Create; the Feed and Cards views and their saved-view value are gone; the table opens a `SidePanel` (preview, destinations with status, the existing row actions) and keeps `?post=` shareable (a post not on the page redirects to `/content/post/<id>`); phones get 72 px `ListRow`s that open the post page. Calendar: toolbar in the page (‹ Today ›, range, Month | Week, Filter, "More calendars" for Key dates/Seasons/Holidays/Subscriptions), free queue times as dashed pills that open Create at that time (`free-slots.ts`, `readQueueSlots`), month pills bounded by policy. Queue: next-in-queue list plus a 360 px panel with the weekly queue times and, under "Automation", the content mix (both moved out of the old Organize screen; `/content/library/fields?view=queue|mix` redirects to `/content/queue`). Approvals: review cards with the full preview, Approve, Request changes (note first) and A/R keys that move focus (the decision itself still needs Enter or a click); the Approvals tab shows the pending count (`pendingApprovalCount`, `PageFrame` → `AppShell.tabCounts`). Library: `LibraryHeader` (title, ⓘ, section tabs gated by feature), Media as a thumbnail grid, Templates/Labels/Fields/Feeds inline toolbars instead of sidebar docks. Post page: `PostPreview`, destinations and status above the existing notes/versions/labels/fields panel.
- **Channel scope:** `modules/shell/server/scope.ts` (`pageChannelScope`) reads `channel` (then cookie) for Create, Posts, Calendar, Queue and Approvals. Several channels are "any of": `publishingPostReadQuery` now accepts comma-separated `channelId` (REST `channel`, MCP `list_posts.channelId`), and `postId` (REST `post`, MCP `list_posts.postId`) for one visible post; Calendar narrows the authorized read in the page. Pages no longer read their own `channelId`/`target` names. Library screens do not use the scope.
- **Config (new Root keys; integrator bumps `CONFIG_SCHEMA_VERSION`, not changed here):** `publishing.contentCopy` (EN/FR catalog of Create and Content; placeholders are validated) and `publishing.contentPolicy` (`publishNowLeadMinutes`, `monthPostsShown`, `freeSlotsPerDay`, `libraryPickerMaxSelect`, `reconnectHref`). Existing catalogs (`publishing.composerCopy`, `uiCopy`, `labelCopy`, …) are unchanged, so saved Root edits keep working.
- **Deleted (superseded):** `PostFilters`, `PostsViewSwitch`, `CalendarFilters`, `PublishingSidebar(Client)`, `ApprovalsTable`, `PublishingChannelOptions` and their tests. `PostActions` and the Queue/Content-mix forms no longer mount a `SidebarDock`; remaining dock users are outside this batch (calendar extras, AI studio, Settings, Root, Tasks, Agency, Reports).
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence; (2) Posts has no date-range or label filter (the read service has neither); (3) "Customize per channel" text overrides, labels and custom fields in Create's More options are not built (no service for per-channel text); (4) Library Media is a grid but has no detail sheet; Templates, Labels, Fields and Feeds are still the earlier tables/forms; (5) Approvals keys only move focus; (6) the legacy live-verification scripts (`scripts/verify-*.ts`) got new URLs only; their Playwright selectors for the old composer dock must be rewritten before a browser run; (7) `Take photo` on phones relies on the OS file picker (`accept` lists image types; no `capture` attribute); (8) Publish now has no undo window (the old per-post undo-send applies to existing posts only); (9) `SidebarDock`/Page tools adapter stays until B9.

## Calendar extras install (2026-10-22, source only)

The `calendar-extras` module is installed (config, MCP, pages, API and ICS routes, sidebar links, board marks, queue season hook, Analytics chart notes, refresh jobs); see ARCHITECTURE.md "Calendar extras install". The integrator must bump `CONFIG_SCHEMA_VERSION` for the new Root keys `calendarExtras.policy`, `calendarExtras.customerCopy`, `calendarExtras.refresh`, `calendarExtras.holidaysSchedule`, `calendarExtras.trendsSchedule`. Still open: PostgreSQL execution of the retained-table SQL, live holiday/trend fetch, browser design/FR/keyboard passes, real calendar client, authenticated MCP client run, data-control rows for retained tables, and public-route throttling/log redaction for `/api/calendar-feed/[token]` at the proxy.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work reads ../DESIGN.md and
../UX-CONTRACT.md; migration/release work reads CUTOVER.md and the dated results
in RELEASE_GATES_PLAN.md. Revalidate deployed SHA and migration ownership before
release work; source and historical receipts do not identify current deployment.

## Production record

Historical deployment snapshot (owner/integrator statement): `ffdb1cdf`, schema **118**,
with migration `20261031180000_rebuild_ads_ad_creation` applied in production
(owner/integrator record; not observed here, and no receipt such as a
`_prisma_migrations` row or CHECK probe is in the repository; confirm it). Owner cutover: 2026-10-20 22:09 CEST, release `5f1e52d7`, via
`rebuild/scripts/prod-cutover.sh` (one-shot, removed after use), origin https://social.newsgeet.com. Rebuild
web/worker recorded active/enabled; legacy inactive/disabled. The legacy tree
was deleted from the repository on 2026-10-22 (lane 47); server-side removal
via `rebuild/scripts/server-legacy-cleanup.sh` is still pending, and there is
no legacy rollback target anymore. Releases use `rebuild/scripts/prod-deploy.sh`.
Keep one publisher. `app.publicOrigin` is the
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
The drill is rebuild-only since lane 47 (legacy half retired with the legacy release).
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
  in CONFIG_LITERAL_AUDIT. Schema 118 describes round 9; current source is 123.
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
  production application). Management ships off by default. Owner now reports
  live create/rename/delete verified in Ads Manager; cleanup receipts remain open.
  Runtime locale propagation is integrated in 8d9ccbe7. Recovery authority/scope follow-up
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
    engine. **At round 8 the UI, REST and MCP entry points did not yet pass customer locale**
    (`CampaignsScreen.tsx`, `api/ads/management/route.ts`, `ads/mcp.ts`), so messages were English there (fixed in 8d9ccbe7), and recovery does not repeat the creation-only unrestricted-channel
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

1. Fix `src/components/AppShell.tsx`: workspace selection POST must include
   exact SELECT WORKSPACE confirmation alongside workspaceId.
   Preserve selection/pending/refusal behavior; service consent must remain strict.
2. Shared config/UI owner registers `shared.formValidationCopy` using the exported
   schema/defaults in `src/lib/ui/form-validation.ts`, loads via runtimeConfig and
   serializes selected copy into FormValidation for public/auth/customer/Root
   layouts. Media presentation, loading and Root-error registrations are done.
3. Release owner reconciles actual deployed SHA/schema/migrations, confirms the
   baseline receipt in `_prisma_migrations`, and verifies CHECK/FK/identity/
   cascade/rollback probes. Preserve the one publisher policy, recovery assets
   and unresolved photo-canary lock. No replay of cutover, migration application
   or production action is authorized here.
4. Data-control owner includes ads_objects in account/workspace exports and
   retain-account erasure, with transaction/stale-sync/purge tests. See the Ads
   README and data-control README; table catalog presence alone is insufficient.
5. Ads owner records sanitized receipts for the owner-reported live
   create/rename/delete run (object levels, confirmations/audit, final state,
   cleanup and spend). Verify remaining budget/status/creative/recovery and real
   MCP paths. Review creation-only unrestricted-channel versus recovery scope;
   round 9 already rechecks current authority/visibility under lock.
6. UI owner reruns Chromium/Firefox/WebKit on synthetic data for all later merges,
   themes/viewports/FR, keyboard and failure recovery. Fix soft 404s, shell error
   boundaries, hydration and remaining raw module messages; source/DOM passes are
   not a clean browser matrix. Smoke waivers need bounded source fixes and tests.
7. Provider/Analytics owner resolves the numbers-evidence adapter gaps and Page
   metric policy registration/consumer projections. Verify database query plans,
   actual volume, worker drain timing, mixed scheduling and recipe recovery.
8. Integrator reconciles the legacy sweep and any later lane commits for
   Instagram, AI agents, async Posts CSV, design round 2 and MCP client
   execution. (Facebook Groups were dropped by owner decision 2026-10-22.)
   They must not be described as shipped/proven.
   LEGACY_CAPABILITY_PARITY ownership here permits status-cell edits only;
   adding/restructuring inventory rows requires the inventory owner.
9. Operation/module owners reconcile stale CONTRACT_AUDIT, ADS_PARITY, config
   audit and Ads handoff/README pending claims against this source snapshot.
   Documentation in this lane cannot manufacture migration or runtime receipts.

## Current lane validation

Owned: ARCHITECTURE.md, AGENT_HANDOFF.md, DELIVERY_PLAN.md, GOAL.md,
MCP_PARITY.md, LEGACY_CAPABILITY_PARITY.md status cells, FEEDS.md and append-only
RELEASE_GATES_PLAN.md. No source/UI/test/contract/registry/migration edits, new Root
keys, servers, deploy, push or production calls. Current validation results are
recorded in the appended release-gate entry; historical test counts above retain
their original scopes. Changes remain in the working tree for integration.

Fresh local checks: TypeScript zero errors; parity guard 22/22 and config validation
7/7 pass. Full suite: 618 files passed, 2 failed, 49 skipped; 8,873 tests passed,
6 failed, 2,055 skipped. Five loopback transport failures are sandbox EPERM; one
Root config search test times out (also reproduced in the focused rerun). See the
appended release-gate entry for exact commands. Full suite is not green. Git
metadata is outside writable roots, so no commit; no push is authorized here.

## Legacy shell lane q-35 — 2026-10-22

Source update: installable app shell (dynamic public branding/manifest, offline-only service worker, icons and bilingual Appearance controls), global cross-site mutation middleware and neutral likes-versus-followers growth identity are implemented in the working tree. See [PLATFORM_SHELL_Q35.md](PLATFORM_SHELL_Q35.md) for exact evidence and remaining checks. New Root key: `settings.webApp`; integrator must bump CONFIG_SCHEMA_VERSION (unchanged here). Existing `meta.metricLabels` and `analytics.overviewCopy` gain copy entries with saved-catalog compatibility. No new database table, migration, background job or provider write. Browser service workers are local browser infrastructure; existing audience synchronization stays under shared worker leases/run history. No server, deploy, commit, push or production action was authorized in this lane. These source changes do not close real browser/provider/release gates or unrelated historical gaps. Facebook Groups are dropped by owner decision 2026-10-22; historical missing-feature statements above do not authorize Groups work.

Q-35 final verification: rebuild TypeScript zero errors; PWA/parity/config 67/67 and cross-site/audience/REST-MCP/UX 242/242 pass. Required full suite: 660 passed files, 1 failed, 49 skipped (10,288 passed tests, 5 failed, 2,191 skipped); all failures are unchanged facebook-native-http loopback `listen EPERM ::1`. Build blocked by Google Fonts DNS. New checks are green, but full-suite/build/browser release gates remain open. Changes left uncommitted.

## Operator monitoring follow-up (2026-10-22)

Source adds module-owned Root monitoring (UI/REST/MCP shared authorization,
exact confirmation and audit), incident evaluation, observed-minute uptime,
and a persisted email outbox that never automatically replays uncertain sends.
The dedicated worker and independent web observer share leases/run history;
web monitoring cannot publish or write worker heartbeats. Worker failures feed
the existing scrubbed error console. Release/recovery readiness probes now use
`/api/health`; scripts were not executed against any host.

New migration `20261022180000_rebuild_uptime_samples` adds minute claims and
monitoring delivery records; apply/rehearse it before enabling monitoring.
New Root keys are listed in the operator lane verification note. Schema version
is deliberately unchanged for the integrator. Telegram, provider usage alerts,
test-alert parity and real database/browser/mail/release evidence remain open.
See `OPERATOR_MONITORING_2026-10-22.md` for scope and current verification.


Fresh operator-lane verification: `npx tsc --noEmit -p .` and
`npm run typecheck` passed with zero errors; 113 focused tests across 12 files
passed, including parity/config guards. Final full suite (only the requested
Facebook diagnostic transport exclusion, cache disabled): 658 files passed,
one failed, 49 skipped; 10,174 tests passed, five failed, 2,159 skipped. All five
failures are loopback `facebook-native-http` tests blocked by sandbox
`listen EPERM ::1`; the full suite is not green. Both release scripts pass
`bash -n`; whitespace checks pass. Work remains uncommitted as requested.

## Lane 43 follow-ups — 2026-10-22

Caption tests now accept raw caption variants through an atomic Publishing draft
batch, alongside existing-post tests. The bilingual source picker, channel
selection and exact confirmation dialog call the same caption service as REST
and MCP. Variants remain drafts until an explicit Publishing action.

Chat subscriptions receive transactional content-free workspace events through
the existing leased notifications job, with durable per-destination claims,
current workspace/access/subscription checks and no automatic replay of uncertain
sends. Root Operations owns the single installation incident evaluator and
email outbox, plus a confirmed test operation and explicitly selected
owner-workspace chat routing. The duplicate Root Alerts screen/config/tools are
removed; its old screen redirects to Operations and REST aliases delegate to the
canonical monitoring service.

Registry schema is 131. Existing caption, chat and Root monitoring policy/copy
objects gain fields; three `notifications.systemAlert*` keys are removed. The
`20261022190000_rebuild_chat_deliveries` source is squashed into the
`20261103000000_baseline` migration (lane 47). Historical
saved duplicate alert settings are not imported automatically; review the Root
monitoring thresholds and configure its chat workspace deliberately.

See [LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md) for exact verification and remaining
gates. No browser, real PostgreSQL, provider/chat/mail delivery or production
verification is claimed. Changes remain uncommitted as requested for this lane.

Final lane-43 verification: rebuild `npm run typecheck` and explicit
`npx tsc --noEmit -p .` pass with zero errors. All 22 targeted files pass
(1,019 tests). Full requested suite, cache disabled: 700 passed files, one failed,
49 skipped; 11,373 passed tests, five failed, 2,525 skipped. Only
`facebook-native-http.test.ts` fails, because sandbox localhost binding returns
`listen EPERM ::1`, matching the baseline. No claim of a green full suite.
Changes are uncommitted; migration/browser/real delivery checks remain open.

## Root administration naming lane (2026-10-22)

Root administration moved to `src/modules/root/server/admin/`; consumers and regression test names follow the new paths. Root settings are renamed to `root.admin.*`, schema 132. The idempotent `20261022200000_root_admin_settings` source (now squashed into the baseline) preserves existing canonical values. The one-time configuration importer is removed; the read-only historical migration expectations were removed with it in lane 47. Facebook live probes resolve configuration and credential decoding through the Facebook module. Stored auth hash and cookie formats remain unchanged. No server, provider call, deployment or push was run.


Root naming continuation verification: typecheck and explicit `tsc -p .` pass;
162 focused tests pass. Final cache-disabled suite (diagnostic transport excluded):
699 files pass, one fails, 49 skip; 11,370 tests pass, five fail, 2,525 skip.
Every failure is unchanged `facebook-native-http` localhost `listen EPERM ::1`.
Keep those tests intact and rerun where sockets are permitted. Migration SQL
passed a synthetic SQLite collision/idempotence/metadata check, but PostgreSQL
rehearsal and real live-probe execution remain open. No servers, deploy or push.

Root naming final continuation: module-owned probe configuration now clears bundled signing secrets when Root has none; three regression tests cover policy and credential fallback. The saved-key SQL collision/idempotence/metadata check is now an automated test (built-in SQLite, not PostgreSQL). Unused historical mapping exports and a residual plans comment are removed. Typecheck and explicit tsc pass; 10 focused files / 164 tests pass. Full cache-disabled suite excluding diagnostic transport: 701 files passed, one failed, 49 skipped; 11,374 tests passed, five failed, 2,525 skipped. All five failures are unchanged sandbox `listen EPERM ::1` in facebook-native-http. No server, live probe, database migration, deploy, push or staging was performed. Source changes remain uncommitted.

## Lane 44 sweep closure (2026-10-22)

`LEGACY_SWEEP_2026-10-21.md` section 0.4 reconciles every missing/partial row against source and lists the open items G1 to G7 (Graph usage reader, legacy `api_tokens`, seven staged connectors, text backgrounds, alt text, mail HTTP API provider, unused-media retention). New: Root key `ui.defaultLocale` (schema **133**), `scripts/install-debian.sh`, `scripts/admin/{set-root,reset-two-step}.ts` (not run on a host). Apply nothing to production from this note.


## Lane 46 OAuth connector installation — 2026-10-22

Mastodon, LinkedIn, Threads, X and Pinterest move from staged adapters to installed
module/host dispatch, disabled by default. Shared Settings/Publishing services retain
UI/REST/MCP authorization, exact confirmation and audit; OAuth uses app.publicOrigin
and discovered resources require explicit selection. G3 is done at source, with
live consent/refresh/publishing/cleanup, browser/client and release gates open.
See [CONNECTORS_LANE_46.md](CONNECTORS_LANE_46.md) for legacy credential mappings,
Mastodon single-instance limitation and the outside-owned Root manual-refresh
credential-consistency gap. Schema bump belongs to the integrator; this lane
leaves CONFIG_SCHEMA_VERSION unchanged. Final TypeScript: zero errors; 11 focused files / 183 tests pass, including
parity/config guards. Required full suite: 711 files pass, one fails, 49 skip;
11,511 tests pass, five fail, 2,553 skip. All failures are unchanged Facebook
loopback probes blocked by sandbox `listen EPERM ::1`; full suite is not green. No production
action or live-provider claim. Changes remain uncommitted as requested.

## Lane 47 legacy removal — 2026-10-22

Owner approval: "delete all old app files and doc from github and server and
cleanup the new app from any residues or old migration". Pre-removal production
backup `/var/backups/legacy-removal-202610221216`, restore verified.

Deleted from the repo (uncommitted): every tracked legacy root path (`src/`,
`tests/`, `e2e/`, `scripts/`, `docs/`, `prisma/`, `public/`, `messages/`, root
package/lock/configs, Dockerfile, compose, root README/guides). Root keeps
`rebuild/`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.mcp.json`, `.claude/`.
Rebuild-root reads were moved first: `test-db.sh` ported to
`rebuild/scripts/dev/`, preview DB prep rewritten for the baseline, the chat
test repointed (it was the only functional root read).

Migrations: 139 rebuild + 1 root chat migration squashed into
`20261103000000_baseline` (SHA-256 `8abd5224…e0f8dd`), concatenated verbatim in
deploy ORDER. Equivalence proven by applying both chain and baseline to
scratch PostgreSQL (PGlite) and comparing full catalogs plus seed data
(identical except `CURRENT_TIMESTAMP` stamps).
`tests/baseline-migration.test.ts` pins all 140 source blocks; 27 migration
test files read the baseline via `tests/baseline-block.ts`. The rehearsal
(`cutover-rehearsal.sh`) pins and applies only the baseline to an empty
scratch DB; `prod-deploy.sh` marks the baseline applied on migrated databases
(resolve semantics) and never re-runs it there; `-1` was dropped everywhere
because the baseline contains `ALTER TYPE ... ADD VALUE`;
`install-debian.sh` uses the project's own psql ledger instead of
`prisma migrate`. Retired: `prod-cutover.sh` (one-shot, already ran),
`deploy/rebuild-deploy.sh`, `deploy/rebuild-rollback.sh` (pre-cutover blocks);
`prod-rollback-drill.sh` is rebuild-only.

Residue: `OAuthCode` export/erase hooks removed; `migration-setting-expectations.ts`
deleted (verifier keeps restore-integrity checks minus the legacy-import block);
`legacy-schema.prisma` minus five models; manifest moves 17 tables to `in_place`
and drops five retired entries; stale lane/plan docs removed
(`CLAUDE_*_COORDINATION`, `CORE_DESIGN_PLAN`, `LEGACY_COMPAT_RENAME`,
`PRODUCTION_HOST`, `plans/*`, `superpowers/plans/*`); TESTING/PREVIEW/README
rewritten for the self-contained app; OPERATIONS/CUTOVER/ARCHITECTURE/GOAL/
DELIVERY_PLAN updated. `LEGACY_CAPABILITY_PARITY.md` and the sweep stay as
historical evidence.

Server (not run): `scripts/server-legacy-cleanup.sh` (idempotent, prints what
it does) removes the old units, `/srv/ms-social-pilot{,.prev}`, the old deploy
guard, and drops `workspace_exports`, `OAuthClient`, `OAuthCode`,
`api_tokens`, `snippets` in one transaction after a fresh dump — never
`/var/lib/ms-social-pilot/media`. The literal schema-compare would have
dropped ~90 live tables (the mapped client is a partial view); the script
additionally verifies zero rebuild references and the shipped `schema.prisma`
`@@map` list server-side. Next: run it in an authorized session, then confirm
the baseline receipt and the five drops on production. No new Root keys;
schema stays 135. Full-suite/typecheck results are in the lane-47 report.
## Design v2 B4 (Inbox) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B4 / [04-SCREENS.md](design-v2/04-SCREENS.md) S8. Files: `src/modules/inbox/ui/{InboxScreen,InboxChrome,InboxFilterRow,ThreadDetailsLayout,InboxActions,InboxShortcuts,moderation/ModerationScreen}.tsx`, the two inbox CSS modules, `round3-copy.ts` (`screen` block), `manifest.ts` (redirect), `src/app/inbox/rules/page.tsx` (moved from `inbox/moderation`). Deleted: `InboxFilterPanel.tsx`, the always-visible `ShortcutHint` legend. Tests: new `inbox-v2-b4`; updated `inbox-{browsing-page,round2-ui,round3-ui,screens-redesign,write-receipts-ui,thread-scroll,analytics-ux-polish}`, `instagram-customer-filters-ui`, `browser-matrix`. Evidence: unit/jsdom/server-render only; no browser, FR screenshot, keyboard-in-browser or phone-keyboard run.

- **New Root keys:** none declared. The Root-editable Inbox catalog gains entries `round3Copy.screen.*` (12 keys); the integrator may need to bump `CONFIG_SCHEMA_VERSION` if the catalog key set is versioned (unchanged here).
- **Open:** (1) moderation actions are still buttons in the thread header, not a per-message menu; (2) the sidebar channel scope is now read by the Inbox (see B5 below); (3) Saved replies are managed from the header and inserted via the existing productivity bar, not a menu inside the reply box or a phone bottom sheet; (4) BulkBar still offers its existing actions (no separate Assign); (5) the 2-tap phone path and the sticky reply box need a real phone browser; (6) legacy `scripts/verify-*` selectors for the inbox sidebar filters are not updated.

## Design v2 B5 (Insights) and Inbox channel scope (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B5 / [04-SCREENS.md](design-v2/04-SCREENS.md) S9 to S12. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) green; new and updated tests `insights-overview`, `charts-v2-b5`, `inbox-scope-b5`, `route-redirects`, `analytics-explorer`, `analytics-demographics-surfaces`, `ads-filter-ui`, `module-manifests`, `shell-v2`, `browser-matrix`. **No browser, screenshot, keyboard-in-browser, FR-in-browser or screen-reader run; no server, migration, deploy or provider call.**

- **Routes (308 from the old ones, declared in the Analytics and Ads manifests):** `/insights` (Overview), `/insights/explore`, `/insights/audience`, `/insights/posts`, `/insights/compare` and `/insights/compare/ads`, `/insights/ads` (Accounts), `/insights/ads/campaigns`, `/insights/ads/manage`, `/insights/ads/analysis` (the former `/analytics/ads` ad-object analysis), `/insights/reports`, and the sub-pages `/insights/goals`, `/insights/pins`, `/insights/notes`, `/insights/tests`. `src/app/analytics/**` and `src/app/ads/**` are deleted; `src/app/insights/**` is thin re-exports. The area tabs are Overview · Explore · Audience · Posts · Compare · Ads · Reports; the pages declare `tabOrder` (new optional manifest field, honoured by `areaPages`) because two modules share the area. Goals, Pins, Ads Campaigns/Manage/Analysis and Compare ads are `navigation: false` sub-pages. The calendar-extras manifest link to chart notes now points at `/insights/notes`.
- **Overview (`ui/AnalyticsScreen.tsx`, `ui/insights/*`):** four key numbers (Audience plus three metrics picked by Root label words, see `analytics.insightsPolicy.tiles`), pinned metrics appended and hidden behind "Show all" beyond four, the main chart (metric switcher inside the card, previous period dashed, chart notes kept, horizontal scroll on phones), Top posts (ranked among the most recent measured posts by the first measure whose label matches a Root word; thumbnails are placeholders because the post read model carries no thumbnail) beside Publishing activity (counts link to Content filtered by status), goal bars when goals exist, and the former heatmap/interaction cards inside a "More insights" disclosure. Every caveat is in an ⓘ (period, coverage "x of y channels", missing is not zero, audience overlap); partial coverage turns it into ⚠. One shared header (`InsightsHeader`) carries the title, ⓘ, actions and the filter row: `DateRangePicker` with presets and the compare switch, then the page's single Filter button. All numbers come from `readAnalyticsSnapshot`, `readPinnedMetrics`, `readGoals` and `readPosts`, the same services REST and MCP use; secondary cards fail independently and are skipped when the member lacks the feature.
- **Channel scope:** Overview, Explore, Audience, Posts and the Inbox read the sidebar scope (`pageChannelScope`, `channel=a,b`, then the cookie) and turn it into the services' explicit channel filter (`insightsReadInput`); their own channel checkboxes/selects are gone. Compare keeps its own period/group forms (it compares groups, so the sidebar scope does not apply yet). Ads uses `account=` and its own Root report presets.
- **Inbox:** `ui/scope.ts` (`inboxScope`) narrows the `allowedChannelIds` constraint of `readInboxList`/`readInboxThread` to the sidebar scope, carries `channel=a,b` through links, the filter form (hidden field), paging and the progressive-load server action, and the Filter button no longer has a channel picker. A single legacy `?channel=<id>` is a one-channel scope. Synchronization from the Inbox targets the one scoped channel, otherwise all.
- **Explore (S10):** a metric list (280 px, availability dot) beside the selected metric's chart, table and resource breakdown; `?metric=` is in the address; phones show the list or the detail. Search, source and measurement type are in the Filter button. Metric links keep the page address (scope, period), not the service's canonical query.
- **Ads (S12):** `AdsHeader` (title, ⓘ, period presets from the existing `ads.reportPolicy`, ad-account switcher in the Filter button, sub-tabs Accounts · Campaigns · Manage · Analysis). **Accounts is one table** (`AccountsTable`: account, status, spend, impressions, clicks, click rate, cost per click, last synced); a row opens a side panel with the spend chart, funnel, actions and daily rows (`AccountCharts`, `DailyMetrics` reused). Spend stays per currency. "Results" and "cost per result" are provider-specific, so the table shows clicks and cost per click. Campaigns, Manage and Analysis keep their screens and Page-tools sidebars (transitional) with the new sub-tabs and routes. Ad accounts are single-select (the services take one `account`); multi-select within one currency is not built.
- **Compare:** one tool with a Channels | Ad accounts switch (`compareKindSwitch`); the two screens stay separate routes.
- **Charts (`src/components/charts`, 02 §6):** time axis fills missing days (`fillTimes`, `series-fit.ts`); comparison aligned by date offset, not array position; above two series each series gets a marker shape and line pattern; donut and stacked bars group beyond eight as "Other" (additive only; unknown stays unknown); the donut legend shows percentages; every chart has a "Show data" toggle (hidden table becomes a visible, scrollable table). `NotesTimeSeriesChart` (calendar-extras) uses the same filled axis so note marks keep their position.
- **New Root keys (integrator bumps `CONFIG_SCHEMA_VERSION`, unchanged here):** `analytics.insightsCopy` (EN/FR catalog with placeholders validated), `analytics.insightsPolicy` (period presets and default, tile definitions, tiles shown/max, chart metrics, Top posts rows/pool/ranking words, goal bars), `ads.insightsCopy` (Ads sub-tabs and Accounts table). The page labels for the tabs live in `home.shellCopy` (`ads/overview` is now "Ads", `analytics/explorer` "Explore", `analytics/ads` "Ads analysis"); saved Root edits of those entries keep their value.
- **Removed/dead:** `ui/explorer/sidebar.tsx`; the old Overview metric grid, pagination and metric-detail sidebar (metric detail now lives in Explore). `ui/AnalyticsFilters.tsx` stays (tests cover it) but no screen mounts it.
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence, and the Overview height (at most 1,800 px) and phone priority 4 (2×2 tiles, bottom-sheet ⓘ, scrollable chart) are CSS/DOM only; (2) Reports, Goals, Pins, Campaigns, Manage, Analysis, Compare and Audience keep their sidebar Page-tools forms rather than the header Filter button; (3) Posts has the sidebar form and no SidePanel with metrics; (4) Top posts thumbnails are empty placeholders until the post performance read model exposes media; (5) Ads Accounts has no "results"/"cost per result" columns and no multi-account select; (6) Compare with the sidebar scope; (7) legacy `scripts/verify-*` selectors for the old Analytics/Ads sidebars are not updated (the matrix route lists are); (8) `SidebarDock` and the Page tools adapter stay until B9.

## Design v2 B6 (Settings) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B6 / [04-SCREENS.md](design-v2/04-SCREENS.md) S13. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) green; new and updated tests `settings-v2-b6`, `workspace-operations-shortener-ui` (rewritten for the cards), `settings-form-validation`, `settings-round2-ui`, `module-manifests`, `browser-matrix`, `integrations-module`, `client-sharing-host79`. **No browser, screenshot, keyboard-in-browser, FR-in-browser or screen-reader run; no server, migration, deploy or provider call.** Services, REST and MCP are unchanged.

- **Shell:** for the Settings area `AppShell` renders an in-content section list (220 px left on desktop, a scrolling strip below 860 px) instead of area tabs. Sections come from the manifest (`tabOrder`): Workspace, Channels, Team, Sharing, Integrations, Account, Data and privacy, History. Labels come from `home.shellCopy` page titles (`settings/connections` is now "Channels", `settings/sharing` "Sharing", `settings/mcp` "Integrations").
- **Routes (308 from the old ones, declared in the Settings manifest):** `/settings/channels` (+ `/groups`), `/settings/sharing` (+ `/bio`), `/settings/integrations` (+ `/keys`, `/webhooks`), `/settings/account` (+ `/security`, `/appearance`, `/notifications`, `/notifications/chat-channels`). Page ids and permissions are unchanged; Link in bio, Webhooks, Notifications and Appearance are `navigation: false` tabs. `/settings/profiles/operations` keeps its address (API). Section tabs: `ui/section-tabs.ts`, rendered by `SettingsPage tab=...` (`SectionTabs`).
- **Workspace (`ui/workspace/WorkspaceCards.tsx`):** seven cards (Name and time zone with a searchable time-zone `Select`, Approvals, Posting hours, Queue and spacing, Links with UTM under a disclosure, AI voice, Moderation alerts). Each card saves alone with its own Save, a "Saved" toast and an inline error that keeps the edit. Cards send their fields on top of the last saved state through the existing `workspace/policy` and `workspace/operations` endpoints with the same exact confirmation strings (the extra confirmation dialog was dropped). The workspace name is read-only (there is no customer rename service).
- **Channels:** one card per connected account (avatar, name, status pill, "x of y channels in use", missing permissions in red with the full grouped list on demand, [Manage channels] [Reconnect] and "⋯" Disconnect). Disconnect keeps its retain-or-delete dialog and consequences. Ad accounts table without the account id column; groups and labels are the second tab. The ad-account id line was removed from the selection dialog.
- **Account:** Profile (name, workspace context without the slug), Security (password, sessions, two-step, passkeys), Appearance, Notifications. The partial account export moved to Data and privacy. Personal (Agency) keys moved to Integrations › API keys; the Account-only fallback still applies. The session id no longer appears in the sign-out confirmation.
- **New Root key (integrator bumps `CONFIG_SCHEMA_VERSION`, unchanged here):** `settings.sectionsCopy` (EN/FR tab, card and Channels labels). Page titles live in the existing `home.shellCopy`.
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence; (2) phone shows a scrolling strip, not the "list page then section page" flow; (3) Team, Sharing, Integrations (MCP, webhooks) and Data keep their earlier panels, only wrapped in the new frame and tabs, and still use the old button styles; (4) no workspace rename; (5) Data and privacy has no unified ZIP status card beyond the existing export panel; (6) legacy `scripts/verify-*` selectors for the old Settings pages are not updated.

## Legacy server removal executed (2026-10-22)

`scripts/server-legacy-cleanup.sh` ran once on production and was then deleted from the repository; references to it above are historical. Result: fresh backup `/var/backups/legacy-cleanup-20261022110559`, five unmapped tables dropped (workspace_exports had 1 row; others empty), legacy units, `/srv/ms-social-pilot{,.prev}` and `/usr/local/sbin/socialpilot-deploy` removed; rebuild units stayed active. Production then deployed `b9001ddf` with the baseline marked applied. `20261022200000_root_admin_settings` was never applied in production before the squash; production had no `root.legacy.*` keys, so no data changed.


## Design v2 B7 — lane 55 (2026-10-22, partial, uncommitted)

Read [design-v2/B7_IMPLEMENTATION.md](design-v2/B7_IMPLEMENTATION.md) before
continuing. Owned Home/Tasks/Agency UI and tests are changed; no new Root keys,
registry bump or service behavior. Home has first-run replacement, personal
greeting, compact period, InfoTip caveats, scheduled-post ListRows, real nonzero
Inbox attention and per-card refresh. Tasks/Agency filters no longer use the dock;
Tasks uses tabs/SidePanel, guards stale comment reads and pending competing actions.
Agency retains its scoped table/unknown values, confirmed switch and exports.
Full S1/S14 is not complete; outside-owned data/copy/activation and build/browser
blockers are enumerated in the report. Synthetic component fixtures are optional
file-only exports, not screenshots or actual page verification. Leave uncommitted;
no server, deploy, push or production work was authorized in this lane.

Final lane-55 evidence: TypeScript exit 0 / zero errors; 16 focused files,
223 tests passed (3 optional artifact-export tests skipped). Full suite with
only diagnostic transport excluded: 718 files passed, 1 failed, 49 skipped;
11,609 tests passed, 5 failed, 2,556 skipped. The failures are unchanged
`facebook-native-http` sandbox `listen EPERM ::1`. Build fails on font DNS and
an outside-owned Settings/Sharing client import of server-only code. Chrome
launch was sandbox-blocked; no screenshots. `git diff --check` passes.

## Design v2 B8 — lane 56 (2026-10-22, uncommitted, source/unit/jsdom only)

Implements batch B8 (S15 Root) and finishes the B7 outside-owned leftovers 1–4
(Home attention/link-click/recent-Inbox data and copy, Agency waiting counts,
optional-area activation, per-task checklists). B7 leftover 5 (Settings/Sharing
production build chain) was already fixed on `main` (`b2ac77b2`); leftover 6
(integration environment) is unchanged: this lane ran unit/jsdom only.

Root: sidebar regrouped into Overview/People/Modules/Operations/Activity with
area icons; module detail pages split into Settings·Availability·Diagnostics·Health
tabs (platforms omit Availability); Operations into Jobs·Diagnostics; Shared
configuration into Settings·Availability. All routes kept. Moved
`src/server/root/*.tsx`, `src/server/jobs/RootJobHealth.tsx` and
`src/app/root/root-nav-icons.tsx` into `src/modules/root/ui/` (no outside-owned
importer needed a shim). The move put 128 pre-existing Root operator literals
under `tests/ui-copy-coverage.test.ts`; they are now catalogued in
`root.interfaceCopy` (EN/FR) with `useRootInterface()` (client) and a cached
`loadRootInterfaceCopy()` (server); only the `ms` unit is allowlisted.

Services: Home overview gains attention counts, link-click totals from the
snapshot metric, an audience delta between known trend days, recent open
conversations, non-throwing setup and a `channelIds` display filter through
UI/REST/MCP. Agency gains an `inbox` capability group (waiting conversations
with coverage) in the overview and exports, plus a clarified `channel` parameter
on Agency/Clients. `workspaces.tasksAreaEnabled` (migration
`20261103020000_workspace_tasks_area`) lets Settings › Workspace show Tasks
early through the existing workspace-operations service; Agency appears for
>1 administered workspace; Tasks obeys the scope through linked posts and
reports hidden unlinked tasks. Per-task checklists: new `task_checklist_items`
table (migration `20261103010000_task_checklist_items`), confirmed/audited
service actions, UI/REST/MCP and Root limits. New MCP tools:
`add_task_checklist_item`, `set_task_checklist_item`,
`delete_task_checklist_item` (parity rows added). New Root keys (integrator
bumps `CONFIG_SCHEMA_VERSION`): `home.linkClickMeasureWords`,
`home.recentInboxLimit`, `home.recentInboxPreviewCharacters`,
`home.attentionReconnectLimit`, `tasks.checklistLimit`,
`tasks.checklistItemMaxCharacters`.

Evidence: `npx tsc --noEmit -p .` 0 errors; `npx next build` passes;
`npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts"`: 720 files
passed, 11683 tests passed, 5 failed — all 5 are the pre-existing
`tests/facebook-native-http.test.ts` sandbox `listen EPERM ::1` failures (same
as B7). Agency module suite: 183 passed; 7 failed, all verified pre-existing on
the clean tree (`export-ui` ×3, `person-account` ×2, `person-ui` ×2). No browser
run, screenshots, live-provider or production verification.

## Design v2 B9 (2026-10-22, source/unit/jsdom only; see HANDOVER for the ship record)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B9 plus the
three HANDOVER open items it names (data-deletion catalog, atomic token
refresh, Inbox saved-replies menu + bulk Assign). Closes the B4 open items
(3) reply-box menu and (4) bulk Assign, and the B2/B3/B5/B6 open items on
`scripts/verify-*` selectors.

- **Adapter removal:** deleted `src/components/SidebarDock.tsx` and the
  unmounted `ModeToggle.tsx`; `AppShell` loses the Page tools sheet, toggle
  and context; `PageFrame`, shell copy/CSS, Root, Calendar, Reports, Ads and
  Analytics screens drop dock mounts. `sidebar=` hits 0 and `pageTools` hits
  0 in `src/`. Eight verify scripts rewritten for the new selectors
  (browser-matrix, first-comments94, destination-formats85,
  facebook-native-journal89/policy87/status91/publication-submissions92,
  reports82); selectors are source-verified only, no browser run.
- **Data deletion:** outcome sentences move from a code constant into
  `public.content` (`resultCompletedOne/Many` with required `{count}`/
  `{when}`, `resultUnknown`, `resultInvalid`; EN/FR defaults;
  `resolveDataDeletionResults` backfills catalogs saved before the keys).
  New `tests/public-data-deletion.test.ts`; `server/site.ts` untouched.
- **Token refresh:** `root/server/admin/connection-refresh.ts` renews the
  account token, `tokenExpiresAt`, destination copies and audit in one
  `prisma.$transaction`. New host fields `grantExpiresAt` and
  `rotateDestinationCopies`, declared per module (YouTube, TikTok, LinkedIn,
  Pinterest, Threads, X); Facebook/Mastodon untouched (page-specific
  grants). New `tests/root-connection-refresh-atomicity.test.ts`; mocked
  transport only, no live-provider renewal run.
- **Inbox:** `ReplyBox` gains an `onInsertSavedReply` menu (names from the
  saved-replies service; insert fills the draft, never sends;
  loading/error/empty/disabled states; writers only). `BULK_ACTIONS` gains
  `assign` (conversations/comments only, `assigneeId` member or null,
  `BULK_INVERSE` null — no Undo) through the shared service with UI dialog
  (member picker from the first item's team list), REST and `bulk_inbox_action`
  parity, exact `BULK ASSIGN <n> INBOX ITEMS TO <member|UNASSIGNED>`
  confirmation and audited receipt. New `tests/inbox-bulk-assign-mcp.test.ts`
  and `tests/inbox-reply-saved-menu.test.ts`. Closes B4 (3)(4).
- **Integrator fixes:** `CONFIG_SCHEMA_VERSION` 135 → **136** (queued B8 keys
  plus the three B9 catalog changes; `config-validation` pins updated).
  `tsconfig.json` excludes reference-only `docs/handover/archive`, whose
  73-file WIP backup broke typecheck (103 errors) and the `next build` type
  gate at HEAD; nothing imports it. Saved `home.shellCopy` catalogs carrying
  `pageTools` keys read as the shipped default until re-saved in Root.

Evidence: `npm run typecheck` 0 errors; targeted B9 files pass; full suite
(diagnostic transport excluded, 30 s timeout) 724 files / 11,726 tests
passed, 5 failed — all pre-existing `tests/facebook-native-http.test.ts`
sandbox `listen EPERM ::1` (file untouched by B9; `node:net` `::1` bind
probe fails identically). `npx next build` re-run at ship time. No browser
matrix, keyboard walk, live-provider or production-behavior run in this
batch beyond the deploy health checks; see HANDOVER for the ship record.
