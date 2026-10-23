# Legacy capability parity gate

Updated 2026-10-22 against local HEAD `25c3ea53` (status cells and sweep-reconcile rows; see the final section and LEGACY_SWEEP_2026-10-21.md section 0). **Full parity remains partial.**
The owner cut over to the rebuild on 2026-10-20. This inventory does not claim
that every capability or release gate passed before that switch. The binding
target remains ARCHITECTURE_CONTRACT.md. Preserve useful legacy capabilities
even when navigation, URLs or provider availability changes.

Legacy sources below retain the inventory scope. Partial distinguishes source
from missing workflows and missing database/browser/provider evidence. Deployment,
a manifest, saved setting or unit test is not complete workflow proof. See
[MCP_PARITY.md](MCP_PARITY.md) for interface and credential-specific differences.

| Priority | Legacy capability and source | Rebuild state | Required proof |
| --- | --- | --- | --- |
| P0 | Eleven network connectors and publishing destinations in `src/lib/networks/index.ts` and `src/lib/networks/connect.ts` | Partial at HEAD 99c41554: Facebook remains the only installed customer platform. Instagram is now an installed platform module at 25c3ea53 (disabled by default; image/video/carousel/Reel/Story publishing, first comment, comments, account+media insights, connection, analytics job and registered publication recovery at fixture level as of the 2026-10-22 live-ready lane, plus background comment sync and signed local-media delivery at source/unit scope as of the 2026-10-23 inbox-sync + media batch — see INSTAGRAM_LIVE_RUN.md; no live Graph run, no media deletion, native scheduling, DMs, webhooks or ads). YouTube and TikTok are installed platform modules (2026-10-22, disabled by default; fixture evidence with stubbed `fetch`, no live Google/TikTok run): OAuth connection with refresh-token renewal, channel/account discovery, video publishing, status reconciliation, YouTube remote delete; no inbox, analytics, first comment or native scheduling. The other seven legacy destinations (Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest, Telegram) remain missing; helpers are not workflow support. | Adapter-level connection, discovery, publishing/status/delete, analytics, inbox, and ads where provider supports them; scoped UI/API/MCP and live tests. |
| P0 | Facebook feed, photo, carousel, video, Reel, Story and native scheduling (Groups dropped: Meta removed the Groups API on 2024-04-22; owner decision 2026-10-22) in `src/lib/facebook/publish.ts` | Partial at HEAD 99c41554: Page formats, native scheduling and recovery source remain as previously recorded. Settings channel groups are organizational only. Format-specific live create/status/delete proof remains incomplete. | Provider fixture and live create/status/delete tests for each supported format; visible choices limited to available capabilities. |
| P0 | Analytics views, comparisons, post explorer, demographics, network analysis, pinned metrics and coverage in `src/app/(app)/analytics/AnalyticsScreen.tsx` and `src/lib/analytics-views.ts` | Partial: catalog/details/explorer, posts, comparisons, pins, goals, audience history/CSV and ad-object analysis have UI/REST/MCP. Shared charts now consume actual previous-period points. Facebook post history/reactions/hierarchy collection exists; live Graph v26.0 probe verifies five current post metrics and refuses three older ones (RELEASE_GATES_PLAN); exhaustive history/collection and dynamic labels remain incomplete. Root-editable EN/FR catalogs and validated-default fallback are integrated.  HEAD 99c41554 separates channel and paid reporting and fixes unknown stock totals/latest resource-day aggregation, with synthetic numbers tests; provider coverage and PostgreSQL proof remain partial. | Shared metric catalog feeding full UI, export, and MCP with date/channel/ad-account scope, comparison, availability, and refresh evidence. |
| P0 | Reports and CSV exports in `src/app/(app)/reports/page.tsx`, `src/lib/reports.ts`, and `src/lib/analytics-export.ts` | Partial: Round 10 adds stored publication counts by ISO weekday and hour (UTC), plus recorded-attempt distributions, through the existing confirmed report UI download/REST/MCP generator. The existing Root analytics.reports.publicationDetails setting now owns three switches and the final attempt bucket ceiling; the report-document catalog supplies EN/FR labels and counter/timing limitations. Counts are independent of clipped content logs, include only current published destinations in the selected channel/period, and do not claim recommended times or historical retry outcomes. Local mocked/query-shape/render/host tests only; PostgreSQL execution and actual browser/client downloads remain open. Round-8 Destinations adds a scoped per-link lifetime click inventory, retained period clicks per link and daily UTC retained click counts through the existing confirmed report UI download/REST/MCP generator. Root `analytics.reports.linkDetails` bounds inventory and daily rows independently; EN/FR artifacts disclose publication-cohort scope, excluded ambiguous legacy links, retention gaps and clipping. No visitor metadata or destination URLs are projected. Local mocked/query-shape/workflow tests and TypeScript only; PostgreSQL, browser downloads and real-client proof remain open. round-7 Top posts restores destination-specific saved text, ordered image/video references with Root-switchable image previews, and saved article link/title/description through the existing confirmed UI download, REST and MCP report workflow. Root `analytics.reports.topPostContent` owns ranking/content/media/URL bounds, image previews and the authenticated media path template; EN/FR artifacts disclose current saved content, expiry, workspace access and clipping. Targeted mocked/render tests and TypeScript verification are local only; PostgreSQL, actual browser/download and real-client/provider proof remain open. Existing templates/schedules/runs, CSV/JSON/printable artifacts, response time/business hours, top posts, goals, destinations/link counts and AI recap exist. Downloads/UI were refined in 0589ddd0. Round-6 Published posts adds three stored-data report views through the existing confirmed UI/REST/MCP generator: a destination-specific content log with attempt counts, daily UTC publication counts independent of log limits, and currently failed destinations last updated in the period (explicitly not historical failure attempts). EN/FR catalogs disclose excerpts, current-state semantics and clipping; Root `analytics.reports.publicationDetails` controls each log ceiling and excerpt length. Local verification: TypeScript 0 errors; 155 targeted tests across 10 files passed, including scoped SQL shapes, bilingual artifacts, row/byte limits and confirmed MCP generation/audit. PostgreSQL, browser, real-client and production evidence remain open. Response reports now include first direct replies to stored root comments, slowest calendar/business-hours first response, and business-hours resolution through the same report generator used by UI downloads, REST and MCP. Round-2 response reports retain pre-period conversation context, reconstruct recorded resolution/reopening cycles, and disclose stored-history coverage and incomplete boundary exclusions in bilingual artifacts through the existing shared generator. Round-3 reports separate comment/conversation answer shares, response and resolution durations, and member business-hours first-response medians through the shared generator. Round-5 member outcomes add slowest first replies, answered-wait resolution counts and calendar/business-hours resolution medians, with last-run first-responder attribution through the same report workflow. Per-channel reports retain member attribution and disclose source limits; complete provider history, actual mail delivery, volume and current-browser proof remain open.  Rounds 1–3 (`23b7be84`, `6ef753e4`, `b725c415`) have local arithmetic, bilingual artifact and mocked workflow tests; bounded history and concurrent-read consistency remain limits. | Complete relevant report sections and exports, schedule/template workflows, UI/API/MCP parity and provider-shaped tests. |
| P1 | Composer overrides, queue slots, approvals, labels, custom fields, notes, versions, templates, first-comment retries, and UTM/link preparation in `src/lib/posts.ts` and related API routes | Partial: composer, slots/approvals/templates/labels/fields/notes/version restore, delayed comments and rejected-only retry, best times, mix/recycle, UTM and shortening are integrated. Scheduling modes are per destination. Newest scheduling/restore/comment database/browser/provider checks remain open; unknown remote attempts stay held. | Full end-to-end tests on production-shaped staging, per-target behavior, provider create/status/delete and permission verification, bulk actions, scheduling rules, plus remaining legacy workflows. |
| P1 | Post list filters, saved views, pagination, bulk actions, retry/duplicate, CSV export and public Posts v1 API in `src/app/(app)/posts/page.tsx` and `src/app/api/posts` | Partial at HEAD 99c41554: scoped lists/search/paging/views, bounded synchronous Posts CSV, bulk actions and confirmed v1 create/scheduling exist. Durable background Posts CSV request/status/private download/expiry now exists at source (25c3ea53: UI, REST `/api/publishing/posts/export/jobs`, MCP `posts_export_job`/`posts_export_status`, worker job `postExports`; mocked tests, migration application not observed); workspace ZIP is different. Publishing redesign and thumbnails have source/DOM evidence, not a current complete browser pass. | Full list/action/API parity with workspace authorization and large-data pagination tests. |
| P1 | Publishing calendar navigation and month coverage in `src/app/(app)/calendar` | Partial: Month/Week/phone agenda, workspace-day grouping, previews, saved views and drag/keyboard moves exist. Shared lifecycle supports adapter-held cancel/reschedule. Round 13 re-offers previously deferred platform destinations after a time change through the same UI/REST/MCP lifecycle, retaining per-destination choices, current authorization, expected-time race protection and uncertain-outcome recovery; Root withdrawal prevents new holds. Targeted mocked regression evidence only (see modules/publishing/server/RESCHEDULE_HANDOFF.md); database/browser/provider checks remain open. Calendar editing, queue-slot presentation, high-volume months and actual drag/remote-schedule browser/provider evidence remain open. | Browser and database tests with records on timezone and month boundaries, high-volume month, permissions, drag-and-drop E2E, and edit workflows. |
| P1 | Inbox assignment, private notes, saved replies, moderation rules, comment deletion and full discovery in `src/lib/inbox.ts` and `src/app/api/inbox` | Partial: scoped conversations/comments/nested replies/reviews, sync/actions/recovery, assignment/notes/replies and moderation rules exist. New quick filters, stored contact/sentiment details, bulk actions, replies drawer and shortcuts have mocked/DOM tests. Contact REST and bulk UI/REST/MCP exist (`f5c21c96`). Facebook Inbox reads now fetch before the locked write phase (`e0584777`); write-time scope/binding checks remain. Complete discovery/backfill, attachments/participants and live moderation remain open.  Later Inbox scrolling/media URL recognition and redesign/focus/FR checks are source/DOM evidence, awaiting a current browser rerun. | Multi-user assignment, notes, moderation log/undo, all relevant posts/reviews, and provider/MCP tests. |
| P1 | Image/video media library, import, usage/quota, holder attribution and stream/raw delivery in `src/lib/media.ts` | Partial: modules/media owns images/videos/search/usage/holders/quota, guarded import and delete with UI/REST/MCP. Round 11 adds still-WebP URL import converted to PNG, durable/searchable imported-image names, and first-rename metadata for uploaded/stored images through shared UI/REST/MCP services. Canonical image metadata reuses media rows without double-counting storage; the existing PATCH route is present and mapped. Root media.webpImportPolicy bounds conversion, with EN/FR guidance/errors. TypeScript and 78 focused tests (including parity guard, real WebP conversion, mocked services/HTTP and jsdom) pass locally; PostgreSQL, browser and actual client proof remain open. Older image-delete/orphan-cleanup paths still need metadata cleanup integration. Thumbnails and real video/storage/browser workflows still need completion or proof. Reference/export completeness needs actual-data checks. | Video upload/library, imports, quotas, usage and reference display, secure retrieval/deletion tests. |
| P1 | Connections for Instagram and other networks (Facebook Groups dropped, Meta API removed), token health and lifecycle callbacks in `src/app/(app)/connections/page.tsx` and `src/app/api/facebook` | Partial at HEAD 99c41554: Facebook Page/ad-account discovery, selection, token health and retain/delete services exist; single/batch selection/disconnect UI/REST/MCP now share confirmed services. Non-expiring long-lived tokens and redacted callback diagnostics are fixed in source. Instagram is installed but off by default and unproven live; Meta deauthorize/data-deletion callbacks exist at source (`/api/platforms/facebook/{deauthorize,data-deletion}`, mocked tests; the Meta dashboard still holds legacy URLs); provider lifecycle/revocation proof remains partial. | Channel/ad-account selection, token/grant status, remote lifecycle callbacks, retain/delete semantics and complete provider discovery. |
| P1 | Ads comparison/trends, findings, sorting, export and freshness in `src/app/(app)/ads/page.tsx`, `src/lib/ads-analysis.ts` | Partial at HEAD 99c41554: reporting/management services now include neutral ads_objects inventory so paused objects without delivery can be listed and managed without losing ownership checks. Facebook discovers hierarchy independently of insights; migration 20261101120000_ads_object_inventory is authored. Locale, Root limits and EN/FR audit fixes are integrated; numeric aggregation has synthetic fixture evidence. Owner reports live create/rename/delete verified in Ads Manager; exact levels, cleanup/spend receipts, remaining creative/budget/recovery/MCP, migration rehearsal/application and inventory export/erasure remain open. | Date/account-scoped trends, deltas, findings, CSV, coverage and live sync checks. |
| P0 | Root users, workspaces, plans, registration, connections, errors, worker, backups, privileges and audit console in `src/app/(root)/root` and `src/app/api/root` | Partial: grouped settings/stored health/diagnostics, users/workspaces/plans/privileges/audit/errors/sessions, lifecycle, installation transfer, registration MCP and connection refresh/disconnect-with-delete exist. All 48 private Root REST inventory exceptions are replaced by 51 mapped tools, including workspace create/rename and directory GET (`8f423ec7`); workspace, directory, configuration-save and error-resolution services now own actor checks and confirmations (`46c6bdae`, mocked evidence). Backups page is read-only. Complete operations/configuration and real installation-transfer/production-volume evidence remain open.  At 99c41554 Root error/loading catalogs are registered and current smoke/EN-FR checks exist; a Root configuration search test still times out locally. | Role-guarded operator UI/API for each function, with change audit and isolated production-shaped checks. |
| P0 | Workspace operations settings: approvals, queue rules, hours, links, UTM, spacing, undo, audience, AI voice and moderation in `src/app/(app)/settings/page.tsx` | Partial: timezone/approval, queue/hours/week start, UTM/shortening, undo, spacing, AI voice, negative alerts and best-time mode have consumers and settings UI/API/MCP. Policy persistence does not prove automation outcomes. Audience/client-approval semantics and full copy/configuration coverage remain open. | Versioned, validated workspace configuration with runtime consumers and migration of needed legacy values. |
| P0 | Workspace operations settings: approvals, queue rules, hours, links, UTM, spacing, undo, audience, AI voice and moderation in `src/app/(app)/settings/page.tsx` | Partial: same workspace-operations inventory as above; best-time mode now consumes neutral stored post ranks through composer/queue services and shortening has a publisher consumer and form toggle. Remaining audience/client-approval semantics and runtime evidence are not closed. | Versioned, validated workspace configuration with runtime consumers and migration of needed legacy values. |
| P0 | Invitations, registration, email verification, password recovery and OAuth authorization in `src/app/(auth)`, `src/app/invite`, and `src/app/api/auth` | Partial: invitations, open registration/verification/resend, password recovery and authenticator/passkey services exist. Earlier PostgreSQL/browser/SMTP-capture checks are recorded in WAVE1_VERIFICATION. Session MCP exposes account security actions. OAuth login, complete recovery/seat policy and live mail/security/browser proof remain open. | Complete all account lifecycle capabilities with abuse controls, policy/seat handling, browser/API coverage, and production-shaped recovery/cutover evidence. |
| P1 | Client review/calendar/portal links and public bio pages with tracked clicks in `src/app/share`, `src/app/bio`, and `src/app/(app)/settings/sharing` | Partial: review/calendar/portal links, versioned access/rotation, feedback and public bio have shared UI/HTTP/MCP services and earlier synthetic probes (CLIENT_SHARING.md). Round 12 Sharing lane: title/description edits now require an acknowledged UI save and exact shared-service confirmation through REST/MCP while retaining the address. Public client links project the authorized workspace HTTPS logo under Root sharing.presentationPolicy; the owner list/REST/MCP expose the same safe presentation policy. Advisory approvals/change requests enqueue author-eligible notifications atomically with stored answers using existing bilingual notification copy and email preferences; applied decisions retain Publishing’s existing notices without duplicates, and comments remain in feedback only. Source, mocked service/REST/MCP and EN/FR DOM/render checks only; PostgreSQL transactions, actual email delivery and browser proof remain open. Portal results, publish-anyway, logo editing, client invitation email, throttling and current key-scope/production evidence need completion. | Portal results, publish-anyway, logos/email, cross-process throttling and end-to-end manager-key channel scope remain open; production/proxy proof outstanding. |
| P1 | Agency views, feed ingestion, post templates and tasks in `src/app/(app)/agency`, `feeds`, `templates`, `tasks` | Partial: Agency overview/exports/clients/switching, Tasks/checklists/comments, templates and RSS/Atom/WordPress feeds exist. Overview person credentials are implemented; session Clients/switching do not expand those keys. WordPress recipe automation adds read-only mapping, image conversion, canonical first comment and distinct timezone-slot planning. Defaults remain off/paused for new installations/sources, while production has owner-recorded source/image/planning and first-day 07:00/11:00 batches, each 10/10 with comments. Article links were removed from comments on owner request. Retry/pause-cancel/pool-health and recipe origin badges/status have source/unit evidence; Round 9 exposes rendered feed-entry previews in the bilingual check dialog and queues approval-request notices atomically from the shared UI/REST/MCP/worker ingest service, controlled by Root feeds.approvalNotificationsEnabled; receipt counts mean queued notifications, not email delivery. Local fake-port/jsdom evidence only; Feeds browser/database recovery, actual notice delivery and client proof remain open. | Full CRUD/workflow parity, workspace permissions, provider-side behavior where relevant, and MCP/API parity. |
| P1 | Notifications, webhooks, REST v1 API tokens and OAuth clients in `src/app/(app)/settings/notifications`, `webhooks`, `api` and `src/app/api/v1` | Partial: durable event notifications/sentiment input, queued mail, signed retrying webhooks/test/secrets/history, REST v1 Posts plus Analytics/Ads tool-dispatch routes and Root-gated OAuth connectors exist. Session MCP secret reveal/rotate exists; bearer tools stay secret-free. Actual delivery/OAuth/MCP client and target migration state need verification. | Delivery preferences, retries/redelivery, secret handling, scoped REST/OAuth contracts and audit tests. |
| P1 | Page profiles/groups/labels, media/watermark, custom fields, AI agents, history and owner export screens under `src/app/(app)/settings` | Partial at HEAD 99c41554: channel organization, watermark, fields/notes/history and partial exports exist. AI writing/recap/sentiment plus the Studio module's writing agents (saved briefs, metered suggestions, content-free history; UI/REST/MCP) cover on-demand writing agents; scheduled runs with run history and AI image/video/voice shipped in the Studio module (2026-10-22; source/mocked-test evidence, live provider checks open). Settings/Root/Inbox/Publishing and shared design passes, FR/focus/semantic tests are source/DOM evidence. Themed not-found now exists; soft 404/hydration/error and current full browser evidence remain open. | Working feature screens and shared services, migrated data, permission and visual checks. |
| P2 | Asynchronous owner ZIP export with job status and expiry in `src/app/(app)/settings/export` | Partial: durable asynchronous ZIP request/status/reuse/build/download/expiry/cleanup is implemented with prior local PostgreSQL evidence. All legacy categories/media and production-volume/export-erasure coverage remain unproven. Recent migration-table ownership and exact account appearance/safe-credential hooks are audited; supplementary purge guards remain without database proof/rehearsal integration. Partial account export is exposed (session GET route, `export_account_data` MCP tool, bilingual Account download, `46c6bdae`; mocked/DOM evidence); neither account JSON nor partial workspace JSON is the ZIP. | Large-data async export, durable status, expiry/cleanup and completeness reporting. |
| P0 | Public legal and info pages (`/privacy-policy`, `/terms`, `/help`, `/pricing`, `/changelog`, `/status`) with `operator.*` and `site.public` settings | Missing at 25c3ea53. Only `/data-deletion` (status page for the Meta callback) exists. Meta app review needs a privacy URL. | Public routes in EN/FR, Root-managed operator/site settings, no placeholder content. |
| P0 | Error and alert recording: `error_events`, `system_alerts`, client error reporter `/api/errors`, alert test, uptime days | Missing at 25c3ea53: Root Errors/Backups read legacy rows; nothing writes them. | Server and client recorder through a shared service, Root console, retention, tests. |
| P0 | Unauthenticated readiness probe `/api/health` | Missing at 25c3ea53; deploy and drill scripts use `/sign-in` or the legacy route. | Cheap health route with database check; deploy/drill scripts moved onto it. |
| P1 | Retention pruning job (`housekeeping`) for activity, email, click, AI and error history | Missing at 25c3ea53: `retention.*` keys are `planned`, no pruner. | Worker job consuming the keys, audited counts, tests on a database. |
| P1 | Share-link "publish anyway" auto-approval after a client deadline (`clientDeadlines`) | Missing; `publishAnywayHours` is unused (CLIENT_SHARING.md). | Service-owned deadline job, exact consent, audit, scoped tests. |
| P1 | Scheduled AI agent runs (`aiAgents`), AI image, video (`aiVideos` polling) and voice | Partial (2026-10-22 Studio module): scheduled runs write weekly drafts through the `scheduledAgents` worker job with UI/REST/MCP management, exact confirmations, metering, audit and run history; idea batch 2 adds supervised autopilot tiers (manual/assisted/supervised-auto) with workspace guardrails, actor=tier audit and queue/history provenance. Image/voice/video generation ships with worker polling. Source/mocked-test evidence only; live provider checks and production runs remain open. | Live provider checks and production evidence for scheduled runs, tiered auto-scheduling and media generation. |
| P1 | Caption tests, chart notes, key dates, seasons, holidays and trends, engagement outlook, spam check | Missing at 25c3ea53; no rebuild routes or tables read. | Per-feature module owner decision (build or retire), data kept until recorded. |
| P1 | ICS calendar feeds (`calendar_feeds`, `/api/calendar-feed/[token]`) | Missing at 25c3ea53. | Tokenised feed, rotation, scope and expiry tests. |
| P1 | Slack and Telegram alert channels (`chat_channels`) | Lane 43 source: bilingual shared UI/REST/MCP destination management/test; transactional publication/inbox/operator events, durable per-destination idempotency and leased worker delivery. Operator events require Root-selected owner-workspace routing. | Apply/rehearse chat-delivery migration and verify real Slack/Telegram delivery, pause/delete/scope boundaries and held uncertain sends. |
| P1 | Composer link preview (`/api/link-preview`, Open Graph) and structured-data fetch | Partial (idea batch 2, 2026-10-22): server-side fetch with shared net-guard safety plus a TTL cache; composer card with honest unavailable/failure states; cached-only reads on render; REST + `get_link_preview` MCP. The guard lives in Publishing (`server/media/network/net-guard`), the fetch service in Studio content-tools; Facebook card refresh stays in the platform module. Source/mocked-test evidence only. | Browser checks of the composer card, production cache behavior. |
| P1 | Translated posts and translation fields in the composer | Partial (idea batch 2, 2026-10-22): per-language text variants on one post (`post_language_variants`, deterministic exact→language→default fallback), composer editor with per-destination resolution, publish-time selection, REST + MCP CRUD, validation/fallback tests. Text-only (pipeline sends one media set per post); per-destination media override explicitly unsupported. Source/mocked-test evidence only. | Browser checks of the variant editor, production publish verification per destination language. |
| P1 | Legacy REST `api_tokens` | Missing by design: replaced by MCP keys, person keys and `/api/v1`; existing tokens are not migrated. | Owner decision on migration or retirement. |
| P1 | Root changelog, client invitations, alert test and Meta usage (`graph_usage`) | Missing at 25c3ea53. | Root service, UI, REST and MCP. |
| P1 | Global command palette | Missing at 25c3ea53. | Shared shell component, keyboard and FR checks. |
| P2 | Installable web app (manifest, service worker, offline page, icons) | Implemented at source in q-35: owned dynamic manifest/worker/offline/PNG routes, Root branding, Settings preparation UI and shared confirmed/audited REST/MCP service. Unit/generated-worker/DOM evidence; real install/offline browser verification remains open. | Manifest and icons in the rebuild, cache policy, browser check. |
| P1 | Central cross-site write refusal (`Sec-Fetch-Site`) | Implemented at source in q-35: shared middleware guards every mutating path and server action with Root origins. 41 origin/cookie/Fetch-Metadata tests. Route-unit smoke bypasses middleware; live HTTP/browser verification remains open. | One shared guard, tests per route family. |

