/**
 * Legacy table manifest for the rebuild data audit. Pure data and SQL builders:
 * no database access, no application imports. `legacy-data-audit.ts` executes
 * these read-only statements; docs/LEGACY_DATA_MIGRATION.md explains each entry.
 *
 * The rebuild shares the legacy PostgreSQL database in place (see
 * docs/DATA_COMPATIBILITY.md). "Migrated" therefore means the rebuild reads or
 * writes the same table, not that rows were copied. Nothing here changes data.
 */

/**
 * in_place            rebuild reads/writes this table (Prisma view, raw SQL, or Root read-only)
 * export_purge_only   rebuild only counts, exports and erases it; no product reader
 * needed_unbuilt      data customers may still want, but the rebuild feature is absent: keep
 * obsolete_candidate  operational history with no rebuild reader; owner decision, export first
 * obsolete_replaced   superseded by a rebuild table; retire only after backup and verification
 */
export type Disposition = 'in_place' | 'export_purge_only' | 'needed_unbuilt' | 'obsolete_candidate' | 'obsolete_replaced';
export type Access = 'prisma' | 'sql' | 'read_only' | 'none';
/** required: NOT NULL workspaceId; optional: nullable; none: no workspaceId column. */
export type WorkspaceColumn = 'required' | 'optional' | 'none';

export type LegacyTable = {
  table: string;
  model: string;
  disposition: Disposition;
  access: Access;
  workspace: WorkspaceColumn;
  /** Rebuild owner of the data (module or shared area), or the replacement/decision it needs. */
  owner: string;
  note?: string;
};

const t = (table: string, model: string, disposition: Disposition, access: Access, workspace: WorkspaceColumn, owner: string, note?: string): LegacyTable =>
  ({ table, model, disposition, access, workspace, owner, note });

