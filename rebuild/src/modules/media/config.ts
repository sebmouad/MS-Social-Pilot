import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const MEDIA_DEFAULTS = {
  pageSize: 48, workspaceQuotaBytes: 5368709120, videoMaxBytes: 536870912, importMaxBytes: 536870912,
  importTimeoutMs: 30000, importMaxRedirects: 3, importAllowHttp: false, importHostAllowlist: [] as string[],
  allowedVideoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'], holderScanLimit: 500, holderListLimit: 10,
  maxSearchCharacters: 120, transactionTimeoutMs: 20000, transactionMaxWaitMs: 5000,
} as const;
export const MEDIA_BOUNDS = {
  pageSize: { min: 5, max: 200 }, workspaceQuotaBytes: { min: 1048576, max: 1099511627776 }, videoMaxBytes: { min: 1048576, max: 2147483647 },
  importMaxBytes: { min: 1048576, max: 2147483647 }, importTimeoutMs: { min: 1000, max: 300000 }, importMaxRedirects: { min: 0, max: 10 },
  holderScanLimit: { min: 10, max: 5000 }, holderListLimit: { min: 1, max: 50 }, maxSearchCharacters: { min: 10, max: 500 },
  transactionTimeoutMs: { min: 1000, max: 60000 }, transactionMaxWaitMs: { min: 100, max: 10000 }, workspaceTimeoutMs: { min: 5000, max: 3600000 },
} as const;
export const VIDEO_MIME_CHOICES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const int = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const G = 'Media library';

export const MEDIA_CONFIG = [
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
  entry({ key: 'media.searchMaxCharacters', group: G, label: 'Library search limit', kind: 'number', description: 'Maximum characters in a library search.', defaultValue: MEDIA_DEFAULTS.maxSearchCharacters, schema: int(MEDIA_BOUNDS.maxSearchCharacters), consumption: 'active' }),
  entry({ key: 'media.transactionTimeoutMs', group: G, label: 'Library transaction timeout (ms)', kind: 'number', description: 'Maximum duration of one library write.', defaultValue: MEDIA_DEFAULTS.transactionTimeoutMs, schema: int(MEDIA_BOUNDS.transactionTimeoutMs), consumption: 'active' }),
  entry({ key: 'media.transactionMaxWaitMs', group: G, label: 'Library transaction wait (ms)', kind: 'number', description: 'Maximum wait for a library write slot.', defaultValue: MEDIA_DEFAULTS.transactionMaxWaitMs, schema: int(MEDIA_BOUNDS.transactionMaxWaitMs), consumption: 'active' }),
] as const;