## Evidence and next checks

- Production: RELEASE_GATES_PLAN results record cutover, ownership/origin/config
  repair, owner sign-in and limited AI/Chrome checks. Deploy via
  `rebuild/scripts/prod-deploy.sh`; legacy command is guarded. Verify the exact
  latest deployed SHA and later migrations in an authorized release session.
- Automated/source: PARITY_PUBLISHING_INBOX.md, PARITY_ANALYTICS_ADS_SETTINGS.md,
  FEEDS.md, CONFIG_LITERAL_AUDIT.md, FACEBOOK_DATA_COVERAGE.md and module UI notes
  describe targeted tests. Old branch-only/unapplied statements need reconciliation
  against current Git and target database, not blanket reuse.
- Browser: WAVE1_VERIFICATION records synthetic dev-preview checks; the release
  log records a later production Chrome sweep. Neither covers every latest route
  across eight current palettes, keyboard and failure/recovery states. Shared
  library coverage is in DESIGN_COMPONENTS.md and CHARTS.md.
- Provider: historical identity/metric/media and AI checks are bounded. OpenAI and
  Gemini had recorded success; Anthropic returned insufficient credit. Every
  Facebook format, Inbox action, insight, Ads write and MCP client still needs
  its own outcome/cleanup proof. Preserve the photo-canary ledger/Page lock in
  FACEBOOK_LIVE_MEDIA_CANARY.md; unreadability never proves deletion.