export const LEGACY_TABLES: readonly LegacyTable[] = [
  // Identity and tenancy
  t('users', 'User', 'in_place', 'prisma', 'none', 'shared auth'),
  t('email_tokens', 'EmailToken', 'in_place', 'sql', 'none', 'settings (verification, recovery)'),
  t('sessions', 'Session', 'in_place', 'prisma', 'none', 'shared auth', 'Legacy sessions stay valid; rebuild creates and revokes its own.'),
  t('workspaces', 'Workspace', 'in_place', 'prisma', 'none', 'shared tenancy'),
  t('memberships', 'Membership', 'in_place', 'prisma', 'required', 'settings (team)'),
  t('invitations', 'Invitation', 'in_place', 'sql', 'required', 'settings (team)'),
  t('passkeys', 'Passkey', 'in_place', 'prisma', 'none', 'shared auth'),
  t('recovery_codes', 'RecoveryCode', 'in_place', 'prisma', 'none', 'shared auth'),
  t('trusted_devices', 'TrustedDevice', 'in_place', 'sql', 'none', 'settings (account security)', 'Rebuild only deletes rows on account security changes; no reader found in source.'),
  t('mcp_api_keys', 'McpApiKey', 'in_place', 'prisma', 'required', 'settings (mcp access)'),
  t('api_tokens', 'ApiToken', 'needed_unbuilt', 'none', 'required', 'integrations / settings (api)', 'Legacy REST tokens are not honoured; issue replacement mcp_api_keys or accept the break before deleting.'),
  t('plans', 'Plan', 'in_place', 'sql', 'none', 'shared entitlements'),
  t('app_settings', 'AppSetting', 'in_place', 'prisma', 'none', 'Root configuration', 'Legacy-only keys are retained; typed keys are imported by import-legacy-config.ts.'),
  t('workspace_data_purges', 'WorkspaceDataPurge', 'in_place', 'prisma', 'required', 'shared data-control', 'Erasure recovery state; never delete.'),
  t('client_invitations', 'ClientInvitation', 'needed_unbuilt', 'none', 'none', 'agency', 'Pending client invitations are unread by the rebuild Agency module.'),

  // Connections and destinations
  t('social_accounts', 'SocialAccount', 'in_place', 'prisma', 'required', 'settings (connections) + platforms/facebook'),
  t('targets', 'Target', 'in_place', 'prisma', 'required', 'settings (connections)'),
  t('page_groups', 'PageGroup', 'in_place', 'sql', 'required', 'settings (channel profiles)'),
  t('page_group_targets', 'PageGroupTarget', 'in_place', 'sql', 'none', 'settings (channel profiles)'),
  t('member_page_access', 'MemberPageAccess', 'in_place', 'sql', 'none', 'settings (team) resource scope'),
  t('instagram_accounts', 'InstagramAccount', 'in_place', 'prisma', 'required', 'platforms/instagram (discovery, analytics only)'),
  t('instagram_media', 'InstagramMedia', 'in_place', 'prisma', 'none', 'platforms/instagram'),
  t('instagram_insights', 'InstagramInsight', 'in_place', 'prisma', 'none', 'platforms/instagram'),
  t('ad_accounts', 'AdAccount', 'in_place', 'prisma', 'required', 'ads + platforms/facebook'),
  t('ad_insights', 'AdInsight', 'in_place', 'prisma', 'none', 'ads + platforms/facebook'),
  t('chat_channels', 'ChatChannel', 'needed_unbuilt', 'none', 'required', 'integrations', 'Chat notification targets; no rebuild reader.'),

  // Publishing
  t('posts', 'Post', 'in_place', 'prisma', 'required', 'publishing'),
  t('post_targets', 'PostTarget', 'in_place', 'prisma', 'none', 'publishing'),
  t('post_versions', 'PostVersion', 'in_place', 'sql', 'none', 'publishing (collaboration)'),
  t('post_notes', 'PostNote', 'in_place', 'sql', 'none', 'publishing (collaboration)'),
  t('post_labels', 'PostLabel', 'in_place', 'sql', 'none', 'publishing'),
  t('labels', 'Label', 'in_place', 'sql', 'required', 'publishing'),
  t('custom_fields', 'CustomField', 'in_place', 'sql', 'required', 'publishing (collaboration)'),
  t('post_field_values', 'PostFieldValue', 'in_place', 'sql', 'none', 'publishing (collaboration)'),
  t('queue_slots', 'QueueSlot', 'in_place', 'sql', 'required', 'publishing (queue)'),
  t('content_mix_rules', 'ContentMixRule', 'in_place', 'sql', 'required', 'publishing (collaboration)'),
  t('post_templates', 'PostTemplate', 'in_place', 'sql', 'required', 'publishing (templates)'),
  t('snippets', 'Snippet', 'needed_unbuilt', 'none', 'required', 'publishing (templates)', 'Rebuild folds snippets into templates only partly; migrate rows into post_templates or keep.'),
  t('media', 'Media', 'in_place', 'sql', 'required', 'media', 'Rows reference files under the media root; verify files with verify-legacy-migration.ts.'),
  t('short_links', 'ShortLink', 'in_place', 'sql', 'required', 'publishing (short links)'),
  t('link_clicks', 'LinkClick', 'in_place', 'sql', 'none', 'analytics (link reports)'),
  t('review_decisions', 'ReviewDecision', 'in_place', 'sql', 'none', 'publishing (approvals)'),
  t('external_posts', 'ExternalPost', 'in_place', 'sql', 'none', 'platforms/facebook (analytics)'),
  t('page_videos', 'PageVideo', 'export_purge_only', 'none', 'none', 'shared data-control', 'Counted, exported and erased; no product reader.'),
  t('feed_sources', 'FeedSource', 'in_place', 'sql', 'required', 'feeds'),
  t('feed_items', 'FeedItem', 'in_place', 'sql', 'none', 'feeds'),
  t('calendar_feeds', 'CalendarFeed', 'needed_unbuilt', 'none', 'required', 'publishing (calendar)', 'ICS subscription tokens; feature absent.'),
  t('bio_pages', 'BioPage', 'in_place', 'sql', 'required', 'sharing'),
  t('bio_links', 'BioLink', 'in_place', 'sql', 'none', 'sharing'),
  t('share_links', 'ShareLink', 'in_place', 'sql', 'required', 'sharing'),
  t('tasks', 'Task', 'in_place', 'sql', 'required', 'tasks'),
  t('key_dates', 'KeyDate', 'needed_unbuilt', 'none', 'required', 'publishing (planning)', 'Feature absent.'),
  t('seasonal_modes', 'SeasonalMode', 'needed_unbuilt', 'none', 'required', 'publishing (planning)', 'Feature absent.'),
  t('public_holidays', 'PublicHoliday', 'needed_unbuilt', 'none', 'none', 'publishing (planning)', 'Reference data; can be re-fetched, but keep until the holidays feature is decided.'),
  t('holiday_years', 'HolidayYear', 'needed_unbuilt', 'none', 'none', 'publishing (planning)', 'Reference data companion of public_holidays.'),
  t('trending_topics', 'TrendingTopic', 'needed_unbuilt', 'none', 'none', 'publishing (planning)', 'Feature absent.'),

  // Inbox and reviews
  t('conversations', 'Conversation', 'in_place', 'prisma', 'none', 'inbox + platforms/facebook'),
  t('conversation_messages', 'ConversationMessage', 'in_place', 'prisma', 'none', 'inbox'),
  t('post_comments', 'PostComment', 'in_place', 'prisma', 'none', 'inbox + publishing'),
  t('page_reviews', 'PageReview', 'in_place', 'sql', 'none', 'inbox (reviews)'),
  t('inbox_notes', 'InboxNote', 'in_place', 'sql', 'required', 'inbox'),
  t('saved_replies', 'SavedReply', 'in_place', 'sql', 'required', 'inbox'),
  t('moderation_rules', 'ModerationRule', 'in_place', 'sql', 'required', 'inbox (moderation)'),
  t('moderation_actions', 'ModerationAction', 'in_place', 'sql', 'required', 'inbox (moderation)'),

  // Analytics and reporting
  t('page_insights', 'PageInsight', 'in_place', 'prisma', 'none', 'analytics + platforms/facebook'),
  t('metric_availability', 'MetricAvailability', 'export_purge_only', 'none', 'none', 'shared data-control', 'Counted, exported and erased; no product reader.'),
  t('page_goals', 'PageGoal', 'in_place', 'sql', 'required', 'analytics (goals)'),
  t('chart_notes', 'ChartNote', 'needed_unbuilt', 'none', 'required', 'analytics', 'Annotations on charts; feature absent.'),
  t('caption_tests', 'CaptionTest', 'needed_unbuilt', 'none', 'required', 'analytics', 'A/B caption experiments; feature absent.'),
  t('saved_views', 'SavedView', 'in_place', 'prisma', 'required', 'publishing (saved views)'),
  t('report_templates', 'ReportTemplate', 'in_place', 'sql', 'required', 'analytics (reports)'),
  t('report_schedules', 'ReportSchedule', 'in_place', 'sql', 'required', 'analytics (reports)'),
  t('report_runs', 'RebuildReportRun', 'in_place', 'prisma', 'required', 'analytics (reports)', 'Created by the additive rebuild report migration.'),

  // AI
  t('ai_agents', 'AiAgent', 'needed_unbuilt', 'none', 'required', 'ai', 'Agent management is absent in the rebuild.'),
  t('ai_generations', 'AiGeneration', 'needed_unbuilt', 'none', 'required', 'ai', 'Usage history for budgets; rebuild limits are per hour only.'),
  t('ai_videos', 'AiVideo', 'needed_unbuilt', 'none', 'required', 'ai', 'AI video jobs and files; feature absent.'),

  // Notifications, activity and integrations
  t('notification_settings', 'NotificationSetting', 'in_place', 'sql', 'required', 'settings (notifications)'),
  t('notification_mutes', 'NotificationMute', 'in_place', 'sql', 'none', 'settings (notifications)'),
  t('email_logs', 'EmailLog', 'in_place', 'sql', 'optional', 'shared mail', 'Rebuild appends; old rows are history only.'),
  t('activity_logs', 'ActivityLog', 'in_place', 'sql', 'required', 'shared audit'),
  t('webhook_endpoints', 'WebhookEndpoint', 'in_place', 'sql', 'required', 'integrations'),
  t('webhook_deliveries', 'WebhookDelivery', 'in_place', 'sql', 'required', 'integrations'),

  // Root and operations
  t('root_activities', 'RootActivity', 'in_place', 'sql', 'none', 'Root audit'),
  t('worker_heartbeats', 'WorkerHeartbeat', 'in_place', 'sql', 'none', 'Root operations'),
  t('backup_runs', 'BackupRun', 'in_place', 'read_only', 'none', 'Root (backups)', 'Rebuild reads only; nothing writes new rows until a backup writer is built.'),
  t('system_alerts', 'SystemAlert', 'in_place', 'read_only', 'none', 'Root (backups)', 'Read-only; no rebuild writer.'),
  t('error_events', 'ErrorEvent', 'in_place', 'read_only', 'none', 'Root (errors)', 'Read and resolve only; no rebuild writer.'),
  t('worker_job_runs', 'WorkerJobRun', 'obsolete_candidate', 'none', 'none', 'replaced by rebuild_sync_runs', 'Legacy scheduler run history.'),
  t('graph_usage', 'GraphUsage', 'obsolete_candidate', 'none', 'none', 'platforms/facebook', 'Legacy Graph rate-limit counters; transient.'),
  t('uptime_days', 'UptimeDay', 'obsolete_candidate', 'none', 'none', 'Root', 'Uptime history; no reader or writer. Export before dropping if the history matters.'),
  t('changelog_entries', 'ChangelogEntry', 'obsolete_candidate', 'none', 'none', 'Root', 'Release notes; data-control retains it as installation data.'),

  // Superseded
  t('workspace_exports', 'WorkspaceExport', 'obsolete_replaced', 'none', 'required', 'rebuild_workspace_exports', 'Old export rows and files are replaced by the asynchronous ZIP service.'),
  t('OAuthClient', 'OAuthClient', 'obsolete_replaced', 'none', 'none', 'mcp_oauth_clients', 'Not migrated: legacy OAuth clients must re-register.'),
  t('OAuthCode', 'OAuthCode', 'obsolete_replaced', 'none', 'required', 'mcp_oauth_codes', 'No workspace FK. Account deletion still removes these rows, so keep until legacy code is gone.'),
];

