import { feedsError } from './messages';
import { runtimeConfigBatch } from '@/server/config/store';
import { WORDPRESS_BOUNDS } from '../wordpress/config';
import type { PlanConfig } from '../wordpress/recipe';
import type { ImageSettings } from '../wordpress/image';

const P = 'feeds.wordpress.';
const KEYS = [
  'enabled', 'tablePrefix', 'siteUrl', 'uploadsPath', 'permalinkTemplate', 'dbConnectTimeoutMs', 'dbQueryTimeoutMs', 'dbPoolSize', 'candidateBatchSize', 'candidateMaxScan',
  'postType', 'postStatus', 'captionMetaKey', 'imageMetaKey', 'recipeMetaKey', 'skipMetaKey', 'attachedFileMetaKey', 'skipShared', 'order', 'maxAgeDays', 'slots', 'timezone',
  'horizonDays', 'minLeadMinutes', 'distinctAcrossPages', 'repostCooldownDays', 'targetTypes', 'runBudget', 'maxSourcesPerRun', 'claimLeaseSeconds', 'maxSlotAttempts', 'previewCount', 'ledgerPageSize',
  'firstCommentTemplate', 'firstCommentMaxCharacters', 'firstCommentDelayMinutes', 'minutesSuffix', 'truncationMark', 'jpegQuality', 'jpegMinQuality', 'jpegQualityStep',
  'imageMaxBytes', 'imageMaxPixels', 'imageFetchTimeoutMs', 'sourceNameMaxCharacters', 'textMaxCharacters', 'titleMaxCharacters',
].map(name => `${P}${name}`);
const SHARED = ['feeds.fetchMaxRedirects', 'feeds.allowHttp', 'feeds.hostAllowlist', 'feeds.maxTargets', 'feeds.identifierMaxCharacters', 'feeds.pageNumberMax', 'feeds.transactionTimeoutMs', 'feeds.transactionMaxWaitMs',
  'data.workspaceOperationTimeoutMs', 'publishing.maxMessageCharacters', 'publishing.maxImageAltCharacters', 'publishing.maxImageUploadBytes'];

export type WordpressSettings = {
  enabled: boolean; tablePrefix: string; siteUrl: string; uploadsPath: string; permalinkTemplate: string;
  db: { connectTimeoutMs: number; queryTimeoutMs: number; poolSize: number }; candidateBatchSize: number; candidateMaxScan: number;
  defaults: PlanConfig; minLeadMinutes: number; targetTypes: string[]; runBudget: number; maxSourcesPerRun: number; claimLeaseSeconds: number; maxSlotAttempts: number; previewCount: number; ledgerPageSize: number;
  commentMax: number; minutesSuffix: string; truncationMark: string; image: ImageSettings; altMax: number;
  sourceNameMax: number; textMax: number; titleMax: number; maxTargets: number; identifierMax: number; pageNumberMax: number; transaction: { timeoutMs: number; maxWaitMs: number };
};