- Data/recovery: the cutover recorded 34 migrations and backups/staging work;
  this does not verify every later migration, new export/erasure category, media
  checksum/restore or post-cutover rollback. Scheduling, recipes and tenant-bound
  history cursors need actual database/application checks.

Follow DELIVERY_PLAN.md for next actions. Complete the legacy API/worker inventory
and requirement-by-requirement review before declaring completion; this route-based
crosswalk does not establish that every legacy sub-operation has been found.


## Analytics response reporting — local parity batch (2026-10-21)

Owned source: `src/modules/analytics/`; tests and this inventory. Legacy comparison:
`src/lib/response-time.ts` and `src/components/analysis/ResponseTimeView.tsx`.
Three previously missing report measures are implemented:

- Comment response coverage: each stored visitor root comment is matched only to
  its first direct channel/app reply on the same post destination. Nested visitor
  replies do not become independent unanswered roots. Counts combine with stored
  conversations and comment-only answered/waiting counts are separately exported.
- Slowest first response in calendar time and within configured workspace business
  hours; no answered waits means unavailable, never zero.
- Median resolution within business hours, alongside calendar resolution. Unresolved
  waits and resolutions at/after the exclusive period end are excluded from durations.

The existing Reports UI prepares CSV/JSON/printable HTML and describes the added
coverage in English/French. `generate_report` and existing REST
`/api/analytics/report-workflows/run` and key dispatch
`/api/v1/analytics/generate_report` reach that same authorized generator; no parallel
calculation or new route is needed. Root catalogs own bilingual wording.
New Root keys: `analytics.reports.responseMessageLimit` (independent conversation
message/comment ceiling; at most twice this count read) and
`analytics.reports.responseMemberLimit` (listed member ceiling). Truncated input
and omitted members remain explicit. Registry schema version intentionally unchanged.