/** Tables the rebuild owns itself; anything else outside the manifest is reported as unclassified. */
export const REBUILD_OWNED_PATTERNS: readonly RegExp[] = [
  /^rebuild_/, /^mcp_oauth_/, /^person_mcp_keys$/, /^task_comments$/, /^wordpress_recipe_/, /^ads_objects$/,
  /^_prisma_migrations$/,
];

export const isRebuildOwned = (table: string) => REBUILD_OWNED_PATTERNS.some(p => p.test(table));
export const isLegacyTable = (table: string) => LEGACY_TABLES.some(e => e.table === table);

const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** Row count for one table. */
export const countSql = (table: string) => `SELECT count(*)::text AS n FROM public.${q(table)}`;

/** Rows whose workspaceId points at no workspace. Null when the table has no workspace column. */
export function orphanWorkspaceSql(entry: LegacyTable): string | null {
  if (entry.workspace === 'none') return null;
  return `SELECT count(*)::text AS n FROM public.${q(entry.table)} x LEFT JOIN public.workspaces w ON w.id = x."workspaceId" ` +
    `WHERE x."workspaceId" IS NOT NULL AND w.id IS NULL`;
}

/** Tables, FK constraints and validation state, from the catalog. */
export const catalogTablesSql = `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`;
export const invalidConstraintsSql = `SELECT conrelid::regclass::text AS table_name, conname FROM pg_constraint WHERE NOT convalidated ORDER BY 1, 2`;

