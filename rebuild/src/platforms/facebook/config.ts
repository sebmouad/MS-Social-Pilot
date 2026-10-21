import { z } from 'zod';
import { entry } from '@/lib/config/entry';
/** Facebook operational settings are supplied by the host application. */
export interface FacebookConfig {
  graphBaseUrl: string;
  oauthBaseUrl: string;
  graphVersion: string;
  requestTimeoutMs: number;
  maxPages: number;
  pageSize: number;
  /** Metric names approved for the configured app and its permissions. */
  pageInsightMetrics: readonly string[];
  adInsightFields: readonly string[];
  /** Root-managed ceiling for an image uploaded from local storage. */
  maxImageUploadBytes: number;
  /** Root-managed MIME allowlist for binary Page photo uploads. */
  allowedImageMimeTypes: readonly string[];
  /** Root policy for signing every normal Graph request with appsecret_proof. */
  appSecretProofEnabled: boolean;
  /** Server-only app secret used to sign Graph requests when policy is enabled. */
  appSecret?: string;
}

export function validateFacebookConfig(config: FacebookConfig): FacebookConfig {
  const base = new URL(config.graphBaseUrl);
  const oauth = new URL(config.oauthBaseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('Facebook Graph endpoint must use HTTPS.');
  if (oauth.protocol !== 'https:' && oauth.hostname !== 'localhost') throw new Error('Facebook OAuth endpoint must use HTTPS.');
  if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('Facebook Graph version must look like vNN.N.');
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1 || config.requestTimeoutMs > 120_000) throw new Error('Facebook request timeout is out of range.');
  if (!Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 100) throw new Error('Facebook page limit is out of range.');
  if (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 100) throw new Error('Facebook page size is out of range.');
  if (!Array.isArray(config.pageInsightMetrics) || !Array.isArray(config.adInsightFields)) throw new Error('Facebook insight fields must be configured.');
  if (typeof config.appSecretProofEnabled !== 'boolean') throw new Error('Facebook app secret proof policy must be configured.');
  if (config.appSecret !== undefined && (typeof config.appSecret !== 'string' || !config.appSecret.trim())) throw new Error('Facebook app secret must be a non-empty string when configured.');
  if (!Number.isInteger(config.maxImageUploadBytes) || config.maxImageUploadBytes < 1 || config.maxImageUploadBytes > 25 * 1024 * 1024) throw new Error('Facebook image upload limit is out of range.');
  if (!Array.isArray(config.allowedImageMimeTypes) || !config.allowedImageMimeTypes.length || config.allowedImageMimeTypes.some(type => !['image/jpeg', 'image/png', 'image/gif'].includes(type))) throw new Error('Facebook image MIME allowlist is invalid.');
  if (base.username || base.password || oauth.username || oauth.password || oauth.search || oauth.hash) throw new Error('Facebook endpoints cannot contain credentials, query strings, or fragments.');
  return config;
}

/** Root owns collection policy; empty content lists make no speculative metric requests. */
export const facebookInsightPeriodsSchema = z.array(z.enum(['day', 'week', 'days_28', 'month', 'lifetime', 'total_over_range'])).min(1).max(6);
export const facebookContentInsightsSchema = z.array(z.object({
  edge: z.enum(['posts', 'videos', 'video_reels', 'stories']),
  insightEdge: z.enum(['insights', 'video_insights']),
  fields: z.array(z.string().trim().min(1).max(2000)).max(100).optional(),
  metrics: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(100),
  periods: facebookInsightPeriodsSchema,
})).max(20);
export const facebookAdBreakdownsSchema = z.array(z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).max(10)).max(20);
export const FACEBOOK_DATA_CONFIG = [
  entry({ key: 'meta.adInsightBreakdowns', group: 'Facebook · Analytics collection', label: 'Ads insight breakdown combinations', kind: 'json', description: 'Separate delivery breakdown requests, for example [["age","gender"],["publisher_platform","platform_position"]]. Only combinations supported by the configured Graph version and fields succeed. Empty disables breakdown collection.', defaultValue: [], schema: facebookAdBreakdownsSchema, consumption: 'active' }),
  entry({ key: 'meta.pageInsightPeriods', group: 'Facebook · Analytics collection', label: 'Page insight periods', kind: 'json', description: 'Request each configured metric separately for each period. Unsupported combinations are reported as partial failures.', defaultValue: ['day'], schema: facebookInsightPeriodsSchema, consumption: 'active' }),
  entry({ key: 'meta.contentInsightCollections', group: 'Facebook · Analytics collection', label: 'Content insight collections', kind: 'json', description: 'Version-verified posts, videos, Reels and Stories metrics and periods. Empty until verified against the configured Graph version. Uses existing insight read grants; does not grant permissions.', defaultValue: [], schema: facebookContentInsightsSchema, consumption: 'active' }),
] as const;

