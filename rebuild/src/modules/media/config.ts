import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';
import { copySchema } from '@/lib/config/copy-schema';
import { mediaCopy } from './copy';
import { mediaMessages, mediaMessagesSchema } from './messages';

export const MEDIA_DEFAULTS = {
  pageSize: 48, workspaceQuotaBytes: 5368709120, videoMaxBytes: 536870912, importMaxBytes: 536870912,
  importTimeoutMs: 30000, importMaxRedirects: 3, importAllowHttp: false, importHostAllowlist: [] as string[],
  allowedVideoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'], holderScanLimit: 500, holderListLimit: 10,
  imageListLimit: 1000, holderExcerptCharacters: 80, identifierMaxCharacters: 80, pageNumberMax: 1000,
  importUrlMaxCharacters: 2048, assetNameMaxCharacters: 180,
  maxSearchCharacters: 120, transactionTimeoutMs: 20000, transactionMaxWaitMs: 5000,
} as const;
export const MEDIA_BOUNDS = {
  pageSize: { min: 5, max: 200 }, workspaceQuotaBytes: { min: 1048576, max: 1099511627776 }, videoMaxBytes: { min: 1048576, max: 2147483647 },
  importMaxBytes: { min: 1048576, max: 2147483647 }, importTimeoutMs: { min: 1000, max: 300000 }, importMaxRedirects: { min: 0, max: 10 },
  holderScanLimit: { min: 10, max: 5000 }, holderListLimit: { min: 1, max: 50 }, maxSearchCharacters: { min: 10, max: 500 },
  imageListLimit: { min: 100, max: 10000 }, holderExcerptCharacters: { min: 20, max: 500 },
  identifierMaxCharacters: { min: 1, max: 256 }, pageNumberMax: { min: 100, max: 1000000 }, importUrlMaxCharacters: { min: 1, max: 8192 }, assetNameMaxCharacters: { min: 1, max: 1000 },
  transactionTimeoutMs: { min: 1000, max: 60000 }, transactionMaxWaitMs: { min: 100, max: 10000 }, workspaceTimeoutMs: { min: 5000, max: 3600000 },
} as const;
export const VIDEO_MIME_CHOICES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const int = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const G = 'Media library';

