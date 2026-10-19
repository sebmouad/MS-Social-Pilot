import type { McpViewer } from '@/server/mcp/types';

/**
 * Reviewed MCP operations that honour a channel/ad-account ceiling. A restricted viewer
 * (an explicit selected-resource credential ceiling intersected with current membership) may use
 * only these. Everything else, including any tool or resource added later, requires an
 * all-resource scope until it is reviewed and listed here. Each entry passes the ceiling to a
 * service that re-checks it; listing a name without that is a policy defect.
 */
const resourceScopedTools: ReadonlySet<string> = new Set([
  // Publishing: lifecycle services receive allowedTargetIds through an explicit publishing actor.
  'list_pages', 'list_posts', 'export_posts', 'create_post', 'update_post', 'duplicate_post', 'submit_post_for_approval', 'review_post',
  'queue_post', 'schedule_post', 'cancel_scheduled_post', 'publish_post', 'sync_post_status', 'send_first_comment', 'record_first_comment_outcome',
  'delete_post', 'get_post_deletion_status', 'finish_post_deletion', 'record_post_deletion_outcome',
  'get_publication_status', 'record_publication_outcome', 'finish_publication_projection', 'adopt_legacy_publication',
  // Publishing collaboration on individual visible posts.
  'get_post_labels', 'assign_post_labels', 'get_post_field_values', 'set_post_field_values', 'list_post_notes', 'add_post_note', 'delete_post_note',
  'list_post_versions', 'restore_post_version', 'get_post_recycle', 'set_post_recycle',
  // Inbox items are checked against the channel ceiling.
  'list_inbox', 'get_inbox_thread', 'reply_to_inbox', 'get_inbox_deletion', 'delete_inbox_comment', 'finish_inbox_deletion', 'set_inbox_resolved',
  'moderate_inbox_comment', 'get_inbox_productivity', 'assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note',
  // Analytics and Ads reads and spend-bound writes that carry the ceiling.
  'get_analytics_overview', 'get_analytics_metric_details', 'get_analytics_demographics', 'compare_analytics', 'get_analytics_explorer',
  'list_report_schedules', 'manage_report_schedule', 'list_report_runs', 'generate_report',
  'get_analytics_pins', 'pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins',
  'list_ad_accounts', 'get_ad_creation_options', 'get_ads_performance', 'get_ads_report_rows', 'export_ads_report', 'compare_ads_performance',
  'list_ads_objects', 'get_ads_object', 'get_live_ad_status', 'create_ad_campaign', 'create_ad_set', 'update_ad',
  'preview_ads_change', 'apply_ads_change', 'list_ads_changes', 'resolve_ads_change', 'list_ads_creatives',
  // Tasks and client links pass the ceiling to their own services. Bio has no channel meaning and is not listed.
  'list_task_post_choices',
  'list_share_links', 'list_shareable_channels', 'list_share_feedback', 'create_share_link', 'update_share_link', 'revoke_share_link', 'rotate_share_link', 'delete_share_link',
]);

/**
 * Reviewed as workspace-wide: no per-channel meaning, or an effect on shared configuration/content.
 * Listed explicitly so tests can prove no current tool is unclassified. Absence here is not a grant.
 */
const workspaceWideTools: ReadonlySet<string> = new Set([
  // Tasks are workspace records; a post ceiling redacts their links, not their own content.
  'list_tasks', 'get_task', 'create_task', 'create_task_checklist', 'update_task', 'move_task', 'delete_task', 'add_task_comment', 'delete_task_comment',
  'list_report_templates', 'manage_report_template',
  'list_workspace_images', 'get_workspace_image', 'delete_workspace_image', 'upload_workspace_image',
  'list_post_templates', 'create_post_template', 'update_post_template', 'delete_post_template',
  'list_post_labels', 'create_post_label', 'update_post_label', 'delete_post_label', 'list_post_label_choices',
  'list_custom_fields', 'create_custom_field', 'update_custom_field', 'delete_custom_field',
  'list_queue_times', 'replace_queue_times', 'get_content_mix', 'save_content_mix', 'set_content_mix_autofill',
  'list_workspace_team', 'add_workspace_member', 'update_workspace_member', 'remove_workspace_member',
  'list_workspace_invitations', 'invite_workspace_member', 'revoke_workspace_invitation',
  'get_workspace_policies', 'update_workspace_policies',
  'get_notification_preferences', 'update_notification_preferences', 'list_notifications', 'mark_notification_read', 'delete_notification',
  'list_inbox_saved_replies', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply',
  'preview_workspace_data_deletion', 'export_workspace_data', 'delete_workspace_data',
  'set_connection_selection', 'get_bio_page', 'save_bio_page', 'delete_bio_page',
  // Draft tools act on targetless local drafts; they carry no channel ceiling.
  'create_draft', 'update_draft', 'delete_draft',
]);

const resourceScopedResources: ReadonlySet<string> = new Set([
  'msp://workspace', 'msp://targets', 'msp://posts', 'msp://inbox', 'msp://settings/sharing',
  'msp://analytics/reports/schedules', 'msp://analytics/reports/runs',
  'msp://analytics/overview', 'msp://analytics/pins', 'msp://analytics/demographics', 'msp://analytics/explorer',
  'msp://ads/objects', 'msp://ads/performance', 'msp://ads/daily',
]);

/** Pass the ceiling to scoped services; undefined means every authorized resource. */
export function isResourceRestricted(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>): boolean {
  // A viewer without resolved permissions is not trusted with workspace-wide operations either.
  if (!viewer.permissions) return true;
  // A session's channel restrictions do not remove independently granted workspace features.
  // Authentication marks every real key explicitly; incomplete synthetic identities fail closed.
  if (viewer.resourceRestricted !== undefined) return viewer.resourceRestricted;
  return Boolean(viewer.apiKeyId && viewer.permissions.pageScope.all === false);
}

export type ToolScopeClass = 'resource' | 'workspace' | 'unclassified';
export function classifyTool(name: string): ToolScopeClass {
  return resourceScopedTools.has(name) ? 'resource' : workspaceWideTools.has(name) ? 'workspace' : 'unclassified';
}

/** Unknown or workspace-wide operations fail closed for restricted viewers. */
export function toolAllowedForScope(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>, name: string): boolean {
  return !isResourceRestricted(viewer) || resourceScopedTools.has(name);
}

export function resourceAllowedForScope(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>, uri: string): boolean {
  return !isResourceRestricted(viewer) || resourceScopedResources.has(uri);
}

export const scopeRefusalMessage = 'This operation requires access to all channels and ad accounts.';
