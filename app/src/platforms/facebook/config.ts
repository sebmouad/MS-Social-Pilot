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


/**
 * Legacy arrays cannot distinguish an old default snapshot from deliberate removal.
 * Migrate them as additions, never infer exclusions from absence. Operators record
 * removals in excludedMetrics (including future names); exclusions always win.
 * Read-time normalization is pure. Persist the normalized policy with saveRootConfig
 * so the existing confirmed, transactional config.changed audit accompanies it.
 * Never write settings from a worker/read or silently manufacture an audit actor.
 */
// Defaults can grow beyond a previously saved list length; do not truncate choices
// or create normalized values that cannot be parsed again on the next read/save.
const metricListSchema = z.array(z.string().regex(/^[a-z][a-z0-9_]*$/));
export function mergeFacebookMetrics(defaults: readonly string[], metrics: readonly string[], excludedMetrics: readonly string[]) {
  const excluded = new Set(excludedMetrics);
  return [...new Set([...metrics, ...defaults])].filter(metric => !excluded.has(metric));
}

// Integrator: module.ts must use this schema/default for meta.pageInsightMetrics;
// every runtime consumer must project .metrics into FacebookConfig.pageInsightMetrics.
export const FACEBOOK_PAGE_METRIC_DEFAULTS = ['page_follows', 'page_daily_follows', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_views_total', 'page_video_views'];
export const facebookPageMetricPolicySchema = z.union([
  metricListSchema.transform(metrics => ({ metrics, excludedMetrics: [] as string[] })),
  z.object({ metrics: metricListSchema, excludedMetrics: metricListSchema }).strict(),
]).transform(policy => ({ metrics: mergeFacebookMetrics(FACEBOOK_PAGE_METRIC_DEFAULTS, policy.metrics, policy.excludedMetrics), excludedMetrics: [...new Set(policy.excludedMetrics)] }));
export const FACEBOOK_POST_METRIC_DEFAULTS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_clicks_by_type', 'post_reactions_by_type_total', 'post_video_views', 'post_video_view_time'];

export const facebookHistoryPolicySchema = z.object({
  lookbackDays: z.number().int().min(1).max(36500),
  pageBudget: z.number().int().min(1).max(100),
  edge: z.enum(['published_posts', 'feed']),
  fields: z.array(z.string().min(1)).min(1).max(100),
  metrics: metricListSchema,
  excludedMetrics: metricListSchema.optional(),
  reactionTypes: z.array(z.string().regex(/^[A-Z_]+$/)).max(30),
}).transform(policy => ({ ...policy, metrics: mergeFacebookMetrics(FACEBOOK_POST_METRIC_DEFAULTS, policy.metrics, policy.excludedMetrics ?? []), excludedMetrics: [...new Set(policy.excludedMetrics ?? [])] }));
export const FACEBOOK_HISTORY_CONFIG = [entry({ key: 'meta.postHistoryPolicy', group: 'Facebook · Analytics collection', label: 'Page post history policy', kind: 'json', description: 'Resumable Page history window, per-run feed page budget, fields, lifetime metrics and reaction types. Video metrics are requested only for positively identified video posts. Metric eligibility depends on Graph version and grants; saved metrics are additions to shipped defaults. Record deliberate removals in excludedMetrics; exclusions win and remain saved. Legacy missing metrics are not treated as exclusions. Save through Root to audit the normalized policy.', defaultValue: { lookbackDays: 365, pageBudget: 2, edge: 'published_posts', fields: ['id', 'message', 'created_time', 'permalink_url', 'status_type', 'full_picture', 'shares', 'comments.limit(0).summary(true)'], metrics: FACEBOOK_POST_METRIC_DEFAULTS, excludedMetrics: [], reactionTypes: ['LIKE', 'LOVE', 'WOW', 'HAHA', 'SAD', 'ANGRY', 'CARE'] }, schema: facebookHistoryPolicySchema, consumption: 'active' })] as const;

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
  page_fans: { en: 'Page likes', fr: 'Mentions J’aime de la Page' },
  page_fan_adds: { en: 'New Page likes', fr: 'Nouvelles mentions J’aime de la Page' },
  page_fan_adds_unique: { en: 'New Page likes (people)', fr: 'Nouvelles mentions J’aime de la Page (personnes)' },
  page_fan_removes: { en: 'Lost Page likes', fr: 'Mentions J’aime de la Page perdues' },
  page_fan_removes_unique: { en: 'Lost Page likes (people)', fr: 'Mentions J’aime de la Page perdues (personnes)' },
  page_impressions: { en: 'Impressions', fr: 'Impressions' },
  page_impressions_unique: { en: 'Unique impressions', fr: 'Impressions uniques' },
  page_follows: { en: 'Followers', fr: 'Abonnés' },
  page_daily_follows: { en: 'Daily follows', fr: 'Abonnements quotidiens' },
  page_daily_follows_unique: { en: 'New followers', fr: 'Nouveaux abonnés' },
  page_daily_unfollows_unique: { en: 'Lost followers', fr: 'Abonnés perdus' },
  page_media_view: { en: 'Media views', fr: 'Vues des médias' },
  page_total_media_view_unique: { en: 'People who viewed media', fr: 'Personnes ayant vu les médias' },
  page_post_engagements: { en: 'Post engagements', fr: 'Interactions avec les publications' },
  page_views_total: { en: 'Page views', fr: 'Vues de la Page' },
  page_video_views: { en: 'Video views', fr: 'Vues de vidéo' },
  page_follows_country: { en: 'Followers by country', fr: 'Abonnés par pays' },
  page_follows_city: { en: 'Followers by city', fr: 'Abonnés par ville' },
  page_actions_post_reactions_total: { en: 'Reactions by type', fr: 'Réactions par type' },
  page_video_complete_views_30s: { en: '30-second video views', fr: 'Vues vidéo de 30 secondes' },
  page_video_views_by_paid_non_paid: { en: 'Video views (paid / organic)', fr: 'Vues vidéo (payantes / organiques)' },
  page_fan_adds_by_paid_non_paid_unique: { en: 'New Page likes (paid / organic)', fr: 'Nouvelles mentions J’aime (payantes / organiques)' },
  content_monetization_earnings: { en: 'Monetization earnings', fr: 'Revenus de monétisation' },
  spend: { en: 'Spend', fr: 'Dépenses' },
  cpc: { en: 'Cost per click', fr: 'Coût par clic' },
  cpm: { en: 'Cost per 1,000 impressions', fr: 'Coût pour 1 000 impressions' },
  cpp: { en: 'Cost per person reached', fr: 'Coût par personne touchée' },
  ctr: { en: 'Click-through rate', fr: 'Taux de clics' },
  frequency: { en: 'Frequency', fr: 'Fréquence' },
  actions: { en: 'Actions', fr: 'Actions' },
  unique_actions: { en: 'Unique actions', fr: 'Actions uniques' },
  action_values: { en: 'Action value', fr: 'Valeur des actions' },
  cost_per_action_type: { en: 'Cost per action', fr: 'Coût par action' },
  cost_per_unique_action_type: { en: 'Cost per unique action', fr: 'Coût par action unique' },
  purchase_roas: { en: 'Purchase return on ad spend', fr: 'Retour sur dépenses publicitaires (achats)' },
  website_ctr: { en: 'Website click-through rate', fr: 'Taux de clics vers le site' },
  inline_link_clicks: { en: 'Link clicks', fr: 'Clics sur lien' },
  outbound_clicks: { en: 'Outbound clicks', fr: 'Clics sortants' },
  video_play_actions: { en: 'Video plays', fr: 'Lectures de vidéo' },
  video_p25_watched_actions: { en: 'Video watched to 25%', fr: 'Vidéo regardée à 25 %' },
  video_p50_watched_actions: { en: 'Video watched to 50%', fr: 'Vidéo regardée à 50 %' },
  video_p75_watched_actions: { en: 'Video watched to 75%', fr: 'Vidéo regardée à 75 %' },
  video_p95_watched_actions: { en: 'Video watched to 95%', fr: 'Vidéo regardée à 95 %' },
  video_p100_watched_actions: { en: 'Video watched to 100%', fr: 'Vidéo regardée en entier' },
  video_thruplay_watched_actions: { en: 'ThruPlays', fr: 'ThruPlays' },
  'action:post_engagement': { en: 'Post engagements', fr: 'Interactions avec les publications' },
  'action:page_engagement': { en: 'Page engagements', fr: 'Interactions avec la Page' },
  'action:post_reaction': { en: 'Post reactions', fr: 'Réactions aux publications' },
  'action:post': { en: 'Post shares', fr: 'Partages de publications' },
  'action:comment': { en: 'Comments', fr: 'Commentaires' },
  'action:like': { en: 'Page likes', fr: 'Mentions J’aime de la Page' },
  'action:link_click': { en: 'Link clicks', fr: 'Clics sur lien' },
  'action:landing_page_view': { en: 'Landing page views', fr: 'Vues de la page de destination' },
  'action:video_view': { en: 'Video views', fr: 'Vues de vidéo' },
  'action:photo_view': { en: 'Photo views', fr: 'Vues de photo' },
  'action:purchase': { en: 'Purchases', fr: 'Achats' },
  'action:lead': { en: 'Leads', fr: 'Prospects' },
  'action:onsite_conversion.post_net_like': { en: 'Net post likes', fr: 'J’aime nets sur publications' },
  'action:onsite_conversion.post_net_save': { en: 'Net post saves', fr: 'Enregistrements nets de publications' },
  'action:onsite_conversion.post_save': { en: 'Post saves', fr: 'Enregistrements de publications' },
  'action:onsite_conversion.messaging_conversation_started_7d': { en: 'Conversations started (7 days)', fr: 'Conversations commencées (7 jours)' },
  'action:onsite_conversion.messaging_first_reply': { en: 'First message replies', fr: 'Premières réponses aux messages' },
  'action:onsite_conversion.lead_grouped': { en: 'On-Facebook leads', fr: 'Prospects sur Facebook' },
  'action:omni_purchase': { en: 'Purchases (all channels)', fr: 'Achats (tous canaux)' },
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
// overwriting custom labels. Collection exclusions are a separate policy.
export const facebookMetricLabelsSchema = z.record(z.string(), z.object({ en: z.string().min(1), fr: z.string().min(1) }))
  .transform(overrides => ({ ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...overrides }));

export const FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS = {
  en: { source: 'Page performance', latest: 'Latest per channel', categories: 'Categories', overlap: 'Counts may overlap across resources. Sums are not deduplicated people or total reach for the whole period.', postSeries: 'Posts published', postSeriesNote: 'Lifetime totals of the posts published on each date, as of their last sync. They are not views or reactions that happened on that date.', rollupWeeksNote: 'Long ranges show weekly points from precomputed rollups; partial weeks at the edges keep daily points.' },
  fr: { source: 'Performances de la Page', latest: 'Dernière valeur par canal', categories: 'Catégories', overlap: 'Les personnes comptées peuvent figurer dans plusieurs ressources. Les sommes ne représentent pas des personnes distinctes ni la portée totale de la période.', postSeries: 'Publications du jour', postSeriesNote: 'Totaux cumulés des publications parues à chaque date, à leur dernière synchronisation. Ce ne sont pas les vues ou réactions survenues ce jour-là.', rollupWeeksNote: 'Les longues périodes affichent des points hebdomadaires issus des cumuls précalculés ; les semaines partielles aux extrémités gardent des points quotidiens.' },
};
const pageAnalyticsCopyLanguageSchema = z.object({ source: z.string().min(1), latest: z.string().min(1), categories: z.string().min(1), overlap: z.string().min(1), postSeries: z.string().min(1).optional(), postSeriesNote: z.string().min(1).optional(), rollupWeeksNote: z.string().min(1).optional() });
export const facebookPageAnalyticsCopySchema = z.object({ en: pageAnalyticsCopyLanguageSchema, fr: pageAnalyticsCopyLanguageSchema });

export const FACEBOOK_DATA_DETAIL_CONFIG = [
 entry({ key: 'meta.pageAnalyticsCopy', group: 'Facebook · Analytics collection', label: 'Bilingual Page analytics copy', kind: 'json', description: 'English and French Page provenance, aggregation and category labels.', defaultValue: FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS, schema: facebookPageAnalyticsCopySchema, consumption: 'active' }),
 entry({ key: 'meta.adHierarchyPolicy', group: 'Facebook · Analytics collection', label: 'Ads hierarchy and action dimensions', kind: 'json', description: 'Additional daily campaign, ad set and ad reports. Action dimensions apply to these reports.', defaultValue: { levels: ['campaign', 'adset', 'ad'], actionBreakdowns: ['action_type'] }, schema: facebookAdHierarchySchema, consumption: 'active' }),
 entry({ key: 'meta.postSeriesMaxPosts', group: 'Facebook · Analytics collection', label: 'Post-based series: posts read per request', kind: 'number', description: 'Most synced posts read to build Page-level series from post insights for the selected dates.', defaultValue: 5000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
 entry({ key: 'meta.postCohortMaxPosts', group: 'Facebook · Analytics collection', label: 'Post cohort measures: posts read per channel and window', kind: 'number', description: 'Most posts (app-published and synced external, each remote post once) read to total per-destination measures and to supply Home and goal views/engagements from post insights when Page insights are absent. Beyond it the read is flagged as truncated.', defaultValue: 20000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
 entry({ key: 'meta.metricLabels', group: 'Facebook · Analytics collection', label: 'Bilingual metric labels', kind: 'json', description: 'English and French labels keyed by normalized metric name. Saved entries override defaults; newly shipped labels are inherited automatically.', defaultValue: FACEBOOK_METRIC_LABEL_DEFAULTS, schema: facebookMetricLabelsSchema, consumption: 'active' }),
] as const;