/** One validated snapshot of every Root value the recipe source reads. A missing or invalid value makes the feature unavailable. */
export async function loadWordpressSettings(): Promise<WordpressSettings> {
  let v: Record<string, unknown>;
  try { v = await runtimeConfigBatch([...KEYS, ...SHARED]); } catch { throw await feedsError('unavailable', 'Recipe planning is temporarily unavailable. Refresh and try again.'); }
  const w = (name: string) => v[`${P}${name}`];
  const s = (key: string) => v[key];
  const n = (value: unknown) => typeof value === 'number' ? value : Number.NaN;
  const transactionTimeout = n(s('feeds.transactionTimeoutMs')); const transactionWait = n(s('feeds.transactionMaxWaitMs'));
  if (![transactionTimeout, transactionWait, n(s('data.workspaceOperationTimeoutMs'))].every(Number.isFinite) || transactionTimeout + transactionWait >= n(s('data.workspaceOperationTimeoutMs'))) throw await feedsError('unavailable', 'Recipe planning is temporarily unavailable. Refresh and try again.');
  const publishingMax = n(s('publishing.maxMessageCharacters'));
  const uploadMax = n(s('publishing.maxImageUploadBytes'));
  return {
    enabled: w('enabled') === true, tablePrefix: String(w('tablePrefix')), siteUrl: String(w('siteUrl')), uploadsPath: String(w('uploadsPath')), permalinkTemplate: String(w('permalinkTemplate')),
    db: { connectTimeoutMs: n(w('dbConnectTimeoutMs')), queryTimeoutMs: n(w('dbQueryTimeoutMs')), poolSize: n(w('dbPoolSize')) },
    candidateBatchSize: n(w('candidateBatchSize')), candidateMaxScan: n(w('candidateMaxScan')),
    defaults: {
      mapping: { captionMetaKey: String(w('captionMetaKey')), imageMetaKey: String(w('imageMetaKey')), recipeMetaKey: String(w('recipeMetaKey')), skipMetaKey: String(w('skipMetaKey')), attachedFileMetaKey: String(w('attachedFileMetaKey')), postType: String(w('postType')), postStatus: String(w('postStatus')) },
      order: w('order') === 'oldest' ? 'oldest' : 'newest', maxAgeDays: n(w('maxAgeDays')), skipShared: w('skipShared') === true, slots: (w('slots') as string[]), timezone: String(w('timezone')),
      horizonDays: n(w('horizonDays')), distinctAcrossPages: w('distinctAcrossPages') === true, cooldownDays: n(w('repostCooldownDays')),
      firstCommentTemplate: String(w('firstCommentTemplate')), firstCommentDelayMinutes: n(w('firstCommentDelayMinutes')),
    },
    minLeadMinutes: n(w('minLeadMinutes')), targetTypes: w('targetTypes') as string[], runBudget: n(w('runBudget')), maxSourcesPerRun: n(w('maxSourcesPerRun')), claimLeaseSeconds: n(w('claimLeaseSeconds')), maxSlotAttempts: n(w('maxSlotAttempts')),
    previewCount: n(w('previewCount')), ledgerPageSize: n(w('ledgerPageSize')),
    commentMax: Math.min(n(w('firstCommentMaxCharacters')), publishingMax), minutesSuffix: String(w('minutesSuffix')), truncationMark: String(w('truncationMark')),
    image: {
      fetch: { timeoutMs: n(w('imageFetchTimeoutMs')), maxBytes: n(w('imageMaxBytes')), maxRedirects: n(s('feeds.fetchMaxRedirects')), allowHttp: s('feeds.allowHttp') === true, hostAllowlist: s('feeds.hostAllowlist') as string[] },
      maxPixels: n(w('imageMaxPixels')), quality: n(w('jpegQuality')), minQuality: n(w('jpegMinQuality')), qualityStep: n(w('jpegQualityStep')), maxOutputBytes: uploadMax,
    },
    altMax: n(s('publishing.maxImageAltCharacters')), sourceNameMax: n(w('sourceNameMaxCharacters')), textMax: n(w('textMaxCharacters')), titleMax: n(w('titleMaxCharacters')),
    maxTargets: n(s('feeds.maxTargets')), identifierMax: n(s('feeds.identifierMaxCharacters')), pageNumberMax: n(s('feeds.pageNumberMax')), transaction: { timeoutMs: transactionTimeout, maxWaitMs: transactionWait },
  };
}

/** Limits for the saved per-source overrides, taken from the same Root bounds as the defaults. */
export const patchLimits = (settings: Pick<WordpressSettings, 'textMax'>) => ({
  template: settings.textMax, horizon: WORDPRESS_BOUNDS.horizonDays, cooldown: WORDPRESS_BOUNDS.repostCooldownDays, age: WORDPRESS_BOUNDS.maxAgeDays, delay: WORDPRESS_BOUNDS.firstCommentDelayMinutes,
});
