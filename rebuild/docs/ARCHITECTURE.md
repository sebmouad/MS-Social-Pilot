# MS Social Pilot architecture

Updated 2026-10-21 against local HEAD `46c6bdae`; reviewed `git log 1240a9ce..HEAD`.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) remains the binding target,
unchanged. This document describes implementation and gaps; deployment, source,
automated tests, browser checks and live-provider evidence are separate claims.
Older batch details remain in the linked feature documents and Git history.

## Production status

The owner cut over on **2026-10-20 at 22:09 CEST**. The rebuild serves
`https://social.newsgeet.com`; `social-pilot-rebuild` and
`social-pilot-rebuild-worker` were recorded active/enabled, and legacy web/worker
inactive/disabled. Legacy files remain for rollback. Releases use
`rebuild/scripts/prod-deploy.sh`; legacy `socialpilot-deploy` refuses while the
rebuild is enabled except for status or an explicit legacy override.

These are recorded production outcomes in [RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-cutover--2026-10-20-2209-cest),
not fresh probes by this documentation worker. That log records 34 applied
migrations, backup, health checks, ownership repair, owner sign-in confirmation,
legacy configuration import and later AI/browser checks. Cutover happened; full
contract completion is still unproven. The deployed release is recorded by the
integrator as `46c6bdae`; this review did not observe it, and application of the
newest migrations must still be checked before claiming source live. The log also
records the 2026-10-21 post-cutover rollback drill (**PASS**: backup restored to a
scratch database, legacy and the installed rebuild started on spare ports; live
services unchanged) and the first full recipe day (40/40 publications with 40/40
first comments). The drill proves a restorable backup and startable rollback
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

Facebook is the only installed customer platform. Instagram/other legacy connector
code does not establish usable rebuild support. Shared services consume adapter
capabilities, format catalogs and normalized measures, never provider branches.
Encapsulation is not complete: shared legacy storage reads in `src/server/data.ts`
and product account helpers in `src/server/account-settings.ts` still need coordinated
moves. Registration of a module does not prove its workflows or health.

## Configuration and public origin

`src/lib/config/registry.ts` aggregates module/platform declarations and
`src/lib/config/shared-config.ts`. Local HEAD has schema version **114**. Runtime
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
| Ads | Account/performance/directory/compare/export, hierarchy charts, creation options, durable confirmed management: campaign, ad set, paused ad and stored-image creative creation, status/budget/rename/assign/delete, missing-grant reconnect notice | Session REST/MCP plus key REST v1; management is off by default and awaits a live `ads_management` grant. `ad.create` needs a ledger CHECK migration that is absent at HEAD (writes fail closed). Mocked/fixture evidence only; see ADS_PARITY.md |
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
Refused cancels can starve later batches; reconciliation can accept a hand-made
post at the same time or miss one returned to draft. `e43d16d2`/`6c2b7a6f` add
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
failure; bilingual bootstrap catalog) are committed; **`not-found.tsx` is not**, so
unknown routes still show Next's default page, and unknown detail ids still answer
HTTP 200. `46c6bdae` fixes queue cancel, Root activity, two-step wording, tokenless
join, verify-email/recovery text and calendar contrast at source (unit tests, no
rerun). Remaining: raw server text on several module forms, boundary above the
shell, keyboard/system-mode in Firefox/WebKit, all four themes there, real Safari,
screen readers, long content, client-render throws and confirmed provider writes.

Historical 328/328 synthetic checks and the production Chrome sweep remain dated
evidence. No browser round covers every later merge, and no declaration guard
replaces actual MCP/provider verification. [MCP_PARITY.md](MCP_PARITY.md) records
the structural guard and closed Root/draft inventory gaps alongside remaining
behavioral gaps. [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) retains
full scope; [DELIVERY_PLAN.md](DELIVERY_PLAN.md) orders follow-up. Full rebuild
completion and the exact current production revision remain unproven.
