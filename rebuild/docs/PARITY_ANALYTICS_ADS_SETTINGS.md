# Analytics, Ads, Settings, Tasks and Agency action parity

Source audit updated 2026-10-21 against local HEAD `6fb0e57f`. This is a capability/action matrix, not a
release-completion claim. Paths below are relative to `rebuild/src/`.
Earlier batch ownership, new-key lists and verification totals below are historical
lane records. This documentation-only follow-up changes no source or Root keys.

**Evidence:** `Present` means source entry points call the indicated core; it does
not mean browser, PostgreSQL, live provider or production verification. `Added`
identifies this batch. `Gap` identifies an unresolved boundary/behavior. UI filters,
sort, paging, drill-down and reset are arguments to their read operation; they are
not additional writes. Copy/download/open actions consume the existing read receipt.
MCP writes require their tool's exact confirmation; all new account writes check
confirmation inside the shared service. Existing confirmation differences are
explicitly listed below rather than treated as equal capabilities.

## Analytics

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| Overview: select channels/ad accounts, dates; search/reset/page metrics | GET `/api/analytics` | `get_analytics_overview` | `modules/analytics/server/read.ts` snapshot; Present |
| Overview: previous-period/year comparison | GET `/api/analytics?compare=previous\|year` | `get_analytics_overview` (`compare`) | Same snapshot/comparison core; Present |
| Inspect metric series and channel/category details; page details | GET `/api/analytics?metric=…&pointPage=…&rowPage=…` | `get_analytics_metric_details` (`kind`, offsets) | Same snapshot; Present |
| Explore catalog; source/kind/search/resource/date filters | GET `/api/analytics/explorer` | `get_analytics_explorer` | `analytics/server/explorer.ts`; Present |
| Explorer: inspect metric, series and breakdown pages | GET `/api/analytics/explorer?metric=…&pointPage=…&rowPage=…` | `get_analytics_explorer` | Same explorer read; Present |
| Compare two periods | POST `/api/analytics/comparison` (`mode=period`) | `compare_analytics` | `analytics/comparison/server/comparison.ts`; Present |
| Compare disjoint channel groups | POST `/api/analytics/comparison` (`mode=channels`) | `compare_analytics` | Same comparison service; Present |
| Audience demographics: selection, date filters, snapshot/history disclosure | GET `/api/analytics/demographics` | `get_analytics_demographics` | `analytics/demographics/server/demographics.ts`; Present |
| Export demographics history CSV | GET `/api/analytics/demographics?format=csv` | `get_analytics_demographics` (`format=csv`) | Same demographics read/export; Present |
| Published-post analytics: dates/channels, measure sort, direction and paging | GET `/api/analytics/posts` | `get_analytics_posts` | `analytics/explorer-posts/service.ts`; Present |
| Ad-object analytics: dates/account/level/parent drill-down, sorting and paging | GET `/api/analytics/ad-objects` | `get_analytics_ad_objects` | `analytics/ad-objects/service.ts`; Present |
| Export ad-object analytics CSV | GET `/api/analytics/ad-objects?format=csv` | `get_analytics_ad_objects` (`format=csv`) | Same service; Present |
| Goals: choose channel, read this month’s goals/progress | GET `/api/analytics/goals` | `get_analytics_goals` | `analytics/goals/server/goals.ts`; Present |
| Save or clear monthly goals | POST `/api/analytics/goals` | `set_analytics_goals` | Same goals core; tool confirmation `SET ANALYTICS GOALS <channelId>`; exact confirmation enforced in service; Present |
| Pins: read own pins and metric choices | GET `/api/analytics/pins` | `get_analytics_pins` | `analytics/pins/server/pins.ts`; Present |
| Pin a metric | POST `/api/analytics/pins` (`action=pin`) | `pin_analytics_metric` | Same pin core; exact tool confirmation; Present |
| Unpin a metric | POST `/api/analytics/pins` (`action=unpin`) | `unpin_analytics_metric` | Same pin core; exact tool confirmation; Present |
| Reorder pins / save selected pin list | POST `/api/analytics/pins` (`action=reorder`) | `reorder_analytics_pins` | Same pin core; exact tool confirmation; Present |
| Reports: export overview/series/details/comparison CSV | GET `/api/reports/export` | **`export_analytics_report`** | Same `readAnalyticsSnapshot` + `analyticsSnapshotCsv`; Added MCP; credential and Root row ceilings, explicit truncation |
| List report templates / page table | GET `/api/analytics/report-workflows/templates` | `list_report_templates` | `analytics/reports/server/templates.ts`; Present |
| Create report template | POST same (`action=create`) | `manage_report_template` (`action=create`) | Same template core; `CREATE REPORT TEMPLATE <name>`; Present |
| Edit template sections/name/period | POST same (`action=update`) | `manage_report_template` (`action=update`) | Same core; `UPDATE REPORT TEMPLATE <id>`; Present |
| Delete template | POST same (`action=delete`) | `manage_report_template` (`action=delete`) | Same core; `DELETE REPORT TEMPLATE <id>`; Present |
| List/page report schedules | GET `/api/analytics/report-workflows/schedules` | `list_report_schedules` | `analytics/reports/server/schedules.ts`; Present |
| Create weekly/monthly schedule and recipients | POST same (`action=create`) | `manage_report_schedule` (`action=create`) | Same schedule core; `CREATE REPORT SCHEDULE <channelId> <frequency>`; Present |
| Edit schedule / recipients / template | POST same (`action=update`) | `manage_report_schedule` (`action=update`) | Same core; `UPDATE REPORT SCHEDULE <id>`; Present |
| Delete schedule | POST same (`action=delete`) | `manage_report_schedule` (`action=delete`) | Same core; `DELETE REPORT SCHEDULE <id>`; Present |
| Read/page run and delivery history | GET `/api/analytics/report-workflows/runs` | `list_report_runs` | `analytics/reports/generation/runs.ts`; Present |
| Prepare a schedule's most recent period | POST `/api/analytics/report-workflows/run` (`scheduleId`) | `generate_report` (`scheduleId`) | Report generation core; UUID retry identity, exact confirmation; Present |
| Prepare a channel report with explicit dates/template | POST same (`channelId,start,end`) | `generate_report` | Same core; `GENERATE CHANNEL REPORT <channelId>`; Present |
| Download prepared CSV / printable HTML (JSON also returned) | Consume generation receipt | Consume `generate_report` result | Same stored generation result; prepared is separate from sent; Present |

