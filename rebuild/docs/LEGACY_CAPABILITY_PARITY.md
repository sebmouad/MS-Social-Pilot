# Legacy capability parity gate

Every customer and operator capability in the legacy app must have a working,
authorized, tested equivalent in the rebuild before production cutover. Routes,
icons, and stored settings alone do not establish parity. The new app may use
different navigation and URLs. Internal E2E fixture routes are outside the
customer feature inventory. This is a living crosswalk; mark an item complete
only after exercising its UI, API, permissions, persisted data, and relevant
provider behavior on production-shaped staging.

Status legend: **partial** means a real subset works; **missing** means no
equivalent workflow; **unverified** means code exists without adequate evidence.

| Priority | Legacy capability and source | Rebuild state | Required proof |
| --- | --- | --- | --- |
| P0 | Eleven network connectors and publishing destinations in `src/lib/networks/index.ts` and `src/lib/networks/connect.ts` | Partial: `rebuild/src/server/platforms/registry.ts` registers Facebook only; Instagram and the other legacy destinations have no rebuild engines. | Adapter-level connection, discovery, publishing/status/delete, analytics, inbox, and ads where provider supports them; scoped UI/API/MCP and live tests. |
| P0 | Facebook feed, photo, carousel, video, Reel, Story, Group and native scheduling in `src/lib/facebook/publish.ts` | Partial: `rebuild/src/platforms/facebook` handles basic Page content and remote video URLs. Local video, Reel/Story, Group, and native scheduling are missing. | Provider fixture and live create/status/delete tests for each supported format; visible choices limited to available capabilities. |
| P0 | Analytics views, comparisons, post explorer, demographics, network analysis, pinned metrics and coverage in `src/app/(app)/analytics/AnalyticsScreen.tsx` and `src/lib/analytics-views.ts` | Partial: `rebuild/src/modules/analytics/ui/AnalyticsScreen.tsx` exposes stored metrics, selected-channel audience totals, and ad-account selection shared with the scoped CSV export. UTC period comparisons, full stored scalar series/detail continuation, provider aggregation caveats and scoped UI/HTTP/CSV/MCP reads now exist. Post explorer, full historical demographics, pinned metrics and complete ad-object analysis remain. | Shared metric catalog feeding full UI, export, and MCP with date/channel/ad-account scope, comparison, availability, and refresh evidence. |
| P0 | Reports and CSV exports in `src/app/(app)/reports/page.tsx`, `src/lib/reports.ts`, and `src/lib/analytics-export.ts` | Partial: `rebuild/src/app/reports` redirects to the single Analytics experience; shared scoped snapshots feed a bounded long-form CSV with metric summaries, details and comparison provenance. Batch82 adds `/analytics/reports`: reusable templates, editable schedules, manual CSV/printable artifacts, durable run history, captured SMTP delivery and scoped UI/API/MCP with Root controls. Wave 2 adds a Response time section (median first reply, answered/waiting counts from stored Inbox messages, calendar time) and a Top posts section (ten best posts by the channel module's ranking measure through a neutral `postPerformance` analytics hook; Facebook ranks by stored reactions+comments+shares), and Goals: a monthly per-channel goals page, API, MCP and report section with legacy metric meanings in the workspace time zone, measured through a neutral `goalMeasures` hook, plus a Destinations section (stored per-post measures through a neutral `destinationMeasures` hook, link clicks for single-destination posts) and a JSON export beside CSV and the printable page (legacy had no XLSX/PDF). An AI recap section (labelled AI-generated, built only from the report's computed figures, offered only while AI assist is available) uses the AI module's `summarize`. Response time also reports a business-hours median from the workspace hours and time zone (legacy definition). Unit tests plus a real-PostgreSQL run of the report SQL (wave2-postgres.integration.test.ts). Per-member/per-page response breakdown and resolve time remain incomplete. | Complete relevant report sections and exports, schedule/template workflows, UI/API/MCP parity and provider-shaped tests. |
| P1 | Composer overrides, queue slots, approvals, labels, custom fields, notes, versions, templates, first-comment retries, and UTM/link preparation in `src/lib/posts.ts` and related API routes | Partial: `rebuild/src/modules/publishing/server/lifecycle.ts` provides drafts, approval, one timestamp, publish, first comment, status and delegates deletion to `rebuild/src/modules/publishing/server/deletion.ts`. Remote post deletion now has durable content-free intent/receipts, per-destination partial outcomes, local finalization after recorded confirmation, customer UI/MCP status and recovery, and bounded private Root history/attestation. Provider exceptions remain uncertain and are not automatically verified or retried. Queue and Approvals lists query statuses and channel scope before pagination; Queue groups posts by workspace day; both use the shared post preview with attachments, first comments and destination outcomes. Approval notes are audited; Calendar rescheduling is available, with no Queue reschedule control. Templates, labels, bulk label assignment, custom fields and team notes have integrated UI/HTTP/MCP services. Batch 69 adds transactional retained version recording and confirmed content restore through UI/HTTP/MCP (see PUBLISHING_HISTORY.md); saved queue timetables and confirmed next-slot placement have integrated UI/HTTP/MCP services (PUBLISHING_QUEUE.md). Batch 72 integrates opted-in content mix and repeating through guarded lifecycle/worker callbacks with UI/HTTP/MCP controls (PUBLISHING_AUTOMATION.md). Batch 73 adds atomic mention/dry notification intents and durable personal alert/email services (NOTIFICATIONS.md); real mix-dry generation proof, remaining alert types, cross-format restore and complete composer queue mode remain incomplete. | Full end-to-end tests on production-shaped staging, per-target behavior, provider create/status/delete and permission verification, bulk actions, scheduling rules, plus remaining legacy workflows. |
| P1 | Post list filters, saved views, pagination, bulk actions, retry/duplicate, CSV export and public Posts v1 API in `src/app/(app)/posts/page.tsx` and `src/app/api/posts` | Partial: `rebuild/src/modules/publishing/ui/posts/PostsScreen.tsx` now pages through scoped workspace posts, with channel access and sidebar status/channel filters applied before counting and paging. Basic actions and idempotent local draft duplication now share UI/HTTP/MCP authorization and durable receipts; literal text/first-comment search and complete-or-refused scoped CSV export now share UI/HTTP/MCP read rules. Personal saved views (legacy `saved_views` table, no migration) now share one service across the sidebar UI, `/api/publishing/saved-views` and MCP `list_saved_views`/`create_saved_view`/`delete_saved_view`, storing only whitelisted filters (see PUBLISHING_SAVED_VIEWS.md). Bulk delete (local-only)/duplicate/reschedule/retry now run each post through its existing single-post service via one bounded service, `/api/publishing/posts/bulk` and MCP `bulk_post_action`; a per-post "Retry failed destinations" control uses the shared publisher in retry-only mode, re-dispatching only destinations recorded failed with no remote ID (uncertain/submitted attempts stay held). See PUBLISHING_BULK_ACTIONS.md. Asynchronous large exports and the REST v1 API remain (the rebuild has no REST API-key seam yet; MCP keys are its only bearer credential). | Full list/action/API parity with workspace authorization and large-data pagination tests. |
| P1 | Publishing calendar navigation and month coverage in `src/app/(app)/calendar` | Partial: rebuild Calendar has Month and Week views (URL `view`, `date`, `channel`, `status`; sidebar filters), groups scoped posts by workspace-local day without the former 100-post truncation, and shows each post with channel badges and a text-plus-shape status chip. Future days and week slots link to `/publishing/compose?date=YYYY-MM-DD&time=HH:MM`. A still-local scheduled post can be moved by drag-and-drop or by the keyboard/touch Move dialog (hour, day, week, or a picked date and time) after a confirmation of the new time; the server (`reschedulePost`) re-checks membership role and authorship, channel scope, status and untouched targets, interprets the time in the workspace zone (DST gaps rejected, repeated hours use the first occurrence) and refuses the past. Phones show an agenda. View post opens the full shared preview in an accessible dialog; dedicated creation uses the composer. Personal Calendar saved views (view/status/channel) share the Posts saved-view service. Not done: editing a post from the Calendar, queue slots, moving published or provider-scheduled posts, high-volume month performance, browser E2E of drag-and-drop. | Browser and database tests with records on timezone and month boundaries, high-volume month, permissions, drag-and-drop E2E, and edit workflows. |
| P1 | Inbox assignment, private notes, saved replies, moderation rules, comment deletion and full discovery in `src/lib/inbox.ts` and `src/app/api/inbox` | Partial: `rebuild/src/modules/inbox/ui/InboxScreen.tsx` is a two-pane Inbox: list of conversations and top-level comments (sidebar filters for channel, type, status, hidden comments; unread and needs-reply indicators) and the selected thread with stored history, author, workspace-time stamps and channel badge. Reply box with character count and the platform reply window in plain words, resolve/reopen, hide/unhide and comment delete (confirmation naming the consequence; platform first, local removal after confirmation) where the adapter supports them. "Last synced" and Sync now report counts and channels that could not be read. Shared scoped UI/HTTP/MCP reads now support literal search, merged activity paging and stored thread-history paging, with Root-managed limits and retained selection. All server checks (entitlement, feature write, channel scope, token and scope grants, audit) are unchanged. Assignment, private notes and saved replies have shared UI/HTTP/MCP services (CORE_WORKFLOWS.md). Moderation rules (links/phone numbers/keywords → hide, record, or reply as the channel; per-channel or all-channel scope, daily cap, once-per-person replies), a moderation log and undo of rule hides now share one scoped service across `/inbox/moderation`, `/api/inbox/moderation` and six MCP tools with exact confirmations, Root bounds (`inbox.moderation*`) and en/fr copy (`src/modules/inbox/moderation.ts`); dispatch reuses the shared hide/reply services and declared module capabilities. Evidence is unit-level only (no PostgreSQL, browser or live-provider run). Rules also run automatically after each Inbox sync as an active qualifying owner (`5c29c1de`, Root `inbox.moderationAutoRun`, `inbox.moderationAutoWorkspaceLimit`); legacy email alerts become log records; rule replies are removed through the normal comment deletion flow rather than undo. Gaps: moderation export/erasure coverage review, visitor replies nested under comments, reviews, automatic remote reconciliation, complete visitor-reply discovery and live-provider tests. Durable unique deletion intent/status/local-finalization, completed alias lookup, recursive stored descendant tombstones and private operator attestation now share UI/HTTP/MCP; these are not proof of automatic remote verification or completed Inbox parity. | Multi-user assignment, notes, moderation log/undo, all relevant posts/reviews, and provider/MCP tests. |
| P1 | Image/video media library, import, usage/quota, holder attribution and stream/raw delivery in `src/lib/media.ts` | Partial: `modules/media` adds `/publishing/media` with images and videos, search, usage/holders, quota, SSRF-guarded import by address, guarded deletion, API and MCP (MEDIA_LIBRARY.md). Unit tests only; no browser video upload, thumbnails or rename. | Video upload/library, imports, quotas, usage and reference display, secure retrieval/deletion tests. |
| P1 | Connections for Groups, Instagram and other networks, token health and lifecycle callbacks in `src/app/(app)/connections/page.tsx` and `src/app/api/facebook` | Partial: `rebuild/src/app/settings/connections` supports Facebook Pages/ad accounts and local retain/delete. Linked legacy Instagram rows now follow selection and disconnect data choices, but new Instagram discovery/connection and provider operations are absent. | Channel/ad-account selection, token/grant status, remote lifecycle callbacks, retain/delete semantics and complete provider discovery. |
| P1 | Ads comparison/trends, findings, sorting, export and freshness in `src/app/(app)/ads/page.tsx`, `src/lib/ads-analysis.ts` | Partial: scoped stored comparison/trends/findings and object-directory services are integrated. Batch 74 adds durable object changes, request replay, safe pending recovery/uncertain attestation and shared UI/HTTP/MCP (ADS_PARITY.md). Complete creation journaling, creative creation, live management and remaining report/export coverage are still open. | Date/account-scoped trends, deltas, findings, CSV, coverage and live sync checks. |
| P0 | Root users, workspaces, plans, registration, connections, errors, worker, backups, privileges and audit console in `src/app/(root)/root` and `src/app/api/root` | Partial: rebuild Root has a grouped control center with Shared/Product/Platform module menus and scoped module settings, installation counts, runtime configuration, redacted historical audit search with workspace/UTC-date filters and bidirectional cursor paging through UI/HTTP/MCP, rebuild-only redacted job health and owner-scoped diagnostics with authorized read-only API checks, timed results/audits/recovery/deadlines through UI/HTTP/MCP, searchable directories, account-state user filters and active verified session counts, transactional current-Root-checked user access/recovery through UI/HTTP/MCP, workspace creation/rename, confirmed audited suspension/restoration through UI/API/MCP, and private installation MCP/session recovery independent of workspace membership. Installation-wide session listing with confirmed, audited single-browser sign-out (`SIGN OUT SESSION <id>`) and a read-only, credential-free cross-workspace connection directory (platform from installed manifests, state, token expiry, scope count, selected/discovered channels) are available through UI/HTTP/MCP with English/French copy (mocked-database tests only). Customer entitlement and shared side-effect guards deny suspended access; private Root inspection remains available. Permanent deletion of a disabled non-Root account that is not a sole owner (`55185468`) and of a suspended workspace through the resumable purge (`82333cd2`) are implemented through UI/HTTP/installation MCP and browser-checked (WAVE1_VERIFICATION.md); a real-PostgreSQL test proves workspace deletion also erases feeds, feed items and webhooks (`b25ad18f`). Registration/invitation administration now has an installation-wide UI/HTTP service with read-only open-registration status, bounded invitation statuses/workspace filters, scoped confirmed revoke and eligible unverified self-registration resend/delete with current Root checks and transactional audits (ROOT_REGISTRATION_ADMIN.md; mocked service/HTTP and DOM/render evidence only; MCP definitions supplied but not registered). Installation-Root transfer, Root connection actions (refresh/disconnect), complete per-module operations/health and product encapsulation, audit export/retention and production-volume audit query verification remain missing. | Role-guarded operator UI/API for each function, with change audit and isolated production-shaped checks. |
| P0 | Workspace operations settings: approvals, queue rules, hours, links, UTM, spacing, undo, audience, AI voice and moderation in `src/app/(app)/settings/page.tsx` | Partial: rebuild settings cover account, appearance, connections, data, MCP and team; workspace timezone and contributor approval policy have validated live consumers (CORE_WORKFLOWS.md). Workspace operations values (week start, business hours, best-time mode, UTM/shortening, spacing gap, undo window, AI voice, negative-comment alert) are validated, audited, en/fr-catalogued settings in the existing legacy columns, exposed via API/MCP (CORE_WORKFLOWS.md). Live consumers: publish-time UTM tagging in the shared publisher and the composer spacing warning; only those fields are rendered. Unit-test evidence only. Still incomplete: consumers for business hours, best times, link shortening, undo send, AI voice and negative-comment alerts; client approval and audience defaults. | Versioned, validated workspace configuration with runtime consumers and migration of needed legacy values. |
| P0 | Invitations, registration, email verification, password recovery and OAuth authorization in `src/app/(auth)`, `src/app/invite`, and `src/app/api/auth` | Partial: workspace invite/list/revoke and invite-token registration/acceptance are implemented with SMTP delivery, hashed expiring tokens and scoped memberships. Open registration (Root `auth.openRegistration`, off by default) with email verification and resend is implemented (`32c89aa0`); the verify link creates the new owner workspace, and an unverified account has no membership. Registration, verification and invitation acceptance passed real-PostgreSQL and browser runs with a loopback SMTP capture (WAVE1_VERIFICATION.md). Password recovery at `/password-recovery` exists with unit tests (ACCOUNT_RECOVERY.md) but has no recorded browser run. OAuth for MCP clients is tracked under integrations. OAuth login, broader public onboarding/account-scope APIs, seat policy and complete browser/API parity remain open. | Complete all account lifecycle capabilities with abuse controls, policy/seat handling, browser/API coverage, and production-shaped recovery/cutover evidence. |
| P1 | Client review/calendar/portal links and public bio pages with tracked clicks in `src/app/share`, `src/app/bio`, and `src/app/(app)/settings/sharing` | Batch79b implements review/calendar/portal links, versioned editing/renewal, feedback and public bio with shared HTTP/MCP services. Isolated 2647 tests plus actual synthetic HTTP/MCP/PG/Chromium probe passed; see CLIENT_SHARING.md. | Portal results, publish-anyway, logos/email, cross-process throttling and end-to-end manager-key channel scope remain open; production/proxy proof outstanding. |
| P1 | Agency views, feed ingestion, post templates and tasks in `src/app/(app)/agency`, `feeds`, `templates`, `tasks` | Partial: Tasks integrated and locally verified (batch 76); Agency now integrated locally (batch 77); RSS/Atom feeds integrated at `/publishing/feeds` (FEEDS.md: review or queue handling that never bypasses approvals, leased worker polling, exactly-once items, API/MCP); unit tests only, no feed images/link previews or approval notifications. | Full CRUD/workflow parity, workspace permissions, provider-side behavior where relevant, and MCP/API parity. |
| P1 | Notifications, webhooks, REST v1 API tokens and OAuth clients in `src/app/(app)/settings/notifications`, `webhooks`, `api` and `src/app/api/v1` | Partial: Settings-owned in-app and queued email delivery for note mentions and mix-dry alerts, personal switches/mutes, current-authority delivery, uncertain holds, audit and UI/HTTP/MCP services are integrated (NOTIFICATIONS.md). Signed webhooks (`/settings/webhooks`, leased retrying delivery, secret reveal/rotate, test, delivery log, MCP) and a REST v1 slice (`me`, `pages`, `webhooks`) authenticated by existing scoped `mcp_` keys are integrated (INTEGRATIONS.md); unit tests only. Only post.published/post.failed events are emitted. REST v1 posts (through Publishing services) and all six webhook events followed, and OAuth connectors for MCP clients (dynamic registration, PKCE S256, member consent issuing a scoped `mcp_` key) are implemented behind a Root switch. The OAuth migration `20261026100000_rebuild_oauth_connectors` is not applied or pinned; it was validated only on a throwaway schema copy. Unit tests only for OAuth. | Delivery preferences, retries/redelivery, secret handling, scoped REST/OAuth contracts and audit tests. |
| P1 | Page profiles/groups/labels, media/watermark, custom fields, AI agents, history and owner export screens under `src/app/(app)/settings` | Partial: image library, scoped data export and Publishing custom fields/team notes/version history have integrated services and screens. Root operational history also exists; this does not complete Page profiles/groups/labels, watermarking, AI agents or every export/legacy setting. | Working feature screens and shared services, migrated data, permission and visual checks. |
| P2 | Asynchronous owner ZIP export with job status and expiry in `src/app/(app)/settings/export` | Partial: asynchronous owner ZIP export with job status, reuse, worker build, download, expiry and file cleanup is implemented (`e3511510`), with a real-PostgreSQL lifecycle test after the void-lock fix (`21fe110d`); migration `20261027100000_rebuild_workspace_exports` is applied to the preview and pinned. Completeness reporting against every legacy export category and production-volume runs remain open. | Large-data async export, durable status, expiry/cleanup and completeness reporting. |

