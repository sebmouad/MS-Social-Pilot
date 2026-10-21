# UI, REST and MCP parity inventory

Updated 2026-10-21 against local HEAD `1240a9ce` (merges since `8852d367`). This is a **source-level**
inventory using module MCP declarations, HTTP routes, shared services and the
lane matrices. It is not a fresh tools/list dump, real MCP-client run, database,
browser or provider verification. Full parity remains **partial**. The automated declaration guard and exact
mapping/exception policy are recorded below; they do not certify behavioral parity.

The target is identical capabilities and service-owned authorization, tenant and
resource scope, confirmations and domain audit through UI, REST and MCP. A tool
name or a transport-only confirmation is insufficient. Session, workspace-key,
selected-resource, person-key and installation authority remain distinct.

## Per-module status

| Module | Shared source coverage across UI / REST / MCP | Status and remaining limits |
| --- | --- | --- |
| Home | `readHomeOverview`, GET `/api/home/overview`, `get_home_overview` | Present; workspace-wide read intentionally refuses resource-limited keys |
| Publishing | Drafts, create/edit/import, lists/search/export, publish/retry/sync, schedule/reschedule/cancel/queue, approvals, deletion/recovery, first-comment send/retry/record, templates/labels/fields/notes/versions, saved views, mix/recycle/best times/media | Broad source coverage. Per-destination schedule modes flow through session REST, key REST v1 and MCP. Draft aliases and REST v1 create now use confirmed `api-writes` lifecycle boundaries (`acb56bd7`); real scheduling/provider and remaining write-boundary evidence stay partial |
| Inbox | List/thread/sync/reply/resolve, nested replies/reviews, moderation/deletion/recovery, productivity, assignment/notes/saved replies and contact details | Broad source coverage; GET `/api/inbox/threads/[key]/details` calls `readInboxContactDetails` (added in `8852d367`). `bulkInboxAction` now has UI, `POST /api/inbox/bulk` and `bulk_inbox_action` (`f5c21c96`); mocked route tests only |
| Analytics | Overview/details/explorer/previous points, comparisons, posts/ad objects, demographics/history CSV, pins/goals, report exports/templates/schedules/runs/generation | Present at source; session HTTP and MCP share cores, key REST v1 delegates declared tools to host. Completeness of collected metrics and real transport/provider results remain unproven |
| Ads | Accounts/performance/directory/rows/exports/compare/status, creation choices, creative sources/image/create/assignment, change preview/apply/history/recovery | Present at source with session routes and key REST v1 through owning MCP groups. Live manager/grant/spend/creative outcomes remain partial |
| Settings connections | Directory/health, OAuth start, single/batch selection, disconnect preview/retain/delete | OAuth start UI/REST/session MCP share service; compatibility route also delegates. Single/batch MCP and REST selections call changeConnectionSelections; MCP and REST disconnect call changeConnectionDisconnect. Browser sends named retain/delete consent after final review. Targeted mocked transport and DOM tests cover caller parity; live client/provider and actual browser evidence remain separate |
| Settings account/security/keys | Profile/password/session reads and changes; authenticator begin/enable/disable, passkey removal; workspace/person key list/issue/revoke | Session-only tools now exist; old claim that account/key issuance has no MCP is superseded. Bearer credentials cannot manage credentials/security. General authentication/passkey ceremony remains interactive |
| Settings appearance | `appearanceSession`, GET/PATCH `/api/settings/appearance`, `get_appearance`, `update_appearance` | Shell ThemeProvider/mode toggle and Settings now share confirmed persistence (`2b42470b`); theme and mode are account-stored, cookies use Root lifetime, layout falls back to validated-session preferences. Cross-device/live persistence proof remains separate |
| Settings workspace/data/notifications | Policy/operations, team/invitations, profiles/watermark, notification preferences/items, snapshot/ZIP/jobs/erasure | Broad source coverage. Snapshot JSON is partial; never equate it with complete ZIP export. Recent-table/account supplementary coverage and deletion hooks are implemented; partial account export now has a session-only GET route, installed MCP tool and bilingual Account download control through the same service. Coverage remains partial. Purge-gate migration needs rehearsal integration and database proof; mail/concurrency remain open |
| Media | Image/video library, usage/holders/quota, guarded import and delete | Shared service/API/MCP; complete UI workflows and storage/runtime proof still partial |
| Feeds | Source CRUD/check modes plus recipe read/save/preview/run/pause/resume | Shared UI/REST/MCP. Recipe tools: `get_recipe_source`, `save_recipe_source`, `preview_recipe_source`, `run_recipe_planner`, `set_recipe_source_state`, `retry_recipe_slots`. Feature off by default on new installs; production log records live source/image work and 80 scheduled posts. Owner-recorded first-day 07:00 and 11:00 batches each published 10/10 with comments; full transport/browser/retry/pause-cancel recovery evidence remains separate |
| AI | Assist availability/write tools and HTTP/UI; report recap and stored sentiment use AI service internally | Present for advertised assist; internal jobs are not separate customer writes. OpenAI/Gemini limited live checks do not prove every consumer |
| Tasks | List/create/checklist/update/move/delete/comments | Same `performTaskAction`; exact write confirmations now in service and sent by UI/REST/MCP. Real concurrent database and browser checks remain scoped gaps |
| Agency | Overview/export via shared service, session Clients and workspace selection | Separate read-only person keys exist for overview; workspace keys cannot expand to person-wide reads. Session Clients/switching are present, not granted to person keys; REST switch versus MCP confirmation difference remains |
| Sharing | Review/share link CRUD/rotate/revoke, feedback, eligible channels, bio controls | Shared UI/API/MCP source; copy-only edits remain version checked without confirmation, access changes confirmed. Browser/public provider/data coverage remains partial |
| Integrations | Webhooks/secrets/test/history, REST v1 and OAuth connector services | Session MCP secret reveal/rotate exist; bearer tools stay secret-free. OAuth browser consent is interactive. Not all module APIs are key-authenticated v1 endpoints |
| Root | Configuration, operations/diagnostics/health, users/workspaces/plans/audit/errors, registration, installation transfer, connection refresh/disconnect/recovery | Private UI/HTTP/installation-session MCP source coverage; workspace/person keys excluded. Backups UI is read-only; full operator inventory/configuration remains partial |

## Key-authenticated REST v1

`/api/v1/analytics/[operation]` and `/api/v1/ads/[operation]` use module-owned
`server/rest.ts` and Integrations `keyToolEndpoint` (`cf2938a1`). The allowlist is
made from owning MCP groups; the host retains feature/resource ceilings,
confirmations, locks and receipts. GET refuses writes; POST passes JSON arguments.
Errors preserve safe attempt metadata. See [INTEGRATIONS.md](INTEGRATIONS.md).
Mocked route/host tests are not a live key/client verification of every tool.

## Explicit remaining deviations

- Inbox bulk REST is implemented; verify actual client/scope/provider outcomes.
- Appearance caller/persistence source gaps are closed; verify cross-device/session
  behavior beyond the scoped unit/render and system-mode browser evidence.
- Publishing draft aliases now call `createPublishingPost`, `updatePublishingPost`
  and `deletePublishingPost`, as do session REST; REST v1 create forwards exact
  `CREATE POST` consent to that boundary (`acb56bd7`). The old no-confirmation
  claim is superseded. Preserve actual lifecycle/scope and live evidence limits.
- Reconcile Agency workspace switching and Sharing copy-only save policy with
  the binding service contract.
- Partial account export is registered in HTTP/MCP and exposed in the bilingual
  Account UI with explicit coverage/exclusions. Mapping and targeted automated
  checks cover those surfaces; real browser/MCP/database verification remains open.
