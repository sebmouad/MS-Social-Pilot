# MS Social Pilot architecture

Updated 2026-10-22 (lane 47) against the local working tree, configuration schema **135**.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) remains binding and unchanged.
Current reconciliation below takes precedence over historical batch snapshots.
Source, automated, browser, live-provider and production evidence remain distinct.

## Lane 47 legacy removal — 2026-10-22

Owner approval: delete the legacy app from the repository and the server and
clean residues from the rebuild. Pre-removal production backup
`/var/backups/legacy-removal-202610221216`, restore verified.

- Repository: all tracked legacy root paths deleted (`src/`, `tests/`, `e2e/`,
  `scripts/`, `docs/`, `prisma/`, `public/`, `messages/`, root package/configs,
  Dockerfile, compose, root README/guides). Root keeps `rebuild/`, `AGENTS.md`,
  `CLAUDE.md`, `.gitignore`, `.mcp.json`, `.claude/`.
- Migrations: the 139 rebuild migrations plus the root chat-deliveries
  migration are squashed into one baseline,
  `prisma/migrations/20261103000000_baseline/migration.sql` (SHA-256
  `8abd5224…e0f8dd`). Equivalence was proven by applying both the chain and the
  baseline to scratch PostgreSQL databases and comparing full catalogs plus
  seed data (identical except `CURRENT_TIMESTAMP` apply stamps).
  `tests/baseline-migration.test.ts` pins all 140 source blocks. Production
  marks the baseline applied without re-running it (`prod-deploy.sh` resolve
  handling); fresh databases apply it without a wrapping transaction (`ALTER
  TYPE ... ADD VALUE`). `prisma migrate` is not used anymore.
- Code: the `OAuthCode` export/erase hooks are removed; the old
  `migration-setting-expectations.ts` helper is deleted and the verifier's
  legacy-import check with it. `legacy-schema.prisma` drops five models
  (`ApiToken`, `Snippet`, `WorkspaceExport`, `OAuthClient`, `OAuthCode`); the
  manifest moves seventeen tables to `in_place` (readers verified) and drops
  the five retired entries.
- Server (not run here): `scripts/server-legacy-cleanup.sh` removes the old
  units, `/srv/ms-social-pilot{,.prev}`, the old deploy guard, and drops the
  five legacy-only tables in one transaction after a fresh dump. Until it
  runs, the old units stay stopped and disabled.
- No new Root keys; schema stays 135. `config-validation`, `parity-guard`
  and the full suite were re-run (see the lane-47 report).

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

## Production status

The owner cut over on **2026-10-20 at 22:09 CEST**. The rebuild serves
`https://social.newsgeet.com`; `social-pilot-rebuild` and
`social-pilot-rebuild-worker` were recorded active/enabled, and legacy web/worker
inactive/disabled. The legacy tree was deleted from the repository on
2026-10-22 (lane 47); server-side removal runs via
`rebuild/scripts/server-legacy-cleanup.sh` and is still pending. Releases use
`rebuild/scripts/prod-deploy.sh`; the legacy `socialpilot-deploy` guard is
removed by that cleanup.