Publishing safety update, 2026-10-16: all lifecycle/local-draft service writes recheck current authority inside a single workspace operation guard with post/destination locks, bounded atomic writes/audits and adapter cancellation. Stale scheduled candidates are skipped. Inline edit/delete recover entered values and choices after failure; successful browser save/delete and scoped live localhost MCP were verified. A later batch added durable remote post deletion and operator recovery, but no automatic provider verification. This remains **partial**: publication intent and independently persisted receipts now support explicit human attestation, legacy claim adoption and local-only projection through customer/Root HTTP/MCP; unknown outcomes stay held without automatic resend; normal Publishing reads now share selected-resource and current authorization checks, excluding retained unselected and mixed-destination posts before counts/pagination. Dedicated retained-history browsing and complete read/API parity remain. Provider/live verification, full parity and release gates remain. See PUBLISHING_OPERATIONS.md and POST_DELETION_RECOVERY.md; do not infer full Publishing or production readiness.

First-comment update, 2026-10-16: immediate post creation and comment dispatch are separate adapter operations. A committed post ID survives comment rejection/uncertainty; current-authorized UI/MCP share attempt claims, explicit retry only after recognized rejection, and audited external human reconciliation. Existing legacy comment columns are mapped without DDL. This closes that specific combined receipt-loss defect, while post-receipt persistence failures, delayed comments, automatic remote verification, full publication/deletion journals and live-provider proof remain open. See FIRST_COMMENT_DELIVERY.md.