## Ads

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| List selected accessible ad accounts / page directory | **GET `/api/ads/accounts`** | `list_ad_accounts` | **`ads/server/performance.ts:listAdsAccounts`**, fresh authority/independent account ceiling; Added REST/shared read |
| Accounts/campaigns: dates/preset/account/level filters and paging | **GET `/api/ads/performance`** | `get_ads_performance` | **`ads/server/performance.ts:readAdsPerformance`**, same dataset and summary functions used by screens; Added REST/shared read |
| Inspect stored action measures and daily rows, page rows | GET `/api/ads/report/rows` | `get_ads_report_rows` | `ads/server/report-read.ts`; Present |
| Export complete bounded stored report CSV | GET `/api/ads/report/export` | `export_ads_report` | `ads/server/export.ts`; Present |
| Browse objects with search/status/level/parent filters and sort/paging | GET `/api/ads/directory` | `list_ads_objects` | `ads/directory/server.ts`; Present |
| Inspect stored object detail / series / available actions | GET `/api/ads/directory?objectId=…` | `get_ads_object` | Same directory service; Present |
| Read stored-history-verified live status | POST `/api/ads/object` | `get_live_ad_status` | `ads/server/actions.ts:readWorkspaceAdObject`; Present; read-only POST |
| Compare periods or object performance | GET `/api/ads/compare` | `compare_ads_performance` | `ads/analysis/server.ts`; Present |
| Export comparison / object-performance CSV | GET `/api/ads/compare?format=csv&exportKind=…` | `compare_ads_performance` (`format=csv`, `exportKind`) | Same comparison export; Present |
| Read account-specific campaign/ad-set creation choices | **GET `/api/ads/creation-options?adAccountId=…`** | `get_ad_creation_options` | **`ads/server/creation-options.ts`**, current manager and account checks; Added REST/shared read |
| Read usable neutral management operations and current limits | GET `/api/ads/management?view=capabilities&adAccountId=…` | **`get_ads_management_options`** | `ads/management/server.ts:describeAdsManagement`; Added MCP |
| Create paused campaign | POST `/api/ads/campaigns` (or management apply) | `create_ad_campaign` / `apply_ads_change` | `ads/server/actions.ts` → management journal; stable request ID and module-owned exact confirmation; Present |
| Create paused ad set under verified campaign | POST `/api/ads/adsets` (or management apply) | `create_ad_set` / `apply_ads_change` | Same journal; scope/confirmation/request ID enforced; Present |
| Browse selected channels and stored images for creative creation | GET `/api/ads/management?view=creative-sources` | `list_ads_creative_sources` | `listAdsCreativeSources`; Present |
| Preview selected stored image | GET `/api/ads/management?view=creative-image` | **`get_ads_creative_image`** | `readAdsCreativeImage`; Added MCP base64/MIME/byte receipt; same stored-image limits |
| Create unattached creative | POST `/api/ads/management` (`action=apply`, `operation.type=creative.create`) | `apply_ads_change` | Same management service; preview confirmation + stable request ID; Present |
| Browse creatives available for assignment | GET `/api/ads/management?view=creatives` | `list_ads_creatives` | `listAdsCreatives`; Present |
| Preview a management change and spend consequences | POST `/api/ads/management` (`action=preview`) | `preview_ads_change` | `previewAdsManagement`; Present |
| Edit object name | POST `/api/ads/management` (`action=apply`, `type=rename`) | `apply_ads_change` | `performAdsManagement`; exact preview confirmation/request identity; Present |
| Activate/pause campaign, ad set or ad | POST `/api/ads/actions` or management apply (`type=status.set`) | `update_ad` / `apply_ads_change` | Same durable management core; Present |
| Change daily/lifetime budget | POST `/api/ads/actions` or management apply (`type=budget.set`) | `update_ad` / `apply_ads_change` | Same durable core, currency stays account-specific; Present |
| Assign creative to ad | POST `/api/ads/management` (`action=apply`, `type=creative.assign`) | `apply_ads_change` | Same durable core; Present when advertised by account |
| Delete supported object | POST `/api/ads/management` (`action=apply`, `type=delete`) | `apply_ads_change` | Same durable core; Present when advertised by account |
| Read/page change history | GET `/api/ads/management?view=changes` | `list_ads_changes` | `listAdsOperations`; Present |
| Resolve an unknown/pending outcome after external review | POST `/api/ads/management` (`action=resolve`) | `resolve_ads_change` | `resolveAdsOperation`; exact resolve/recover confirmation, no remote resend; Present |

