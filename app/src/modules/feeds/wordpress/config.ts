import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/**
 * Root settings of the WordPress recipe source (read-only access to a WordPress database plus the planner that
 * keeps scheduled posts filled). Per-workspace sources start from these defaults and may override them.
 */
export const WORDPRESS_DEFAULTS = {
  enabled: true, tablePrefix: 'wp_', siteUrl: '', uploadsPath: '/wp-content/uploads', permalinkTemplate: '{siteUrl}/{slug}/',
  dbConnectTimeoutMs: 5000, dbQueryTimeoutMs: 15000, dbPoolSize: 2, candidateBatchSize: 200, candidateMaxScan: 5000,
  postType: 'post', postStatus: 'publish', captionMetaKey: '_msrwa_facebook_caption', imageMetaKey: '_msrwa_facebook_generated',
  recipeMetaKey: '_msrwa_recipe', skipMetaKey: 'fb_shared_at', attachedFileMetaKey: '_wp_attached_file', skipShared: true, order: 'newest', maxAgeDays: 0,
  slots: ['07:00', '11:00', '15:00', '17:00'] as string[], timezone: 'Europe/Paris', horizonDays: 2, minLeadMinutes: 5, pageStaggerMinutes: 9, distinctAcrossPages: true, repostCooldownDays: 365,
  targetTypes: ['page'] as string[], runBudget: 80, maxSourcesPerRun: 200, claimLeaseSeconds: 300, maxSlotAttempts: 5, previewCount: 5, ledgerPageSize: 50,
  firstCommentTemplate: '🍽️ {title}\n\n🧂 Ingrédients :\n{ingredients}\n\n👩‍🍳 Préparation :\n{steps}\n\n📖 Recette complète : {link}',
  firstCommentMaxCharacters: 8000, firstCommentDelayMinutes: 0, minutesSuffix: ' min', truncationMark: '…',
  jpegQuality: 88, jpegMinQuality: 60, jpegQualityStep: 8, imageMaxBytes: 8388608, imageMaxPixels: 40000000, imageFetchTimeoutMs: 20000,
  sourceNameMaxCharacters: 120, textMaxCharacters: 10000, titleMaxCharacters: 300,
  reuseEnabled: false, reuseCooldownDays: 365,
  poolWarnDays: 14, poolCacheSeconds: 900, pauseCancelEnabled: true, pauseCancelBatchSize: 100,
  statusUpcomingCount: 5, statusFailureWindowDays: 7,
} as const;
export const WORDPRESS_BOUNDS = {
  dbConnectTimeoutMs: { min: 500, max: 60000 }, dbQueryTimeoutMs: { min: 1000, max: 120000 }, dbPoolSize: { min: 1, max: 4 },
  candidateBatchSize: { min: 10, max: 1000 }, candidateMaxScan: { min: 100, max: 100000 }, maxAgeDays: { min: 0, max: 36500 },
  horizonDays: { min: 1, max: 14 }, minLeadMinutes: { min: 1, max: 1440 }, pageStaggerMinutes: { min: 0, max: 60 }, repostCooldownDays: { min: 0, max: 3650 },
  runBudget: { min: 1, max: 500 }, maxSourcesPerRun: { min: 1, max: 1000 }, claimLeaseSeconds: { min: 60, max: 3600 }, maxSlotAttempts: { min: 1, max: 20 }, previewCount: { min: 1, max: 20 }, ledgerPageSize: { min: 5, max: 200 },
  firstCommentMaxCharacters: { min: 200, max: 8000 }, firstCommentDelayMinutes: { min: 0, max: 1440 },
  jpegQuality: { min: 40, max: 100 }, jpegMinQuality: { min: 30, max: 100 }, jpegQualityStep: { min: 1, max: 30 },
  imageMaxBytes: { min: 102400, max: 33554432 }, imageMaxPixels: { min: 1000000, max: 268402689 }, imageFetchTimeoutMs: { min: 1000, max: 120000 },
  sourceNameMaxCharacters: { min: 10, max: 240 }, textMaxCharacters: { min: 500, max: 20000 }, titleMaxCharacters: { min: 40, max: 1000 },
  reuseCooldownDays: { min: 0, max: 3650 },
  poolWarnDays: { min: 1, max: 3650 }, poolCacheSeconds: { min: 0, max: 86400 }, pauseCancelBatchSize: { min: 1, max: 500 },
  statusUpcomingCount: { min: 1, max: 20 }, statusFailureWindowDays: { min: 1, max: 90 },
} as const;
const int = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);