- Finish operational/configurable copy, localization and ownership gaps recorded
  in CONFIG_LITERAL_AUDIT.md; recheck after integration instead of repeating old
  lane claims (OAuth compatibility and batch-selection wiring are already fixed).
- Run a current cross-module auth/scope/confirmation matrix and actual MCP transport
  checks. Existing unit/render suites and older scoped probes do not prove all
  current module/credential combinations.

Authentication ceremonies, external provider consent and client-only navigation
have no equivalent autonomous tool operation; their underlying application
services/actions remain subject to the same authority. These boundaries do not
excuse missing customer capabilities.

Detailed matrices: [PARITY_PUBLISHING_INBOX.md](PARITY_PUBLISHING_INBOX.md),
[PARITY_ANALYTICS_ADS_SETTINGS.md](PARITY_ANALYTICS_ADS_SETTINGS.md). The current
source checks above supersede their stale integration warnings where named.

## Historical documentation follow-up verification — 2026-10-21

From `rebuild/`, `npx tsc --noEmit -p .` passed with zero errors. Targeted
`npx vitest run --no-cache` passed **60 tests / 6 files / zero skipped**:
`inbox-bulk-route` (18), `parity-connection-selection` (11),
`parity-connection-disconnect` (17), `ui-copy-coverage` (3),
`worker-shutdown` (6), `inbox-sync-fetch-then-write` (5), all under `tests/*.test.ts`.
These are source/mocked-unit/route checks; no fresh browser, PostgreSQL, real MCP
client, live provider or production evidence was collected. Only the eight owned
documents changed; no Root keys, schema version or source edits. No full suite,
servers, deploy or push. Architecture/delivery/handoff status updates are outside
this lane and must carry forward the caller and evidence gaps listed here.

## Automated declaration guard

`tests/parity-guard.test.ts` reads the following reviewed tables as its policy.
It imports **all** `installedMcpGroups()` tools (including unavailable-by-default
and session-only tools), plus the separate Agency person overview catalog. It
also imports private `rootToolDefinitions`, keeping installation authority separate
from customer manifest features. It compares exact names, feature ids and reviewed
read/write classification, then scans every `src/app/api/**/route.ts` export with the TypeScript parser.
Named re-exports and exported handler aliases count; Next's implicit HEAD/OPTIONS
do not. Root tools and routes are mapped under their separate installation authority;
authentication and protocol routes retain exact reasoned exclusions below. No prefix/wildcard exception is applied by the test.

Every tool must name an existing explicit HTTP method/path counterpart; every
exported method/path must be mapped back to tools or have an exact reasoned
exception. A new tool still fails even if a generic REST dispatcher could serve
it. A new method on an existing route also fails until reviewed. Deleted/stale
mappings, stale exceptions, unknown features and resource readTools fail.
Manifest pages are feature declarations, not operation declarations: each feature
must have a mapped tool or an explicit alias to a covered feature. This does not
invent a per-operation UI declaration that the current manifests do not contain.

This is a structural regression guard, **not evidence of equal authorization,
service calls, request schemas, confirmations, audit, real UI behavior, or live
MCP/provider outcomes**. Known service/confirmation deviations above remain open;
capability aliases below do not certify those paths. Read/write comes from the
MCP declaration, not HTTP verbs (some reads are POST and previews can be writes).
Action/view selectors are documented below; adding an action inside an existing
handler needs behavioral tests beyond this route-export inventory.

To extend a capability, review the actual service and transport first, add the
exact row(s), and run `npx vitest run tests/parity-guard.test.ts --no-cache` and
`npx tsc --noEmit -p .` from `rebuild/`. Do not generate expected entries from the
live catalog inside the test or add a blanket exclusion to make it pass.

