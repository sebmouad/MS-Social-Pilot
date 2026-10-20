# MCP parity inventory

Updated 2026-10-20. Scope: customer features reachable from UI screens and `src/app/api/**`, compared with the tools and resources each module declares in its `mcp.ts` (aggregated by `src/modules/installed-mcp.ts` and `src/server/mcp`). Root and installation tools are out of scope. The tool list was dumped from `installedMcpGroups()`, not copied from older notes.

Status: **Covered** = tool(s) call the same service as the UI/HTTP route, with authorization, scope ceiling and (for writes) exact confirmation. **Gap** = customer capability without a tool. **By design** = intentionally not exposed over MCP. Coverage here is source and unit-test evidence only; no live-provider or end-to-end MCP run is claimed.

## Publishing

| Capability | UI / HTTP route | MCP tool(s) | Status |
| --- | --- | --- | --- |
| List / filter / export posts | `/api/publishing/posts`, `posts/export` | `list_posts`, `export_posts`, resource `msp://posts` | Covered |
| Draft create / edit / delete | `/api/publishing/posts` | `create_draft`, `update_draft`, `delete_draft`, `create_post`, `update_post` | Covered |
| Publish, schedule, queue, cancel, duplicate | `posts`, `queue`, `duplicate` | `publish_post`, `schedule_post`, `queue_post`, `cancel_scheduled_post`, `duplicate_post` | Covered |
| Approvals | `posts` | `submit_post_for_approval`, `review_post` | Covered |
| First comment | `posts` | `send_first_comment`, `record_first_comment_outcome` | Covered |
| Status sync and recovery | `recovery` | `sync_post_status`, `get_publication_status`, `record_publication_outcome`, `finish_publication_projection`, `adopt_legacy_publication` | Covered |
| Post deletion incl. remote | `posts` | `delete_post`, `get_post_deletion_status`, `finish_post_deletion`, `record_post_deletion_outcome` | Covered |
| Bulk actions | `posts/bulk` | `bulk_post_action` | Covered |
| Saved views | `saved-views` | `list_saved_views`, `create_saved_view`, `delete_saved_view` | Covered |
| Templates | `templates` | `list_post_templates`, `create/update/delete_post_template` | Covered |
| Labels and assignment | `labels`, `assignments` | `list_post_labels`, `create/update/delete_post_label`, `get_post_labels`, `list_post_label_choices`, `assign_post_labels` | Covered |
| Custom fields | `custom-fields` | `list_custom_fields`, `create/update/delete_custom_field`, `get_post_field_values`, `set_post_field_values` | Covered |
| Notes, versions | `notes`, `versions` | `list_post_notes`, `add_post_note`, `delete_post_note`, `list_post_versions`, `restore_post_version` | Covered |
| Queue times, content mix, recycle | `queue-slots`, `content-mix`, `recycle` | `list_queue_times`, `replace_queue_times`, `get_content_mix`, `save_content_mix`, `set_content_mix_autofill`, `get_post_recycle`, `set_post_recycle` | Covered |
| Workspace images | media routes | `list_workspace_images`, `get_workspace_image`, `upload_workspace_image`, `delete_workspace_image` | Covered |
| Media library | `/api/media-library` | `list_media_library`, `import_media_from_url`, `delete_media_asset` | Covered |
| Tasks | `/api/tasks` | ten `*_task*` tools | Covered |
| Content feeds | `/api/feeds` | `list/create/update/delete/check_content_feed` | Covered |
| AI assist | `/api/ai` | `get_ai_assist_status`, `ai_assist_write` | Covered |

## Inbox

| Capability | UI / HTTP route | MCP tool(s) | Status |
| --- | --- | --- | --- |
| Conversations, threads, reply, resolve | `/api/inbox`, `threads`, `actions` | `list_inbox`, `get_inbox_thread`, `reply_to_inbox`, `set_inbox_resolved` | Covered |
| Comment moderation and deletion | `actions`, `deletions` | `moderate_inbox_comment`, `delete_inbox_comment`, `get_inbox_deletion`, `finish_inbox_deletion` | Covered |
| Assignment, private notes, saved replies | `productivity` | `get_inbox_productivity`, `assign_inbox_item`, `add/delete_inbox_private_note`, `list_inbox_saved_replies`, `create/update/delete_inbox_saved_reply` | Covered |
| Moderation rules and undo | `moderation` | `get_inbox_moderation`, `create/update/delete_inbox_moderation_rule`, `run_inbox_moderation_rules`, `undo_inbox_moderation_action` | Covered |

