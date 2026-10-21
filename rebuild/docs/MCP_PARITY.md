# UI, REST and MCP parity inventory

Updated 2026-10-21 against local HEAD `6fb0e57f`. This is a **source-level**
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
| Publishing | Drafts, create/edit/import, lists/search/export, publish/retry/sync, schedule/reschedule/cancel/queue, approvals, deletion/recovery, first-comment send/retry/record, templates/labels/fields/notes/versions, saved views, mix/recycle/best times/media | Broad source coverage. Per-destination schedule modes flow through session REST, key REST v1 and MCP. v1 create retains a no-confirmation contract; confirmation uniformity and real scheduling/provider evidence remain partial |
| Inbox | List/thread/sync/reply/resolve, nested replies/reviews, moderation/deletion/recovery, productivity, assignment/notes/saved replies and contact details | Broad source coverage; GET `/api/inbox/threads/[key]/details` calls `readInboxContactDetails` (added in `8852d367`). `bulkInboxAction` now has UI, `POST /api/inbox/bulk` and `bulk_inbox_action` (`f5c21c96`); mocked route tests only |
| Analytics | Overview/details/explorer/previous points, comparisons, posts/ad objects, demographics/history CSV, pins/goals, report exports/templates/schedules/runs/generation | Present at source; session HTTP and MCP share cores, key REST v1 delegates declared tools to host. Completeness of collected metrics and real transport/provider results remain unproven |
| Ads | Accounts/performance/directory/rows/exports/compare/status, creation choices, creative sources/image/create/assignment, change preview/apply/history/recovery | Present at source with session routes and key REST v1 through owning MCP groups. Live manager/grant/spend/creative outcomes remain partial |
| Settings connections | Directory/health, OAuth start, single/batch selection, disconnect preview/retain/delete | OAuth start UI/REST/session MCP share service; compatibility route also delegates. REST single/batch selection and disconnect now use confirmed module services; batch UI/MCP share selection wrapper. Single MCP selection and disconnect MCP still confirm outside the lower core; browser disconnect payload is stale. See explicit caller fixes below |
| Settings account/security/keys | Profile/password/session reads and changes; authenticator begin/enable/disable, passkey removal; workspace/person key list/issue/revoke | Session-only tools now exist; old claim that account/key issuance has no MCP is superseded. Bearer credentials cannot manage credentials/security. General authentication/passkey ceremony remains interactive |
| Settings appearance | `appearanceSession`, GET/PATCH `/api/settings/appearance`, `get_appearance`, `update_appearance` | Settings surfaces covered; shell ThemeProvider still writes cookies directly, layout ignores account theme when cookie absent. Whole-app same-service requirement remains partial |
| Settings workspace/data/notifications | Policy/operations, team/invitations, profiles/watermark, notification preferences/items, snapshot/ZIP/jobs/erasure | Broad source coverage. Snapshot JSON is partial; never equate it with complete ZIP export. Real data coverage, mail and concurrency need feature-specific proof |
| Media | Image/video library, usage/holders/quota, guarded import and delete | Shared service/API/MCP; complete UI workflows and storage/runtime proof still partial |
| Feeds | Source CRUD/check modes plus recipe read/save/preview/run/pause/resume | Shared UI/REST/MCP. Recipe tools: `get_recipe_source`, `save_recipe_source`, `preview_recipe_source`, `run_recipe_planner`, `set_recipe_source_state`. Feature off by default on new installs; production log records live source/image work and 80 scheduled posts. Facebook delivery/comments, full transport/browser/recovery evidence remain separate |
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
- Finish Settings caller wiring after `f5c21c96`: `src/modules/settings/mcp.ts`
  single `set_connection_selection` should call `changeConnectionSelections`;
  `src/modules/settings/connections-mcp.ts` disconnect should call
  `changeConnectionDisconnect` rather than confirming only in the executor.
  `src/modules/settings/ui/connections/manager.tsx` must send the named
  `DISCONNECT <id> RETAIN` or `DISCONNECT <id> DELETE RELATED DATA` phrase to REST;
  its current missing retain/short `DELETE` payload is refused. Wrapper tests
  validate accepted single/batch and disconnect input, not these caller paths.
- Route global theme changes through the appearance service, propagate its
  cookie policy and use saved account preference when a valid cookie is absent.
- Reconcile REST v1 Posts create's no-confirmation exception, Agency workspace
  switching and Sharing copy-only save policy with the binding service contract.
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

## Documentation follow-up verification — 2026-10-21

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
compares their exact names, feature ids and declared read/write classification,
then scans every `src/app/api/**/route.ts` export with the TypeScript parser.
Named re-exports and exported handler aliases count; Next's implicit HEAD/OPTIONS
do not. Root and authentication routes are scanned too, with exact exclusions
below. No prefix/wildcard exception is applied by the test.

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
| set_connection_selection | settings/connections | write | PATCH /api/connections | Single selection is representable as one items entry in batch REST. MCP still uses lower core and different confirmation; caller unification remains a gap. |
| list_connections | settings/connections | read | GET /api/settings/connections | Shared customer operation; transport arguments may differ. |
| preview_connection_disconnect | settings/connections | read | POST /api/connections | Shared customer operation; transport arguments may differ. |
| disconnect_connection | settings/connections | write | DELETE /api/connections | REST confirmed wrapper versus MCP lower core; caller/confirmation parity remains a gap. |
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
| create_draft | publishing/posts | write | POST /api/publishing/posts | Capability alias: create_post without scheduledAt. Legacy MCP draft service/confirmation differs; behavioral parity remains a gap. |
| update_draft | publishing/posts | write | PATCH /api/publishing/posts/[id] | Capability alias: update_post for a draft. Legacy MCP draft service/confirmation differs; behavioral parity remains a gap. |
| delete_draft | publishing/posts | write | DELETE /api/publishing/posts/[id] | Capability alias: delete_post with local deletion for a draft. Legacy MCP draft service/confirmation differs; behavioral parity remains a gap. |
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
| create_post | publishing/posts | write | POST /api/publishing/posts | POST accepts draft or scheduled content; REST v1 alias has a known confirmation gap. |
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
| POST /api/v1/posts | create_post | Key-authenticated create; current no-confirmation policy remains an explicit behavioral gap. |
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