<!-- parity-tools:start -->
| MCP tool | Feature | Access | REST method/path | Mapping review note |
| --- | --- | --- | --- | --- |
| get_home_overview | home/overview | read | GET /api/home/overview | Shared customer operation; transport arguments may differ. |
| get_ads_report_rows | ads/campaigns | read | GET /api/ads/report/rows | Shared customer operation; transport arguments may differ. |
| export_ads_report | ads/campaigns | read | GET /api/ads/report/export | Shared customer operation; transport arguments may differ. |
| list_ad_accounts | ads/campaigns | read | GET /api/ads/accounts | Shared customer operation; transport arguments may differ. |
| get_ad_creation_options | ads/campaigns | read | GET /api/ads/creation-options | Shared customer operation; transport arguments may differ. |
| get_ads_performance | ads/campaigns | read | GET /api/ads/performance | Shared customer operation; transport arguments may differ. |
| get_live_ad_status | ads/campaigns | read | POST /api/ads/object | POST reads a live object; MCP name differs from the HTTP object route. |
| create_ad_campaign | ads/campaigns | write | POST /api/ads/campaigns | Shared customer operation; transport arguments may differ. |
| create_ad_set | ads/campaigns | write | POST /api/ads/adsets | Shared customer operation; transport arguments may differ. |
| update_ad | ads/campaigns | write | POST /api/ads/actions | Shared customer operation; transport arguments may differ. |
| compare_ads_performance | ads/compare | read | GET /api/ads/compare | Shared customer operation; transport arguments may differ. |
| list_ads_objects | ads/objects | read | GET /api/ads/directory | Shared customer operation; transport arguments may differ. |
| get_ads_object | ads/objects | read | GET /api/ads/directory | GET directory with object identity; stored object detail, distinct from live status. |
| get_ads_management_options | ads/campaigns | read | GET /api/ads/management | Shared customer operation; transport arguments may differ. |
| get_ads_creative_image | ads/campaigns | read | GET /api/ads/management | Shared customer operation; transport arguments may differ. |
| list_ads_creative_sources | ads/campaigns | read | GET /api/ads/management | Shared customer operation; transport arguments may differ. |
| preview_ads_change | ads/campaigns | read | POST /api/ads/management | Shared customer operation; transport arguments may differ. |
| apply_ads_change | ads/campaigns | write | POST /api/ads/management | Shared customer operation; transport arguments may differ. |
| list_ads_changes | ads/campaigns | read | GET /api/ads/management | Shared customer operation; transport arguments may differ. |
| resolve_ads_change | ads/campaigns | write | POST /api/ads/management | Shared customer operation; transport arguments may differ. |
| list_ads_creatives | ads/campaigns | read | GET /api/ads/management | Shared customer operation; transport arguments may differ. |
| list_tasks | tasks/board | read | GET /api/tasks | Shared customer operation; transport arguments may differ. |
| get_task | tasks/board | read | GET /api/tasks/[id] | Shared customer operation; transport arguments may differ. |
| list_task_post_choices | tasks/board | read | GET /api/tasks/posts | Shared customer operation; transport arguments may differ. |
| create_task | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| create_task_checklist | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| update_task | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| move_task | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| delete_task | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| add_task_comment | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| delete_task_comment | tasks/board | write | POST /api/tasks | Shared customer operation; transport arguments may differ. |
| list_share_links | settings/sharing | read | GET /api/sharing/links | Shared customer operation; transport arguments may differ. |
| list_shareable_channels | settings/sharing | read | GET /api/sharing/channels | Shared customer operation; transport arguments may differ. |
| list_share_feedback | settings/sharing | read | GET /api/sharing/links/[id]/feedback | Shared customer operation; transport arguments may differ. |
| create_share_link | settings/sharing | write | POST /api/sharing/links | Shared customer operation; transport arguments may differ. |
| update_share_link | settings/sharing | write | PATCH /api/sharing/links/[id] | Shared customer operation; transport arguments may differ. |
| revoke_share_link | settings/sharing | write | POST /api/sharing/links/[id] | Shared customer operation; transport arguments may differ. |
| rotate_share_link | settings/sharing | write | POST /api/sharing/links/[id] | Shared customer operation; transport arguments may differ. |
| delete_share_link | settings/sharing | write | DELETE /api/sharing/links/[id] | Shared customer operation; transport arguments may differ. |
| get_bio_page | settings/bio | read | GET /api/sharing/bio | Shared customer operation; transport arguments may differ. |
| save_bio_page | settings/bio | write | PUT /api/sharing/bio | Shared customer operation; transport arguments may differ. |
| delete_bio_page | settings/bio | write | DELETE /api/sharing/bio | Shared customer operation; transport arguments may differ. |
| export_analytics_report | analytics/reports | read | GET /api/reports/export | Shared customer operation; transport arguments may differ. |
| get_analytics_posts | analytics/posts | read | GET /api/analytics/posts | Shared customer operation; transport arguments may differ. |
| get_analytics_ad_objects | analytics/ads | read | GET /api/analytics/ad-objects | Shared customer operation; transport arguments may differ. |
| list_report_templates | analytics/reports | read | GET /api/analytics/report-workflows/templates | Shared customer operation; transport arguments may differ. |
| manage_report_template | analytics/reports | write | POST /api/analytics/report-workflows/templates | Shared customer operation; transport arguments may differ. |
| list_report_schedules | analytics/reports | read | GET /api/analytics/report-workflows/schedules | Shared customer operation; transport arguments may differ. |
| manage_report_schedule | analytics/reports | write | POST /api/analytics/report-workflows/schedules | Shared customer operation; transport arguments may differ. |
| list_report_runs | analytics/reports | read | GET /api/analytics/report-workflows/runs | Shared customer operation; transport arguments may differ. |
| generate_report | analytics/reports | write | POST /api/analytics/report-workflows/run | Shared customer operation; transport arguments may differ. |
| get_analytics_pins | analytics/pins | read | GET /api/analytics/pins | Shared customer operation; transport arguments may differ. |
| pin_analytics_metric | analytics/pins | write | POST /api/analytics/pins | Shared customer operation; transport arguments may differ. |
| unpin_analytics_metric | analytics/pins | write | POST /api/analytics/pins | Shared customer operation; transport arguments may differ. |
| reorder_analytics_pins | analytics/pins | write | POST /api/analytics/pins | Shared customer operation; transport arguments may differ. |
| get_analytics_goals | analytics/goals | read | GET /api/analytics/goals | Shared customer operation; transport arguments may differ. |
| set_analytics_goals | analytics/goals | write | POST /api/analytics/goals | Shared customer operation; transport arguments may differ. |
| get_analytics_demographics | analytics/demographics | read | GET /api/analytics/demographics | Shared customer operation; transport arguments may differ. |
| compare_analytics | analytics/compare | read | POST /api/analytics/comparison | Shared customer operation; transport arguments may differ. |
| get_analytics_explorer | analytics/explorer | read | GET /api/analytics/explorer | Shared customer operation; transport arguments may differ. |
| get_analytics_overview | analytics/overview | read | GET /api/analytics | Shared customer operation; transport arguments may differ. |
| get_analytics_metric_details | analytics/overview | read | GET /api/analytics | Analytics metric query selects detail; source-level capability correspondence only. |
| get_appearance | settings/appearance | read | GET /api/settings/appearance | Shared customer operation; transport arguments may differ. |
| update_appearance | settings/appearance | write | PATCH /api/settings/appearance | Shared customer operation; transport arguments may differ. |
| reveal_webhook_secret | settings/webhooks | write | POST /api/webhooks/[id]/secret/reveal | Shared customer operation; transport arguments may differ. |
| rotate_webhook_secret_once | settings/webhooks | write | POST /api/webhooks/[id]/secret | Shared customer operation; transport arguments may differ. |
| start_connection | settings/connections | write | POST /api/connections/[platform]/start | Shared customer operation; transport arguments may differ. |
| list_agency_clients | agency/clients | read | GET /api/agency | GET view=clients; browser sessions only, separate from person overview credentials. |
| select_workspace | settings/account | write | POST /api/workspaces/select | Browser-session operation in both transports; confirmation consistency remains a gap. |
| get_account_security | settings/account | read | GET /api/settings/account/security | Shared customer operation; transport arguments may differ. |
| begin_account_two_step | settings/account | write | POST /api/settings/account/security/setup | Shared customer operation; transport arguments may differ. |
| enable_account_two_step | settings/account | write | POST /api/settings/account/security/enable | Shared customer operation; transport arguments may differ. |
| disable_account_two_step | settings/account | write | POST /api/settings/account/security/disable | Shared customer operation; transport arguments may differ. |
| remove_account_passkey | settings/account | write | DELETE /api/settings/account/passkeys | Shared customer operation; transport arguments may differ. |
| export_account_data | settings/account | read | GET /api/settings/account/export | Session-only partial profile/appearance/safe-metadata export through exportAccountData; no workspace content or secrets. |
| get_account | settings/account | read | GET /api/settings/account | Shared customer operation; transport arguments may differ. |
| update_account_profile | settings/account | write | PATCH /api/settings/account | Shared customer operation; transport arguments may differ. |
| change_account_password | settings/account | write | POST /api/settings/account | Shared customer operation; transport arguments may differ. |
| list_account_sessions | settings/account | read | GET /api/settings/account/sessions | Shared customer operation; transport arguments may differ. |
| revoke_account_session | settings/account | write | DELETE /api/settings/account/sessions | Shared customer operation; transport arguments may differ. |
| list_mcp_keys | settings/mcp | read | GET /api/settings/mcp-keys | Shared customer operation; transport arguments may differ. |
| create_mcp_key | settings/mcp | write | POST /api/settings/mcp-keys | Shared customer operation; transport arguments may differ. |
| revoke_mcp_key | settings/mcp | write | DELETE /api/settings/mcp-keys | Shared customer operation; transport arguments may differ. |
| list_person_mcp_keys | settings/account | read | GET /api/settings/account/person-keys | Shared customer operation; transport arguments may differ. |
| create_person_mcp_key | settings/account | write | POST /api/settings/account/person-keys | Shared customer operation; transport arguments may differ. |
| revoke_person_mcp_key | settings/account | write | DELETE /api/settings/account/person-keys | Shared customer operation; transport arguments may differ. |
| list_workspace_exports | settings/data | read | GET /api/settings/data/exports | Shared customer operation; transport arguments may differ. |
| request_workspace_export | settings/data | write | POST /api/settings/data/exports | Shared customer operation; transport arguments may differ. |
| download_workspace_export | settings/data | read | GET /api/settings/data/exports/[id] | Shared customer operation; transport arguments may differ. |
| list_channel_profiles | settings/connections | read | GET /api/settings/profiles | Shared customer operation; transport arguments may differ. |
| save_channel_group | settings/connections | write | POST /api/settings/profiles | Shared customer operation; transport arguments may differ. |
| delete_channel_group | settings/connections | write | POST /api/settings/profiles | Shared customer operation; transport arguments may differ. |
| set_channel_profile_labels | settings/connections | write | POST /api/settings/profiles | Shared customer operation; transport arguments may differ. |
| get_workspace_watermark | settings/workspace | read | GET /api/settings/watermark | Shared customer operation; transport arguments may differ. |
| save_workspace_watermark | settings/workspace | write | POST /api/settings/watermark | Shared customer operation; transport arguments may differ. |
| remove_workspace_watermark | settings/workspace | write | POST /api/settings/watermark | Shared customer operation; transport arguments may differ. |
| apply_image_watermark | publishing/posts | write | POST /api/settings/watermark | Shared customer operation; transport arguments may differ. |
| list_workspace_invitations | settings/team | read | GET /api/settings/team/invitations | Shared customer operation; transport arguments may differ. |
| invite_workspace_member | settings/team | write | POST /api/settings/team/invitations | Shared customer operation; transport arguments may differ. |
| revoke_workspace_invitation | settings/team | write | DELETE /api/settings/team/invitations | Shared customer operation; transport arguments may differ. |
| list_workspace_team | settings/team | read | GET /api/settings/team | Shared customer operation; transport arguments may differ. |
| add_workspace_member | settings/team | write | POST /api/settings/team | Shared customer operation; transport arguments may differ. |
| update_workspace_member | settings/team | write | PATCH /api/settings/team | Shared customer operation; transport arguments may differ. |
| remove_workspace_member | settings/team | write | DELETE /api/settings/team | Shared customer operation; transport arguments may differ. |
| get_workspace_policies | settings/workspace | read | GET /api/settings/workspace/policy | Shared customer operation; transport arguments may differ. |
| update_workspace_policies | settings/workspace | write | POST /api/settings/workspace/policy | Shared customer operation; transport arguments may differ. |
| get_workspace_operations | settings/workspace | read | GET /api/settings/workspace/operations | Shared customer operation; transport arguments may differ. |
| update_workspace_operations | settings/workspace | write | POST /api/settings/workspace/operations | Shared customer operation; transport arguments may differ. |
| get_notification_preferences | settings/notifications | read | GET /api/notifications | Shared customer operation; transport arguments may differ. |
| update_notification_preferences | settings/notifications | write | PUT /api/notifications | Shared customer operation; transport arguments may differ. |
| list_notifications | settings/notifications | read | GET /api/notifications | Shared customer operation; transport arguments may differ. |
| mark_notification_read | settings/notifications | write | PATCH /api/notifications | Shared customer operation; transport arguments may differ. |
| delete_notification | settings/notifications | write | DELETE /api/notifications | Shared customer operation; transport arguments may differ. |
| list_pages | settings/connections | read | GET /api/v1/pages | Shared customer operation; transport arguments may differ. |
| set_connection_selections | settings/connections | write | PATCH /api/connections | REST items array and MCP batch tool use the confirmed selection wrapper. |
| set_connection_selection | settings/connections | write | PATCH /api/connections | REST and MCP accept the same single payload and exact SET CONNECTION <kind> <id> ENABLED/DISABLED consent through changeConnectionSelections. |
| list_connections | settings/connections | read | GET /api/settings/connections | Shared customer operation; transport arguments may differ. |
| preview_connection_disconnect | settings/connections | read | POST /api/connections | Shared customer operation; transport arguments may differ. |
| disconnect_connection | settings/connections | write | DELETE /api/connections | REST and MCP call changeConnectionDisconnect; browser sends exact named RETAIN or DELETE RELATED DATA consent after review. Mocked transport/DOM evidence only. |
| preview_workspace_data_deletion | settings/data | read | POST /api/settings/data | Shared customer operation; transport arguments may differ. |
| export_workspace_archive | settings/data | read | GET /api/settings/data | Shared customer operation; transport arguments may differ. |
| export_workspace_data | settings/data | read | GET /api/settings/data/snapshot | Shared customer operation; transport arguments may differ. |
| delete_workspace_data | settings/data | write | DELETE /api/settings/data | Shared customer operation; transport arguments may differ. |
| get_best_times | publishing/posts | read | GET /api/publishing/best-times | Shared customer operation; transport arguments may differ. |
| list_post_templates | publishing/templates | read | GET /api/publishing/templates | Shared customer operation; transport arguments may differ. |
| create_post_template | publishing/templates | write | POST /api/publishing/templates | Shared customer operation; transport arguments may differ. |
| update_post_template | publishing/templates | write | PUT /api/publishing/templates/[id] | Shared customer operation; transport arguments may differ. |
| delete_post_template | publishing/templates | write | DELETE /api/publishing/templates/[id] | Shared customer operation; transport arguments may differ. |
| list_post_labels | publishing/labels | read | GET /api/publishing/labels | Shared customer operation; transport arguments may differ. |
| create_post_label | publishing/labels | write | POST /api/publishing/labels | Shared customer operation; transport arguments may differ. |
| update_post_label | publishing/labels | write | PUT /api/publishing/labels/[id] | Shared customer operation; transport arguments may differ. |
| delete_post_label | publishing/labels | write | DELETE /api/publishing/labels/[id] | Shared customer operation; transport arguments may differ. |
| list_saved_views | publishing/posts | read | GET /api/publishing/saved-views | Shared customer operation; transport arguments may differ. |
| create_saved_view | publishing/posts | write | POST /api/publishing/saved-views | Shared customer operation; transport arguments may differ. |
| delete_saved_view | publishing/posts | write | DELETE /api/publishing/saved-views/[id] | Shared customer operation; transport arguments may differ. |
| bulk_post_action | publishing/posts | write | POST /api/publishing/posts/bulk | Shared customer operation; transport arguments may differ. |
| get_post_labels | publishing/collaboration | read | GET /api/publishing/assignments | Shared customer operation; transport arguments may differ. |
| list_post_label_choices | publishing/collaboration | read | GET /api/publishing/labels | Collaboration label chooser uses the same label directory as the Labels screen. |
| assign_post_labels | publishing/collaboration | write | POST /api/publishing/assignments | Shared customer operation; transport arguments may differ. |
| list_custom_fields | publishing/collaboration | read | GET /api/publishing/custom-fields | Shared customer operation; transport arguments may differ. |
| create_custom_field | publishing/collaboration | write | POST /api/publishing/custom-fields | Shared customer operation; transport arguments may differ. |
| update_custom_field | publishing/collaboration | write | PUT /api/publishing/custom-fields/[id] | Shared customer operation; transport arguments may differ. |
| delete_custom_field | publishing/collaboration | write | DELETE /api/publishing/custom-fields/[id] | Shared customer operation; transport arguments may differ. |
| get_post_field_values | publishing/collaboration | read | GET /api/publishing/custom-fields/posts/[postId] | Shared customer operation; transport arguments may differ. |
| set_post_field_values | publishing/collaboration | write | PUT /api/publishing/custom-fields/posts/[postId] | Shared customer operation; transport arguments may differ. |
| list_post_notes | publishing/collaboration | read | GET /api/publishing/notes | Shared customer operation; transport arguments may differ. |
| add_post_note | publishing/collaboration | write | POST /api/publishing/notes | Shared customer operation; transport arguments may differ. |
| delete_post_note | publishing/collaboration | write | DELETE /api/publishing/notes/[id] | Shared customer operation; transport arguments may differ. |
| list_post_versions | publishing/collaboration | read | GET /api/publishing/versions | Shared customer operation; transport arguments may differ. |
| restore_post_version | publishing/collaboration | write | POST /api/publishing/versions | Shared customer operation; transport arguments may differ. |
| list_queue_times | publishing/queue | read | GET /api/publishing/queue-slots | Shared customer operation; transport arguments may differ. |
| replace_queue_times | publishing/queue | write | PUT /api/publishing/queue-slots | Shared customer operation; transport arguments may differ. |
| get_content_mix | publishing/queue | read | GET /api/publishing/content-mix | Shared customer operation; transport arguments may differ. |
| save_content_mix | publishing/queue | write | PUT /api/publishing/content-mix | Shared customer operation; transport arguments may differ. |
| set_content_mix_autofill | publishing/queue | write | PUT /api/publishing/content-mix | Shared customer operation; transport arguments may differ. |
| get_post_recycle | publishing/collaboration | read | GET /api/publishing/recycle | Shared customer operation; transport arguments may differ. |
| set_post_recycle | publishing/collaboration | write | PUT /api/publishing/recycle | Shared customer operation; transport arguments may differ. |
| list_workspace_images | publishing/media | read | GET /api/media | Shared customer operation; transport arguments may differ. |
| get_workspace_image | publishing/media | read | GET /api/media/[id] | Shared customer operation; transport arguments may differ. |
| delete_workspace_image | publishing/media | write | DELETE /api/media/[id] | Shared customer operation; transport arguments may differ. |
| upload_workspace_image | publishing/media | write | POST /api/media | Shared customer operation; transport arguments may differ. |
| list_posts | publishing/posts | read | GET /api/publishing/posts | Shared customer operation; transport arguments may differ. |
| export_posts | publishing/posts | read | GET /api/publishing/posts/export | Shared customer operation; transport arguments may differ. |
| create_draft | publishing/posts | write | POST /api/publishing/posts | Capability alias: create_post without scheduledAt. Closed in `acb56bd7`: same confirmed api-writes boundary as REST and canonical tool; mocked parity tests, no live-client proof. |
| update_draft | publishing/posts | write | PATCH /api/publishing/posts/[id] | Capability alias: update_post for a draft. Closed in `acb56bd7`: same confirmed api-writes boundary as REST and canonical tool; mocked parity tests, no live-client proof. |
| delete_draft | publishing/posts | write | DELETE /api/publishing/posts/[id] | Capability alias: delete_post with local deletion for a draft. Closed in `acb56bd7`: same confirmed api-writes boundary as REST and canonical tool; mocked parity tests, no live-client proof. |
| publish_post | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| send_first_comment | publishing/posts | write | POST /api/publishing/first-comments/[action] | Shared customer operation; transport arguments may differ. |
| retry_first_comment | publishing/posts | write | POST /api/publishing/first-comments/retry | Shared customer operation; transport arguments may differ. |
| record_first_comment_outcome | publishing/posts | write | POST /api/publishing/first-comments/[action] | Shared customer operation; transport arguments may differ. |
| sync_post_status | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| delete_post | publishing/posts | write | DELETE /api/publishing/posts/[id] | Shared customer operation; transport arguments may differ. |
| get_post_deletion_status | publishing/posts | read | GET /api/publishing/posts/[id]/deletion | Shared customer operation; transport arguments may differ. |
| finish_post_deletion | publishing/posts | write | POST /api/publishing/posts/[id]/deletion | Shared customer operation; transport arguments may differ. |
| record_post_deletion_outcome | publishing/posts | write | POST /api/publishing/posts/[id]/deletion | Shared customer operation; transport arguments may differ. |
| get_publication_status | publishing/posts | read | GET /api/publishing/recovery | Shared customer operation; transport arguments may differ. |
| record_publication_outcome | publishing/posts | write | POST /api/publishing/recovery | Shared customer operation; transport arguments may differ. |
| finish_publication_projection | publishing/posts | write | POST /api/publishing/recovery | Shared customer operation; transport arguments may differ. |
| adopt_legacy_publication | publishing/posts | write | POST /api/publishing/recovery | Shared customer operation; transport arguments may differ. |
| duplicate_post | publishing/posts | write | POST /api/publishing/duplicate | Shared customer operation; transport arguments may differ. |
| create_post | publishing/posts | write | POST /api/publishing/posts | POST accepts draft or scheduled content; REST v1 now forwards exact CREATE POST consent to the same confirmed boundary (`acb56bd7`). |
| update_post | publishing/posts | write | PATCH /api/publishing/posts/[id] | Shared customer operation; transport arguments may differ. |
| submit_post_for_approval | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| review_post | publishing/approvals | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| queue_post | publishing/queue | write | POST /api/publishing/queue | Shared customer operation; transport arguments may differ. |
| schedule_post | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| reschedule_post | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| import_posts | publishing/posts | write | POST /api/publishing/posts/import | Shared customer operation; transport arguments may differ. |
| cancel_scheduled_post | publishing/posts | write | POST /api/publishing/posts/[id]/[action] | Shared customer operation; transport arguments may differ. |
| list_inbox | inbox/conversations | read | GET /api/inbox | Shared customer operation; transport arguments may differ. |
| get_inbox_thread | inbox/conversations | read | GET /api/inbox/threads/[key] | Shared customer operation; transport arguments may differ. |
| reply_to_inbox | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| sync_inbox | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| get_inbox_deletion | inbox/conversations | read | GET /api/inbox/deletions | Shared customer operation; transport arguments may differ. |
| delete_inbox_comment | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| finish_inbox_deletion | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| set_inbox_resolved | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| get_inbox_contact_details | inbox/conversations | read | GET /api/inbox/threads/[key]/details | Shared customer operation; transport arguments may differ. |
| bulk_inbox_action | inbox/conversations | write | POST /api/inbox/bulk | Shared customer operation; transport arguments may differ. |
| moderate_inbox_comment | inbox/conversations | write | POST /api/inbox/actions | Shared customer operation; transport arguments may differ. |
| get_inbox_productivity | inbox/conversations | read | GET /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| list_inbox_saved_replies | inbox/conversations | read | GET /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| assign_inbox_item | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| add_inbox_private_note | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| delete_inbox_private_note | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| create_inbox_saved_reply | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| update_inbox_saved_reply | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| delete_inbox_saved_reply | inbox/conversations | write | POST /api/inbox/productivity | Shared customer operation; transport arguments may differ. |
| get_inbox_moderation | inbox/conversations | read | GET /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| create_inbox_moderation_rule | inbox/conversations | write | POST /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| update_inbox_moderation_rule | inbox/conversations | write | POST /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| delete_inbox_moderation_rule | inbox/conversations | write | POST /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| run_inbox_moderation_rules | inbox/conversations | write | POST /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| undo_inbox_moderation_action | inbox/conversations | write | POST /api/inbox/moderation | Shared customer operation; transport arguments may differ. |
| list_media_library | publishing/media | read | GET /api/media-library | Shared customer operation; transport arguments may differ. |
| import_media_from_url | publishing/media | write | POST /api/media-library | Shared customer operation; transport arguments may differ. |
| delete_media_asset | publishing/media | write | DELETE /api/media-library/[id] | Shared customer operation; transport arguments may differ. |
| list_content_feeds | publishing/feeds | read | GET /api/feeds | Shared customer operation; transport arguments may differ. |
| create_content_feed | publishing/feeds | write | POST /api/feeds | Shared customer operation; transport arguments may differ. |
| update_content_feed | publishing/feeds | write | PUT /api/feeds/[id] | Shared customer operation; transport arguments may differ. |
| delete_content_feed | publishing/feeds | write | DELETE /api/feeds/[id] | Shared customer operation; transport arguments may differ. |
| check_content_feed | publishing/feeds | write | POST /api/feeds/[id]/check | Shared customer operation; transport arguments may differ. |
| get_recipe_source | publishing/feeds | read | GET /api/feeds/wordpress | Shared customer operation; transport arguments may differ. |
| save_recipe_source | publishing/feeds | write | PUT /api/feeds/wordpress | Shared customer operation; transport arguments may differ. |
| preview_recipe_source | publishing/feeds | write | POST /api/feeds/wordpress/preview | Shared customer operation; transport arguments may differ. |
| run_recipe_planner | publishing/feeds | write | POST /api/feeds/wordpress/run | Shared customer operation; transport arguments may differ. |
| set_recipe_source_state | publishing/feeds | write | POST /api/feeds/wordpress/state | Shared customer operation; transport arguments may differ. |
| retry_recipe_slots | publishing/feeds | write | POST /api/feeds/wordpress/retry | Shared customer operation; transport arguments may differ. |
| get_ai_assist_status | publishing/posts | read | GET /api/ai | Shared customer operation; transport arguments may differ. |
| ai_assist_write | publishing/posts | write | POST /api/ai | Shared customer operation; transport arguments may differ. |
| list_webhooks | settings/webhooks | read | GET /api/webhooks | Shared customer operation; transport arguments may differ. |
| create_webhook | settings/webhooks | write | POST /api/webhooks | Shared customer operation; transport arguments may differ. |
| update_webhook | settings/webhooks | write | PATCH /api/webhooks/[id] | Shared customer operation; transport arguments may differ. |
| delete_webhook | settings/webhooks | write | DELETE /api/webhooks/[id] | Shared customer operation; transport arguments may differ. |
| rotate_webhook_secret | settings/webhooks | write | POST /api/webhooks/[id]/secret | Shared customer operation; transport arguments may differ. |
| test_webhook | settings/webhooks | write | POST /api/webhooks/[id]/test | Shared customer operation; transport arguments may differ. |
| list_webhook_deliveries | settings/webhooks | read | GET /api/webhooks/[id]/deliveries | Shared customer operation; transport arguments may differ. |
| redeliver_webhook_delivery | settings/webhooks | write | POST /api/webhooks/[id]/deliveries/[deliveryId] | Shared customer operation; transport arguments may differ. |
| get_agency_overview | agency/overview | read | GET /api/agency | Person overview catalog only; REST uses browser identity, MCP uses person identity; neither accepts workspace keys. |
<!-- parity-tools:end -->