The route-based inventory is a first pass; inspect each legacy API and worker
before claiming the crosswalk exhaustive. Each provider must be modular, but retaining legacy
capability does not require preserving a legacy route or visual design.

The cutover blocker is the **capability**, not simply the missing screen. If
legacy data is needed to implement it, map and migrate that data with backup and
recovery evidence. Unavailable provider permissions must produce a clear,
customer-safe state rather than a false claim of support.


Publication recovery update, 2026-10-17: PUBLICATION_RECOVERY.md documents the
implemented durable attempt/receipt/projection journal and exact-scoped manual
recovery. This closes the earlier missing auditable resolution path, including
local projection failures after a receipt commits. If the provider accepted a
request but its receipt never commits, intent remains uncertain and requires
external review; it is not automatically verified or resent. Automatic provider
lookup/idempotency, delayed effects, full media/grant coverage, complete legacy
workflows and real provider/cutover evidence remain incomplete.

Publishing readiness update, 2026-10-17: locally expired/revoked credentials,
missing/corrupt destination tokens and insufficient adapter grants cannot claim
publication intent. First-comment/delete/manual-status operations share the
resolver, with Facebook-owned publish/delete policies and adapter transport
checks. Composer/edit/import and MCP destination output share current readiness.
Single-photo publication prefers a valid returned post ID. These close specific
local preflight/identity defects, not complete grant or format coverage. Durable
intermediate upload receipts/cleanup, local video, Reels/Stories/native scheduling,
real provider permission/task/response verification and full parity stay open.
See PUBLISHING_READINESS.md.