Evidence: TypeScript (`npx tsc --noEmit -p .`) passed with zero errors; 101 tests across eight targeted files passed with `--no-cache` (the initial cache write was refused by the sandbox). `git diff --check` passed. Targeted arithmetic/reader/render tests cover tenant/channel query shape,
comment identity collisions, attribution, period end, truncation, business hours,
unknown values and bilingual CSV/JSON/HTML/text. Existing report service and mocked
HTTP/MCP/UI tests verify their common entry paths. This is local automated evidence,
not a PostgreSQL, browser, provider, mail or production result. Stored-history gaps,
period-start context for conversation runs, and reopen/resolution event history
remain limits; current resolution state cannot reconstruct historical transitions.

Integrator follow-up outside ownership: bump `CONFIG_SCHEMA_VERSION` for the two
keys and changed catalogs; record this batch in ARCHITECTURE.md, DELIVERY_PLAN.md
and AGENT_HANDOFF.md. No migration, server, deployment, push or production operation
was performed by this worker.


## Analytics response history — round 2 (2026-10-21)

Ownership: `src/modules/analytics/`, targeted tests and this inventory. This batch
extends three partial legacy response-report capabilities through the existing
shared generator, rather than claiming three unrelated product modules complete:

1. Period-correct visitor waits. Stored messages before the report start establish
   the original visitor run; a continuation/reply inside the period cannot create
   a new wait. Only waits starting inside the inclusive UTC period are counted;
   replies at the exclusive end are excluded. Resolution belongs to the latest
   preceding visitor run, matching the legacy wait model.