The next table records additional REST entry points for the same named tools.
The dynamic v1 dispatcher rows enumerate today's tools explicitly; its existence
never auto-approves a newly declared tool.

<!-- parity-rest-aliases:start -->
| REST method/path | MCP tools | Reason |
| --- | --- | --- |
| POST /api/oauth/connections/[platform]/start | start_connection | Compatibility connection start delegates to the same session connection-start HTTP service. |
| GET /api/v1/posts | list_posts | Key-authenticated post directory; channel ceilings remain enforced. |
| POST /api/v1/posts | create_post | Key-authenticated create; exact CREATE POST confirmation now enforced by shared api-writes (`acb56bd7`). |
| POST /api/v1/posts/[id]/[action] | schedule_post, reschedule_post, cancel_scheduled_post, queue_post | Key-authenticated schedule/reschedule/cancel-schedule/queue selector; same lifecycle services. |
| GET /api/v1/webhooks | list_webhooks | Key-authenticated webhook directory. |
| POST /api/v1/webhooks | create_webhook | Key-authenticated webhook creation; secrets excluded. |
| DELETE /api/v1/webhooks/[id] | delete_webhook | Key-authenticated webhook deletion. |
| GET /api/v1/ads/[operation] | get_ads_report_rows, export_ads_report, list_ad_accounts, get_ad_creation_options, get_ads_performance, get_live_ad_status, compare_ads_performance, list_ads_objects, get_ads_object, get_ads_management_options, get_ads_creative_image, list_ads_creative_sources, preview_ads_change, list_ads_changes, list_ads_creatives | Explicit operation-name allowlist in this review; keyToolEndpoint dispatches the owning MCP groups, GET refuses writes. |
| POST /api/v1/ads/[operation] | get_ads_report_rows, export_ads_report, list_ad_accounts, get_ad_creation_options, get_ads_performance, get_live_ad_status, create_ad_campaign, create_ad_set, update_ad, compare_ads_performance, list_ads_objects, get_ads_object, get_ads_management_options, get_ads_creative_image, list_ads_creative_sources, preview_ads_change, apply_ads_change, list_ads_changes, resolve_ads_change, list_ads_creatives | Explicit operation-name allowlist in this review; keyToolEndpoint dispatches the owning MCP groups, GET refuses writes. |
| GET /api/v1/analytics/[operation] | export_analytics_report, get_analytics_posts, get_analytics_ad_objects, list_report_templates, list_report_schedules, list_report_runs, get_analytics_pins, get_analytics_goals, get_analytics_demographics, compare_analytics, get_analytics_explorer, get_analytics_overview, get_analytics_metric_details | Explicit operation-name allowlist in this review; keyToolEndpoint dispatches the owning MCP groups, GET refuses writes. |
| POST /api/v1/analytics/[operation] | export_analytics_report, get_analytics_posts, get_analytics_ad_objects, list_report_templates, manage_report_template, list_report_schedules, manage_report_schedule, list_report_runs, generate_report, get_analytics_pins, pin_analytics_metric, unpin_analytics_metric, reorder_analytics_pins, get_analytics_goals, set_analytics_goals, get_analytics_demographics, compare_analytics, get_analytics_explorer, get_analytics_overview, get_analytics_metric_details | Explicit operation-name allowlist in this review; keyToolEndpoint dispatches the owning MCP groups, GET refuses writes. |
<!-- parity-rest-aliases:end -->