Platform access update, 2026-10-17: installed module manifests own Root-managed
default inclusion and plan-grant keys. Shared policy resolution no longer
hardcodes Facebook or grants uninstalled providers from plan text. Normal
customer web/MCP access cannot inherit private Root suspension inspection.
Connections/OAuth/selection, Analytics provider loading, Inbox and Ads resource
services and destination/Home/team choices now enforce current platform access.
Synthetic real HTTP/MCP/Chrome tests cover denied and restored access; complete
provider collector subscription policy, plans/billing management and broader
operator/legacy/provider proof remain missing. See PLATFORM_ACCESS_PLAN.md.

Post duplication update, 2026-10-17: POST_DUPLICATION.md documents one authorized
local draft copy with content/first comment/all media and fresh pending targets,
atomic content-free audit, source-scoped UUID replay, current authorization and
shared UI/HTTP/MCP. It does not copy remote delivery history or dispatch provider
requests. This closes the individual Duplicate workflow, not bulk actions, full
post-management parity, provider verification or production release gates.

Posts search/export update, 2026-10-17: POST_SEARCH_EXPORT.md documents literal
text/first-comment search before count/pagination and current-scoped CSV v1
through the sidebar, HTTP and read-only MCP. All matching posts within Root
ceilings are exported across displayed pages using a bounded database snapshot;
oversized sets are refused with no partial file. This does not close saved
views, bulk operations, large asynchronous archives, REST v1, provider coverage,
complete legacy parity or production release gates.