<!-- parity-rest-exceptions:start -->
| REST method/path | Reason |
| --- | --- |
| GET /api/root/activity/export | Private installation activity/audit inspection; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/activity | Private installation activity/audit inspection; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/backups | Private backup inventory read; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/config | Private installation configuration read/save; separate Root authority, outside customer installedMcpGroups. |
| PUT /api/root/config | Private installation configuration read/save; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/connections/[id]/refresh | Private cross-workspace connection inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/connections/[id] | Private cross-workspace connection inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/connections/[id] | Private cross-workspace connection inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/connections | Private cross-workspace connection inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/diagnostics | Private installation diagnostic execution/history; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/diagnostics | Private installation diagnostic execution/history; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/errors/[id] | Private installation error inspection/management; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/errors/[id] | Private installation error inspection/management; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/errors | Private installation error inspection/management; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/inbox-deletions | Private Inbox deletion recovery; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/inbox-deletions | Private Inbox deletion recovery; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/installation | Private installation transfer; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/lifecycle/ownership | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/lifecycle | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/lifecycle/users/[id] | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| DELETE /api/root/lifecycle/users/[id] | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/lifecycle/workspaces/[id] | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| DELETE /api/root/lifecycle/workspaces/[id] | Private user/workspace/ownership lifecycle; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/operations | Private installation operations inspection; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/plans/[id] | Private access-plan administration; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/plans/assign | Private access-plan administration; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/plans | Private access-plan administration; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/platform-publication-evidence | Private provider publication-evidence controls; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/platform-publication-evidence | Private provider publication-evidence controls; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/post-deletions | Private publication deletion recovery; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/post-deletions | Private publication deletion recovery; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/privileges/export | Private privilege inspection/export/control; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/privileges | Private privilege inspection/export/control; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/privileges | Private privilege inspection/export/control; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/publication-attempts | Private publication attempt inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/publication-attempts | Private publication attempt inspection/recovery; separate Root authority, outside customer installedMcpGroups. |
| DELETE /api/root/registration/accounts/[id] | Private registration/invitation/account control; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/registration/accounts/[id] | Private registration/invitation/account control; separate Root authority, outside customer installedMcpGroups. |
| DELETE /api/root/registration/invitations/[id] | Private registration/invitation/account control; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/registration | Private registration/invitation/account control; separate Root authority, outside customer installedMcpGroups. |
| DELETE /api/root/sessions/[id] | Private installation session inspection/revocation; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/sessions | Private installation session inspection/revocation; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/users/[id] | Private installation user administration; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/users/[id] | Private installation user administration; separate Root authority, outside customer installedMcpGroups. |
| GET /api/root/users | Private installation user administration; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/workspaces/[id]/access | Private installation workspace/access administration; separate Root authority, outside customer installedMcpGroups. |
| PATCH /api/root/workspaces/[id] | Private installation workspace/access administration; separate Root authority, outside customer installedMcpGroups. |
| POST /api/root/workspaces | Private installation workspace/access administration; separate Root authority, outside customer installedMcpGroups. |
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


## Automated guard evidence — 2026-10-21

Added `tests/parity-guard.test.ts` and the policy tables in this document only.
Inventory: **237 installed tools + 1 separate Agency person tool**, **266 exported
REST method/path pairs**: 194 mapped customer pairs and 72 exact protocol/private
Root exceptions. Two manifest view aliases reuse covered feature capabilities.
No product declaration fields, Root keys or schema-version changes were needed.

From `rebuild/`, `npx vitest run tests/parity-guard.test.ts --no-cache` passed
**10 tests / 1 file**, and `npx tsc --noEmit -p .` passed with **zero errors**.
Regression fixtures exercise new tools, new methods/routes (including Root),
removed counterparts, changed feature/write declarations, stale/unexplained/
overlapping exceptions, missing alias targets, exported-handler parsing and
malformed policy tables. No whole suite, server, browser, database, live MCP,
provider, deploy, push or production operation was run.

The first inventory probe passed assertions but could not write Vitest's results
cache through the pre-existing external node_modules link (EPERM); the final
successful run used `--no-cache`. This was a cache-path restriction, not runtime
product evidence. Completed changes remain in the worktree for integration;
linked Git metadata is outside this worker's writable roots.

Additional source finding: `create_draft`, `update_draft`, `delete_draft` still use
legacy `createLocalDraft`/`updateLocalDraft`/`deleteLocalDraft` helpers while HTTP
post CRUD uses lifecycle services. Their rows record customer capability aliases,
not same-service proof. Publishing owners must unify those paths and confirmations
or deliberately retire duplicate tools. Existing Settings selection/disconnect,
appearance and other confirmation gaps above remain outside this lane. Architecture,
delivery-plan and handoff owners should record this guard and its limited evidence;
those files are outside the worker's assigned paths.