/** Foreign keys from other tables into the given table (blocks DROP without CASCADE). */
export const inboundForeignKeysSql = (table: string) =>
  `SELECT conrelid::regclass::text AS from_table, conname FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.${q(table)}'::regclass ORDER BY 1, 2`;

/** Rebuild tables that reference a legacy table by foreign key (a drop must not cascade into them). */
export const rebuildDependentsSql = `SELECT c.conrelid::regclass::text AS from_table, c.confrelid::regclass::text AS to_table, c.conname ` +
  `FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid::regclass::text ~ '^(rebuild_|mcp_oauth_|person_mcp_keys|task_comments|wordpress_recipe_|ads_objects)' ORDER BY 1, 2`;

/** Dispositions that must keep their rows until the owner records a decision. */
export const KEEP_DISPOSITIONS: readonly Disposition[] = ['in_place', 'export_purge_only', 'needed_unbuilt'];

export type DeleteGate = 'keep' | 'decision_required' | 'retire_after_backup';
export function deleteGate(entry: LegacyTable, rows: number): DeleteGate {
  if (rows === 0 && (entry.disposition === 'needed_unbuilt' || entry.disposition === 'obsolete_candidate' || entry.disposition === 'obsolete_replaced')) return 'retire_after_backup';
  if (entry.disposition === 'obsolete_replaced') return 'retire_after_backup';
  if (entry.disposition === 'obsolete_candidate') return 'decision_required';
  return 'keep';
}