Facebook signing update, 2026-10-17: FACEBOOK_REQUEST_SIGNING.md records the
Facebook-owned Root policy and authenticated Graph signing across normal,
paginated and ad-set transports. Missing/unreadable secret readiness is safe;
stored history remains readable. A real engine-only legacy credential bridge
verified user/Page identity, required read grants, Page/ad-account discovery and
four configured Page metrics. This is bounded live read evidence, not OAuth
callback, live UI/API/MCP, publishing/media/deletion/Inbox/Ads-write proof or
complete provider parity. The connection lacks `ads_management`; broader metrics,
formats, lifecycle coverage and every production release gate remain open.

Ordered media update, 2026-10-17: ORDERED_MEDIA_AUTHORING.md records complete
ordered list editing in the shared composer/local edit, per-image descriptions,
multi-file selection, confirmed-reference upload retry and matching strict MCP
media arrays. Adapter declarations own combinations and live-ready upload limits;
services repeat checks before save/schedule/duplication/publication intent. This
closes the one-attachment UI and multi-image edit exclusion, not image-only posts,
local video, native formats, durable temporary-photo recovery, full media/provider
parity or production gates. The real-provider multi-photo canary remains unrun.


Captionless content update, 2026-10-17: CAPTIONLESS_POSTS.md closes the shared
text-required restriction for image, remote-video and link posts. UI/MCP authoring,
duplication, scheduling/rescheduling and publication preflight share the same
minimum-content rule. Empty/first-comment-only posts remain invalid. This is not
live provider proof, native format support, durable temporary photo recovery,
full Publishing parity or production readiness.