export const webpImportPolicySchema = z.object({
  enabled: z.boolean(), maxPixels: z.number().int().min(1).max(100000000),
  maxConcurrent: z.number().int().min(1).max(8), timeoutMs: z.number().int().min(100).max(300000),
  maxOutputBytes: z.number().int().min(1).max(104857600),
}).strict();
/** Unused library assets (no post references them) are removed after `unusedDays`; off until Root enables it. */
export const mediaRetentionPolicySchema = z.object({
  enabled: z.boolean(), unusedDays: z.number().int().min(1).max(3650), batchLimit: z.number().int().min(1).max(1000),
}).strict();
export const MEDIA_CONFIG = [
  entry({ key: 'media.retentionPolicy', group: G, label: 'Unused media retention', kind: 'json', description: 'When enabled, a leased worker job removes library assets older than unusedDays that no post references (checked again inside a workspace lock; any scan that cannot finish keeps the asset). batchLimit caps assets removed per workspace per run. Stored files are removed after the record. Each removal is audited. Off by default.', defaultValue: { enabled: false, unusedDays: 90, batchLimit: 100 }, schema: mediaRetentionPolicySchema, consumption: 'active' }),
  entry({ key: 'media.retentionSchedule', group: G, label: 'Unused media retention schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone for the unused media retention job.', defaultValue: '43 3 * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'media.webpImportPolicy', group: G, label: 'WebP import conversion', kind: 'json', description: 'Convert still WebP imports to PNG for workspace image storage. Animated WebP is refused. Bounds cover decoded pixels, concurrent conversions per process, elapsed time and encoded output bytes.', defaultValue: { enabled: true, maxPixels: 16000000, maxConcurrent: 2, timeoutMs: 10000, maxOutputBytes: 26214400 }, schema: webpImportPolicySchema, consumption: 'active' }),
  entry({ key: 'media.libraryPageSize', group: G, label: 'Library page size', kind: 'number', description: 'Assets listed on one media library page.', defaultValue: MEDIA_DEFAULTS.pageSize, schema: int(MEDIA_BOUNDS.pageSize), consumption: 'active' }),
  entry({ key: 'media.workspaceQuotaBytes', group: G, label: 'Workspace storage quota (bytes)', kind: 'number', description: 'Total stored media bytes one workspace may hold; imports beyond it are refused.', defaultValue: MEDIA_DEFAULTS.workspaceQuotaBytes, schema: int(MEDIA_BOUNDS.workspaceQuotaBytes), consumption: 'active' }),
  entry({ key: 'media.videoMaxBytes', group: G, label: 'Maximum video size (bytes)', kind: 'number', description: 'Largest single video accepted into the library. A publishing provider may enforce a lower limit.', defaultValue: MEDIA_DEFAULTS.videoMaxBytes, schema: int(MEDIA_BOUNDS.videoMaxBytes), consumption: 'active' }),
  entry({ key: 'media.allowedVideoMimeTypes', group: G, label: 'Video MIME allowlist', kind: 'json', description: 'Video types accepted into the library.', defaultValue: [...MEDIA_DEFAULTS.allowedVideoMimeTypes], schema: z.array(z.enum(VIDEO_MIME_CHOICES)).min(1).max(VIDEO_MIME_CHOICES.length), consumption: 'active' }),
  entry({ key: 'media.importMaxBytes', group: G, label: 'Import download limit (bytes)', kind: 'number', description: 'Largest download one import from a web address may read.', defaultValue: MEDIA_DEFAULTS.importMaxBytes, schema: int(MEDIA_BOUNDS.importMaxBytes), consumption: 'active' }),
  entry({ key: 'media.importTimeoutMs', group: G, label: 'Import timeout (ms)', kind: 'number', description: 'Overall time allowed for one import, including redirects.', defaultValue: MEDIA_DEFAULTS.importTimeoutMs, schema: int(MEDIA_BOUNDS.importTimeoutMs), consumption: 'active' }),
  entry({ key: 'media.importMaxRedirects', group: G, label: 'Import redirect limit', kind: 'number', description: 'Redirects followed (each re-checked) during one import.', defaultValue: MEDIA_DEFAULTS.importMaxRedirects, schema: int(MEDIA_BOUNDS.importMaxRedirects), consumption: 'active' }),
  entry({ key: 'media.importAllowHttp', group: G, label: 'Allow plain http imports', kind: 'boolean', description: 'When off only https addresses can be imported.', defaultValue: MEDIA_DEFAULTS.importAllowHttp, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'media.importHostAllowlist', group: G, label: 'Import host allowlist', kind: 'json', description: 'Domains imports may use (subdomains included). Empty allows any public host; private networks are always refused.', defaultValue: [...MEDIA_DEFAULTS.importHostAllowlist], schema: z.array(z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9*.-]+$/)).max(100), consumption: 'active' }),
  entry({ key: 'media.holderScanLimit', group: G, label: 'Usage scan limit', kind: 'number', description: 'Maximum posts examined per request when attributing assets to the posts that use them.', defaultValue: MEDIA_DEFAULTS.holderScanLimit, schema: int(MEDIA_BOUNDS.holderScanLimit), consumption: 'active' }),
  entry({ key: 'media.holderListLimit', group: G, label: 'Posts listed per asset', kind: 'number', description: 'Posts named in an asset usage list.', defaultValue: MEDIA_DEFAULTS.holderListLimit, schema: int(MEDIA_BOUNDS.holderListLimit), consumption: 'active' }),
  entry({ key: 'media.imageListLimit', group: G, label: 'Stored images scanned', kind: 'number', description: 'Maximum stored images read when combining image files with the media library.', defaultValue: MEDIA_DEFAULTS.imageListLimit, schema: int(MEDIA_BOUNDS.imageListLimit), consumption: 'active' }),
  entry({ key: 'media.holderExcerptCharacters', group: G, label: 'Post usage excerpt length', kind: 'number', description: 'Characters of post text retained for each media usage reference.', defaultValue: MEDIA_DEFAULTS.holderExcerptCharacters, schema: int(MEDIA_BOUNDS.holderExcerptCharacters), consumption: 'active' }),
  entry({ key: 'media.identifierMaxCharacters', group: G, label: 'Asset identifier length', kind: 'number', description: 'Maximum characters accepted for a library asset identifier.', defaultValue: MEDIA_DEFAULTS.identifierMaxCharacters, schema: int(MEDIA_BOUNDS.identifierMaxCharacters), consumption: 'active' }),
  entry({ key: 'media.pageNumberMax', group: G, label: 'Library page number ceiling', kind: 'number', description: 'Largest accepted page number in a media library request.', defaultValue: MEDIA_DEFAULTS.pageNumberMax, schema: int(MEDIA_BOUNDS.pageNumberMax), consumption: 'active' }),
  entry({ key: 'media.importUrlMaxCharacters', group: G, label: 'Import address length', kind: 'number', description: 'Maximum characters accepted for a media import address.', defaultValue: MEDIA_DEFAULTS.importUrlMaxCharacters, schema: int(MEDIA_BOUNDS.importUrlMaxCharacters), consumption: 'active' }),
  entry({ key: 'media.assetNameMaxCharacters', group: G, label: 'Asset name length', kind: 'number', description: 'Maximum characters retained in an imported media name.', defaultValue: MEDIA_DEFAULTS.assetNameMaxCharacters, schema: int(MEDIA_BOUNDS.assetNameMaxCharacters), consumption: 'active' }),
  entry({ key: 'media.searchMaxCharacters', group: G, label: 'Library search limit', kind: 'number', description: 'Maximum characters in a library search.', defaultValue: MEDIA_DEFAULTS.maxSearchCharacters, schema: int(MEDIA_BOUNDS.maxSearchCharacters), consumption: 'active' }),
  entry({ key: 'media.transactionTimeoutMs', group: G, label: 'Library transaction timeout (ms)', kind: 'number', description: 'Maximum duration of one library write.', defaultValue: MEDIA_DEFAULTS.transactionTimeoutMs, schema: int(MEDIA_BOUNDS.transactionTimeoutMs), consumption: 'active' }),
  entry({ key: 'media.transactionMaxWaitMs', group: G, label: 'Library transaction wait (ms)', kind: 'number', description: 'Maximum wait for a library write slot.', defaultValue: MEDIA_DEFAULTS.transactionMaxWaitMs, schema: int(MEDIA_BOUNDS.transactionMaxWaitMs), consumption: 'active' }),
  entry({ key: 'media.copy', group: G, label: 'Media library copy', kind: 'json', description: 'English and French media library labels, confirmations and feedback.', defaultValue: mediaCopy, schema: z.object({ en: copySchema(mediaCopy.en), fr: copySchema(mediaCopy.fr) }).strict(), consumption: 'active' }),
  entry({ key: 'media.messages', group: G, label: 'Media library failure messages', kind: 'json', description: 'English and French text of the media library\'s failure replies in the app, REST API and MCP. The request\'s language picks the version; without one, English is used.', defaultValue: mediaMessages, schema: mediaMessagesSchema, consumption: 'active' }),
] as const;