2. Historical resolution/reopening reporting. Analytics reads the existing local
   Inbox workflow audit under workspace/channel scope. State uses the last event
   before the exclusive report end, so a later current-state reopen cannot erase
   that earlier resolution. Historical completed visitor-to-resolution cycles
   remain measurable after a subsequent reopen, in calendar/business hours.
   Repeated resolve events cannot duplicate a measured cycle; reopening without
   new visitor input creates no invented duration. Event counts and measured
   cycles are deliberately different measures.
3. Stored-history provenance. CSV/JSON/printable HTML/text expose record counts,
   stored-only/unknown-platform completeness, saved-state fallback counts, event
   counts and source truncation. Safety cuts exclude an incomplete final
   conversation or post discussion instead of creating false waiting/resolve
   figures. A truncated event history suppresses resolution durations. UI copy
   explains these semantics in English/French; Root owns all added wording.

Surfaces: Reports UI downloads and session REST
`/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report` and MCP `generate_report` continue to enter the
same authorized report workflow/generator. This batch changes no transport auth,
confirmation, credential ceiling or audit policy. The MCP operation description
now documents history/context/coverage; no parallel report calculator was added.

New Root key: `analytics.reports.responseEventLimit` (default 20,000, validated
100–100,000). Existing `responseMessageLimit` now bounds each source including
pre-period context; `responseMemberLimit` is unchanged. Existing catalogs
`analytics.reportDocumentCopy` and `analytics.reportsCopy` gain wording. The
registry schema version is intentionally unchanged for the integrator.