Facebook media staging update, 2026-10-17: FACEBOOK_MEDIA_RECOVERY.md documents
committed per-photo/feed intent/receipts, held partial effects, orphan-safe data
cleanup guards, private module-owned Root evidence and matching HTTP/MCP reads.
Existing local receipt recovery can use an exact known feed ID without resending.
Cleanup of known staged photos, unknown-step reconciliation, real provider media
canary/cleanup and complete Facebook/legacy/cutover gates remain unfinished.


Facebook known-photo cleanup update, 2026-10-17: an opt-in private Root action
now records separate deletion intent/audit/receipts and shares UI/HTTP/MCP
authority. Explicit external verification/race acknowledgment is required because
Graph cannot reliably prove continued unused state. Known or uncertain feed
effects block cleanup; uncertain DELETE results cannot be resent. Confirmed
synthetic replay and fault tests do not prove live provider deletion. Unknown
upload/feed/delete reconciliation, native formats, full Facebook/legacy/MCP
coverage and production cutover remain open. See FACEBOOK_MEDIA_RECOVERY.md.

Live multi-photo update, batch 55: the current engine published two generated
multipart photos and one feed post on the user-selected Page. Remote reads
verified publication and exact photo association; feed deletion returned an
explicit receipt. Child-photo cleanup is held because reads became unavailable;
neither API lookup failures nor a bounded photo list prove absence. The private
file ledger and Page lock are retained. This engine-only legacy credential bridge
does not verify migrated rebuild UI/API/MCP, database journaling, first comments,
other formats or complete provider parity. See FACEBOOK_LIVE_MEDIA_CANARY.md.

