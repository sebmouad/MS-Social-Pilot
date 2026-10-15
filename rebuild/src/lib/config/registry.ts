import { z } from 'zod';
import { MODULES, PAGES } from '@/lib/product';
import { THEMES } from '@/lib/themes';

/** Bump when a registry key or its persisted representation changes. */
export const CONFIG_SCHEMA_VERSION = 7;

const cron = z.string().min(9).max(100).refine((value) => {
  const fields = value.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => /^[\d*/?,\-]+$/.test(field));
}, 'Use a five-field cron expression.');
const url = z.string().url().refine((value) => value.startsWith('https://'), 'Use an HTTPS URL.');
const stringList = z.array(z.string().trim().min(1).max(200)).max(100);
const optionList = (values: readonly string[]) => z.enum(values as [string, ...string[]]);

type Consumption = 'active' | 'configured' | 'planned';
type Option = { value: string; label: string };
type Entry = {
  key: string; group: string; label: string; kind: 'text' | 'secret' | 'boolean' | 'number' | 'select' | 'json';
  description: string; defaultValue: unknown; schema: z.ZodTypeAny; consumption: Consumption; options?: readonly Option[];
};
const entry = <const T extends Entry>(value: T) => value;
const options = (values: readonly { id: string; name: string }[]): Option[] => values.map(({ id, name }) => ({ value: id, label: name }));

/**
 * This is the sole source for Root-managed runtime settings. `consumption`
 * separates live controls from settings that are stored for upcoming runtime
 * integrations; the UI must preserve that distinction.
 */