## Settings

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| View discovered/selected connections and health | **GET `/api/settings/connections?offset=…`** | `list_connections` | **`settings/server/connection-directory.ts`** with fresh manager/tenant/feature checks + shared `listConnections`/health; Added REST/shared paginated read |
| Connect/reconnect provider: start authorization | POST `/api/oauth/connections/[platform]/start` | `start_connection` | `settings/server/connection-start.ts`; same exact `START CONNECTION <platform>`, current session/manager/platform checks, audit and provider-owned state cookies. Returns authorization URL only; Added. Compatibility `/api/connections/[platform]/start` also delegates to `connectionStartHttp` |
| Complete provider consent | Provider authorization URL then existing callback | Open `start_connection` receipt in the same signed-in browser | External provider consent requires human navigation; no app secret or replacement consent tool. Callback/state validation remains provider-owned |
| Enable/disable channel or ad account | PATCH `/api/connections` | `set_connection_selection` | `settings/server/connection-selection.ts:changeConnectionSelections` now validates single or batch consent for REST; single MCP still calls the lower core (see below) |
| Save multiple selection changes atomically | PATCH `/api/connections` | **`set_connection_selections`** | UI/REST/MCP use `changeConnectionSelections`; Root batch bound and exact `SET CONNECTION SELECTIONS <count>` checked before atomic scoped/audited core |
| Preview disconnect-related record counts | POST `/api/connections` | `preview_connection_disconnect` | `previewSocialAccountDeletion`; Present |
| Disconnect retaining related records | DELETE `/api/connections` (`mode=retain`) | `disconnect_connection` (`mode=retain`) | REST now uses `changeConnectionDisconnect`, requiring `DISCONNECT <id> RETAIN`; MCP still confirms in its executor before calling the lower core; browser payload mismatch below. Local credential removal only |
| Disconnect deleting related records | DELETE same (`mode=delete`) | `disconnect_connection` (`mode=delete`) | REST confirmed service requires `DISCONNECT <id> DELETE RELATED DATA`; MCP uses that phrase in its executor; browser still sends `DELETE` (open wiring gap) |
| Read channel groups/profile labels | GET `/settings/profiles/operations`; **GET `/api/settings/profiles`** | `list_channel_profiles` | `settings/channel-profiles/service.ts`; Added REST alias (existing module HTTP handler already serves UI route) |
| Create channel group | POST same (`action=saveGroup`) | `save_channel_group` | Same profile service; exact confirmation enforced in service; Present |
| Edit channel group | POST same (`action=saveGroup,id`) | `save_channel_group` | Same service; exact confirmation enforced in service; Present |
| Delete channel group | POST same (`action=deleteGroup`) | `delete_channel_group` | Same service; exact `DELETE CHANNEL GROUP <id>`; Present |
| Set/clear channel profile labels | POST same (`action=setLabels`) | `set_channel_profile_labels` | Same service; exact confirmation enforced in service; Present |
| Read watermark settings | GET `/settings/watermark/operations`; **GET `/api/settings/watermark`** | `get_workspace_watermark` | `settings/watermark/service.ts`; Added REST alias |
| Save watermark/logo | POST same | `save_workspace_watermark` | Same watermark service/confirmation; Present |
| Remove watermark | POST same | `remove_workspace_watermark` | Same watermark service/confirmation; Present |
| Apply watermark to a stored image | POST same | `apply_image_watermark` | Same image transformation core/confirmation; Present |
| View team, roles and assignable channels | GET `/api/settings/team` | `list_workspace_team` | `settings/server/team.ts`; Present |
| Add existing account with role/channel scope | POST `/api/settings/team` | `add_workspace_member` | Same team service, exact confirmation; Present |
| Edit member role/channel scope | PATCH `/api/settings/team` | `update_workspace_member` | Same team service, exact confirmation; Present |
| Remove workspace member | DELETE `/api/settings/team` | `remove_workspace_member` | Same team service, exact confirmation; Present |
| List pending/accepted/expired invitations | GET `/api/settings/team/invitations` | `list_workspace_invitations` | `settings/server/invitations.ts`; Present |
| Invite account by email/role/channel scope | POST same | `invite_workspace_member` | Same invitation service, exact confirmation, delivery availability gate; Present |
| Revoke pending invitation | DELETE same | `revoke_workspace_invitation` | Same invitation service, exact confirmation; Present |
| Read workspace timezone/approval policy | GET `/api/settings/workspace/policy` | `get_workspace_policies` | `settings/server/workspace-policy.ts`; Present |
| Save timezone/approval policy | POST same | `update_workspace_policies` | Same policy service, exact confirmation; Present |
| Read workspace publishing operations | GET `/api/settings/workspace/operations` | `get_workspace_operations` | `settings/server/workspace-operations.ts`; Present |
| Save operational choices, including best-time mode | POST same | `update_workspace_operations` | Same operations service, exact confirmation; Present |
| Read own account/profile/password policy | **GET `/api/settings/account`** | **`get_account`** | **`settings/server/account.ts`**; Added shared service/read/tool; browser session only |
| Save profile name | PATCH `/api/settings/account` | **`update_account_profile`** | Same service; `UPDATE ACCOUNT PROFILE`; UI uses shared confirmation dialog; Added MCP/refactored REST |
| Change password and revoke other sessions | POST `/api/settings/account` | **`change_account_password`** | Same service; `CHANGE ACCOUNT PASSWORD`, verifies current password, compare-and-set hash, content-free audit; Added MCP/refactored REST |
| List/page own active sessions | GET `/api/settings/account/sessions?offset=…` | **`list_account_sessions`** | Same service; current session identified, hashes removed, Root/key ceiling; Added MCP/refactored REST |
| Revoke another active session | DELETE `/api/settings/account/sessions` | **`revoke_account_session`** | Same service; `REVOKE ACCOUNT SESSION <id>`, cannot revoke current/foreign session; Added MCP/refactored REST |
| Read account security | GET `/api/settings/account/security` | `get_account_security` | Session-only account-security service; no bearer credential management |
| Begin / enable / disable authenticator | POST `/api/settings/account/security/{setup,enable,disable}` | `begin_account_two_step` / `enable_account_two_step` / `disable_account_two_step` | Shared session service, current identity/confirmation and code/password checks; enrollment remains an interactive ceremony |
| Remove own passkey | DELETE `/api/settings/account/passkeys` | `remove_account_passkey` | Shared session service, exact confirmation; verify actual browser/security outcomes separately |
| Read/change appearance | GET/PATCH `/api/settings/appearance` | `get_appearance` / `update_appearance` | `settings/server/appearance.ts`; theme stored in existing `users.theme`, display mode cookie-only (no mode column). Same session authority, `UPDATE APPEARANCE`, transactional audit and cookies; Added. Settings picker uses this REST service |
| Preview workspace erasure | POST `/api/settings/data` | `preview_workspace_data_deletion` | `server/data-control`; Present |
| Export synchronous ZIP with media | GET `/api/settings/data` | **`export_workspace_archive`** | Same `server/data-control/archive.ts:exportWorkspaceArchive`; Added MCP |
| Export redacted direct-record JSON snapshot | **GET `/api/settings/data/snapshot`** | `export_workspace_data` | Same `exportWorkspaceData`; Added REST. This is explicitly a partial snapshot, not the ZIP archive |
| Request durable ZIP export | POST `/api/settings/data/exports` | `request_workspace_export` | `settings/server/exports.ts`; exact `REQUEST WORKSPACE EXPORT <workspaceId>`; Present |
| List export jobs/status/expiry | GET `/api/settings/data/exports` | `list_workspace_exports` | Same exports service; Present |
| Download ready unexpired ZIP | GET `/api/settings/data/exports/[id]` | `download_workspace_export` | Same exports service; Present |
| Erase workspace records/media, preserve identity/team | DELETE `/api/settings/data` | `delete_workspace_data` | `deleteWorkspaceData`; scoped tool confirmation maps to core `DELETE`; Present |
| Read own notification preferences / mutes | GET `/api/notifications` (returns preferences and items) | `get_notification_preferences` | `settings/notifications/server.ts`; Present |
| Save notification preferences / channel mutes | PUT `/api/notifications` | `update_notification_preferences` | Same core; `UPDATE NOTIFICATION PREFERENCES`; Present |
| List/page/filter unread notifications | GET `/api/notifications` | `list_notifications` | Same core; Present |
| Mark notification read | PATCH `/api/notifications?id=…` | `mark_notification_read` | Same core; exact `READ NOTIFICATION <id>`; Present |
| Delete notification | DELETE `/api/notifications?id=…` | `delete_notification` | Same core; exact `DELETE NOTIFICATION <id>`; Present |
| List workspace MCP keys/history | GET `/api/settings/mcp-keys?offset=…` | **`list_mcp_keys`** | **`settings/mcp-access/server.ts:listMcpKeys`**; UI/REST/MCP share bounded safe directory; Added MCP/refactored read |
| Issue scoped workspace MCP key | POST `/api/settings/mcp-keys` | **`create_mcp_key`** | Existing `issueMcpKey`; exact confirmation, secret returned once; Added session-only MCP |
| Revoke workspace MCP key | DELETE `/api/settings/mcp-keys` | **`revoke_mcp_key`** | Existing `revokeMcpKey`; exact confirmation; Added session-only MCP |
| List own Agency person keys | GET `/api/settings/account/person-keys` | **`list_person_mcp_keys`** | `settings/person-keys/service.ts:listPersonKeys`; Added session-only MCP |
| Issue Agency overview person key | POST same | **`create_person_mcp_key`** | Existing `issuePersonKey`; exact `CREATE AGENCY KEY <name> <days> DAYS`; Added session-only MCP |
| Revoke own Agency person key | DELETE same | **`revoke_person_mcp_key`** | Existing `revokePersonKey`; exact `REVOKE AGENCY KEY <id>`; Added session-only MCP |
| Copy/show one-time key token | Local UI receipt action | Consume create result | No separate persisted mutation; token never appears in list APIs/tools |