Evidence: from `rebuild/`, `npx tsc --noEmit -p .` passed with zero errors.
116 tests passed across nine targeted files with `npx vitest run ... --no-cache`:
`analytics-response-history.test.ts` (14), `analytics-response-comments.test.ts`
(5), `report-response-time.test.ts` (16), `report-document-copy.test.ts` (6),
`analytics-parity-report-generation.test.ts` (39), `reports82-ui.test.ts` (15),
`reports82-http-host.test.ts` (4), `reports82-mcp-host.test.ts` (6), and
`ui-copy-coverage.test.ts` (11). `git diff --check` passed. Tests cover arithmetic,
scoped query shape, context/boundaries, historical events/cycles, cut-thread
exclusion, audit truncation, bilingual artifacts and old-catalog fallback; existing
mocked UI/HTTP/MCP checks cover their common workflow entry paths. Older saved
report document catalogs now fall back through schema validation; missing UI keys
use the selected-language default. No database, interactive browser, provider or
production execution occurred. No servers, deployment, commits or push were
performed. Git worktree metadata is outside this worker's writable roots;
verified changes remain in the working tree for integration.

Remaining gaps: provider backfill/exhaustiveness is still unknown. Missing or
pruned workflow events cannot be reconstructed: current saved-state fallback is
explicit, and cannot recover an older resolution erased by an unrecorded reopen.
Reads remain bounded; large old histories can exhaust a source ceiling before a
recent requested period, yielding a disclosed partial report. Independent reads
are not a repeatable-read snapshot under concurrent Inbox changes. Actual
PostgreSQL query/volume, browser/theme/download and live transport/provider proof
remain open. These limits supersede the round-1 blanket absence of period-start
context and historical events, without claiming complete provider history.

Integrator edits outside ownership: bump `CONFIG_SCHEMA_VERSION` for the new key
and changed bilingual catalogs; update ARCHITECTURE.md, DELIVERY_PLAN.md and
AGENT_HANDOFF.md with this batch and the remaining evidence limits. Consider a
module-owned neutral completeness contract from Inbox/platform backfill and
indexed audit-history access for large datasets; no provider/shared/schema files
were changed in this lane.

## Analytics response breakdowns — round 3 (2026-10-21)

Owned: `src/modules/analytics/`, targeted tests and this inventory. Legacy source:
`src/components/analysis/ResponseTimeView.tsx` and `src/lib/response-time.ts`.
Three remaining response-report slices now share the existing authorized generator:

1. Comment response breakdown: visitor wait total and answer share, calendar and
   business-hours median/slowest first response, resolution median and
   resolved/unresolved counts, independently from conversation messages.
2. Conversation response breakdown: the same measures for stored conversation
   visitor runs, with an independent denominator. Empty input has no percentage
   or duration; unavailable business hours remain unknown. Combined medians are
   still calculated from actual waits, never averaged from source medians.
3. Member business-hours response: each first reply contributes its business-hour
   wait to its responding member, including an explicit outside-app bucket.
   Current-member name scope, former-member fallback and configured row omission
   counts remain intact. Genuine zero waits outside business hours remain zero.

Reports UI describes the measures in English/French and its CSV/JSON/printable
HTML downloads contain them. Text artifacts carry the same summaries. Existing
session REST `/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report` and MCP `generate_report` enter the same
report workflow. No new entry point, credential policy, confirmation or audit
path was introduced. Older retained summaries remain readable without fabricated
new fields. CSV retains existing comment-count keys without duplicate rows.

Root settings: no new keys. Existing typed `analytics.reportDocumentCopy` and
`analytics.reportsCopy` catalogs gain bilingual copy, consumed through their
existing runtime readers. Existing response message/event/member and artifact
row/byte settings continue to bound this work. `CONFIG_SCHEMA_VERSION` unchanged.

Verification from `rebuild/`: `npx tsc --noEmit -p .` passed with zero errors;
123 tests passed across ten targeted files with `npx vitest run ... --no-cache`:
`analytics-response-source-parity.test.ts` (6),
`analytics-response-comments.test.ts` (6), `analytics-response-history.test.ts`
(14), `report-response-time.test.ts` (16), `report-document-copy.test.ts` (6),
`analytics-parity-report-generation.test.ts` (39), `reports82-ui.test.ts` (15),
`reports82-http-host.test.ts` (4), `reports82-mcp-host.test.ts` (6), and
`ui-copy-coverage.test.ts` (11). `git diff --check` passed. New arithmetic,
scoped-reader and bilingual artifact checks cover independent sources, member
attribution, unknown versus zero, HTML escaping and artifact ceilings. Existing
mocked UI/HTTP/MCP tests cover their common workflow paths; these are local
automated checks, not real transport, PostgreSQL, browser or provider evidence.