Ads filter correction, batch 56: unavailable accounts and invalid dates now
produce retained field-linked correction state before insight reads, instead of
silently broadening the report. Overview counts agree with selected account
cards; presets and custom editing share the sidebar's themed controls. This
closes those filter UX defects only. Root-managed report policy/copy, reporting
pagination/comparisons/exports/freshness, full management/provider/MCP parity and
production-shaped release verification remain open. See ADS_REPORT_FILTERS.md.


Facebook media recovery update, 2026-10-17: private Root now supports a default-off
module-owned path for operators to record externally observed photo/feed and
deletion outcomes. Generic Root actions support bounded typed fields and show
read-only context resolved from evidence. Human reports and provider results are
separate immutable facts; conflicting outcomes remain held and late provider
evidence is retained separately. Human feed
absence never authorizes cleanup, which still requires no feed intent or a
definitively provider-rejected feed plus the existing manual checks. This closes
the manual-reporting gap only. It does not provide arbitrary conflict resolution,
candidate search, live create/delete proof, complete Publishing/Facebook or MCP
parity, or cutover. See FACEBOOK_MEDIA_RECOVERY.md and UX-CONTRACT.md.

Ads reporting policy, batch 57: presets, labels/defaults, calendar range ceilings
and filter-string limits are now one Ads-owned, Root-managed object consumed by
both UI and MCP. MCP exposes/selects current presets and uses UTC inclusive days
with an explicitly exclusive returned end. Root HTTP validation fails before
persistence; empty/stale filters fail without broadening scope. This addresses
those batch-56 policy gaps only. General copy configuration, report row bounds,
complete pagination, comparisons, exports, freshness/status presentation and
broader Ads/legacy/MCP capability and cutover gates remain open.

Ads report browsing, batch 58: account cards and complete object summaries have
server-rendered sidebar pages with scope-preserving URLs and explicit counts.
Root page-size/read-row controls apply to both customer reports and MCP; scoped
oversize datasets are refused before partial aggregation. Current connection scope
and normalized level filters precede the row ceiling. Summary identity/order is
stable for unchanged data. This closes bounded synchronous UI browsing gaps only;
database object/directory paging, byte/time bounds, asynchronous reports, daily
MCP detail coverage, comparisons/exports/freshness/status and wider Ads/legacy/
release requirements remain open. Production is unchanged.