## Settings: sharing, bio and webhooks (source owned by other modules)

These screens are installed in Settings navigation, but their services/tools are
owned by `modules/sharing` and `modules/integrations`. Round 2 adds a thin Settings-owned session guard for secret-bearing responses; all webhook rules, confirmation, rate limits and audit remain in the original Integrations service. No Integrations product logic is duplicated.

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| List/page client share links | GET `/api/sharing/links` | `list_share_links` | `modules/sharing/server`; Present |
| Discover shareable channel choices | GET `/api/sharing/channels` | `list_shareable_channels` | Same `listShareableChannels` as UI picker, current sharing authority/scope and Root bound; Added REST |
| Create review/calendar/portal link | POST `/api/sharing/links` | `create_share_link` | Same sharing core; exact confirmation; Present |
| Edit title/description | PATCH `/api/sharing/links/[id]` | `update_share_link` | Version-checked shared update; existing confirmation gap for copy-only edits |
| Edit link access/resources/expiry | PATCH same | `update_share_link` | Same shared core; exact confirmation; replaces secret on access changes; Present |
| Revoke link | POST `/api/sharing/links/[id]` (`action=revoke`) | `revoke_share_link` | Same core; exact confirmation; Present |
| Rotate link | POST same (`action=rotate`) | `rotate_share_link` | Same core; exact confirmation; Present |
| Delete link/feedback | DELETE `/api/sharing/links/[id]` | `delete_share_link` | Same core; exact confirmation; Present |
| View/page recorded client feedback | GET `/api/sharing/links/[id]/feedback` | `list_share_feedback` | Same sharing core; Present |
| Copy/open newly issued public URL | Local receipt / public page navigation | Consume create/update/rotate result | Existing secrets are not recoverable from lists; Present |
| Read bio page and click counts | GET `/api/sharing/bio` | `get_bio_page` | Shared bio core; Present |
| Create/edit bio profile and ordered links | PUT `/api/sharing/bio` | `save_bio_page` | Same core; `SAVE BIO PAGE <slug>`; Present |
| Enable/disable public bio | PUT same (`enabled`) | `save_bio_page` | Same core/confirmation; Present |
| Delete bio page/click totals | DELETE same | `delete_bio_page` | Same core; `DELETE BIO PAGE <slug>`; Present |
| List webhook endpoints | GET `/api/webhooks` | `list_webhooks` | `modules/integrations/server`; Present |
| Create webhook | POST `/api/webhooks` | `create_webhook` | Same core; `CREATE WEBHOOK <name>`; Present |
| Enable/disable endpoint or edit events | PATCH `/api/webhooks/[id]` | `update_webhook` | Same core; `UPDATE WEBHOOK <id>`; Present |
| Delete webhook and delivery history | DELETE same | `delete_webhook` | Same core; `DELETE WEBHOOK <id>`; Present |
| Reveal signing secret in one response | POST `/api/webhooks/[id]/secret/reveal` | `reveal_webhook_secret` | Same `settings/server/webhook-secrets.ts` → Integrations reveal service: current session, manager/tenant/write checks, exact `REVEAL WEBHOOK SECRET <id>`, rate limit and committed content-free audit. Added session-only MCP; lists never return secrets |
| Rotate signing secret and return new secret once | POST `/api/webhooks/[id]/secret` | `rotate_webhook_secret_once` (session); existing `rotate_webhook_secret` remains secret-free | Same Settings session guard → Integrations rotation service; `ROTATE WEBHOOK SECRET <id>`; Added session-only result parity without widening bearer-key secret authority |
| Send test ping | POST `/api/webhooks/[id]/test` | `test_webhook` | Same core; exact `TEST WEBHOOK <id>`; Present |
| List/page delivery history | GET `/api/webhooks/[id]/deliveries` | `list_webhook_deliveries` | Same core; Present |
| Redeliver settled delivery | POST `/api/webhooks/[id]/deliveries/[deliveryId]` | `redeliver_webhook_delivery` | Same core; exact `REDELIVER WEBHOOK DELIVERY <id>`; Present |