Remaining gaps: full stored/provider history completeness, bounded oldest-first
reads, saved-state fallback ambiguity, concurrent-read consistency and actual
large-data performance remain as disclosed in round 2. The new breakdowns use
period-end resolution state; historical repeated cycles remain the separately
reported combined history measure, not additional source-level cycle measures.
Interactive browser/theme/download, database and live REST/MCP/provider checks
remain open. No servers, deployment, production calls, commit or push performed;
changes remain in the working tree for integration.

Integrator edits outside ownership: reconcile `CONFIG_SCHEMA_VERSION` for the
changed catalogs, and record this batch and evidence limits in ARCHITECTURE.md,
DELIVERY_PLAN.md and AGENT_HANDOFF.md. No migrations or host wiring are needed.

## Analytics source workflows — round 4 (2026-10-21)

Ownership: `src/modules/analytics/`, targeted tests, and this inventory. This
batch extends three partial legacy response-report capabilities from
`src/components/analysis/ResponseTimeView.tsx` and `src/lib/response-time.ts`:

1. Member first replies split by comments/conversations. Each source includes
   numeric answered-wait counts and calendar/business-hours medians, computed
   from that source's waits. Current workspace membership bounds name lookup;
   former-member/outside-app buckets retain English/French wording. The Root
   member row limit applies independently to combined and source summaries;
   omitted counts appear in artifacts, without changing the full summary totals.
2. Historical resolution cycles split by source. Both sources expose measured
   cycle counts and calendar/business-hours medians. The combined median still
   uses actual cycles, never averaged source medians. Same-valued local comment
   and conversation IDs cannot mix cycles. Duplicate resolves, reopen without
   visitor input, safety-cut threads and truncated audit history keep the prior
   conservative behavior; unset hours remain unavailable, genuine zero remains zero.
3. Recorded resolution/reopening counts split by source, independently from
   measured cycles and saved period-end state. Repeated recorded actions and
   actions without stored visitor history count as events, not extra durations;
   bilingual artifacts explicitly explain that distinction. Counts on a truncated
   event prefix remain marked partial rather than claiming complete history.

UI report preparation/downloads, session REST
`/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report`, and MCP `generate_report` reuse the existing
confirmed, scoped and audited report workflow/generator. CSV/JSON/printable HTML
and text carry all three additions; Reports guidance and MCP discovery describe
them. Existing retained summaries without these optional fields remain readable.
No new routes, permissions, service authorization paths or provider calls exist.

Root settings: no new keys. Existing typed `analytics.reportDocumentCopy` and
`analytics.reportsCopy` gain bilingual wording. Existing runtime response member,
message/event and artifact limits govern the additions; the response-member
setting description now explains independent source bounds. Registry schema
version is intentionally unchanged for the integrator.

Verification: `npx tsc --noEmit -p .` passed with zero errors. From `rebuild/`,
133 tests passed across 11 targeted files with `npx vitest run ... --no-cache`:
`analytics-response-source-workflows.test.ts` (10 new),
`analytics-response-source-parity.test.ts` (6),
`analytics-response-comments.test.ts` (6), `analytics-response-history.test.ts`
(14), `report-response-time.test.ts` (16), `report-document-copy.test.ts` (6),
`analytics-parity-report-generation.test.ts` (39), `reports82-ui.test.ts` (15),
`reports82-http-host.test.ts` (4), `reports82-mcp-host.test.ts` (6), and
`ui-copy-coverage.test.ts` (11). `git diff --check` passed. New reader/arithmetic
and artifact checks cover source identity, attribution, per-source omissions,
cycles versus events, history cuts, missing hours, escaping, bilingual catalogs
and output limits. Existing mocked host/UI/service checks cover the common
transport paths; no real HTTP/MCP client, PostgreSQL, browser, provider, mail or
production verification is claimed. No whole suite, server, deploy or push ran.

Remaining gaps: legacy multi-channel response comparison is still represented
by separate per-channel reports, not one cross-channel response table. Missing
provider/audit history, bounded oldest-first reads, saved-state fallback and
concurrent-read consistency remain as disclosed in rounds 2–3. A recorded action
without stored visitor input cannot reconstruct a cycle. Broader report copy/
format literals and complete provider history remain open. Interactive download,
theme/viewport, database volume and actual REST/MCP/provider proof remain open.
These three report slices do not establish full Analytics or legacy parity.

Integrator edits outside ownership: reconcile `CONFIG_SCHEMA_VERSION` for the
changed catalogs and update ARCHITECTURE.md, DELIVERY_PLAN.md and AGENT_HANDOFF.md
with the batch and evidence limits. No migration or host wiring is needed.
Changes are left uncommitted in this worktree for integration; linked Git metadata
is outside this worker's writable roots. Existing untracked node_modules links
are unrelated and were not modified.

## Analytics member outcomes — round 5 (2026-10-21)

Owned: `src/modules/analytics/`, targeted tests, this inventory. Legacy reference:
`src/lib/inbox-response.ts` builds full per-member `ResponseSummary` objects with
`src/lib/response-time.ts::summariseWaits`; the old screen renders only part of
that data. This batch restores three missing member-level report measures:

1. Slowest first reply in calendar time and configured business hours.
2. Resolved/unresolved **answered** waits by responding member. A saved resolution
   belongs only to the last visitor run starting before that resolution. If that
   run is unanswered, or its first reply follows resolution, no member receives
   resolution credit. Previous responders do not receive duplicate credit.
3. Median resolution duration for those attributed answered waits, in calendar
   time and business hours. Medians use actual run durations, not source medians.
   Attribution identifies the first responder, not the person clicking Resolve.