These are recorded production outcomes in [RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-cutover--2026-10-20-2209-cest),
not fresh probes by this documentation worker. That log records 34 applied
migrations, backup, health checks, ownership repair, owner sign-in confirmation,
legacy configuration import and later AI/browser checks. Cutover happened; full
contract completion is still unproven. An older integrator snapshot named `ffdb1cdf` (schema 118); the later dated
statement names `a910d774`/120. Neither identifies the current deployment. Migration
`20261031180000_rebuild_ads_ad_creation` was stated as applied in production; this
review did not observe application and no receipt is in the repository, so confirm the
applied migrations before claiming source live. The log also
records the 2026-10-21 post-cutover rollback drill (**PASS**: backup restored to a
scratch database, legacy and the installed rebuild started on spare ports; live
services unchanged) and the first full recipe day (07:00, 11:00, 15:00 and 17:00
Europe/Paris: 40/40 publications with 40/40 first comments; the article link was
then removed from the comments at the owner's request). The drill proves a restorable backup and startable rollback
artifacts, not a proxy cutback or media restoration.
See [CUTOVER.md](CUTOVER.md) for current status and historical migration procedures.

## Source and service boundaries

Next.js App Router, React, TypeScript, Prisma and PostgreSQL provide the web app;
a separate worker handles leased jobs. UI, REST and MCP must enter the same
product service, which owns current identity, tenant/resource scope, entitlements,
confirmations, state transitions and domain audit. Transport guards supplement
that boundary. The remaining deviations are tracked in [MCP_PARITY.md](MCP_PARITY.md).

| Location | Ownership |
| --- | --- |
| `src/modules/<module>/manifest.ts` | Routes, features, Root namespaces and job declarations |
| `src/modules/<module>/config.ts` | Typed owning-module Root definitions |
| `src/modules/<module>/mcp.ts` | Tools/resources, confirmation and credential-scope metadata |
| `src/modules/<module>/server/`, `ui/` | Product services and screens |
| `src/modules/installed-config.ts`, `installed-mcp.ts` | Installed-module aggregation |
| `src/platforms/facebook/` | Facebook protocol, credentials, OAuth/discovery, publishing, Inbox, analytics/Ads storage mapping and jobs |
| `src/server/platforms/` and `src/platforms/types.ts` | Neutral contracts, installed host registration and dispatch |
| `src/server/` | Shared authentication, authorization, jobs, mail, audit, configuration, data control and private Root infrastructure |
| `src/app/` | Thin pages, HTTP entry points and shared/authentication shell |

Installed platform modules are Facebook, Instagram, YouTube and TikTok (all but
Facebook disabled by default, fixture evidence only). YouTube and TikTok
(`src/platforms/youtube`, `src/platforms/tiktok`) are plain OAuth-with-refresh
modules: the neutral parts (sealed state cookie, destination persistence,
compare-and-set token store, renewal job, bounded JSON/media HTTP) live in
`src/server/platforms/{token-connection,token-renewal-job,provider-http,request-locale}.ts`
and name no provider; each module owns its endpoints, scopes, protocol and copy.
Legacy connector code for the other seven networks does not establish usable
rebuild support. Shared services consume adapter
capabilities, format catalogs and normalized measures, never provider branches.
Encapsulation is not complete: shared legacy storage reads in `src/server/data.ts`
still need coordinated moves. Account policy has moved to Settings; the shared
account path retains audit infrastructure and compatibility exports. Registration of a module does not prove its workflows or health.

## Configuration and public origin

`src/lib/config/registry.ts` aggregates module/platform declarations and
`src/lib/config/shared-config.ts`. The historical round-9 snapshot had schema version **118** (round 6 added `meta.adsCopy`, the Facebook
Ads action copy, owned by `src/platforms/facebook/ads-ui-config.ts`; round 7 added
`analytics.reports.publicationDetails` (116); round 8 added
`analytics.reports.topPostContent` (117); `meta.metricLabels` merges saved labels
over defaults and `meta.postHistoryPolicy` now merges saved metric additions with explicit exclusions;
round 9 adds `meta.pageAnalyticsCopy` and `analytics.reports.linkDetails`). Runtime
consumers use `runtimeConfig`; Root validates and transactionally audits saves,
encrypts secrets and groups controls under Shared, Product and Platform owners.
Database access and encryption trust material remain bootstrap dependencies.

`app.publicOrigin` supplies the browser-facing origin for same-origin checks and
absolute links behind the proxy; production was set to `https://social.newsgeet.com`.
`src/server/request-origin.ts` loads it at Node startup, retains it on `globalThis`
across Next bundles and refreshes on `app.publicOriginRefreshSeconds` and local
Root saves. Empty falls back to the received origin; `app.developmentOrigins`
provides Root-trusted preview origins. This fixed recorded production write refusals.

[CONFIG_LITERAL_AUDIT.md](CONFIG_LITERAL_AUDIT.md) records extensive extracted
limits/copy, current consumers and residual literals. Synchronous policy uses a
validated process snapshot; cross-process refresh is eventual. Standalone workers
need explicit refresh if they use those helpers; browser fallbacks need serialized
policy. Root recovery limits, `http.oauthAuthorizeMaxBodyBytes` and
`shared.reschedulePolicy` are implemented. Root-editable English/French catalogs
now cover Publishing, Inbox, Analytics,
Ads, Home, Tasks and Agency (`38ab34f4`), then Feeds, Media and Sharing
(`93944199`); `5e6841ee` adds bilingual service/public error paths for those last
three modules. `fb42b056` introduces `configOrDefault`: schema-validated readers
fall back to the registry default when stored catalogs/display policies are
missing, unreadable or invalid, then validate that default. The companion
`configValueOrDefault` checks only outer shape; callers own deeper validation.
These changes do not prove every string/policy is extracted or translated; AI
prompts, residual Root labels and transport/UI ceilings still need review.
The two OAuth consent settings have readers but stale inactive metadata.

## Themes, components and charts

The current palettes are **Vivid**, **Meta blue**, **Warm** and **Clean**, each with
light/dark palettes; system mode follows the device. Root `theme.default` and
`theme.defaultMode` set defaults. Runtime tokens are in `src/styles/tokens.css`;
metadata is in `src/lib/themes.ts`. Module icon colors and Tabler icons are shared.
Grove/Coast/Clay/Nightfall names in older evidence describe the previous system.

[DESIGN_COMPONENTS.md](DESIGN_COMPONENTS.md) documents shared tables, forms,
selects, menus, tabs, confirmations, drawers, filters, feedback and accessibility
behavior. [CHARTS.md](CHARTS.md) documents lazy ECharts time series, bars, donuts,
heatmaps, funnels, sparklines and audience pyramids, with theme tokens, keyboard
interaction, data tables and unknown-value gaps. Home, Publishing, Inbox,
Analytics/Ads, Tasks, Agency, Settings, Root and public/auth screens have adopted
shared controls in recent commits. Recorded Chromium rounds now exercise the
current palettes; their scope and
unresolved findings are described below, not an all-route clean pass.
English/French catalogs have expanded; localization is incomplete, including
some dynamic analytics labels and source error/default copy.

Settings appearance, the global ThemeProvider and mode toggle now save through
PATCH `/api/settings/appearance`, sharing `appearanceSession`/`updateAppearance`
with session MCP (`2b42470b`). Theme is stored in `users.theme`, mode under the
exact account key `settings.appearance.user.<userId>.mode`; changes audit together.
Cookies are a cache using the Root-configured lifetime. Layout uses saved account
preferences for a validated session when a valid cookie is absent, then Root
defaults. Preview changes remain local until save. Unit/render evidence covers
persistence/refusal; browser round 2 verifies system mode on representative pages,
not every cross-device persistence/security scenario.

## Implemented product slices and limits

| Module | Implemented source | Evidence / remaining gap |
| --- | --- | --- |
| Home | Authorized stored-data overview, charts, REST and `get_home_overview` | Workspace-wide tool refuses resource-limited keys; browser evidence below is scoped |
| Publishing | Drafts/composer, CSV, previews, list/calendar/queue, approvals, templates/labels/fields/notes/versions, bulk actions, first comments, recovery, best times, mix/recycle and short links | Shared UI/REST/MCP coverage documented in PARITY_PUBLISHING_INBOX; native/live and new scheduling runtime checks remain partial |
| Inbox | Scoped threads/nested replies/reviews, sync, moderation/deletion recovery, assignment/notes/replies, quick filters, contact details, bulk actions and shortcuts | Contact-details REST and bulk UI/REST/MCP (`f5c21c96`) exist; provider history/metadata and live moderation remain partial |
| Analytics | Catalog/series, previous-period points, comparison, posts, audience history, ad objects, pins, goals, reports/exports and charts | Stored-data surfaces share services; complete readable-provider collection, labels and provider history remain partial; response-report rounds 1–3 add comments, historical cycles, source/member breakdowns with disclosed stored-history limits |
| Ads | Account/performance/directory/compare/export, hierarchy charts, creation options, durable confirmed management: campaign, ad set, paused ad and stored-image creative creation, status/budget/rename/assign/delete, missing-grant reconnect notice | Session REST/MCP plus key REST v1; management ships off by default; the owner reports live create/rename/delete verified in Ads Manager. The `ad.create` ledger CHECK migration exists (`20261031180000_rebuild_ads_ad_creation`, recorded applied in production by the owner/integrator); Ads locale now propagates at the service boundary; inventory supports objects without delivery. Local fixture evidence and bounded owner-reported live evidence are distinct; see ADS_PARITY.md |
| Settings | Connections/selection, profiles/watermark, team/invitations, account/security/sessions, appearance, notifications, exports/erasure and keys | Broad service parity; selection and disconnect callers (UI, REST, MCP) share the confirmed services; partial account export is exposed (session route, MCP tool, bilingual download). Live mail/security/data coverage remain gaps; shell appearance shares persistence |
| Media / Feeds / AI | Media images/videos/import/quota; RSS/Atom/WordPress feeds; recipe planner; AI writing/recap/sentiment | Shared UI/REST/MCP slices; real storage/source/automation and current browser/live evidence vary by feature |
| Tasks / Agency / Sharing / Integrations | Task workflows, Agency overview/clients/export/switching, review/bio links, webhooks, scoped REST/OAuth connectors | Shared services exist; credential-specific capabilities and remaining confirmation differences must remain explicit |
| Root | Owned settings, diagnostics/stored health, users/workspaces/plans/audit/errors, registration, installation transfer, connection refresh/disconnect and recovery | Private UI/HTTP/installation MCP includes workspace create/rename and directory GET; declaration exceptions closed. Workspace create/rename, directory, configuration save and error resolution are services in `src/modules/root/server/` that recheck the actor and own confirmations (mocked evidence). Backups page is read-only; production-scale proof incomplete |

## Scheduling and durable remote effects

Scheduling is chosen **per destination**: application worker or platform-held,
with a post default and Root fallback. Neutral adapter catalogs supply native
support/lead windows; Facebook owns Meta behavior. Supported holds become
`scheduled_remote`; unsupported/too-soon/too-far choices stay pending for the app
and return explicit deferral reasons. Comments wait for positive publication.
Queue honors these choices; mix/recycle hand-off follows each automation run.
Reschedule/cancel act on held copies before local changes and retain uncertain
outcomes. Source and mocked tests are recorded in
[PARITY_PUBLISHING_INBOX.md](PARITY_PUBLISHING_INBOX.md); migration
`20261031100000_rebuild_destination_schedule_mode` is pinned, but this review
establishes no database application or live hold/cancel/reschedule proof.

Publication, first-comment and deletion journals retain intent/receipts separately
from local projection. Unknown/submitted outcomes remain held; status reconciliation
uses positive matching identity, never a failed lookup as proof of absence.
Rejected-only comment retry is separately confirmed. Native formats have source
integration and proof/recovery paths; default-off/private capability and mocked
evidence do not establish live delivery. See FACEBOOK_NATIVE_FORMATS.md,
PUBLICATION_RECOVERY.md, FIRST_COMMENT_SCHEDULING.md and INBOX_WRITE_RECOVERY.md.
Preserve the unresolved photo-canary ledger/Page lock in FACEBOOK_LIVE_MEDIA_CANARY.md.

## WordPress recipes and AI

[FEEDS.md](FEEDS.md) documents the recipe source: read-only WordPress MariaDB,
Root-controlled field mapping, caption/image/recipe metadata, guarded image fetch
and WebP-to-JPEG conversion, canonical recipe first comment, configurable local
slots/timezone/horizon/cooldown and distinct allocation. A per-slot ledger holds
uncertain outcomes; ordinary Publishing services create scheduled posts and apply
approval/scope rules. UI, REST and six recipe MCP tools share the service,
including retry.
Defaults remain disabled/new-source paused, but the configured production source
is active. RELEASE_GATES_PLAN records read-only MariaDB checks, image/JPEG storage,
80 planned posts across 10 Pages and the first 07:00 Europe/Paris batch: 10/10
publications and 10/10 first comments, with one Page checked in the owner's browser.
The owner's current task report additionally records the first day's 11:00 batch
as 10/10 with comments and the full day (07:00, 11:00, 15:00, 17:00) as 40/40
publications with 40/40 first comments; this worker did not probe production. The owner removed
the article link from comments; `2e23223a` records a backed-up/audited update of
80 scheduled comments and preserves links on truncation only if the template
contains `{link}`. The original link-preview observation is historical.

`d68fc5c1` adds date/ID ordering, failed-slot retry with uncertain-slot reconciliation,
pause-and-cancel via Publishing, cached pool-health estimates and recipe worker
summaries. These follow-ups have fake/unit evidence, not live recovery proof.
Round 6 (`6d3347fb`) closes the earlier refusal-starvation and time-matching
gaps at unit level: refused cancels rotate behind untouched work, and
reconciliation uses the ledger's stored post id, including cancelled drafts.
Missing/unreadable identity stays uncertain; claims without a stored id require
manual reconciliation. This is not live recovery proof. `e43d16d2`/`6c2b7a6f` add
recipe origin badges/filters in Posts and Calendar, a Feeds sidebar link and a
bilingual status card (next times, published today, failed/uncertain, supply).
Labels/visibility bounds are Root settings; unit/render evidence does not prove
Feeds in browser round 2, whose database lacked the recipe table. The pinned
WordPress migration and lockfile exist; exact migration receipts, export/erasure,
full transport scope and crash recovery remain separate verification work.

AI adapters for **OpenAI, Gemini and Anthropic** are selected by `ai.provider`,
with provider-specific Root credentials/models/endpoints. The release log records
successful OpenAI/Gemini tests and composer suggestion generation; Anthropic
returned insufficient account credit. This is limited provider evidence, not
verification of every prompt, report recap or sentiment job.

## Facebook collection and evidence boundaries

[FACEBOOK_DATA_COVERAGE.md](FACEBOOK_DATA_COVERAGE.md) records resumable Page post
history, independent per-metric failures, reaction counts, Ads hierarchy/action
breakdowns and configurable extra collection. History cursors now have a dedicated
tenant/target-bound table and pinned migration
`20261031120000_rebuild_facebook_sync_cursors`; RELEASE_GATES_PLAN records
production application with backup, while recent-table export/erasure and purge
concurrency still need their own PostgreSQL evidence. Shared `sync.cursor.*` job progress remains a separate
configuration/state design gap.

The initial three-post/twelve-month result is one Page, not exhaustive history
proof. Later live Graph v26.0 evidence in RELEASE_GATES_PLAN verifies
`post_media_view`, `post_total_media_view_unique`, `post_reactions_by_type_total`,
`post_clicks`, `post_clicks_by_type`; `post_impressions`,
`post_impressions_unique`, `post_engaged_users` are invalid in that probe.
`63207a7c`/`954e80cb` correct post-insights time-window paging rather than cursor
continuation; the post-deploy probe reports no failures, views 3, unique 3 and
one like. The reactions summary edge returned 0 against insights' 1; lag is only
a hypothesis. Eligibility and persisted Root overrides still need scope-specific
checks. Conversation attachment/participant metadata, video/Reel/Story collection
and complete readable metric presentation remain incomplete.

## Worker reliability, data control and read performance

`e0584777` moves Facebook Inbox fetches outside workspace transactions/resource
locks. `d511e39c` extends fetch-then-write to Page analytics/history and Ads;
write-time binding/access/purge checks remain, with stale bindings refused.
The worker stops claims on signals, requests safe item stops, drains within
`sync.workerShutdownGraceMs`, then aborts/releases abandoned leases, polling with
`sync.workerDrainPollMs`. Mocked tests cover these paths; production stop duration,
systemd timeout compatibility and real contention/recovery remain unmeasured here.

Data-control rounds (`4b13204b`, `83b26ba9`) inventory every recent migration table:
tenant catalog rows plus explicit legacy OAuth-code/channel-profile ownership,
account appearance/safe credential metadata, and retained installation/outbox/
purge recovery state. Root user deletion and unverified-registration deletion
now call supplementary cleanup transactionally. `exportAccountData` is exposed
(`46c6bdae`) through session-only `GET /api/settings/account/export`, installed MCP
tool `export_account_data` and a bilingual Account download, with explicit partial
profile/appearance/safe-metadata coverage and refusal of bearer credentials. It is
not the owner ZIP and is covered by mocked/DOM tests only.
`20261031150000_rebuild_supplementary_purge_gates` adds OAuthCode/profile INSERT/
UPDATE guards, but rehearsal pinning and real PostgreSQL concurrency proof remain
open. See `src/server/data-control/README.md`; optional database tests skipped in
the lane report. No complete export/erasure claim follows from catalog coverage.

`245683ce` adds `20261031160000_rebuild_read_path_indexes` in root
`prisma/migrations/`: three workspace/order Posts indexes and a target/time/metric
Page-insights index. Analytics reuses exact-scope initial reads and request-scoped
limits; Publishing reuses per-provider adapters within a read; Home overlaps
independent cards/channel history reads and caches host promises per request.
Authorization/resource checks and isolated card failures remain. Source/query
shape tests are evidence; no target application receipt, query plan, timing or
production speedup is recorded.

## History, public site, health and error recorder (2026-10-22)

Source-level; mocked service/route/MCP tests only, no browser, PostgreSQL or production run.

- `src/modules/history/` is a Settings feature (`settings/history`, declared through the Settings manifest like Integrations): owner/admin read-only activity and email-log readers behind one service (`server/history.ts`), session REST (`/api/settings/history/{activity,email}`) and MCP (`list_workspace_activity`, `list_workspace_email_log`). Root keys `history.*`.
- Public site (`ui/public-pages.tsx`, thin `src/app/{help,pricing,status,changelog,privacy-policy,terms,data-deletion}` routes): text is Root-editable (`public.content`, `public.operator`, `public.siteEnabled`), EN/FR, rendered only as paragraphs, lists and safe links. Help, pricing, status and changelog 404 until `public.siteEnabled`; the legal pages are always public.
- Root changelog (`server/changelog.ts`, `/root/changelog`, `/api/root/changelog*`, Root MCP `*_root_changelog_*`): installation owner only, exact confirmations, transactional audit.
- `GET /api/health` (`server/health.ts`): the database decides the verdict, worker state is information.
- `src/server/errors/`: self-hosted recorder feeding `error_events` (Next `onRequestError`, error boundary, `window` listeners via `/api/errors`), scrubbed and grouped, bounded by Root keys `errors.*`. Operator follow-up below adds worker-side recording, `system_alerts` and uptime writers; runtime evidence and residual delivery parity remain open.

## Design v2 B2/B3: Create and Content (2026-10-22, source only)

Publishing's customer routes are now `/create` and `/content/*` (see AGENT_HANDOFF "Design v2 B2 and B3" for the route table, files, new Root keys `publishing.contentCopy` and `publishing.contentPolicy`, and open items). Ownership is unchanged: the screens live in `src/modules/publishing/ui/**` (plus media and feeds screens in their own modules) and call the same services, server actions, REST routes and MCP tools. Two read changes are shared by UI, REST and MCP through `publishingPostReadQuery`: comma-separated channel lists and a single `postId`. `src/app/content/**` and `src/app/create/**` are thin re-exports; the 308 redirects are declared in the publishing manifest. Nothing here is browser- or provider-verified.

## Calendar extras install (2026-10-22)

Key dates, seasons, personal calendar subscriptions, chart notes and holidays/trends are a Publishing feature in `src/modules/calendar-extras/` (`INTEGRATION.md` there lists the owned files). Installed at source: its two config entries plus `calendarExtras.refresh`, `calendarExtras.holidaysSchedule` and `calendarExtras.trendsSchedule` (spread in `installed-config.ts`; schema version not bumped here), fifteen MCP tools (`installed-mcp.ts`; MCP_PARITY rows), thin pages `/publishing/calendar/{dates,seasons,feeds,trends}` and `/analytics/notes`, API routes `/api/key-dates`, `/api/seasons`, `/api/calendar-feeds`, `/api/chart-notes`, `/api/calendar/trends` (+ `[id]`) and the bearer ICS read `/api/calendar-feed/[token]`.

- **Board marks:** `CalendarScreen` loads key dates for the visible range through `loadBoardMilestones` (same scoped service, follows pages, refuses incomplete sets) and the board shows them in month, week and phone agenda. Sidebar links to the four calendar screens come from `calendarExtrasLinks` with Root-managed labels; Analytics links to Chart notes.
- **Chart notes:** `loadChartAnnotations` feeds `NotesTimeSeriesChart` on the Analytics overview metric cards and the Explorer detail chart; a refusal or over-limit set leaves charts unmarked.
- **Queue seasons:** `allocateQueueTime` and the content-mix planner read the workspace's overlapping `seasonal_modes` inside their transaction (`queueSeasons`) and pass a per-day `adjustDay` (pause/shift/fewer/more) to `nextAvailableSlot`. Only new queue times are shaped; scheduled posts never move.
- **Refresh jobs:** Publishing-declared `calendarHolidays` and `calendarTrends` (worker branch in `scripts/worker.ts`, code in `server/refresh.ts`) fetch Nager.Date holidays and Google Trends RSS for audience countries through the shared SSRF-guarded `guardedFetch`. URLs, allowed hosts, batch sizes, ages, size/time limits and the master switch are Root-managed.
- **Evidence:** mocked unit/DOM tests (`tests/calendar-extras*.test.ts`, parity 22/22, config validation). No PostgreSQL run of the retained-table SQL, no live Nager/Google fetch, no browser/theme/phone check, no real calendar client, no authenticated MCP client run. Data-control catalog rows for the retained tables still need integration-owner review.

## Verification and continuation

[BROWSER_MATRIX_2026-10-21.md](BROWSER_MATRIX_2026-10-21.md) records real Chromium
against a local production build and synthetic preview database. Round 1 executed
992/992 cells: 41 customer, 16 Root and five public routes across four themes,
light/dark and desktop/phone. Shared border-box, sidebar contrast and hidden-chart
table fixes cleared overflow; 176 findings remained, including media 404s, Home/
calendar contrast and tokenless join requests. This was not a clean pass.
`4cccd55f` addresses Home/calendar contrast; round 2 still finds calendar cases.

Round 2 covers dynamic pages (160 cells), session states (176), not-found (128),
empty workspaces (656), system mode on 22 representative pages (768), keyboard
walks (656 customer + 672 other cells), and injected failures (640). System-mode
comparison/live switching and keyboard walks passed their scoped checks; 121
failure probes retained input/dialogs and showed feedback. Open findings include
soft/unbranded English-only 404/error pages, misleading two-step failures, raw
server errors, lost input on queue/Root activity failure, calendar contrast and
join/share-media 404s. `36946d9e` subsequently adds missing-image fallback and
saved-view expired-session feedback with unit tests, without a browser rerun.

Round 3 adds Firefox and WebKit (the Safari engine, not Safari) extended matrices
on vivid and warm (496 cells each; no overflow, accessible-name or theme failures;
WebKit shows 16 hydration warnings from `root-time.ts` and Sharing `LinksManager`
date formatting), Chromium system mode on every page (992 cells, no mismatch) and a
database-outage check: the root layout threw and every page answered Next's
unthemed English 500, which the shared `ErrorState` fixed. Round 4 migrated the
preview database (so Feeds renders), verified a page-level throw boundary (16 cells
per engine, 0 findings; retry recovery in Firefox only) and ran the dynamic,
empty, not-found and failure parts in Firefox and WebKit, reproducing the module
findings. `error.tsx` (retry re-requests the server) and `global-error.tsx` (layout
failure; bilingual bootstrap catalog) were committed then; `not-found.tsx` was not
(added in round 8, below), and unknown detail ids still answered HTTP 200. `46c6bdae` fixes queue cancel, Root activity, two-step wording, tokenless
join, verify-email/recovery text and calendar contrast at source (unit tests, no
rerun). Remaining: raw server text on several module forms, boundary above the
shell, keyboard/system-mode in Firefox/WebKit, all four themes there, real Safari,
screen readers, long content, client-render throws and confirmed provider writes.

Round 5 (Chromium only, local production build of `46c6bdae`, synthetic database
that gained Feeds recipe rows): full matrix 992/992 cells over 62 routes including
the Ads pages and `/publishing/feeds` (**162 findings**, none from Ads or Feeds), a
72-cell fixes check (no broken-image icon on Posts, Queue, Approvals, Calendar; 10
findings) and an unknown-route check (64/64, HTTP 404, 0 findings). Remaining causes:
seeded media with no stored file (80), tokenless `/join` preview requests and 429s
(addressed at source in round 6, below), the warm-light calendar "View post" button at
4.35:1 (published-card opacity `.88` in `calendar.module.css`; seven of eight
theme/mode combinations pass) and the saved-view save after the session cookie is
removed, which still said "check its name" (8/8 desktop cells). Not proven: Firefox,
WebKit, keyboard/system/dynamic/empty/failure parts, Ads create/edit flows driven in
a browser, recipe card visual inspection. `not-found.tsx` remains absent from
`src/app/`.

Round 6 (`6d3347fb`; source and unit evidence, **no browser rerun**):

- Ads: Facebook-owned `ads-copy.ts` holds the EN/FR action labels, name-validation
  text and confirmation templates; Root key `meta.adsCopy` lets the operator edit
  them with placeholders validated (every token exactly once). Ads module
  `copy.ts` gains matching customer strings. At round 6 `ad.create` still lacked its
  ledger CHECK migration (added in round 8, below) and the live `ads_management` grant.
- Join: `/api/auth/invitations/preview` answers `{ invitation: null }` (HTTP 200)
  for a missing or unknown token, and `join-form.tsx` shows the "link needed"
  state from that body instead of a 404. The form still makes one request, so a 429
  from the per-token rate limit is not ruled out. Tests `invitation-http`, `join-form`.
- Queue: `cancelScheduledPostAction` no longer routes failures through the shared
  runner's redirect; it throws so `CancelScheduleForm` keeps filters, reschedule
  input and its localized inline notice (`post-cancel-action.test.ts`).
- Recipe recovery (`wordpress-planner`, `-recovery`, `-store`): uncertain-slot
  reconciliation resolves the post by the **ledger's stored post id**, not by
  channel and scheduled time, so a manual post at the same slot is never adopted
  and a cancelled post (time cleared) is still found; unknown identity keeps the
  slot uncertain; settlement is conditional on the expected post id. A refused
  pause-cancel is rotated behind untouched work by a timestamp-only write
  (`deferCancellation`; `plannedUpcoming` orders by least recent attempt), so a
  refused first batch no longer starves later posts and `remaining` is no longer
  forced false.
- New tests: `feeds-recipe-recovery-verification`, `publishing-scheduling-
  verification` (mixed application/platform holds, stale due-worker claim, first-
  comment failure after confirmed publication, remote reschedule timeout, contributor
  approval), `facebook-ads-copy`, `browser-matrix-round5`. All use fakes or mocked
  ports; no PostgreSQL, live Facebook or production run.

Round 7 (`5e7749c3`; source and unit evidence with fakes, **no browser rerun**;
schema 116):

- Publishing: the saved-view save without a session says the session ended
  (`saved_sessionEnded`); calendar published posts use a dashed edge and quieter fill
  rather than opacity (the warm-light "View post" contrast finding); the collaboration
  post screen calls `notFound()` for an unknown post.
- Facebook (`src/platforms/facebook/`): `FacebookAdsValidationError` gives validation
  failures a stable `issueCode`; `ads-copy.ts` holds the EN/FR validation, ownership,
  unconfirmed-creation and transport messages used by `ads-ops`. Post-history
  collection adds `post_clicks` and video metrics (only for positively identified
  video posts), keeps insight, summary and per-type reaction observations separate
  with `reactionProvenance` and a conflict flag, and treats lifetime insight links as
  snapshots rather than more pages (`data-collection.ts`, `post-history.ts`).
- Reports: Published posts content log, daily UTC counts and currently failed
  destinations through the shared confirmed generator (Root
  `analytics.reports.publicationDetails`).

Round 8 (`960831df`; source and unit evidence, **no browser, PostgreSQL or live
provider run**; schema 117):

- Themed 404: `src/app/not-found.tsx` (`ErrorState kind="not-found"`, bilingual, link
  home) is committed; `not-found-page` is a jsdom render test. HTTP statuses for
  unknown share/bio/Root ids and a boundary inside the shell remain open.
- Ads: migration `20261031180000_rebuild_ads_ad_creation` allows `ad.create` in the
  operation ledger; the owner/integrator record it as applied in production
  (unobserved here). Ads copy is Root-managed per request:
  `PlatformAdsHost.configuredOperations(locale)` is resolved by `platformAds(provider,
  locale)` into a request-local host, with `withPlatformAdsLocale` and
  `withAdsErrorBoundary(operation, locale)` carrying the locale (neutral
  `server/platforms/host.ts` and `registry.ts`; no provider branch). At round 8 the Ads UI,
  session REST and MCP entry points did not yet pass customer locale (fixed in
  8d9ccbe7); the cutover rehearsal script and tests do not yet list
  the migration; recovery had not yet gained round 9 locked authority/visibility rechecks and
  still does not repeat the creation-only unrestricted-channel rule (see
  `src/modules/ads/server/README.md`).
- Facebook configuration: shipped Page/post/reaction metric labels merge under saved
  `meta.metricLabels`; default `meta.postHistoryPolicy` metrics gain clicks and video
  metrics. That round's replacement behavior is superseded by round 9 additions/exclusions below.
- Analytics and Inbox: Top posts report content (saved destination text, media
  references, optional image previews, article preview; Root
  `analytics.reports.topPostContent`; `reports/TOP_POST_CONTENT.md`); focus rings,
  labelled focusable table regions, scrollable long channel lists, locale-correct
  "Last synced" and phone layout (`inbox-analytics-ux-polish`).
- Tests (mocked or source-level): `not-found-page`, `ads-ad-create-migration`,
  `ads-ad-create`, `ads-runtime-host`, `facebook-metric-config`,
  `report-top-post-content*`, `inbox-analytics-ux-polish`. The applied-migration claim
  is an owner record, not test evidence.

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

### Rounds 10–12 (`75923335` to `a910d774`; schema 120)

Source and unit/mocked evidence unless stated; no fresh browser, PostgreSQL,
provider or production observation by this documentation lane.

- **Facebook ownership of analytics identity (`806a0ef5`, `6e111754`):** the
  Facebook analytics target now reports the platform id (not the remote Page id)
  to the shared host, which resolves the platform module by that id; before this,
  shared post explorer and insights found no host and showed no post performance.
  `facebook/post-performance.ts` also reads synced insights for app-published posts.
  The shared Analytics code gained no provider branch. Production effect is unobserved here.
- **Public origin (`c0e5386a`):** Facebook OAuth callback validation, redirects and
  the secure state cookie derive from the Root public origin (see "Configuration and
  public origin"), not `request.url`, which is the internal listener behind the proxy.
  Files: `app/api/connections/[platform]/callback/route.ts`, `platforms/facebook/connection.ts`.
  The owner's reconnect retry is pending; no successful post-fix connection is recorded.
- **Page metrics (round 10):** `platforms/facebook/page-insights.ts` resolves the
  configured Page metric list (additions and explicit exclusions) before constructing
  the transport. The array-versus-policy registration gap noted for round 9 stays on
  the ledger until `module.ts`, `runtime.ts`, `adset.ts` and `ads-ops` are shown to use it.
- **Reports and Analytics:** Published posts adds weekday, UTC-hour and recorded-attempt
  distributions (typed fields in `analytics.reports.publicationDetails`; saved-data
  counts, not engagement or provider proof). The Analytics post explorer drops
  identifier-like metrics and uses local dates.
- **Feeds:** reviewer notices on held feed posts (`feeds.approvalNotificationsEnabled`),
  WordPress reuse policy and supply view (`feeds.wordpress.reuseEnabled`,
  `feeds.wordpress.reuseCooldownDays`), and caption text handling in
  `modules/feeds/wordpress/text.ts` (entity decoding, C0 controls mapped to U+202F or
  dropped) plus the audited repair service `caption-repair.ts`. See [FEEDS.md](FEEDS.md).
- **Other:** media rename REST, Publishing/Settings/Ads/Home/Root polish, and scoped
  MCP key tests (`mcp-scope-feeds-service`, `mcp-scope-host-matrix`, mocked ports).
- **Schema:** 119 added `feeds.approvalNotificationsEnabled`; 120 added the two reuse
  keys. This lane edits no registry.
- **Browser:** round 6's lane hung. Only the matrix harness and a date/time focus ring
  (`d24fcd40`, `tokens.css`) are committed; there is no round 6 result, so rounds 6–12
  UI changes remain without a browser run.

Historical 328/328 synthetic checks and the production Chrome sweep remain dated
evidence. No browser round covers every later merge, and no declaration guard
replaces actual MCP/provider verification. [MCP_PARITY.md](MCP_PARITY.md) records
the structural guard and closed Root/draft inventory gaps alongside remaining
behavioral gaps. [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) retains
full scope; [DELIVERY_PLAN.md](DELIVERY_PLAN.md) orders follow-up. Full rebuild
completion remains unproven; the deployed `ffdb1cdf` statement has not been
independently re-observed by this documentation lane.

## Legacy shell lane q-35 — 2026-10-22

Source update: installable app shell (dynamic public branding/manifest, offline-only service worker, icons and bilingual Appearance controls), global cross-site mutation middleware and neutral likes-versus-followers growth identity are implemented in the working tree. See [PLATFORM_SHELL_Q35.md](PLATFORM_SHELL_Q35.md) for exact evidence and remaining checks. New Root key: `settings.webApp`; integrator must bump CONFIG_SCHEMA_VERSION (unchanged here). Existing `meta.metricLabels` and `analytics.overviewCopy` gain copy entries with saved-catalog compatibility. No new database table, migration, background job or provider write. Browser service workers are local browser infrastructure; existing audience synchronization stays under shared worker leases/run history. No server, deploy, commit, push or production action was authorized in this lane. These source changes do not close real browser/provider/release gates or unrelated historical gaps. Facebook Groups are dropped by owner decision 2026-10-22; historical missing-feature statements above do not authorize Groups work.

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

## Root administration naming lane (2026-10-22)

Root administration moved to `src/modules/root/server/admin/`; consumers and regression test names follow the new paths. Root settings are renamed to `root.admin.*`, schema 132. The idempotent `20261022200000_root_admin_settings` source (now squashed into the baseline) preserves existing canonical values. The one-time configuration importer is removed; the read-only historical migration expectations were removed with it in lane 47. Facebook live probes resolve configuration and credential decoding through the Facebook module. Stored auth hash and cookie formats remain unchanged. No server, provider call, deployment or push was run.

Root naming follow-up: live probes merge Root configuration in the Facebook module and explicitly clear bundled app secrets when current signing material is absent. Automated regression tests cover this boundary and saved-setting SQL collisions/idempotence (SQLite only); no provider or PostgreSQL proof is claimed.

## Lane 45 — sweep gaps G1, G3, G5, G6, G7 (2026-10-22, source only, schema 134)

- **Graph usage (G1):** Facebook-owned recorder (`platforms/facebook/graph-usage.ts`) feeds `graph_usage`; Root reads it via the neutral `PlatformHost.apiUsage` hook (`modules/root/server/api-usage.ts`, `/root/platforms/<id>`, `GET /api/root/api-usage`, MCP `get_root_api_usage`).
- **Credential connections (G3):** `PlatformHost.connection.credentials` (module-worded form and verification) plus the shared `connectWithCredentials` service in Settings (UI dialog, `/api/oauth/connections/[platform]/credentials`, MCP `get_connection_credential_form`/`connect_with_credentials`). Bluesky (app password) and Telegram (bot token + channel) are installed, off by default, text-only.
- **Alt text (G5):** `AiPort` takes an optional image; `suggestAltText` (UI button, `POST /api/ai/alt-text`, MCP `suggest_image_alt_text`).
- **Mail API (G6):** `mail.provider=api` with `mail.apiEndpoint`/`mail.apiKey` (`server/mail/api-transport.ts`).
- **Media retention (G7):** leased job `mediaRetention`, policy `media.retentionPolicy`.
- Decisions recorded: G2 legacy `api_tokens` retired, G4 text backgrounds dropped (2026-10-22). Evidence is unit/mocked only; see `LEGACY_SWEEP_2026-10-21.md` section 0.4 for live gates.


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

## Design v2 B4: Inbox (2026-10-22, source only)

The Inbox is one screen with a Filter button, quick-filter row, three panes from 1280 px (list, thread, collapsible details) and two pages below 1024 px; Rules is its second tab at `/inbox/rules` (`/inbox/moderation` redirects, 308). Ownership, services, REST and MCP are unchanged. Details in `src/modules/inbox/ui/IMPLEMENTATION.md` and AGENT_HANDOFF "Design v2 B4". Nothing here is browser-verified.