export const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const META_KEY = /^[A-Za-z0-9_.:-]{1,191}$/;
export const SLOTS_MAX = 24;
export const slotsSchema = z.array(z.string().regex(SLOT_TIME, 'Use HH:MM.')).min(1).max(SLOTS_MAX);
const sitePattern = z.string().max(2048).refine(v => v === '' || /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(v), 'Use an https address without a query.');
const G = 'WordPress recipes';
const text = (key: string, label: string, description: string, defaultValue: string, schema: z.ZodTypeAny) =>
  entry({ key, group: G, label, kind: 'text', description, defaultValue, schema, consumption: 'active' });
const num = (key: string, label: string, description: string, defaultValue: number, range: { min: number; max: number }) =>
  entry({ key, group: G, label, kind: 'number', description, defaultValue, schema: int(range), consumption: 'active' });
const flag = (key: string, label: string, description: string, defaultValue: boolean) =>
  entry({ key, group: G, label, kind: 'boolean', description, defaultValue, schema: z.boolean(), consumption: 'active' });
const metaKey = z.string().regex(META_KEY);
const P = 'feeds.wordpress.';

export const WORDPRESS_CONFIG = [
  flag(`${P}enabled`, 'Plan recipes from WordPress', 'Master switch. When on, the background worker keeps enabled recipe sources filled with scheduled posts via the WordPress REST API.', WORDPRESS_DEFAULTS.enabled),
  text(`${P}tablePrefix`, 'WordPress table prefix', 'Prefix of the WordPress tables (letters, digits and underscore).', WORDPRESS_DEFAULTS.tablePrefix, z.string().regex(/^[A-Za-z0-9_]{0,32}$/)),
  text(`${P}siteUrl`, 'WordPress site address', 'Default site address (https) for new recipe sources; permalinks and image addresses are built from it.', WORDPRESS_DEFAULTS.siteUrl, sitePattern),
  text(`${P}uploadsPath`, 'WordPress uploads path', 'Path under the site address where attachments are served.', WORDPRESS_DEFAULTS.uploadsPath, z.string().regex(/^\/[A-Za-z0-9_./-]{0,200}$/)),
  text(`${P}permalinkTemplate`, 'Recipe link template', 'Fallback link for the first comment, used only when WordPress does not report the post\'s own link. {siteUrl} and {slug} are replaced.', WORDPRESS_DEFAULTS.permalinkTemplate, z.string().min(1).max(500).refine(v => v.includes('{slug}'), 'Include {slug}.')),
  num(`${P}dbConnectTimeoutMs`, 'WordPress connect timeout (ms)', 'Time allowed to open the read-only database connection.', WORDPRESS_DEFAULTS.dbConnectTimeoutMs, WORDPRESS_BOUNDS.dbConnectTimeoutMs),
  num(`${P}dbQueryTimeoutMs`, 'WordPress query timeout (ms)', 'Time allowed for one read-only query.', WORDPRESS_DEFAULTS.dbQueryTimeoutMs, WORDPRESS_BOUNDS.dbQueryTimeoutMs),
  num(`${P}dbPoolSize`, 'WordPress connection pool size', 'Most database connections held open at once.', WORDPRESS_DEFAULTS.dbPoolSize, WORDPRESS_BOUNDS.dbPoolSize),
  num(`${P}candidateBatchSize`, 'Recipes read per query', 'Rows requested by one candidate query.', WORDPRESS_DEFAULTS.candidateBatchSize, WORDPRESS_BOUNDS.candidateBatchSize),
  num(`${P}candidateMaxScan`, 'Recipes scanned per run', 'Most recipes examined in one planning run before it stops looking.', WORDPRESS_DEFAULTS.candidateMaxScan, WORDPRESS_BOUNDS.candidateMaxScan),
  text(`${P}postType`, 'Default WordPress post type', 'Default for new sources.', WORDPRESS_DEFAULTS.postType, z.string().regex(/^[A-Za-z0-9_-]{1,20}$/)),
  text(`${P}postStatus`, 'Default WordPress post status', 'Default for new sources.', WORDPRESS_DEFAULTS.postStatus, z.string().regex(/^[A-Za-z0-9_-]{1,20}$/)),
  text(`${P}captionMetaKey`, 'Default caption field', 'Post-meta key holding the Facebook caption; default for new sources.', WORDPRESS_DEFAULTS.captionMetaKey, metaKey),
  text(`${P}imageMetaKey`, 'Default image field', 'Post-meta key holding the attachment ID of the Facebook image; default for new sources.', WORDPRESS_DEFAULTS.imageMetaKey, metaKey),
  text(`${P}recipeMetaKey`, 'Default recipe field', 'Post-meta key holding the canonical recipe (JSON); default for new sources.', WORDPRESS_DEFAULTS.recipeMetaKey, metaKey),
  text(`${P}skipMetaKey`, 'Default already-shared field', 'Post-meta key whose presence marks a recipe as already shared; empty disables. Default for new sources.', WORDPRESS_DEFAULTS.skipMetaKey, z.string().regex(/^([A-Za-z0-9_.:-]{1,191})?$/)),
  text(`${P}attachedFileMetaKey`, 'Attachment file field', 'Attachment post-meta key holding the file path under the uploads folder.', WORDPRESS_DEFAULTS.attachedFileMetaKey, metaKey),
  flag(`${P}skipShared`, 'Skip recipes already shared', 'Default for new sources: leave out recipes that carry the already-shared field.', WORDPRESS_DEFAULTS.skipShared),
  entry({ key: `${P}order`, group: G, label: 'Default recipe order', kind: 'select', description: 'Which recipes are planned first; default for new sources.', defaultValue: WORDPRESS_DEFAULTS.order, schema: z.enum(['newest', 'oldest']), options: [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }], consumption: 'active' }),
  num(`${P}maxAgeDays`, 'Default maximum recipe age (days)', 'Ignore recipes published longer ago than this; 0 means no limit. Default for new sources.', WORDPRESS_DEFAULTS.maxAgeDays, WORDPRESS_BOUNDS.maxAgeDays),
  entry({ key: `${P}slots`, group: G, label: 'Default publishing times', kind: 'json', description: 'Local times (HH:MM) at which every page posts, every day; default for new sources.', defaultValue: [...WORDPRESS_DEFAULTS.slots], schema: slotsSchema, consumption: 'active' }),
  text(`${P}timezone`, 'Default time zone', 'IANA time zone the publishing times are read in (daylight saving aware); default for new sources.', WORDPRESS_DEFAULTS.timezone, z.string().min(1).max(64).refine(v => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; } }, 'Use an IANA time zone.')),
  num(`${P}horizonDays`, 'Default planning horizon (days)', 'How far ahead scheduled posts are kept filled; default for new sources.', WORDPRESS_DEFAULTS.horizonDays, WORDPRESS_BOUNDS.horizonDays),
  num(`${P}pageStaggerMinutes`, 'Minutes between Pages in one slot', 'Each Page publishes this many minutes after the previous one in the same slot, so a network of Pages never posts at the same second. 0 publishes all at once.', WORDPRESS_DEFAULTS.pageStaggerMinutes, WORDPRESS_BOUNDS.pageStaggerMinutes),
  num(`${P}minLeadMinutes`, 'Minimum lead before a slot (minutes)', 'A slot closer than this is left alone, so a post is never scheduled in the past.', WORDPRESS_DEFAULTS.minLeadMinutes, WORDPRESS_BOUNDS.minLeadMinutes),
  flag(`${P}distinctAcrossPages`, 'Different recipe on every page', 'Default for new sources: no two pages receive the same recipe within the horizon.', WORDPRESS_DEFAULTS.distinctAcrossPages),
  num(`${P}repostCooldownDays`, 'Default repost cooldown (days)', 'A recipe is not planned again on the same page within this many days; default for new sources.', WORDPRESS_DEFAULTS.repostCooldownDays, WORDPRESS_BOUNDS.repostCooldownDays),
  entry({ key: `${P}targetTypes`, group: G, label: 'Channel types used', kind: 'json', description: 'Channel types a source with all channels plans for. Channels Publishing does not accept are skipped.', defaultValue: [...WORDPRESS_DEFAULTS.targetTypes], schema: z.array(z.string().regex(/^[a-z_]{1,32}$/)).min(1).max(20), consumption: 'active' }),
  num(`${P}runBudget`, 'Posts created per planning run', 'Most scheduled posts one run creates across all sources; the rest follow on later runs.', WORDPRESS_DEFAULTS.runBudget, WORDPRESS_BOUNDS.runBudget),
  num(`${P}maxSourcesPerRun`, 'Recipe sources examined per run', 'Most enabled recipe sources one worker run looks at (least recently run first); the rest follow on later runs.', WORDPRESS_DEFAULTS.maxSourcesPerRun, WORDPRESS_BOUNDS.maxSourcesPerRun),
  num(`${P}claimLeaseSeconds`, 'Unfinished claim lease (seconds)', 'A slot claim older than this without a post is marked uncertain and is not retried automatically.', WORDPRESS_DEFAULTS.claimLeaseSeconds, WORDPRESS_BOUNDS.claimLeaseSeconds),
  num(`${P}maxSlotAttempts`, 'Recipes tried per slot', 'After this many recipes fail for one slot, the slot is left failed for review.', WORDPRESS_DEFAULTS.maxSlotAttempts, WORDPRESS_BOUNDS.maxSlotAttempts),
  num(`${P}previewCount`, 'Recipes shown in the preview', 'Upcoming recipes shown exactly as they will post.', WORDPRESS_DEFAULTS.previewCount, WORDPRESS_BOUNDS.previewCount),
  num(`${P}ledgerPageSize`, 'Planned posts per page', 'Rows of the planned-posts table shown at once.', WORDPRESS_DEFAULTS.ledgerPageSize, WORDPRESS_BOUNDS.ledgerPageSize),
  text(`${P}firstCommentTemplate`, 'Default first-comment template', 'Placeholders: {title} {description} {ingredients} {steps} {servings} {prep} {cook} {total} {link}. Default for new sources.', WORDPRESS_DEFAULTS.firstCommentTemplate, z.string().min(1).max(WORDPRESS_DEFAULTS.textMaxCharacters)),
  num(`${P}firstCommentMaxCharacters`, 'First-comment length limit', 'Longer comments are shortened (ingredients and steps first) and keep the recipe link.', WORDPRESS_DEFAULTS.firstCommentMaxCharacters, WORDPRESS_BOUNDS.firstCommentMaxCharacters),
  num(`${P}firstCommentDelayMinutes`, 'Default first-comment delay (minutes)', 'Wait after publication before the first comment is sent; default for new sources.', WORDPRESS_DEFAULTS.firstCommentDelayMinutes, WORDPRESS_BOUNDS.firstCommentDelayMinutes),
  text(`${P}minutesSuffix`, 'Minutes suffix', 'Text placed after a duration in {prep}, {cook} and {total}.', WORDPRESS_DEFAULTS.minutesSuffix, z.string().max(20)),
  text(`${P}truncationMark`, 'Shortening mark', 'Text placed where a long first comment was shortened.', WORDPRESS_DEFAULTS.truncationMark, z.string().min(1).max(10)),
  num(`${P}jpegQuality`, 'JPEG quality', 'Starting quality when the Facebook image is converted to JPEG.', WORDPRESS_DEFAULTS.jpegQuality, WORDPRESS_BOUNDS.jpegQuality),
  num(`${P}jpegMinQuality`, 'Lowest JPEG quality', 'Quality is lowered in steps down to this value when the file is too large.', WORDPRESS_DEFAULTS.jpegMinQuality, WORDPRESS_BOUNDS.jpegMinQuality),
  num(`${P}jpegQualityStep`, 'JPEG quality step', 'How much quality is lowered on each attempt.', WORDPRESS_DEFAULTS.jpegQualityStep, WORDPRESS_BOUNDS.jpegQualityStep),
  num(`${P}imageMaxBytes`, 'Recipe image download limit (bytes)', 'Largest source image that will be downloaded.', WORDPRESS_DEFAULTS.imageMaxBytes, WORDPRESS_BOUNDS.imageMaxBytes),
  num(`${P}imageMaxPixels`, 'Recipe image pixel limit', 'Largest source image (width x height) that will be converted.', WORDPRESS_DEFAULTS.imageMaxPixels, WORDPRESS_BOUNDS.imageMaxPixels),
  num(`${P}imageFetchTimeoutMs`, 'Recipe image download timeout (ms)', 'Time allowed to download one image.', WORDPRESS_DEFAULTS.imageFetchTimeoutMs, WORDPRESS_BOUNDS.imageFetchTimeoutMs),
  num(`${P}sourceNameMaxCharacters`, 'Recipe source name limit', 'Longest recipe source name.', WORDPRESS_DEFAULTS.sourceNameMaxCharacters, WORDPRESS_BOUNDS.sourceNameMaxCharacters),
  num(`${P}textMaxCharacters`, 'Recipe template length limit', 'Longest first-comment template saved with a source.', WORDPRESS_DEFAULTS.textMaxCharacters, WORDPRESS_BOUNDS.textMaxCharacters),
  num(`${P}titleMaxCharacters`, 'Recorded title length', 'Longest recipe title kept in the planned-posts record.', WORDPRESS_DEFAULTS.titleMaxCharacters, WORDPRESS_BOUNDS.titleMaxCharacters),
  flag(`${P}reuseEnabled`, 'Allow reuse of posted recipes', 'Off by default: a recipe already planned for a channel is never reused there. When on, only confirmed publications past both the source cooldown and the minimum reuse cooldown may be reused, oldest last publication first, after fresh recipes.', WORDPRESS_DEFAULTS.reuseEnabled),
  num(`${P}reuseCooldownDays`, 'Minimum recipe reuse cooldown (days)', 'Minimum elapsed days since confirmed publication on the same channel. The longer of this and the source cooldown applies. Unconfirmed posts remain blocked.', WORDPRESS_DEFAULTS.reuseCooldownDays, WORDPRESS_BOUNDS.reuseCooldownDays),
  num(`${P}poolWarnDays`, 'Recipe pool warning (days)', 'A channel is flagged as running low when its remaining eligible recipes last fewer days than this at the current posting times.', WORDPRESS_DEFAULTS.poolWarnDays, WORDPRESS_BOUNDS.poolWarnDays),
  num(`${P}poolCacheSeconds`, 'Recipe pool check cache (seconds)', 'How long a computed recipe pool health result is reused before the recipe library is scanned again; 0 scans on every view.', WORDPRESS_DEFAULTS.poolCacheSeconds, WORDPRESS_BOUNDS.poolCacheSeconds),
  flag(`${P}pauseCancelEnabled`, 'Allow cancelling scheduled posts on pause', 'When on, pausing a recipe source may also cancel its scheduled, not yet published posts (only when the member asks and confirms).', WORDPRESS_DEFAULTS.pauseCancelEnabled),
  num(`${P}pauseCancelBatchSize`, 'Posts cancelled per pause request', 'Most scheduled posts one pause request cancels; repeat the request to continue.', WORDPRESS_DEFAULTS.pauseCancelBatchSize, WORDPRESS_BOUNDS.pauseCancelBatchSize),
  num(`${P}statusUpcomingCount`, 'Status card: next posts shown', 'Upcoming planned posts listed on the recipe status card at the top of Content feeds.', WORDPRESS_DEFAULTS.statusUpcomingCount, WORDPRESS_BOUNDS.statusUpcomingCount),
  num(`${P}statusFailureWindowDays`, 'Status card: problem window (days)', 'Failed or uncertain planned posts from the last this many days are counted under "Need attention" on the recipe status card.', WORDPRESS_DEFAULTS.statusFailureWindowDays, WORDPRESS_BOUNDS.statusFailureWindowDays),
] as const;