export const facebookHistoryPolicySchema = z.object({
  lookbackDays: z.number().int().min(1).max(36500),
  pageBudget: z.number().int().min(1).max(100),
  edge: z.enum(['published_posts', 'feed']),
  fields: z.array(z.string().min(1)).min(1).max(100),
  metrics: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(100),
  reactionTypes: z.array(z.string().regex(/^[A-Z_]+$/)).max(30),
});
export const FACEBOOK_HISTORY_CONFIG = [entry({ key: 'meta.postHistoryPolicy', group: 'Facebook · Analytics collection', label: 'Page post history policy', kind: 'json', description: 'Resumable Page history window, per-run feed page budget, fields, lifetime metrics and reaction types. Video metrics are requested only for positively identified video posts. Metric eligibility depends on Graph version and grants; explicitly saved metric lists replace the defaults.', defaultValue: { lookbackDays: 365, pageBudget: 2, edge: 'published_posts', fields: ['id', 'message', 'created_time', 'permalink_url', 'status_type', 'full_picture', 'shares', 'comments.limit(0).summary(true)'], metrics: ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_clicks_by_type', 'post_reactions_by_type_total', 'post_video_views', 'post_video_view_time'], reactionTypes: ['LIKE', 'LOVE', 'WOW', 'HAHA', 'SAD', 'ANGRY', 'CARE'] }, schema: facebookHistoryPolicySchema, consumption: 'active' })] as const;

export const facebookAdHierarchySchema = z.object({ levels: z.array(z.enum(['campaign', 'adset', 'ad'])).max(3), actionBreakdowns: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(10) });
/** Normalized post keys and raw Page keys; saved labels override these defaults. */
export const FACEBOOK_METRIC_LABEL_DEFAULTS = {
  impressions: { en: 'Impressions', fr: 'Impressions' },
  reach: { en: 'People reached', fr: 'Personnes touchées' },
  clicks: { en: 'Clicks', fr: 'Clics' },
  comments: { en: 'Comments', fr: 'Commentaires' },
  shares: { en: 'Shares', fr: 'Partages' },
  reactions: { en: 'Reactions', fr: 'Réactions' },
  engagement: { en: 'Engagement', fr: 'Interactions' },
  post_media_view: { en: 'Media views', fr: 'Vues des médias' },
  post_total_media_view_unique: { en: 'People who viewed media', fr: 'Personnes ayant vu les médias' },
  post_clicks_by_type: { en: 'Clicks by type', fr: 'Clics par type' },
  post_reactions_by_type_total: { en: 'Reactions by type', fr: 'Réactions par type' },
  video_views: { en: 'Video views', fr: 'Vues de vidéo' },
  video_watch_time: { en: 'Video watch time (milliseconds)', fr: 'Durée de visionnage (millisecondes)' },
  page_follows: { en: 'Followers', fr: 'Abonnés' },
  page_daily_follows: { en: 'Daily follows', fr: 'Abonnements quotidiens' },
  page_daily_follows_unique: { en: 'New followers', fr: 'Nouveaux abonnés' },
  page_daily_unfollows_unique: { en: 'Lost followers', fr: 'Abonnés perdus' },
  page_media_view: { en: 'Media views', fr: 'Vues des médias' },
  page_total_media_view_unique: { en: 'People who viewed media', fr: 'Personnes ayant vu les médias' },
  page_post_engagements: { en: 'Post engagements', fr: 'Interactions avec les publications' },
  page_views_total: { en: 'Page views', fr: 'Vues de la Page' },
  page_video_views: { en: 'Video views', fr: 'Vues de vidéo' },
  reactions_like: { en: 'Likes', fr: 'Mentions J’aime' },
  reactions_love: { en: 'Love reactions', fr: 'Réactions J’adore' },
  reactions_wow: { en: 'Wow reactions', fr: 'Réactions Wouah' },
  reactions_haha: { en: 'Haha reactions', fr: 'Réactions Haha' },
  reactions_sad: { en: 'Sad reactions', fr: 'Réactions Triste' },
  reactions_angry: { en: 'Angry reactions', fr: 'Réactions Grrr' },
  reactions_care: { en: 'Care reactions', fr: 'Réactions Solidaire' },
} satisfies Record<string, { en: string; fr: string }>;

// Runtime single/batch reads and Root reads/saves all parse the owning schema.
// Merge catalogs here so older stored catalogs gain newly shipped labels without
// overwriting custom labels or forcing removed metrics back into collection lists.
export const facebookMetricLabelsSchema = z.record(z.string(), z.object({ en: z.string().min(1), fr: z.string().min(1) }))
  .transform(overrides => ({ ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...overrides }));

export const FACEBOOK_DATA_DETAIL_CONFIG = [
 entry({ key: 'meta.adHierarchyPolicy', group: 'Facebook · Analytics collection', label: 'Ads hierarchy and action dimensions', kind: 'json', description: 'Additional daily campaign, ad set and ad reports. Action dimensions apply to these reports.', defaultValue: { levels: ['campaign', 'adset', 'ad'], actionBreakdowns: ['action_type'] }, schema: facebookAdHierarchySchema, consumption: 'active' }),
 entry({ key: 'meta.metricLabels', group: 'Facebook · Analytics collection', label: 'Bilingual metric labels', kind: 'json', description: 'English and French labels keyed by normalized metric name. Saved entries override defaults; newly shipped labels are inherited automatically.', defaultValue: FACEBOOK_METRIC_LABEL_DEFAULTS, schema: facebookMetricLabelsSchema, consumption: 'active' }),
] as const;