These are exact intentional authority/protocol exceptions, not missing customer
features. Session-only tools that have REST peers remain in the main mapping;
being session-only alone does not exclude them. Root is outside the customer
catalog and has a separate installation MCP inventory and tests. Adding any new
Root/authentication method/path still fails until its own exception is reviewed.

Private Root operations are mapped separately from customer feature declarations.
They require a current installation-owner session; this table grants no workspace
or person credential access. Root resources read through these same tools.

<!-- parity-root-tools:start -->
| MCP tool | Authority | Access | REST method/path | Mapping review note |
| --- | --- | --- | --- | --- |
| list_root_activity | installation/root | read | GET /api/root/activity | listRootActivity. |
| export_root_activity | installation/root | read | GET /api/root/activity/export | exportRootActivity; complete redacted CSV and export audit. |
| get_root_backup_status | installation/root | read | GET /api/root/backups | readRootBackupStatus; recorded runs only. |
| get_root_diagnostics_summary | installation/root | read | GET /api/root/backups | readRootDiagnosticsSummary; the same combined HTTP backup response. |
| get_root_config | installation/root | read | GET /api/root/config | readConfig and safeConfigShape; HTTP additionally returns the availability catalog. |
| set_root_config | installation/root | write | PUT /api/root/config | saveConfig; MCP currently requires an extra transport confirmation, see boundary gaps below. |
| refresh_root_connection | installation/root | write | POST /api/root/connections/[id]/refresh | refreshRootConnection; same exact confirmation and domain audit. |
| preview_root_connection_deletion | installation/root | read | GET /api/root/connections/[id] | previewRootConnectionDeletion. |
| disconnect_root_connection | installation/root | write | POST /api/root/connections/[id] | disconnectRootConnection; retain/delete mode confirmation and audit. |
| list_root_connections | installation/root | read | GET /api/root/connections | listRootConnections. |
| get_root_diagnostics | installation/root | read | GET /api/root/diagnostics | listRootDiagnostics. |
| run_root_diagnostics | installation/root | write | POST /api/root/diagnostics | runRootDiagnostics; confirmed audited checks. |
| get_root_error | installation/root | read | GET /api/root/errors/[id] | getRootError. |
| set_root_error_resolved | installation/root | write | POST /api/root/errors/[id] | setRootErrorResolved; confirmation remains in each entry point. |
| list_root_errors | installation/root | read | GET /api/root/errors | listRootErrors. |
| list_root_inbox_deletions | installation/root | read | GET /api/root/inbox-deletions | listRootInboxDeletions. |
| confirm_root_inbox_deletion | installation/root | write | POST /api/root/inbox-deletions | confirmRootInboxDeletion; exact remote-verification attestation and audit. |
| transfer_root_installation | installation/root | write | POST /api/root/installation | transferInstallationOwnership; exact confirmation and audit. |
| transfer_root_workspace_ownership | installation/root | write | POST /api/root/lifecycle/ownership | transferWorkspaceOwnership; exact confirmation and audit. |
| get_root_lifecycle | installation/root | read | GET /api/root/lifecycle | loadRootLifecycle. |
| delete_root_user | installation/root | write | DELETE /api/root/lifecycle/users/[id] | deleteRootUser; exact confirmation and audit. |
| delete_root_workspace | installation/root | write | DELETE /api/root/lifecycle/workspaces/[id] | deleteRootWorkspace; exact confirmation and audit. |
| get_root_operations | installation/root | read | GET /api/root/operations | loadRootOperations. |
| update_root_plan | installation/root | write | PATCH /api/root/plans/[id] | updateRootPlan; exact confirmation and audit. |
| assign_root_plan | installation/root | write | POST /api/root/plans/assign | assignRootPlan; exact confirmation and audit. |
| list_root_plans | installation/root | read | GET /api/root/plans | listRootPlans; default view. |
| list_root_plan_history | installation/root | read | GET /api/root/plans | listRootPlanHistory; view=history. |
| list_root_subscribers | installation/root | read | GET /api/root/plans | listRootSubscribers; view=subscribers. |
| get_root_platform_publication_evidence | installation/root | read | GET /api/root/platform-publication-evidence | readRootPlatformPublicationEvidence. |
| run_root_platform_publication_action | installation/root | write | POST /api/root/platform-publication-evidence | runRootPlatformPublicationAction; module confirmation and audit. |
| list_root_post_deletions | installation/root | read | GET /api/root/post-deletions | listRootPostDeletions. |
| record_root_post_deletion_outcome | installation/root | write | POST /api/root/post-deletions | recordRootPostDeletionOutcome; exact attestation and audit. |
| export_root_privileges | installation/root | read | GET /api/root/privileges/export | exportRootPrivileges; bounded complete-or-refused CSV. |
| list_root_privileges | installation/root | read | GET /api/root/privileges | listRootPrivileges. |
| change_root_member_role | installation/root | write | POST /api/root/privileges | changeRootMemberRole; exact confirmation and audit. |
| list_root_publication_attempts | installation/root | read | GET /api/root/publication-attempts | listRootPublicationAttempts. |
| record_root_publication_outcome | installation/root | write | POST /api/root/publication-attempts | recordRootPublicationOutcome; action=record. |
| finish_root_publication_projection | installation/root | write | POST /api/root/publication-attempts | finishRootPublicationProjection; action=finish. |
| adopt_root_legacy_publication | installation/root | write | POST /api/root/publication-attempts | adoptRootLegacyPublication; action=adopt. |
| delete_root_unverified_registration | installation/root | write | DELETE /api/root/registration/accounts/[id] | controlRootRegistrationAccount; action=delete. |
| resend_root_registration_verification | installation/root | write | POST /api/root/registration/accounts/[id] | controlRootRegistrationAccount; action=resend. |
| revoke_root_invitation | installation/root | write | DELETE /api/root/registration/invitations/[id] | revokeRootRegistrationInvitation. |
| list_root_registration | installation/root | read | GET /api/root/registration | listRootRegistration. |
| sign_out_root_session | installation/root | write | DELETE /api/root/sessions/[id] | signOutRootSession. |
| list_root_sessions | installation/root | read | GET /api/root/sessions | listRootSessions. |
| manage_root_user | installation/root | write | PATCH /api/root/users/[id]; POST /api/root/users/[id]; PATCH /api/root/lifecycle/users/[id] | setRootUserDisabled / revokeRootUserSessions / resetRootUserTwoStep; lifecycle wrapper delegates to the same core. |
| list_root_users | installation/root | read | GET /api/root/users | loadRootUsers. |
| set_root_workspace_access | installation/root | write | PATCH /api/root/workspaces/[id]/access; PATCH /api/root/lifecycle/workspaces/[id] | setRootWorkspaceAccess; lifecycle wrapper delegates to the same core. |
| rename_root_workspace | installation/root | write | PATCH /api/root/workspaces/[id] | renameRootWorkspace; same exact confirmation, concurrency check and transactional audit. |
| create_root_workspace | installation/root | write | POST /api/root/workspaces | createRootWorkspace; same exact confirmation, active owner membership and transactional audit. |
| list_root_workspaces | installation/root | read | GET /api/root/workspaces | listRootWorkspaces; separately authenticated private dispatcher. |
<!-- parity-root-tools:end -->