## Tasks

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| List/filter status/assignee/overdue/text, page tasks and counts | GET `/api/tasks` | `list_tasks` | `tasks/server/tasks.ts:listTasks`; Present |
| Read task / page comment history | GET `/api/tasks/[id]?commentOffset=…` | `get_task` | `getTask`; Present |
| Search/page accessible posts for linking | GET `/api/tasks/posts` | `list_task_post_choices` | `listTaskPostChoices`; Present |
| Create task with assignee/due date/post link | POST `/api/tasks` (`action=task.create`) | `create_task` | `performTaskAction`; tool `CREATE TASK <title>`; Present; confirmation ledger below |
| Create checklist/batch with due-date spacing | POST same (`action=task.createMany`) | `create_task_checklist` | Same service; tool `CREATE <count> TASKS`; Present |
| Edit title/notes/assignee/due date | POST same (`action=task.update`) | `update_task` | Same service; stale timestamp refused; tool `UPDATE TASK <id>`; Present |
| Link/unlink post on task | POST same (`action=task.update`, `postId`) | `update_task` | Same service; resource visibility rechecked; Present |
| Move task status | POST same (`action=task.transition`) | `move_task` | Same service; tool `MOVE TASK <id> TO <status>`; Present |
| Delete task and comments | POST same (`action=task.delete`) | `delete_task` | Same service; `DELETE TASK <id>`; Present |
| Add task comment | POST same (`action=comment.add`) | `add_task_comment` | Same service; tool `COMMENT ON TASK <id>`; Present |
| Delete own comment / moderate as manager | POST same (`action=comment.delete`) | `delete_task_comment` | Same service; `DELETE TASK COMMENT <id>`; Present |

## Agency

| Customer action / UI | REST | MCP tool | Shared core / status |
| --- | --- | --- | --- |
| Overview search/sort/order/attention filter | GET `/api/agency` | `get_agency_overview` through person credential dispatcher | `agency/server/agency.ts:agencyOverview`; Present; workspace keys excluded |
| Export filtered overview CSV/JSON | GET `/api/agency?format=csv\|json` | `get_agency_overview` (`format`) | `agency/server/export.ts`; Present |
| Client/member/invitation directory search | GET `/api/agency?view=clients` | `list_agency_clients` (session) | Same `listAgencyClients` per-workspace authority/entitlement/team filtering. Added session MCP registration; existing overview-only person keys remain overview-only |
| Enter a workspace / open its module or team | POST `/api/workspaces/select`, then navigate | `select_workspace` (session) | Shared `agency/server/workspace-selection.ts`: current session/member locks, suspended/purge guard, audit, browser cookie. Subsequent requests use selection; no credential scope changes. MCP requires `SELECT WORKSPACE <id>`; REST retains existing explicit-selection payload |
| Manage a client's team/invitation after switching | Settings team/invitation routes above | Team/invitation tools in that workspace | Same workspace services; Agency does not bypass per-workspace grants |

## Confirmation and authority ledger

This batch does **not** certify the existing implementations as uniformly confirmed:

- `f5c21c96` merged REST single/batch selection and retain/delete disconnect
  through confirmed module services. Batch UI/REST/MCP already share the selection
  wrapper. Source recheck still finds single MCP `set_connection_selection` in
  `settings/mcp.ts` confirming in its executor then calling `setConnectionSelections`;
  `settings/connections-mcp.ts` likewise calls `disconnectSocialAccount` directly.
  Route both through the module wrappers to make confirmation service-owned.
  `settings/ui/connections/manager.tsx` still submits `DELETE` for delete and no
  confirmation for retain: both now fail the stricter REST contract. Send the
  named `DISCONNECT <id> RETAIN|DELETE RELATED DATA` confirmation from the dialog.
  Mocked wrapper/REST tests pass; they do not prove browser/MCP callers are wired.
