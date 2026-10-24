import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const scopeList = z.array(z.string().regex(/^[a-z_]+$/)).min(1);
const metric = z.object({ name: z.string().regex(/^[a-z_]+$/), period: z.enum(['day', 'lifetime']), metricType: z.enum(['time_series', 'total_value']), breakdown: z.string().regex(/^[a-z_,]+$/).optional() });
const metricLabels = {
  views: { en: 'Views', fr: 'Vues' }, reach: { en: 'People reached', fr: 'Personnes touchées' },
  total_interactions: { en: 'Interactions', fr: 'Interactions' }, saved: { en: 'Saves', fr: 'Enregistrements' },
  likes: { en: 'Likes', fr: 'Mentions J’aime' }, comments: { en: 'Comments', fr: 'Commentaires' },
  shares: { en: 'Shares', fr: 'Partages' }, follower_count: { en: 'New followers', fr: 'Nouveaux abonnés' },
  followers_count: { en: 'Followers', fr: 'Abonnés' }, profile_views: { en: 'Profile views', fr: 'Vues du profil' },
  follows_and_unfollows: { en: 'Follows and unfollows', fr: 'Abonnements et désabonnements' },
};
const copy = {
  recoveryTitle: { en: 'Instagram publication evidence', fr: 'Preuves de publication Instagram' },
  recoveryDescription: { en: 'Container and publication intents and receipts. Unresolved publish requests remain held and are never sent again automatically.', fr: 'Intentions et confirmations de préparation et de publication. Les demandes non résolues restent en attente et ne sont jamais renvoyées automatiquement.' },
  operation: { en: 'Publication', fr: 'Publication' },
  phase: { en: 'Step', fr: 'Étape' },
  state: { en: 'Status', fr: 'État' },
  remoteId: { en: 'Instagram identifier', fr: 'Identifiant Instagram' },
  recordedAt: { en: 'Recorded at', fr: 'Enregistré le' },
  publicReply: { en: 'Your reply appears publicly under this comment.', fr: 'Votre réponse apparaît publiquement sous ce commentaire.' },
  commentsOnly: { en: 'Only comments are available for this account.', fr: 'Seuls les commentaires sont disponibles pour ce compte.' },
  publishing: { en: 'Publishing', fr: 'Publication' },
  comments: { en: 'Comments', fr: 'Commentaires' },
  analytics: { en: 'Analytics', fr: 'Statistiques' },
  unavailable: { en: 'Instagram could not complete this request. Please try again later.', fr: 'Instagram n’a pas pu terminer cette demande. Réessayez plus tard.' },
  invalid: { en: 'Check the selected format, caption and media before trying again.', fr: 'Vérifiez le format, la légende et les médias avant de réessayer.' },
  permission: { en: 'Reconnect this account to allow this action.', fr: 'Reconnectez ce compte pour autoriser cette action.' },
  uncertain: { en: 'The publication could not be confirmed. Check the account before sending it again.', fr: 'La publication n’a pas pu être confirmée. Vérifiez le compte avant de la renvoyer.' },
  processing: { en: 'Instagram could not prepare this media. Check the file before trying again.', fr: 'Instagram n’a pas pu préparer ce média. Vérifiez le fichier avant de réessayer.' },
  source: { en: 'Instagram performance', fr: 'Performances Instagram' },
  overlap: { en: 'Reach and lifetime snapshots are not additive. People may overlap across accounts.', fr: 'La portée et les instantanés cumulés ne s’additionnent pas. Les personnes peuvent figurer dans plusieurs comptes.' },
  rollupWeeksNote: { en: 'Long ranges show weekly points from precomputed rollups; partial weeks at the edges keep daily points.', fr: 'Les longues périodes affichent des points hebdomadaires issus des cumuls précalculés ; les semaines partielles aux extrémités gardent des points quotidiens.' },
  image: { en: 'Photo', fr: 'Photo' }, video: { en: 'Video', fr: 'Vidéo' },
  carousel: { en: 'Carousel', fr: 'Carrousel' }, reel: { en: 'Reel', fr: 'Reel' },
  story: { en: 'Story', fr: 'Story' },
};
export const instagramPolicySchema = z.object({
  graphBaseUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }),
  graphVersion: z.string().regex(/^v\d+\.\d+$/), requestTimeoutMs: z.number().int().min(1).max(120000),
  analyticsLookbackDays: z.number().int().min(1).max(3650).default(30),
  analyticsReadMaxRows: z.number().int().min(1).max(100000).default(10000),
  inboxReplyMaxCharacters: z.number().int().min(1).max(10000).default(2000),
  inboxTargetsPerWorkspace: z.number().int().min(1).max(100).default(5),
  inboxPostsPerTarget: z.number().int().min(1).max(250).default(25),
  connectionMaxPages: z.number().int().min(1).max(1000).default(100),
  pageSize: z.number().int().min(1).max(100), maxPages: z.number().int().min(1).max(100),
  pollIntervalMs: z.number().int().min(1).max(60000), pollAttempts: z.number().int().min(1).max(300),
  captionLength: z.number().int().min(1).max(2200), carouselMax: z.number().int().min(2).max(10),
  appSecretProofEnabled: z.boolean(),
  readScopes: scopeList, publishScopes: scopeList, commentScopes: scopeList, insightScopes: scopeList,
  accountMetrics: z.array(metric), postMetrics: z.array(z.string().regex(/^[a-z_]+$/)),
  labels: z.record(z.string(), bilingual), copy: z.object(Object.fromEntries(Object.keys(copy).map(key => [key, bilingual.default(copy[key as keyof typeof copy])])) as { [K in keyof typeof copy]: z.ZodDefault<typeof bilingual> }),
});
export type InstagramPolicy = z.infer<typeof instagramPolicySchema>;
export const INSTAGRAM_POLICY_DEFAULTS: InstagramPolicy = {
  graphBaseUrl: 'https://graph.facebook.com', graphVersion: 'v26.0', requestTimeoutMs: 15000,
  analyticsLookbackDays: 30, analyticsReadMaxRows: 10000, inboxReplyMaxCharacters: 2000, inboxTargetsPerWorkspace: 5, inboxPostsPerTarget: 25, connectionMaxPages: 100, pageSize: 50, maxPages: 5, pollIntervalMs: 3000, pollAttempts: 100, captionLength: 2200, carouselMax: 10,
  appSecretProofEnabled: true,
  readScopes: ['instagram_basic', 'pages_read_engagement'], publishScopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'],
  commentScopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'], insightScopes: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement'],
  accountMetrics: [{ name: 'views', period: 'day', metricType: 'total_value' }, { name: 'reach', period: 'day', metricType: 'time_series' }],
  postMetrics: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'], labels: metricLabels, copy,
};
export const INSTAGRAM_CONFIG = [
  entry({ key: 'platforms.instagram.enabled', group: 'Instagram · Engine', label: 'Instagram enabled', kind: 'boolean', description: 'Keep off until the connection, persistence and shared host integration are verified.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.instagram.includedByDefault', group: 'Instagram · Access', label: 'Included by default', kind: 'boolean', description: 'Workspace access policy after host integration.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.instagram.planFeatures', group: 'Instagram · Access', label: 'Plan access keys', kind: 'json', description: 'Plan feature keys granting Instagram access after host integration.', defaultValue: ['platform_instagram'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'instagram.policy', group: 'Instagram · API and operations', label: 'Instagram adapter policy', kind: 'json', description: 'Graph endpoint/version, bounded reads and polling, caption/media limits, required grants, metric requests and English/French copy. Does not grant provider permissions.', defaultValue: INSTAGRAM_POLICY_DEFAULTS, schema: instagramPolicySchema, consumption: 'active' }),
  entry({ key: 'instagram.appSecret', group: 'Instagram · Credentials', label: 'Graph application secret', kind: 'secret', description: 'App secret for signing Instagram Graph requests; use the app associated with the linked Page credentials.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'instagram' } }));