The remaining 24 exceptions are authentication bootstrap/ceremonies, transport or
credential-protocol handling, and public-token authority. `/api/v1/me` describes
only the presented workspace key's grants, not another credential or customer
operation; it remains a credential-protocol exception. MCP HTTP itself cannot be
mapped to one of its own tools. Public review decisions stay bound to the share
token rather than granting authenticated workspace agents external reviewer
identity. Each exact reason follows; no private Root product read/write remains
excepted.

<!-- parity-rest-exceptions:start -->
| REST method/path | Reason |
| --- | --- |
| GET /api/auth/register | Public registration availability for account bootstrap; not authenticated customer workspace data. |
| GET /api/connections/[platform]/callback | Provider consent callback validates browser OAuth state; autonomous tools initiate consent through mapped start_connection. |
| GET /api/mcp | MCP HTTP transport negotiation/unsupported-stream response, not a product capability. |
| GET /api/v1/me | Credential introspection returns authenticated key grants/ceilings; protocol-specific identity metadata, not workspace product data. |
| POST /api/auth/invitations/accept | Interactive invitation redemption binds the current browser identity; workspace MCP credentials cannot bootstrap membership. |
| POST /api/auth/invitations/enroll | Interactive invitation account enrollment/verification ceremony; not an authenticated workspace operation. |
| POST /api/auth/invitations/preview | Invitation-token preview before joining; separate invitation authority, not workspace MCP access. |
| POST /api/auth/invitations/register | Interactive invited account creation; no authenticated workspace identity exists yet. |
| POST /api/auth/passkey/options | WebAuthn challenge/options require an interactive authenticator ceremony. |
| POST /api/auth/passkey/verify | WebAuthn challenge completion requires interactive browser/authenticator origin binding. |
| POST /api/auth/recovery/request | Unauthenticated account recovery request; not a workspace-authorized operation. |
| POST /api/auth/recovery/reset | Recovery-token-bound password reset; separate recovery authority from authenticated MCP. |
| POST /api/auth/register | Unauthenticated registration ceremony; no workspace credential exists yet. |
| POST /api/auth/sign-in | Interactive session bootstrap with account credentials; MCP consumes authenticated identities. |
| POST /api/auth/sign-out | Browser-session cookie termination; MCP credential revocation has its own mapped tools. |
| POST /api/auth/two-step/enroll | Pending-sign-in second-factor enrollment; distinct from mapped authenticated account security settings. |
| POST /api/auth/two-step/verify | Pending-sign-in verification; completes browser session bootstrap. |
| POST /api/auth/verify-email | Email-token ownership verification ceremony; separate pending-account authority. |
| POST /api/auth/verify-email/resend | Email ownership verification ceremony; separate pending-account authority. |
| POST /api/mcp | JSON-RPC protocol host dispatches the tools being inventoried; it is not their REST counterpart. |
| POST /api/oauth/authorize | Interactive OAuth client consent under browser identity; delegated clients cannot grant themselves consent. |
| POST /api/oauth/register | Public OAuth client bootstrap registration; separate protocol authority from workspace operations. |
| POST /api/oauth/token | OAuth authorization-code/refresh-token exchange; authentication protocol, not a product operation. |
| POST /api/sharing/public/[token]/decision | External reviewer share-token decision; separate public reviewer authority from workspace MCP. Authenticated link management/feedback reads stay mapped. |
<!-- parity-rest-exceptions:end -->