- Tasks now require and validate confirmation for every write inside
  `TASK_ACTION_SCHEMA` / `performTaskAction`. MCP preserves the value; REST and
  UI send the same create/checklist/update/move/comment/delete confirmations.
  Unit, HTTP, MCP and DOM fixtures were updated together. Database concurrency
  fixtures were updated but the six integration cases remain opt-in/skipped.
- Channel-group creation/editing and channel-label replacement now require exact
  `SAVE CHANNEL GROUP <name-or-id>` / `SET CHANNEL PROFILE LABELS <channelId>`
  inside the shared service. UI uses the shared confirmation dialog with Root
  English/French copy; MCP and REST submit the same tokens. Delete is unchanged.
- Sharing copy-only edits are version checked but do not require confirmation;
  access changes do. Sharing UI is excluded from this lane; requiring confirmation for those existing saves needs that UI owner to send it.
- New account profile/password/session-revocation services check exact confirmation
  and current feature write access, session identity, expiry/pending/disabled state;
  passwords use the existing password policy and audit helpers. Session-only MCP
  availability plus execution checks refuse every bearer key before cookie access.
  Issuing/revoking workspace/person keys uses their existing confirmed services.
  No existing Agency person key gained Clients or write authority.

## Integration work outside owned paths

1. `src/lib/config/registry.ts`: integrator increments `CONFIG_SCHEMA_VERSION` once
   for any unregistered Root keys in the round-specific lists below. This lane deliberately did not edit it.
2. OAuth compatibility delegation is complete: both start routes call
   `connectionStartHttp` in `modules/settings/server/connection-start-http.ts`.
   REST selection now uses `changeConnectionSelections` (no old fixed 250 route
   ceiling); REST disconnect uses `changeConnectionDisconnect`. Remaining edits
   are the single MCP selection/disconnect and browser disconnect callers named
   above; no provider-credential authority should expand to close these gaps.
3. Global appearance: `src/app/layout.tsx` still initializes from cookies/Root
   defaults only. Integrator should load the authenticated user's existing
   `users.theme` when there is no valid theme cookie, through the Settings service.
   Settings reads/writes and browser reload already consume the account preference.
   `components/ThemeProvider.tsx` and its shared shell controls still write a fixed
   cookie lifetime directly; route those changes through the same appearance
   REST service (mode stays cookie-only). Do not infer whole-app preference
   unification from the newly shared Settings picker.
4. Webhook aliases deliberately preserve existing bearer policy. The new
   `reveal_webhook_secret` and `rotate_webhook_secret_once` accept browser sessions
   only and use the same core as REST. There is no duplication of secret storage,
   generation, scope, rate limits, confirmations or audits. Integrations-owned
   explanatory comments saying no MCP reveal exists should be updated by that
   module's owner. Repeated explicit reveal remains possible, confirmed/rate-limited
   each time; “once” describes a response, not destruction of the signing key.
5. Agency session tools are registered through the Settings-installed catalog.
   Person credentials still store `readFeature=agency/overview` and intentionally
   cannot read Clients or switch browser workspaces. Adding those to person keys
   would require an explicit new grant/schema/host policy, not a silent upgrade.
6. Account helper ownership: `src/server/account-settings.ts` still owns product
   password/name/audit helpers. Move the product parts into Settings in a coordinated
   batch; this lane imports the existing shared policy/audit instead of editing it.
   General authentication/2FA workflows remain in their current auth routes/services;
   AccountScreen has no account-management controls for enabling/disabling 2FA or
   editing email. They are not marked implemented by this matrix.
7. Update `docs/ARCHITECTURE.md`, `docs/DELIVERY_PLAN.md` and `docs/AGENT_HANDOFF.md`
   with this matrix and the actual verification result when integrating. Those
   files were outside this worker's owned paths; this file holds continuation facts.

## New Root keys (module declarations only)

- `settings.connectionDirectoryPageSize`: discovered-source page bound.

- `settings.accountNameMaxLength`: profile validation/UI maximum.
- `settings.accountSessionPageSize`: active-session page bound.
- `settings.accountConfirmationCopy`: English/French account confirmation and
  shared account/key paging labels.
- `mcp.keys.historyPageSize`: safe workspace-key metadata page bound.
- `settings.connectionSelectionBatchSize`: confirmed bulk-selection bound;
  constrained to the current underlying service ceiling until that owner removes it.

## Verification and continuation

New tests exercise account/session authority and confirmation failures, password
compare-and-set and current-session preservation, token-free paging, session-only
MCP dispatch/credential-escalation refusals, REST identity/CSRF/query checks,
independent Ads resource ceilings and creation availability, Analytics export
scope/row ceilings, atomic selection confirmation and account confirmation UI.
Existing related key, Ads, Analytics and Settings tests are run separately from
any browser/database/live-provider proof. Exact final results are recorded below.

No servers, whole-suite run, deployment, production access or push is authorized
for this worker. Dependency symlinks are pre-existing and left untouched. Use
Vitest `--no-cache`: its default results-cache write fails through the worktree's
external dependency symlink. New Root keys need the integrator's schema-version
bump before release. Browser themes/viewports/keyboard, actual PostgreSQL,
provider operations and real MCP transport remain unverified.