## Analytics and Ads

| Capability | UI / HTTP route | MCP tool(s) | Status |
| --- | --- | --- | --- |
| Overview, metric details, explorer, comparison, posts, demographics | `/api/analytics*` | `get_analytics_overview`, `get_analytics_metric_details`, `get_analytics_explorer`, `compare_analytics`, `get_analytics_posts`, `get_analytics_demographics` | Covered |
| Pins, goals | `pins`, `goals` | `get/pin/unpin/reorder_analytics_pins`, `get_analytics_goals`, `set_analytics_goals` | Covered |
| Report templates, schedules, runs, generate | `report-workflows/*`, `/api/reports/export` | `list_report_templates`, `manage_report_template`, `list_report_schedules`, `manage_report_schedule`, `list_report_runs`, `generate_report` | Covered |
| Ads reporting, rows, export, compare | `/api/ads/report/*`, `compare` | `get_ads_performance`, `get_ads_report_rows`, `export_ads_report`, `compare_ads_performance`, `get_live_ad_status` | Covered |
| Ads accounts, objects, creatives | `directory`, `object` | `list_ad_accounts`, `list_ads_objects`, `get_ads_object`, `list_ads_creatives`, `get_ad_creation_options` | Covered |
| Ads creation and changes | `campaigns`, `adsets`, `management`, `actions` | `create_ad_campaign`, `create_ad_set`, `update_ad`, `preview_ads_change`, `apply_ads_change`, `list_ads_changes`, `resolve_ads_change` | Covered |

## Settings, sharing, integrations

| Capability | UI / HTTP route | MCP tool(s) | Status |
| --- | --- | --- | --- |
| Destinations and selection | `/api/connections` PATCH | `list_pages`, `set_connection_selection` | Covered |
| Connection directory (sources, health, discovered unselected resources) | Connections screen | `list_connections` | **Added in this batch** |
| Disconnect with retain/delete choice and consequence preview | `/api/connections` POST (preview) / DELETE | `preview_connection_disconnect`, `disconnect_connection` | **Added in this batch** |
| Start OAuth connect / reconnect | `/api/connections/[platform]/start`, `callback` | none | By design: interactive browser consent |
| Team, invitations | `/api/settings/team`, `invitations` | `list_workspace_team`, `add/update/remove_workspace_member`, `list_workspace_invitations`, `invite_workspace_member`, `revoke_workspace_invitation` | Covered |
| Workspace policy and operations | `workspace/policy`, `operations` | `get/update_workspace_policies`, `get/update_workspace_operations` | Covered |
| Notifications | `/api/notifications` | preferences, list, mark read, delete tools | Covered |
| Data export / deletion | `settings/data`, `data/exports` | `preview_workspace_data_deletion`, `export_workspace_data`, `delete_workspace_data`, `list/request/download_workspace_export` | Covered |
| Client sharing and bio | `/api/sharing/*` | `list/create/update/revoke/rotate/delete_share_link`, `list_share_feedback`, `list_shareable_channels`, bio tools | Covered |
| Webhooks | `/api/webhooks*` | eight `*_webhook*` tools | Covered |
| Agency | `/api/agency` | `get_agency_overview`, `list_agency_clients` | Declared; withheld from workspace catalogs (person-wide scope) |
| Account profile, password, sessions | `/api/settings/account*` | none | By design: person credentials never reachable through workspace keys |
| MCP key issuance | `/api/settings/mcp-keys` | none | By design: restricted credentials cannot mint credentials |
| Sign-in, registration, recovery, two-step, passkeys, OAuth connector endpoints | `/api/auth/*`, `/api/oauth/*` | none | By design: authentication |
| Public review decision, REST v1 | `/api/sharing/public/*`, `/api/v1/*` | none | By design: separate public/key-scoped surfaces |

## Open items

- No customer capability gap remains in the table beyond the "by design" rows; verify by re-dumping `installedMcpGroups()` after module changes.
- Agency person-wide MCP credentials are not implemented (see AGENCY.md).
- Parity of write confirmations and scope ceilings is covered per module by existing tests; no single cross-module matrix test exists yet.
- No live MCP-client, browser or provider run was made for the new connection tools.
