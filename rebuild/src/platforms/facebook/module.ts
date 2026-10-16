import { z } from 'zod';
import { entry, url, stringList } from '@/lib/config/entry';
import { enabledEntry, type PlatformModule } from '../module';

/**
 * The Facebook platform module: Facebook Pages and Meta ad accounts.
 *
 * Engine: `./publishing.ts` (provider operations) · server wiring:
 * `./runtime.ts` and `./host.ts` · settings: below (stored keys keep their
 * historical `meta.*` names so existing values carry over).
 */
export const facebookModule = {
  id: 'facebook',
  name: 'Facebook',
  description: 'Facebook Pages: publishing, comments and messages, Page insights, and Meta ad accounts.',
  mark: { text: 'f', color: '#1877f2' },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'supported', analytics: 'supported', ads: 'supported' },
  channelKinds: [{ kind: 'page', label: 'Facebook Page' }],
  enabledKey: 'platforms.facebook.enabled',
  requiredSettings: ['meta.appId', 'meta.appSecret', 'meta.oauthRedirectUri', 'meta.oauthScopes'],
  settingsGroup: 'Facebook',
} as const satisfies PlatformModule;

const facebookConfigEntries = [
  entry({ ...enabledEntry('facebook', 'Facebook', true), schema: z.boolean() }),
  entry({ key: 'meta.graphBaseUrl', group: 'Facebook · API endpoints', label: 'Meta Graph API base URL', kind: 'text', description: 'HTTPS origin and optional path used by Meta Graph requests.', defaultValue: 'https://graph.facebook.com', schema: url, consumption: 'active' }),
  entry({ key: 'meta.oauthBaseUrl', group: 'Facebook · API endpoints', label: 'Meta OAuth dialog base URL', kind: 'text', description: 'HTTPS origin used to display the Meta authorization dialog.', defaultValue: 'https://www.facebook.com', schema: url, consumption: 'active' }),
  entry({ key: 'meta.graphVersion', group: 'Facebook · API endpoints', label: 'Meta Graph API version', kind: 'text', description: 'Version used by Meta integrations when connected.', defaultValue: 'v25.0', schema: z.string().regex(/^v\d+\.\d+$/, 'Use a version such as v25.0.'), consumption: 'active' }),
  entry({ key: 'meta.requestTimeoutMs', group: 'Facebook · API endpoints', label: 'Meta request timeout (ms)', kind: 'number', description: 'Maximum time allowed for one Meta API request.', defaultValue: 15000, schema: z.number().int().min(1000).max(120000), consumption: 'active' }),
  entry({ key: 'meta.maxPages', group: 'Facebook · API endpoints', label: 'Meta pagination limit', kind: 'number', description: 'Maximum Graph response pages read per collection request.', defaultValue: 20, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'meta.pageSize', group: 'Facebook · API endpoints', label: 'Meta response page size', kind: 'number', description: 'Items requested per Graph response page.', defaultValue: 100, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'meta.pageInsightMetrics', group: 'Facebook · Analytics metrics', label: 'Meta Page insight metrics', kind: 'json', description: 'JSON array of Page insight metric names approved for this app. Unsupported metrics may need removal after provider changes.', defaultValue: ['page_follows', 'page_media_view', 'page_post_engagements', 'page_views_total'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.adInsightFields', group: 'Facebook · Analytics metrics', label: 'Meta ad insight fields', kind: 'json', description: 'JSON array of Ads Insights fields approved for this app.', defaultValue: ['impressions', 'reach', 'spend', 'clicks', 'cpc', 'cpm'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.maxImageUploadBytes', group: 'Facebook · Publishing limits', label: 'Maximum Meta image upload size (bytes)', kind: 'number', description: 'Maximum local image bytes sent to Meta for one Page photo.', defaultValue: 8388608, schema: z.number().int().min(1).max(26214400), consumption: 'active' }),
  entry({ key: 'meta.allowedImageMimeTypes', group: 'Facebook · Publishing limits', label: 'Meta image upload MIME allowlist', kind: 'json', description: 'Allowed image MIME types for local Page photo uploads.', defaultValue: ['image/jpeg', 'image/png'], schema: z.array(z.enum(['image/jpeg', 'image/png', 'image/gif'])).min(1).max(3), consumption: 'active' }),
  entry({ key: 'meta.appId', group: 'Facebook · API credentials', label: 'Meta app ID', kind: 'text', description: 'Public OAuth application identifier.', defaultValue: '', schema: z.string().max(200), consumption: 'active' }),
  entry({ key: 'meta.appSecret', group: 'Facebook · API credentials', label: 'Meta app secret', kind: 'secret', description: 'Encrypted at rest. The saved value is never returned by the configuration API.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'meta.oauthRedirectUri', group: 'Facebook · API credentials', label: 'Meta OAuth callback URL', kind: 'text', description: 'HTTPS callback URL registered with the Meta application.', defaultValue: '', schema: z.union([z.literal(''), url]), consumption: 'active' }),
  entry({ key: 'meta.oauthStateMinutes', group: 'Facebook · API credentials', label: 'Meta connection challenge lifetime', kind: 'number', description: 'Minutes allowed between opening Meta authorization and returning to the callback.', defaultValue: 10, schema: z.number().int().min(1).max(60), consumption: 'active' }),
  entry({ key: 'meta.oauthScopes', group: 'Facebook · API scopes', label: 'Facebook OAuth scopes', kind: 'json', description: 'JSON array of Facebook Page scopes requested during authorization. Keep aligned with app review approval.', defaultValue: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.inboxReadScopes', group: 'Facebook · API scopes · inbox', label: 'Meta inbox read scopes', kind: 'json', description: 'JSON array of Meta scopes required to read Page conversations and comments.', defaultValue: ['pages_messaging', 'pages_read_engagement'], schema: stringList, consumption: 'configured' }),
  entry({ key: 'meta.postReadScopes', group: 'Facebook · API scopes · publishing', label: 'Meta post status read scopes', kind: 'json', description: 'JSON array of Meta scopes required to refresh the status of Page posts.', defaultValue: ['pages_read_engagement'], schema: stringList.min(1), consumption: 'active' }),
  entry({ key: 'meta.firstCommentScopes', group: 'Facebook · API scopes · publishing', label: 'Meta first-comment scopes', kind: 'json', description: 'JSON array of Meta scopes required to publish a Page post first comment.', defaultValue: ['pages_manage_engagement'], schema: stringList.min(1), consumption: 'active' }),
  entry({ key: 'meta.inboxWriteScopes', group: 'Facebook · API scopes · inbox', label: 'Meta inbox write scopes', kind: 'json', description: 'JSON array of Meta scopes required to reply to Page conversations and moderate comments.', defaultValue: ['pages_messaging', 'pages_manage_engagement'], schema: stringList, consumption: 'configured' }),
  entry({ key: 'inbox.messengerReplyWindowHours', group: 'Facebook · Inbox', label: 'Messenger reply window (hours)', kind: 'number', description: 'Maximum time after the latest visitor message that the Inbox allows a Messenger reply. Meta allows at most 24 hours.', defaultValue: 24, schema: z.number().int().min(1).max(24), consumption: 'active' }),
  entry({ key: 'meta.adsReadScopes', group: 'Facebook · API scopes · ads', label: 'Meta ads read scopes', kind: 'json', description: 'JSON array of ads reporting scopes. Request only scopes approved for this Meta app.', defaultValue: ['ads_read'], schema: stringList, consumption: 'active' }),
  entry({ key: 'meta.adsManageScopes', group: 'Facebook · API scopes · ads', label: 'Meta ads management scopes', kind: 'json', description: 'JSON array of ads management scopes. These can enable spend-affecting actions and require an approved app and implemented controls.', defaultValue: ['ads_management'], schema: stringList, consumption: 'active' }),
  entry({ key: 'api.meta.requestsPerMinute', group: 'Facebook · API rate limits', label: 'Meta requests per minute', kind: 'number', description: 'Application-side request budget for Meta API calls.', defaultValue: 200, schema: z.number().int().min(1).max(100000), consumption: 'planned' }),
] as const;

/** Every setting remains owned by this adapter, including legacy key namespaces. */
export const FACEBOOK_CONFIG = facebookConfigEntries.map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: facebookModule.id } }));
