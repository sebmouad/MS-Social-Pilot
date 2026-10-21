# Legacy capability parity gate

Updated 2026-10-21 against local HEAD `960831df` (status cells only; rounds 6–8 reviewed). **Full parity remains partial.**
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
| P0 | Eleven network connectors and publishing destinations in `src/lib/networks/index.ts` and `src/lib/networks/connect.ts` | Partial: Facebook is the only installed customer platform. Instagram and the other legacy destinations lack usable rebuild adapters. Removed provider APIs cannot be restored by configuration. | Adapter-level connection, discovery, publishing/status/delete, analytics, inbox, and ads where provider supports them; scoped UI/API/MCP and live tests. |
| P0 | Facebook feed, photo, carousel, video, Reel, Story, Group and native scheduling in `src/lib/facebook/publish.ts` | Partial: Page feed/photo and native video/Reel/Story source, proof/recovery and app versus Meta-native scheduling exist. Per-destination choices, queue and mix/recycle share Publishing services. Private/default-off native paths and mocked tests do not establish every format live. Group publishing is not advertised. | Provider fixture and live create/status/delete tests for each supported format; visible choices limited to available capabilities. |
| P0 | Analytics views, comparisons, post explorer, demographics, network analysis, pinned metrics and coverage in `src/app/(app)/analytics/AnalyticsScreen.tsx` and `src/lib/analytics-views.ts` | Partial: catalog/details/explorer, posts, comparisons, pins, goals, audience history/CSV and ad-object analysis have UI/REST/MCP. Shared charts now consume actual previous-period points. Facebook post history/reactions/hierarchy collection exists; live Graph v26.0 probe verifies five current post metrics and refuses three older ones (RELEASE_GATES_PLAN); exhaustive history/collection and dynamic labels remain incomplete. Root-editable EN/FR catalogs and validated-default fallback are integrated. | Shared metric catalog feeding full UI, export, and MCP with date/channel/ad-account scope, comparison, availability, and refresh evidence. |
| P0 | Reports and CSV exports in `src/app/(app)/reports/page.tsx`, `src/lib/reports.ts`, and `src/lib/analytics-export.ts` | Partial: Round-8 Destinations adds a scoped per-link lifetime click inventory, retained period clicks per link and daily UTC retained click counts through the existing confirmed report UI download/REST/MCP generator. Root `analytics.reports.linkDetails` bounds inventory and daily rows independently; EN/FR artifacts disclose publication-cohort scope, excluded ambiguous legacy links, retention gaps and clipping. No visitor metadata or destination URLs are projected. Local mocked/query-shape/workflow tests and TypeScript only; PostgreSQL, browser downloads and real-client proof remain open. round-7 Top posts restores destination-specific saved text, ordered image/video references with Root-switchable image previews, and saved article link/title/description through the existing confirmed UI download, REST and MCP report workflow. Root `analytics.reports.topPostContent` owns ranking/content/media/URL bounds, image previews and the authenticated media path template; EN/FR artifacts disclose current saved content, expiry, workspace access and clipping. Targeted mocked/render tests and TypeScript verification are local only; PostgreSQL, actual browser/download and real-client/provider proof remain open. Existing templates/schedules/runs, CSV/JSON/printable artifacts, response time/business hours, top posts, goals, destinations/link counts and AI recap exist. Downloads/UI were refined in 0589ddd0. Round-6 Published posts adds three stored-data report views through the existing confirmed UI/REST/MCP generator: a destination-specific content log with attempt counts, daily UTC publication counts independent of log limits, and currently failed destinations last updated in the period (explicitly not historical failure attempts). EN/FR catalogs disclose excerpts, current-state semantics and clipping; Root `analytics.reports.publicationDetails` controls each log ceiling and excerpt length. Local verification: TypeScript 0 errors; 155 targeted tests across 10 files passed, including scoped SQL shapes, bilingual artifacts, row/byte limits and confirmed MCP generation/audit. PostgreSQL, browser, real-client and production evidence remain open. Response reports now include first direct replies to stored root comments, slowest calendar/business-hours first response, and business-hours resolution through the same report generator used by UI downloads, REST and MCP. Round-2 response reports retain pre-period conversation context, reconstruct recorded resolution/reopening cycles, and disclose stored-history coverage and incomplete boundary exclusions in bilingual artifacts through the existing shared generator. Round-3 reports separate comment/conversation answer shares, response and resolution durations, and member business-hours first-response medians through the shared generator. Round-5 member outcomes add slowest first replies, answered-wait resolution counts and calendar/business-hours resolution medians, with last-run first-responder attribution through the same report workflow. Per-channel reports retain member attribution and disclose source limits; complete provider history, actual mail delivery, volume and current-browser proof remain open.  Rounds 1–3 (`23b7be84`, `6ef753e4`, `b725c415`) have local arithmetic, bilingual artifact and mocked workflow tests; bounded history and concurrent-read consistency remain limits. | Complete relevant report sections and exports, schedule/template workflows, UI/API/MCP parity and provider-shaped tests. |
| P1 | Composer overrides, queue slots, approvals, labels, custom fields, notes, versions, templates, first-comment retries, and UTM/link preparation in `src/lib/posts.ts` and related API routes | Partial: composer, slots/approvals/templates/labels/fields/notes/version restore, delayed comments and rejected-only retry, best times, mix/recycle, UTM and shortening are integrated. Scheduling modes are per destination. Newest scheduling/restore/comment database/browser/provider checks remain open; unknown remote attempts stay held. | Full end-to-end tests on production-shaped staging, per-target behavior, provider create/status/delete and permission verification, bulk actions, scheduling rules, plus remaining legacy workflows. |
| P1 | Post list filters, saved views, pagination, bulk actions, retry/duplicate, CSV export and public Posts v1 API in `src/app/(app)/posts/page.tsx` and `src/app/api/posts` | Partial: scoped lists/search/paging/views/export and bulk actions share services; key REST v1 Posts includes scheduling. Large asynchronous Posts CSV is absent (workspace ZIP is different); draft aliases and v1 create now share confirmed lifecycle boundaries (`acb56bd7`); real client outcomes remain unverified. Missing-image fallback and saved-view expired-session feedback are source/unit fixes (`36946d9e`), without browser rerun. | Full list/action/API parity with workspace authorization and large-data pagination tests. |
| P1 | Publishing calendar navigation and month coverage in `src/app/(app)/calendar` | Partial: Month/Week/phone agenda, workspace-day grouping, previews, saved views and drag/keyboard moves exist. Shared lifecycle supports adapter-held cancel/reschedule. Calendar editing, queue-slot presentation, high-volume months and actual drag/remote-schedule browser/provider evidence remain open. | Browser and database tests with records on timezone and month boundaries, high-volume month, permissions, drag-and-drop E2E, and edit workflows. |
| P1 | Inbox assignment, private notes, saved replies, moderation rules, comment deletion and full discovery in `src/lib/inbox.ts` and `src/app/api/inbox` | Partial: scoped conversations/comments/nested replies/reviews, sync/actions/recovery, assignment/notes/replies and moderation rules exist. New quick filters, stored contact/sentiment details, bulk actions, replies drawer and shortcuts have mocked/DOM tests. Contact REST and bulk UI/REST/MCP exist (`f5c21c96`). Facebook Inbox reads now fetch before the locked write phase (`e0584777`); write-time scope/binding checks remain. Complete discovery/backfill, attachments/participants and live moderation remain open. | Multi-user assignment, notes, moderation log/undo, all relevant posts/reviews, and provider/MCP tests. |
| P1 | Image/video media library, import, usage/quota, holder attribution and stream/raw delivery in `src/lib/media.ts` | Partial: modules/media owns images/videos/search/usage/holders/quota, guarded import and delete with UI/REST/MCP. Thumbnails/rename and real video/storage/browser workflows still need completion or proof. Reference/export completeness needs actual-data checks. | Video upload/library, imports, quotas, usage and reference display, secure retrieval/deletion tests. |
| P1 | Connections for Groups, Instagram and other networks, token health and lifecycle callbacks in `src/app/(app)/connections/page.tsx` and `src/app/api/facebook` | Partial: Facebook Page/ad-account discovery, selection, stored health, reconnect and retain/delete exist. OAuth startup including compatibility route shares service; batch selection UI/REST/MCP share confirmed wrapper. Single selection/disconnect confirmations differ. New Instagram/Group adapters and provider lifecycle/revocation proof remain absent. | Channel/ad-account selection, token/grant status, remote lifecycle callbacks, retain/delete semantics and complete provider discovery. |
| P1 | Ads comparison/trends, findings, sorting, export and freshness in `src/app/(app)/ads/page.tsx`, `src/lib/ads-analysis.ts` | Partial: comparison/trends/findings, rows/export/freshness, hierarchy/charts, directory and durable campaign/ad-set/paused-ad/creative management exist through session API/MCP and key REST v1, with a reconnect notice when the `ads_management` grant is absent (`46c6bdae`, mocked evidence). Management is off by default; the `ad.create` ledger CHECK migration (`20261031180000_rebuild_ads_ad_creation`) is authored and recorded applied in production (owner/integrator), while the Ads runtime copy locale is not yet passed by the UI/REST/MCP entry points. Live management grants, paused creation/cleanup and exhaustive reporting outcomes remain unproven. | Date/account-scoped trends, deltas, findings, CSV, coverage and live sync checks. |
| P0 | Root users, workspaces, plans, registration, connections, errors, worker, backups, privileges and audit console in `src/app/(root)/root` and `src/app/api/root` | Partial: grouped settings/stored health/diagnostics, users/workspaces/plans/privileges/audit/errors/sessions, lifecycle, installation transfer, registration MCP and connection refresh/disconnect-with-delete exist. All 48 private Root REST inventory exceptions are replaced by 51 mapped tools, including workspace create/rename and directory GET (`8f423ec7`); workspace, directory, configuration-save and error-resolution services now own actor checks and confirmations (`46c6bdae`, mocked evidence). Backups page is read-only. Complete operations/configuration and real installation-transfer/production-volume evidence remain open. | Role-guarded operator UI/API for each function, with change audit and isolated production-shaped checks. |
| P0 | Workspace operations settings: approvals, queue rules, hours, links, UTM, spacing, undo, audience, AI voice and moderation in `src/app/(app)/settings/page.tsx` | Partial: timezone/approval, queue/hours/week start, UTM/shortening, undo, spacing, AI voice, negative alerts and best-time mode have consumers and settings UI/API/MCP. Policy persistence does not prove automation outcomes. Audience/client-approval semantics and full copy/configuration coverage remain open. | Versioned, validated workspace configuration with runtime consumers and migration of needed legacy values. |
| P0 | Workspace operations settings: approvals, queue rules, hours, links, UTM, spacing, undo, audience, AI voice and moderation in `src/app/(app)/settings/page.tsx` | Partial: same workspace-operations inventory as above; best-time mode now consumes neutral stored post ranks through composer/queue services and shortening has a publisher consumer and form toggle. Remaining audience/client-approval semantics and runtime evidence are not closed. | Versioned, validated workspace configuration with runtime consumers and migration of needed legacy values. |
| P0 | Invitations, registration, email verification, password recovery and OAuth authorization in `src/app/(auth)`, `src/app/invite`, and `src/app/api/auth` | Partial: invitations, open registration/verification/resend, password recovery and authenticator/passkey services exist. Earlier PostgreSQL/browser/SMTP-capture checks are recorded in WAVE1_VERIFICATION. Session MCP exposes account security actions. OAuth login, complete recovery/seat policy and live mail/security/browser proof remain open. | Complete all account lifecycle capabilities with abuse controls, policy/seat handling, browser/API coverage, and production-shaped recovery/cutover evidence. |
| P1 | Client review/calendar/portal links and public bio pages with tracked clicks in `src/app/share`, `src/app/bio`, and `src/app/(app)/settings/sharing` | Partial: review/calendar/portal links, versioned access/rotation, feedback and public bio have shared UI/HTTP/MCP services and earlier synthetic probes (CLIENT_SHARING.md). Copy-only edits remain unconfirmed. Portal results/publish-anyway/branding/email, throttling and current key-scope/production evidence need completion. | Portal results, publish-anyway, logos/email, cross-process throttling and end-to-end manager-key channel scope remain open; production/proxy proof outstanding. |
| P1 | Agency views, feed ingestion, post templates and tasks in `src/app/(app)/agency`, `feeds`, `templates`, `tasks` | Partial: Agency overview/exports/clients/switching, Tasks/checklists/comments, templates and RSS/Atom/WordPress feeds exist. Overview person credentials are implemented; session Clients/switching do not expand those keys. WordPress recipe automation adds read-only mapping, image conversion, canonical first comment and distinct timezone-slot planning. Defaults remain off/paused for new installations/sources, while production has owner-recorded source/image/planning and first-day 07:00/11:00 batches, each 10/10 with comments. Article links were removed from comments on owner request. Retry/pause-cancel/pool-health and recipe origin badges/status have source/unit evidence; Feeds browser/database recovery and feed previews/reviewer notices remain open. | Full CRUD/workflow parity, workspace permissions, provider-side behavior where relevant, and MCP/API parity. |
| P1 | Notifications, webhooks, REST v1 API tokens and OAuth clients in `src/app/(app)/settings/notifications`, `webhooks`, `api` and `src/app/api/v1` | Partial: durable event notifications/sentiment input, queued mail, signed retrying webhooks/test/secrets/history, REST v1 Posts plus Analytics/Ads tool-dispatch routes and Root-gated OAuth connectors exist. Session MCP secret reveal/rotate exists; bearer tools stay secret-free. Actual delivery/OAuth/MCP client and target migration state need verification. | Delivery preferences, retries/redelivery, secret handling, scoped REST/OAuth contracts and audit tests. |
| P1 | Page profiles/groups/labels, media/watermark, custom fields, AI agents, history and owner export screens under `src/app/(app)/settings` | Partial: channel groups/labels, watermark application, fields/notes/history and export services have UI/API/MCP. Broader profiles/group filters, AI agents and complete export/localization remain open. Vivid/Meta blue/Warm/Clean light/dark are implemented; global shell and Settings now share account-stored theme/mode and Root-lifetime cache cookies (`2b42470b`). Browser rounds 1–4 cover scoped synthetic Chromium, Firefox and WebKit paths with themed bilingual error pages and unresolved findings (no `not-found.tsx`, soft 404s, raw module errors), not a clean full visual pass. | Working feature screens and shared services, migrated data, permission and visual checks. |
| P2 | Asynchronous owner ZIP export with job status and expiry in `src/app/(app)/settings/export` | Partial: durable asynchronous ZIP request/status/reuse/build/download/expiry/cleanup is implemented with prior local PostgreSQL evidence. All legacy categories/media and production-volume/export-erasure coverage remain unproven. Recent migration-table ownership and exact account appearance/safe-credential hooks are audited; supplementary purge guards remain without database proof/rehearsal integration. Partial account export is exposed (session GET route, `export_account_data` MCP tool, bilingual Account download, `46c6bdae`; mocked/DOM evidence); neither account JSON nor partial workspace JSON is the ZIP. | Large-data async export, durable status, expiry/cleanup and completeness reporting. |

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