Round 1 verification (historical): **247 tests passed in 17 targeted files**, no skips or
failures, using `npx vitest run --no-cache` from `rebuild/`. The cache-enabled
first run passed its assertions but failed writing the external dependency cache;
the successful final run disabled caching. `npx tsc --noEmit -p .` completed with
**0 errors**. `git diff --check` passed. No full suite or servers were run.

| Targeted test file | Passed |
| --- | ---: |
| `tests/parity-account-service.test.ts` | 12 |
| `tests/parity-account-mcp.test.ts` | 13 |
| `tests/parity-rest-surfaces.test.ts` | 11 |
| `tests/parity-ads-read-service.test.ts` | 3 |
| `tests/parity-analytics-export.test.ts` | 3 |
| `tests/parity-connection-selection.test.ts` | 4 |
| `tests/parity-connection-directory.test.ts` | 2 |
| `tests/ads-management-mcp74.test.ts` | 5 |
| `tests/settings-form-validation.test.ts` | 8 |
| `tests/account-settings.test.ts` | 3 |
| `tests/mcp-key-management.test.ts` | 3 |
| `tests/mcp-key-service80.test.ts` | 7 |
| `tests/channel-profiles-surfaces.test.ts` | 7 |
| `tests/mcp-ads-account-scope80.test.ts` | 11 |
| `tests/mcp-analytics-account-scope80.test.ts` | 8 |
| `tests/connections-mcp.test.ts` | 4 |
| `tests/mcp-security.test.ts` | 143 |

New account/credential tools are absent for all bearer keys. Newly issued bearer
keys cannot request the session-only Account/MCP-management features, and the
key-creation picker omits them. Account profile rendering reads the same shared
account service as REST/MCP. Shared Ads reads preserve an explicit credential
platform ceiling while intersecting current membership/plan/resource authority.
No provider-specific branching was introduced.

Changes remain in this worktree. Linked Git metadata is outside the sandbox's
writable roots; no commit, push, deployment or production change is claimed.

## Changed files

Complete batch inventory (paths relative to `rebuild/`; dependency symlinks excluded):

- `docs/PARITY_ANALYTICS_ADS_SETTINGS.md`
- `src/app/api/ads/accounts/route.ts`
- `src/app/api/ads/creation-options/route.ts`
- `src/app/api/ads/performance/route.ts`
- `src/app/api/settings/account/route.ts`
- `src/app/api/settings/account/sessions/route.ts`
- `src/app/api/settings/connections/route.ts`
- `src/app/api/settings/data/snapshot/route.ts`
- `src/app/api/settings/mcp-keys/route.ts`
- `src/app/api/settings/profiles/route.ts`
- `src/app/api/settings/watermark/route.ts`
- `src/modules/ads/management/mcp.ts`
- `src/modules/ads/mcp.ts`
- `src/modules/ads/server/access.ts`
- `src/modules/ads/server/creation-options.ts`
- `src/modules/ads/server/performance.ts`
- `src/modules/analytics/mcp.ts`
- `src/modules/settings/account-confirmation-copy.ts`
- `src/modules/settings/account-mcp.ts`
- `src/modules/settings/config.ts`
- `src/modules/settings/connections-mcp.ts`
- `src/modules/settings/mcp-access/server.ts`
- `src/modules/settings/mcp-access/session-policy.ts`
- `src/modules/settings/mcp.ts`
- `src/modules/settings/server/account-http.ts`
- `src/modules/settings/server/account-session.ts`
- `src/modules/settings/server/account.ts`
- `src/modules/settings/server/connection-directory.ts`
- `src/modules/settings/server/connection-selection.ts`
- `src/modules/settings/ui/account/AccountScreen.tsx`
- `src/modules/settings/ui/account/manager.tsx`
- `src/modules/settings/ui/mcp/McpScreen.tsx`
- `tests/ads-management-mcp74.test.ts`
- `tests/connections-mcp.test.ts`
- `tests/mcp-ads-account-scope80.test.ts`
- `tests/mcp-key-service80.test.ts`
- `tests/mcp-security.test.ts`
- `tests/parity-account-mcp.test.ts`
- `tests/parity-account-service.test.ts`
- `tests/parity-ads-read-service.test.ts`
- `tests/parity-analytics-export.test.ts`
- `tests/parity-connection-directory.test.ts`
- `tests/parity-connection-selection.test.ts`
- `tests/parity-rest-surfaces.test.ts`
- `tests/settings-form-validation.test.ts`


## Round 2 requested action coverage and remaining integration

Every action requested for this round now has a REST and authenticated MCP
entry point calling the same module service: OAuth startup, appearance read/save,
webhook reveal/rotate, Agency Clients, workspace selection and sharing channels.
Tasks and channel-profile write confirmations were also moved into their shared
services. English-first `Accept-Language` with French fallbacks now keeps the
Analytics Audience history heading in English; French-first remains French.

This is action/source coverage, **not a 100% end-to-end architecture or release
claim**. No requested application action intrinsically lacks a REST/MCP equivalent.
External provider consent still requires opening the returned authorization URL
in the same browser session that received its state cookies; consent is owned by
the external provider and cannot be replaced by an application tool. Browser-only
navigation, copying a receipt and applying a theme to the current document remain
client behavior; the underlying data/actions are exposed.

The old OAuth startup route, global theme shell writers/initialization and
connection-selection confirmation boundary still require the exact external
edits listed above. Existing sharing copy-only edits remain version checked but
unconfirmed; enforcing confirmations requires coordinated changes with the
excluded sharing UI. Existing overview-only person credentials and webhook
bearer credentials deliberately gain no new secret, Clients or browser-write
powers. These are credential boundaries, not missing session capabilities.

New Root keys for round 2 (registry version deliberately unchanged):