Combined, comment and conversation summaries each carry optional `memberOutcomes`
rows aligned with their existing bounded member lists. Existing summaries without
these rows remain renderable. No new provider requests or authorization path:
Reports UI preparation/download, session REST `/api/analytics/report-workflows/run`,
key REST `/api/v1/analytics/generate_report` and MCP `generate_report` enter the
same confirmed, tenant/channel-scoped, audited report service/generator. Shared
CSV/JSON/printable HTML/text include the new measures and attribution explanation;
additive EN/FR Reports guidance and MCP discovery describe them.

Root keys: **none added**. Existing `analytics.reportDocumentCopy` and
`analytics.reportsCopy` gain EN/FR entries. Existing runtime response message,
event, member and artifact limits govern reads/output; the response-member limit
now documents its outcome rows. `CONFIG_SCHEMA_VERSION` is deliberately unchanged.

Verification: `npx tsc --noEmit -p .` passed with zero errors. The targeted
12-file Vitest run passed 143 tests (10 new) with `--no-cache`: member outcomes,
source workflows/parity, comments, history, response time, document copy, report
generation, Reports UI, HTTP/MCP hosts and UI copy coverage. `git diff --check`
passed. No full suite, server, browser, provider, deployment,
push or production calls. Arithmetic, artifacts and mocked host tests are local
evidence, not actual HTTP/MCP download or provider/database evidence.

Remaining gaps: these are three member-report slices, not three completed product
modules or full legacy parity. Cross-channel comparison still needs a shared
multi-channel report workflow. Member outcomes use saved period-end resolution
state, not historical cycle ownership; reopened waits remain unresolved even if
an earlier cycle completed. Missing/truncated provider/audit history, saved-state
fallback and concurrent-read consistency retain previous rounds' disclosures.
Unanswered runs have no responding member and are excluded from member outcomes.
Root output bounds may truncate the added rows with the existing disclosure.

Integrator edits outside ownership: reconcile the registry schema version for
changed catalogs, and update ARCHITECTURE.md, DELIVERY_PLAN.md and AGENT_HANDOFF.md
with these measures and evidence limits. No routes or migrations need wiring.
Changes remain in this working tree for integration; linked Git metadata is
outside the worker's writable roots. Pre-existing node_modules links are untouched.


## Instagram P0 adapter lane — 2026-10-21 (fixture evidence)

Source: `src/platforms/instagram/` and Root configuration registration in
`src/platforms/index.ts`; legacy references `src/lib/facebook/instagram.ts`,
`src/lib/facebook/instagram-publish.ts`, `src/lib/instagram.ts`. See the module
README for the exact activation dependencies and protocol limitations.

Implemented provider ports: discovery only from supplied selected Pages;
image/carousel/Reel container creation with bounded child/parent status polling;
first comment; owner-matched published status; owned-media comments/replies and
comment moderation/deletion; per-metric post/account insights with explicit
failures, raw values, neutral non-additive series/category snapshots and current
follower snapshots. Missing grants fail closed. Published-media deletion, native
scheduling, Stories, direct messages and ads are not declared.

Update 2026-10-22 (live-ready lane, fixture evidence, still default-off): feed
video (`VIDEO`) and stories (`STORIES`, no caption/first-comment/status) join
the publishing matrix; media history now collects into `instagram_media` and
feeds `postPerformance`; the publication-recovery host is registered. Audit and
owner checklist: [INSTAGRAM_LIVE_RUN.md](INSTAGRAM_LIVE_RUN.md).

Update 2026-10-23 (inbox-sync + media batch, source/unit evidence, still
default-off): background comment sync joins the shared `inbox` job (fair
workspace ring with cursors, fetch-then-write, `instagram.inbox_synced`
receipts) and stored-library images publish through the Publishing-owned
signed-URL pipeline (secret/expiry Root keys, composer + dispatch wiring,
images only). Still missing: DMs, Meta inbound webhooks, remote media
deletion, usage-header accounting. No live Graph run yet, so this cell stays
**partial**.

This remains **partial**, not a working customer Instagram connector. Settings
are registered and the manifest is staged, but PLATFORM_MODULES is unchanged:
shared connection/selection persistence, host registration, storage/sync hooks,
durable container reconciliation and actual UI/REST/MCP parity still need
integration. No parallel interface/business service or stub OAuth flow was added.
The adapter requires public HTTPS media URLs; signed local-media delivery needs
integration. Comment-management permission is required beyond the three scopes
named in this lane. Media deletion support was not established for Facebook Login.

New Root keys: `platforms.instagram.enabled` (false),
`platforms.instagram.includedByDefault` (false), `platforms.instagram.planFeatures`,
`instagram.policy`, `instagram.appSecret`. Policy owns endpoints/version, limits,
polling, scopes, metric queries and bilingual copy. CONFIG_SCHEMA_VERSION is left
unchanged for the integrator. No screen changed; no browser/design claim applies.

Local evidence: 36 tests passed across instagram-platform.test.ts,
instagram-runtime.test.ts, instagram-discovery.test.ts and
platform-analytics-metadata.test.ts; `npx tsc --noEmit -p .` passed with zero
errors, and `git diff --check` passed. All commands ran from rebuild/. These checks
use synthetic data and mocked transport only. No server, whole suite, live Graph,
deployment, production action or push. Changes remain in the working tree for
integration. Shared architecture/goal/plan/handoff files are outside this lane;
the integrator must record this batch and its unfinished activation dependencies.

## Lane 43 caption/chat/operator follow-up — 2026-10-22

Caption tests accept raw variants as well as existing posts. Variant posts are
created atomically through Publishing's service and remain drafts until an
explicit Publishing action. The same start service serves the bilingual screen,
REST and MCP with exact mode-specific consent, current channel scope and audit.

Root Alerts is consolidated into Root Operations monitoring: a single incident
writer, existing email outbox, selected owner-workspace chat subscriptions and
confirmed test operation. The old `notifications.systemAlert*` configuration and
duplicate private MCP tools are removed. Registry schema 131 captures this lane.
Local evidence and remaining database/browser/live delivery gates are recorded in
[LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md); these changes do not establish full
rebuild or provider parity.