Ads stored daily metrics/export, batch 59: scoped service/API/MCP reads expose
all stored scalar/action/additional values and fetch provenance; daily UI also
shows primary measures. Complete CSV uses applied report filters, every matching
level/page, explicit credential redactions, spreadsheet-safe strings and current
Root row/byte/filename controls. Oversized exports return no partial result.
Shared download behavior handles stale/unmounted reads and receipt validation.
This closes the stored detail/export gaps at that scope. It does not establish
every provider metric collection, advanced reporting/comparison/status, complete
Ads creation/management, full MCP/legacy parity or release readiness.

Facebook worker authorization, batch 60: remote scheduled status, Page insights,
Ads insights and Inbox now qualify a current active workspace owner's feature
and platform access, refresh selected connection credentials/grants/expiry per
attempt and recheck before persistence/commit. Shared locks fence selection,
disconnect and reconnection against collector writes. Scheduled and Inbox reads
also enforce the parent post's workspace. Root owns worker access/budgets and
Facebook collection grants/windows. This closes those background-scope/stale-
credential races; it does not complete provider collection formats, discovery,
callback lifecycle, Ads management, live operation proof or release gates.

Workspace team and invitations, batches 61–62: Settings manages existing active accounts and invitation records through tenant-scoped role/channel grants in the customer UI, HTTP and management MCP. Invitation preview, existing-account acceptance and new-account registration use the public HTTP auth flow. Current authority, exact confirmations, transaction/audit atomicity, single-use expiry, SMTP status handling and Root-managed bounds were exercised with an isolated PostgreSQL database and local SMTP capture. General verification/recovery/OAuth flows, seat-plan policy, clean-phone/browser verification and full legacy parity remain missing. No production cutover is implied. See TEAM_ACCESS.md, ONBOARDING.md and PREVIEW_QA.md.

Batch 63 adds reusable Publishing template CRUD/composer reuse, Inbox assignment/
notes/saved replies, and workspace time zone/approval policy. These scoped slices
do not close the broader Publishing, Inbox or workspace settings rows. Runtime,
browser/provider and cutover evidence remain separate; see CORE_WORKFLOWS.md.

Batch 64 source adds shared label management, self-service email password
recovery and normalized metric exploration. Account OAuth/general verification,
full analytics demographic/report workflows, bulk label assignment and other
legacy row gaps remain open. See the three module documents for exact scope.


Reports batch82: verified local template/schedule/history/generation workflows,
current key/channel authority, one-at-a-time fenced claims, honest SMTP outcomes,
Root registry74 controls, actual ZIP export/erasure and9 PostgreSQL cases.
2865 tests/331 files, zero skips; build/typecheck and actual local HTTP/MCP/
Chromium/SMTP passed. Two additive migrations passed backup/restore and the
17-file schema-only rehearsal. This closes those report workflow slices only.
Remaining sections/AI recap, full Facebook engine, complete Root coverage and
production-shaped rollback/cutover remain required. See REPORT_WORKFLOWS.md.


### Batch94 P1 first-comment timing checkpoint
Root-bounded delays now flow through composer/edit/CSV/template, duplication,
recycle, version save/restore, scoped UI/MCP reads and export. A neutral worker
continues due comments after confirmed per-destination publication, including
asynchronous status reconciliation. Scheduled inline comments enforce current
owner job access in addition to the original author. Attempts commit before
dispatch; uncertain/rejected results cannot auto-retry, malformed successful
responses cannot release a claim, and valid IDs can survive operation cancellation.
Local PostgreSQL,3216 tests, build/typecheck and four-theme/two-width Chromium/MCP
evidence are scoped in FIRST_COMMENT_SCHEDULING.md. This closes the local delayed-
comment implementation gap for the current supported format; native formats,
full live-provider delivery and broader publication/deletion release gates remain
open. Persistent receipt-storage failures remain held without a guaranteed
late-fact append; do not describe the entire Publishing/Facebook engine as done.

Notification delivery update, 2026-10-20: remaining legacy workspace event
producers now enqueue durable Settings intents with personal email switches and
current authority. See NOTIFICATIONS.md for exact event coverage and limits.
Migration remains unapplied, negative spikes require stored classified sentiment,
and runtime/provider/SMTP/concurrency evidence remains open. This does not close
the broader Notifications/integrations parity row.