export const CONFIG_REGISTRY = [
  entry({ key: 'platforms.facebook.enabled', group: 'Platforms', label: 'Facebook engine enabled', kind: 'boolean', description: 'Make the installed Facebook adapter available to workspace features. Connected data remains stored when disabled.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'auth.loginAttempts', group: 'Security · rate limits', label: 'Sign-in attempts allowed', kind: 'number', description: 'Maximum password or verification attempts per account during one window.', defaultValue: 10, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'auth.loginWindowMinutes', group: 'Security · rate limits', label: 'Sign-in attempt window', kind: 'number', description: 'Minutes before failed sign-in attempts reset.', defaultValue: 15, schema: z.number().int().min(1).max(1440), consumption: 'active' }),
  entry({ key: 'auth.sessionDays', group: 'Security · sessions', label: 'Full session lifetime (days)', kind: 'number', description: 'Maximum age of a fully verified browser session.', defaultValue: 30, schema: z.number().int().min(1).max(365), consumption: 'active' }),
  entry({ key: 'auth.pendingMinutes', group: 'Security · sessions', label: 'Two-step challenge lifetime (minutes)', kind: 'number', description: 'Time allowed to complete a password-verified two-step challenge.', defaultValue: 15, schema: z.number().int().min(1).max(120), consumption: 'active' }),
  entry({ key: 'auth.recoveryCodeCount', group: 'Security · sessions', label: 'Recovery codes per enrollment', kind: 'number', description: 'Number of one-time recovery codes issued when enrolling an authenticator.', defaultValue: 10, schema: z.number().int().min(1).max(50), consumption: 'active' }),
  entry({ key: 'auth.passwordMinLength', group: 'Security · passwords', label: 'Minimum password length', kind: 'number', description: 'Minimum number of characters required when a user changes a password.', defaultValue: 12, schema: z.number().int().min(8).max(64), consumption: 'active' }),
  entry({ key: 'auth.passwordMaxBytes', group: 'Security · passwords', label: 'Maximum password bytes', kind: 'number', description: 'Maximum UTF-8 byte length accepted for a new password.', defaultValue: 800, schema: z.number().int().min(64).max(4096), consumption: 'active' }),
  entry({ key: 'security.twoStep', group: 'Security', label: 'Two-step requirement', kind: 'select', description: 'Admins, everyone, or off. Enrolled factors still require verification.', defaultValue: 'admins', schema: z.enum(['admins', 'everyone', 'off']), consumption: 'active', options: [{ value: 'admins', label: 'Admins' }, { value: 'everyone', label: 'Everyone' }, { value: 'off', label: 'Off' }] }),
  entry({ key: 'security.apiRequestsPerMinute', group: 'Security · rate limits', label: 'API requests per minute', kind: 'number', description: 'Default per-actor request budget for application APIs.', defaultValue: 120, schema: z.number().int().min(1).max(100000), consumption: 'planned' }),

  entry({ key: 'meta.graphBaseUrl', group: 'API endpoints', label: 'Meta Graph API base URL', kind: 'text', description: 'HTTPS origin and optional path used by Meta Graph requests.', defaultValue: 'https://graph.facebook.com', schema: url, consumption: 'active' }),
  entry({ key: 'meta.oauthBaseUrl', group: 'API endpoints', label: 'Meta OAuth dialog base URL', kind: 'text', description: 'HTTPS origin used to display the Meta authorization dialog.', defaultValue: 'https://www.facebook.com', schema: url, consumption: 'active' }),
  entry({ key: 'meta.graphVersion', group: 'API endpoints', label: 'Meta Graph API version', kind: 'text', description: 'Version used by Meta integrations when connected.', defaultValue: 'v25.0', schema: z.string().regex(/^v\d+\.\d+$/, 'Use a version such as v25.0.'), consumption: 'active' }),
  entry({ key: 'meta.requestTimeoutMs', group: 'API endpoints', label: 'Meta request timeout (ms)', kind: 'number', description: 'Maximum time allowed for one Meta API request.', defaultValue: 15000, schema: z.number().int().min(1000).max(120000), consumption: 'active' }),
  entry({ key: 'meta.maxPages', group: 'API endpoints', label: 'Meta pagination limit', kind: 'number', description: 'Maximum Graph response pages read per collection request.', defaultValue: 20, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'meta.pageSize', group: 'API endpoints', label: 'Meta response page size', kind: 'number', description: 'Items requested per Graph response page.', defaultValue: 100, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'meta.pageInsightMetrics', group: 'Analytics metrics', label: 'Meta Page insight metrics', kind: 'json', description: 'JSON array of Page insight metric names approved for this app. Unsupported metrics may need removal after provider changes.', defaultValue: ['page_follows', 'page_media_view', 'page_post_engagements', 'page_views_total'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.adInsightFields', group: 'Analytics metrics', label: 'Meta ad insight fields', kind: 'json', description: 'JSON array of Ads Insights fields approved for this app.', defaultValue: ['impressions', 'reach', 'spend', 'clicks', 'cpc', 'cpm'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.appId', group: 'API credentials', label: 'Meta app ID', kind: 'text', description: 'Public OAuth application identifier.', defaultValue: '', schema: z.string().max(200), consumption: 'active' }),
  entry({ key: 'meta.appSecret', group: 'API credentials', label: 'Meta app secret', kind: 'secret', description: 'Encrypted at rest. The saved value is never returned by the configuration API.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'meta.oauthRedirectUri', group: 'API credentials', label: 'Meta OAuth callback URL', kind: 'text', description: 'HTTPS callback URL registered with the Meta application.', defaultValue: '', schema: z.union([z.literal(''), url]), consumption: 'active' }),
  entry({ key: 'meta.oauthStateMinutes', group: 'API credentials', label: 'Meta connection challenge lifetime', kind: 'number', description: 'Minutes allowed between opening Meta authorization and returning to the callback.', defaultValue: 10, schema: z.number().int().min(1).max(60), consumption: 'active' }),
  entry({ key: 'meta.oauthScopes', group: 'API scopes', label: 'Meta Page and Instagram scopes', kind: 'json', description: 'JSON array of Page and Instagram scopes requested during Meta authorization. Keep aligned with app review approval.', defaultValue: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.inboxReadScopes', group: 'API scopes · inbox', label: 'Meta inbox read scopes', kind: 'json', description: 'JSON array of Meta scopes required to read Page conversations and comments.', defaultValue: ['pages_messaging', 'pages_read_engagement'], schema: stringList, consumption: 'configured' }),
  entry({ key: 'meta.inboxWriteScopes', group: 'API scopes · inbox', label: 'Meta inbox write scopes', kind: 'json', description: 'JSON array of Meta scopes required to reply to Page conversations and moderate comments.', defaultValue: ['pages_messaging', 'pages_manage_engagement'], schema: stringList, consumption: 'configured' }),
  entry({ key: 'meta.adsReadScopes', group: 'API scopes · ads', label: 'Meta ads read scopes', kind: 'json', description: 'JSON array of ads reporting scopes. Request only scopes approved for this Meta app.', defaultValue: ['ads_read'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.adsManageScopes', group: 'API scopes · ads', label: 'Meta ads management scopes', kind: 'json', description: 'JSON array of ads management scopes. These can enable spend-affecting actions and require an approved app and implemented controls.', defaultValue: ['ads_management'], schema: stringList, consumption: 'active' }),
  entry({ key: 'ads.managementEnabled', group: 'Ads management', label: 'Ads changes enabled', kind: 'boolean', description: 'Allow paused Facebook campaign creation and status or budget changes for supported connected ad accounts after required scopes are approved.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'youtube.apiBaseUrl', group: 'API endpoints', label: 'YouTube Data API base URL', kind: 'text', description: 'HTTPS endpoint for YouTube Data API calls.', defaultValue: 'https://www.googleapis.com/youtube/v3', schema: url, consumption: 'planned' }),
  entry({ key: 'youtube.oauthScopes', group: 'API scopes', label: 'YouTube OAuth scopes', kind: 'json', description: 'JSON array of OAuth scopes requested for YouTube access.', defaultValue: ['https://www.googleapis.com/auth/youtube.readonly'], schema: stringList, consumption: 'planned' }),
  entry({ key: 'linkedin.apiBaseUrl', group: 'API endpoints', label: 'LinkedIn API base URL', kind: 'text', description: 'HTTPS endpoint for LinkedIn API calls.', defaultValue: 'https://api.linkedin.com', schema: url, consumption: 'planned' }),
  entry({ key: 'linkedin.oauthScopes', group: 'API scopes', label: 'LinkedIn OAuth scopes', kind: 'json', description: 'JSON array of OAuth scopes requested for LinkedIn access.', defaultValue: ['openid', 'profile', 'w_member_social'], schema: stringList, consumption: 'planned' }),
  entry({ key: 'x.apiBaseUrl', group: 'API endpoints', label: 'X API base URL', kind: 'text', description: 'HTTPS endpoint for X API calls.', defaultValue: 'https://api.x.com/2', schema: url, consumption: 'planned' }),
  entry({ key: 'x.oauthScopes', group: 'API scopes', label: 'X OAuth scopes', kind: 'json', description: 'JSON array of OAuth scopes requested for X access.', defaultValue: ['tweet.read', 'users.read', 'tweet.write', 'offline.access'], schema: stringList, consumption: 'planned' }),

  entry({ key: 'jobs.enabled', group: 'Sync schedules', label: 'Background jobs enabled', kind: 'boolean', description: 'Master availability switch for background work.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'sync.posts.schedule', group: 'Sync schedules', label: 'Post and publishing sync schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone.', defaultValue: '*/5 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'sync.analytics.schedule', group: 'Sync schedules', label: 'Analytics sync schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone.', defaultValue: '15 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'sync.inbox.schedule', group: 'Sync schedules', label: 'Inbox sync schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone.', defaultValue: '*/2 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'sync.maxConcurrentJobs', group: 'Sync schedules', label: 'Maximum concurrent sync jobs', kind: 'number', description: 'Upper bound for simultaneously running sync tasks.', defaultValue: 4, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'sync.retryLimit', group: 'Sync schedules', label: 'Sync retry limit', kind: 'number', description: 'Maximum retry attempts before a sync task is marked failed.', defaultValue: 5, schema: z.number().int().min(0).max(50), consumption: 'active' }),
  entry({ key: 'sync.maxItemsPerJob', group: 'Sync schedules', label: 'Maximum records per sync job', kind: 'number', description: 'Maximum local records a single sync job examines in one run.', defaultValue: 10000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'sync.workerLeaseMinutes', group: 'Sync schedules', label: 'Worker lease duration (minutes)', kind: 'number', description: 'How long a worker owns a distributed job lease before another worker may take it.', defaultValue: 5, schema: z.number().int().min(1).max(60), consumption: 'active' }),
  entry({ key: 'sync.workerHeartbeatSeconds', group: 'Sync schedules', label: 'Worker heartbeat interval (seconds)', kind: 'number', description: 'How often the background worker records its health heartbeat.', defaultValue: 30, schema: z.number().int().min(5).max(300), consumption: 'active' }),

  entry({ key: 'api.meta.requestsPerMinute', group: 'API rate limits', label: 'Meta requests per minute', kind: 'number', description: 'Application-side request budget for Meta API calls.', defaultValue: 200, schema: z.number().int().min(1).max(100000), consumption: 'planned' }),
  entry({ key: 'api.youtube.requestsPerMinute', group: 'API rate limits', label: 'YouTube requests per minute', kind: 'number', description: 'Application-side request budget for YouTube API calls.', defaultValue: 100, schema: z.number().int().min(1).max(100000), consumption: 'planned' }),
  entry({ key: 'publishing.maxMessageCharacters', group: 'Publishing limits', label: 'Maximum post characters', kind: 'number', description: 'Maximum text length for a post in the shared composer; provider-specific limits may be lower.', defaultValue: 10000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'publishing.maxImportRows', group: 'Publishing limits', label: 'Maximum import rows', kind: 'number', description: 'Maximum posts accepted in one bulk CSV import.', defaultValue: 100, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'publishing.maxImportBytes', group: 'Publishing limits', label: 'Maximum import file size', kind: 'number', description: 'Maximum CSV bytes accepted in one bulk import.', defaultValue: 256000, schema: z.number().int().min(1024).max(100000000), consumption: 'active' }),
  entry({ key: 'publishing.maxTargetsPerPost', group: 'Publishing limits', label: 'Maximum channels per post', kind: 'number', description: 'Maximum selected destinations for one post.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'publishing.maxRemoteMediaPerPost', group: 'Publishing limits', label: 'Maximum remote media per post', kind: 'number', description: 'Maximum HTTPS media URLs accepted in one post.', defaultValue: 2, schema: z.number().int().min(0).max(20), consumption: 'active' }),

  ...MODULES.map((module) => entry({ key: `entitlements.modules.${module.id}` as const, group: 'Entitlements · modules', label: `${module.title} available`, kind: 'boolean' as const, description: `Installation-wide default availability for the ${module.title} module. Existing workspace and plan restrictions remain in force.`, defaultValue: true, schema: z.boolean(), consumption: 'active' as const })),
  ...PAGES.map((page) => entry({ key: `entitlements.features.${page.id}` as const, group: 'Entitlements · features', label: `${page.title} available`, kind: 'boolean' as const, description: `Installation-wide default availability for ${page.title}. Existing workspace and plan restrictions remain in force.`, defaultValue: true, schema: z.boolean(), consumption: 'active' as const })),

  entry({ key: 'retention.auditDays', group: 'Retention', label: 'Audit history retention (days)', kind: 'number', description: 'How long Root and security audit records are retained.', defaultValue: 365, schema: z.number().int().min(1).max(3650), consumption: 'planned' }),
  entry({ key: 'retention.syncLogDays', group: 'Retention', label: 'Sync log retention (days)', kind: 'number', description: 'How long completed and failed sync logs are retained.', defaultValue: 30, schema: z.number().int().min(1).max(3650), consumption: 'planned' }),
  entry({ key: 'retention.analyticsDays', group: 'Retention', label: 'Analytics history retention (days)', kind: 'number', description: 'How long imported analytics history is kept.', defaultValue: 730, schema: z.number().int().min(1).max(3650), consumption: 'planned' }),
  entry({ key: 'logging.level', group: 'Logging', label: 'Log level', kind: 'select', description: 'Minimum application event severity emitted by the runtime logger.', defaultValue: 'info', schema: optionList(['error', 'warn', 'info', 'debug']), consumption: 'planned', options: [{ value: 'error', label: 'Error' }, { value: 'warn', label: 'Warning' }, { value: 'info', label: 'Info' }, { value: 'debug', label: 'Debug' }] }),
  entry({ key: 'logging.retentionDays', group: 'Logging', label: 'Log retention (days)', kind: 'number', description: 'How long application logs are retained by the configured log sink.', defaultValue: 30, schema: z.number().int().min(1).max(3650), consumption: 'planned' }),

  entry({ key: 'mcp.enabled', group: 'MCP', label: 'MCP endpoint enabled', kind: 'boolean', description: 'Allow authenticated workspace members to access the MCP endpoint.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'mcp.authenticatedRoles', group: 'MCP', label: 'MCP permitted workspace roles', kind: 'json', description: 'JSON array of workspace roles allowed to authenticate. Current endpoint permits owner and admin roles.', defaultValue: ['owner', 'admin'], schema: z.array(optionList(['owner', 'admin', 'editor', 'viewer'])).min(1).max(4), consumption: 'active' }),
  entry({ key: 'mcp.maxRequestBytes', group: 'MCP', label: 'MCP request size limit (bytes)', kind: 'number', description: 'Maximum JSON-RPC request body size accepted by the MCP endpoint.', defaultValue: 1048576, schema: z.number().int().min(1024).max(10485760), consumption: 'active' }),
  entry({ key: 'mcp.requestsPerMinute', group: 'MCP', label: 'MCP requests per minute', kind: 'number', description: 'Per-user request budget for MCP operations.', defaultValue: 60, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'mcp.maxResultItems', group: 'MCP', label: 'Maximum MCP result items', kind: 'number', description: 'Maximum rows returned by a single MCP list operation.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'mcp.keys.maxActivePerWorkspace', group: 'MCP · API keys', label: 'Active API keys per workspace', kind: 'number', description: 'Maximum non-expired, non-revoked MCP bearer keys in each workspace.', defaultValue: 10, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'mcp.keys.maxLifetimeDays', group: 'MCP · API keys', label: 'Maximum API key lifetime (days)', kind: 'number', description: 'Longest lifetime workspace admins may select when issuing an MCP key.', defaultValue: 365, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'mcp.keys.requestsPerMinute', group: 'MCP · API keys', label: 'API key requests per minute', kind: 'number', description: 'Request budget applied independently to each MCP bearer key.', defaultValue: 60, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'theme.default', group: 'Theme defaults', label: 'Default workspace theme', kind: 'select', description: 'Theme used when a visitor has no saved theme preference.', defaultValue: 'grove', schema: optionList(THEMES.map((theme) => theme.id)), consumption: 'active', options: options(THEMES) }),
  entry({ key: 'operations.supportEmail', group: 'Operations', label: 'Support email', kind: 'text', description: 'Contact address shown to operators.', defaultValue: '', schema: z.union([z.literal(''), z.string().email()]), consumption: 'planned' }),
] as const satisfies readonly Entry[];

export type ConfigKey = (typeof CONFIG_REGISTRY)[number]['key'];
export type ConfigValue<K extends ConfigKey> = z.infer<Extract<(typeof CONFIG_REGISTRY)[number], { key: K }>['schema']>;
export type ConfigKind = Entry['kind'];
export const CONFIG_BY_KEY = new Map<string, Entry>(CONFIG_REGISTRY.map((item) => [item.key, item]));

/** Availability controls are generated from the actual rebuild catalog. */
export const AVAILABILITY_CATALOG = {
  modules: MODULES.map(({ id, title }) => ({ id, title })),
  features: PAGES.map(({ id, title, module }) => ({ id, title, module })),
} as const;

export function safeConfigShape() {
  return (CONFIG_REGISTRY as readonly Entry[]).map(({ key, group, label, kind, description, defaultValue, consumption, options: choices }) => ({
    key, group, label, kind, description, defaultValue, consumption, options: choices,
  }));
}