Manifest-only view aliases explicitly reuse covered feature capabilities. Neither
alias waives the target's service-owned authorization or UI verification.

<!-- parity-feature-aliases:start -->
| Manifest feature | Covered feature | Reason |
| --- | --- | --- |
| publishing/calendar | publishing/posts | Calendar presents the post directory and scheduling operations; no independent calendar operation is declared. |
| ads/overview | ads/campaigns | Account overview presents the same account/performance reads declared under ads/campaigns by MCP. |
<!-- parity-feature-aliases:end -->

Selector review: `/api/tasks` POST uses the task action union; Sharing link POST
selects rotate/revoke, PATCH edits copy/access; `/api/settings/profiles` POST and
`/api/settings/watermark` POST use their service action unions. Notifications GET
returns both preferences and items. Ads management GET uses capabilities,
creative-image, creative-sources, creatives or changes; POST uses preview/apply/
resolve. Directory GET selects list/detail. Publishing post `[action]` selects
publish, schedule, reschedule, cancel-schedule, submit, review or sync; first
comments `[action]` selects send/record; deletion POST uses finish/record;
recovery POST uses record/finish/adopt (sync also corresponds to sync_post_status).
Content-mix PUT uses save or setAutoFill. Inbox actions POST selects reply, sync,
resolve, delete, finish_delete or moderate; productivity/moderation POST use
service action unions, productivity GET optionally selects saved-replies.
Analytics pins POST selects pin/unpin/reorder; report workflows manage their
service action unions. These selectors explain many-tools-to-one-route mapping;
the guard checks exports, not the internals of those unions.