- `settings.appearanceCookieMaxAgeSeconds`: Settings REST/MCP theme/mode cookie lifetime.
- `settings.appearanceCopy`: complete English/French appearance labels and feedback.
- `settings.channelProfilesConfirmationCopy`: English/French profile-save confirmation dialogs.
- `agency.workspaceIdMaxLength`: workspace selection input bound.

Appearance uses existing `theme.default` / `theme.defaultMode` defaults and the
existing `users.theme` database column via parameterized SQL (the compatibility
Prisma model omits this column). No mode column exists, so mode is cookie-only.
No migration, client generation, shared registry edit, server, deployment, push
or production change was made. Changes remain uncommitted: linked Git metadata
is outside the sandbox writable roots.


Round 2 final verification from `rebuild/`:

- `npx tsc --noEmit -p .`: **0 errors**.
- Targeted `npx vitest run --no-cache`: **551 passed, 6 skipped**, across
  **28 files (27 passed, one database integration file skipped)**. The skipped
  `tasks78-concurrency.integration.test.ts` cases require a configured test database.
- `git diff --check`: passed. No full-suite or browser/live-provider run.

The targeted files were:

- `tests/parity-appearance-round2.test.ts`
- `tests/parity-appearance-ui-round2.test.ts`
- `tests/parity-session-surfaces-round2.test.ts`
- `tests/parity-oauth-round2-service.test.ts`
- `tests/parity-oauth-round2-transports.test.ts`
- `tests/parity-agency-round2.test.ts`
- `tests/workspace-selection-route.test.ts`
- `tests/agency-service.test.ts`
- `tests/agency-route.test.ts`
- `tests/agency-mcp.test.ts`
- `tests/agency-host-integration.test.ts`
- `tests/analytics-demographics-surfaces.test.ts`
- `tests/parity-account-service.test.ts`
- `tests/parity-account-mcp.test.ts`
- `tests/parity-rest-surfaces.test.ts`
- `tests/settings-copy-parity.test.ts`
- `tests/integrations-access.test.ts`
- `tests/integrations-services.test.ts`
- `tests/mcp-security.test.ts`
- `tests/raw-sql-void-guard.test.ts`
- `tests/channel-profiles.test.ts`
- `tests/channel-profiles-surfaces.test.ts`
- `tests/tasks-host-integration.test.ts`
- `tests/tasks-module.test.ts`
- `tests/tasks-route.test.ts`
- `tests/tasks-service.test.ts`
- `tests/tasks76-ui.test.ts`
- `tests/tasks78-concurrency.integration.test.ts`

Round 2 changed-file inventory (relative to `rebuild/`; pre-existing dependency symlinks excluded):

- `docs/PARITY_ANALYTICS_ADS_SETTINGS.md`
- `src/app/api/oauth/connections/[platform]/start/route.ts`
- `src/app/api/settings/appearance/route.ts`
- `src/app/api/sharing/channels/route.ts`
- `src/app/api/webhooks/[id]/secret/reveal/route.ts`
- `src/app/api/webhooks/[id]/secret/route.ts`
- `src/app/api/workspaces/select/route.ts`
- `src/modules/agency/config.ts`
- `src/modules/agency/mcp.ts`
- `src/modules/agency/server/workspace-selection.ts`
- `src/modules/analytics/ui/demographics/DemographicsScreen.tsx`
- `src/modules/settings/channel-profiles/config.ts`
- `src/modules/settings/channel-profiles/contracts.ts`
- `src/modules/settings/channel-profiles/copy.ts`
- `src/modules/settings/channel-profiles/mcp.ts`
- `src/modules/settings/channel-profiles/service.ts`
- `src/modules/settings/config.ts`
- `src/modules/settings/connection-start-mcp.ts`
- `src/modules/settings/mcp.ts`
- `src/modules/settings/server/account.ts`
- `src/modules/settings/server/appearance-http.ts`
- `src/modules/settings/server/appearance.ts`
- `src/modules/settings/server/connection-start-http.ts`
- `src/modules/settings/server/connection-start.ts`
- `src/modules/settings/server/webhook-secrets-http.ts`
- `src/modules/settings/server/webhook-secrets.ts`
- `src/modules/settings/session-parity-mcp.ts`
- `src/modules/settings/ui/appearance/AppearanceScreen.tsx`
- `src/modules/settings/ui/appearance/copy.ts`
- `src/modules/settings/ui/appearance/picker.tsx`
- `src/modules/settings/ui/connections/manager.tsx`
- `src/modules/settings/ui/connections/reconnect.tsx`
- `src/modules/settings/ui/profiles/ProfilesManager.tsx`
- `src/modules/settings/ui/profiles/ProfilesScreen.tsx`
- `src/modules/tasks/mcp.ts`
- `src/modules/tasks/server/tasks.ts`
- `src/modules/tasks/tasks.ts`
- `src/modules/tasks/ui/TaskBoard.tsx`
- `tests/agency-service.test.ts`
- `tests/analytics-demographics-surfaces.test.ts`
- `tests/channel-profiles-surfaces.test.ts`
- `tests/channel-profiles.test.ts`
- `tests/integrations-access.test.ts`
- `tests/parity-agency-round2.test.ts`
- `tests/parity-appearance-round2.test.ts`
- `tests/parity-appearance-ui-round2.test.ts`
- `tests/parity-oauth-round2-service.test.ts`
- `tests/parity-oauth-round2-transports.test.ts`
- `tests/parity-session-surfaces-round2.test.ts`
- `tests/tasks-host-integration.test.ts`
- `tests/tasks-module.test.ts`
- `tests/tasks-route.test.ts`
- `tests/tasks-service.test.ts`
- `tests/tasks76-ui.test.ts`
- `tests/tasks78-concurrency.integration.test.ts`
- `tests/workspace-selection-route.test.ts`