## Exception closure evidence — 2026-10-21

Removed all **48 private Root REST exceptions** and added an explicit reviewed
Root table covering **51 private tools**. Existing counterparts already shared
the named services except two missing MCP writes: `create_root_workspace` and
`rename_root_workspace` now call `createRootWorkspace` / `renameRootWorkspace`.
Both preserve service-owned exact confirmations and transactional domain audits;
the private dispatcher rechecks current installation-owner identity and refuses
workspace keys. Current Root name/identifier limits and default timezone are read
with `runtimeConfig`; no new Root keys or schema version change.

Mapping Root also exposed an existing reverse gap: `list_root_workspaces` had no
REST read. Added `GET /api/root/workspaces` through `listRootWorkspaces`, using the
Root directory page size, private session authorization, strict filters and
no-store responses. Source changes are limited to
`src/server/mcp/root-tools.ts` and `src/app/api/root/workspaces/route.ts`; test and
inventory changes are `tests/parity-guard.test.ts` and this document.

The guard now checks 238 customer/person tools plus 51 private Root tools, Root
resource read mappings, exact exported routes and 24 remaining authority/protocol
exceptions. It forbids reintroducing Root route exceptions. The original guard
had 10 tests; the expanded targeted file passes **21 tests / 1 file** with
`npx vitest run tests/parity-guard.test.ts --no-cache`. Tests exercise real
workspace service logic over mocked database calls, confirmation rejection,
current identity/key refusal, current Root limits, default/explicit timezone,
audit invocation/failure, inactive owners, purge holds, rename concurrency, and
the new directory route's authentication, filters and shared-service dispatch.
This is source and mocked automated evidence, not PostgreSQL transaction rollback,
a real MCP client, browser, provider or production evidence.

`npx tsc --noEmit -p .` passes with zero errors; `git diff --check` passes. No whole
suite, server, deploy, push or production operation was run. Changes are left in
the worktree for integration; linked Git metadata is outside writable roots.
Pre-existing untracked dependency links are unchanged.

### Boundary gaps requiring other owned files

Explicit mapping removes an inventory exemption; it does not certify every
historical Root caller's behavioral parity. These existing gaps were inspected
and remain open because service/UI files are outside this lane:

- `src/server/root/workspace-controls.ts`: move current Root identity checks and
  `root.workspaceNameMaxCharacters`, `root.identifierMaxCharacters` and timezone
  validation/defaulting into both workspace services. They currently own exact
  confirmations, persistence and domain audit, while identity/current Root limits
  are checked by the REST/MCP entry points. Recheck authority transactionally.
- `src/server/root/directory.ts`: accept an actor and enforce current Root authority
  inside `listRootWorkspaces`; update its UI and transport callers. Today the
  private dispatchers perform this check before the shared directory query.
- `src/server/config/store.ts` and Root config UI/callers: provide a shared confirmed
  Root configuration operation. REST `saveConfig` does not require the exact text
  demanded by MCP's `set_root_config`; do not claim confirmation parity from the
  mapping. MCP config read also omits HTTP's availability catalog.
- `src/server/root/legacy/errors.ts` and error UI/callers: reconcile the documented
  reversible no-confirmation service/REST action with MCP's extra transport
  confirmation. Service-owned audit exists; confirmation policy is inconsistent.
- Architecture, delivery plan and handoff owners must record the new Root mapping,
  two MCP writes, directory GET and these remaining boundary gaps.

Customer source findings were rechecked through `1240a9ce`: draft aliases and
REST v1 create are unified by `acb56bd7`; appearance callers/account persistence
are unified by `2b42470b`. Settings single-selection/disconnect callers and the
Agency/Sharing confirmation differences remain open. Closing 48 Root inventory
exceptions does not close the Root service-boundary gaps above. The 24 retained
exact exceptions are authority/protocol boundaries, not accepted product omissions.

## Catch-up evidence boundaries

Copy catalogs and schema/default fallback (`38ab34f4`, `fb42b056`, `93944199`,
`5e6841ee`) expand bilingual UI and service errors; they do not prove complete
localization. Recipe origin/status visibility has unit/render evidence. Browser
rounds 1–2 are Chromium/local production-build/synthetic-data evidence, with
unresolved findings and no Feeds table in round 2; see
[BROWSER_MATRIX_2026-10-21.md](BROWSER_MATRIX_2026-10-21.md). Owner-recorded recipe
publications/comments and post-insights probes in RELEASE_GATES_PLAN, plus the
owner's 11:00 batch report, establish those limited remote outcomes, not every
MCP tool or cleanup/recovery path. Analytics legacy rounds 1–3 extend the same
report generator behind UI/REST/MCP, with mocked transport/arithmetic/artifact
evidence; complete history, live clients and report download behavior stay open.

The current documentation lane adds no keys, source, routes or tools. Historical
lane test counts above describe their original runs; current validation is recorded
in AGENT_HANDOFF.md. Full parity remains partial.

## Partial personal account export exposure — 2026-10-21

`GET /api/settings/account/export` delegates to `accountHttp(request, 'export')`;
Settings installs the existing `ACCOUNT_EXPORT_MCP` group (`export_account_data`).
Both reach `exportAccountData` through the current session actor. Bearer/API-key
credentials remain refused. Account settings provides an English/French download
with explicit included/excluded coverage, pending state and safe retry guidance.
It validates JSON format/version, partial-coverage marker and exact UTF-8 bytes
before handing the file to the browser. Success describes preparation, not proof
of a locally saved file. Unmount aborts the request and suppresses late downloads.

No new Root registry keys: copy fields extend `settings.uiCopy.account.en/fr`,
and both service and UI consume `data.maxArchiveBytes`. Its description now
covers workspace archives and partial personal JSON. The integrator owns the
configuration schema-version bump and reconciliation of stored copy overrides.
The inventory now includes 239 customer/person tools (51 private Root tools).

Evidence: `npx tsc --noEmit -p .` passes with zero errors. Targeted Vitest with
`--no-cache` covers account-export UI (16), transport (6), service (8), parity
guard (22), and Settings copy parity (48). These are synthetic DOM/mocked checks;
no browser, live MCP, PostgreSQL, provider or production check was performed.
Complete portability, supplementary purge migration rehearsal and concurrency
proof remain open. No server, deployment or push was run in this lane.
