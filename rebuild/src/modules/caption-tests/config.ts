import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { CAPTION_TESTS_COPY } from './copy';

const measureKeys = z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/)).min(1).max(20);

export const captionTestsPolicySchema = z.object({
  enabled: z.boolean(),
  minCaptions: z.number().int().min(2).max(4), maxCaptions: z.number().int().min(2).max(4),
  defaultHours: z.number().int().min(1).max(720), minHours: z.number().int().min(1).max(720), maxHours: z.number().int().min(1).max(720),
  defaultMinViews: z.number().int().min(1).max(10_000_000), maxMinViews: z.number().int().min(1).max(10_000_000),
  nameMaxCharacters: z.number().int().min(10).max(300), listLimit: z.number().int().min(1).max(200),
  insightsGraceMs: z.number().int().min(3_600_000).max(30 * 86_400_000), evaluationBatch: z.number().int().min(1).max(500),
  historyLimit: z.number().int().min(10).max(5000), learnClipCharacters: z.number().int().min(20).max(1000),
  /** Stored per-post measures, in order of preference, that count as a view / as an engagement. */
  viewMeasures: measureKeys, engagementMeasures: measureKeys,
  transactionTimeoutMs: z.number().int().min(1000).max(60_000), transactionMaxWaitMs: z.number().int().min(100).max(10_000),
}).strict().refine(v => v.minCaptions <= v.maxCaptions && v.minHours <= v.defaultHours && v.defaultHours <= v.maxHours && v.defaultMinViews <= v.maxMinViews, 'Bounds must be consistent.');

const copyShape = z.object(Object.fromEntries(Object.keys(CAPTION_TESTS_COPY.en).map(key => [key, z.string().min(1).max(600)])));
export const captionTestsCopySchema = z.object({ en: copyShape, fr: copyShape });

export const CAPTION_TESTS_DEFAULTS = {
  enabled: true, minCaptions: 2, maxCaptions: 4, defaultHours: 48, minHours: 1, maxHours: 720, defaultMinViews: 500, maxMinViews: 1_000_000,
  nameMaxCharacters: 80, listLimit: 50, insightsGraceMs: 3 * 86_400_000, evaluationBatch: 50, historyLimit: 500, learnClipCharacters: 140,
  viewMeasures: ['impressions'], engagementMeasures: ['reactions', 'comments', 'shares', 'clicks'],
  transactionTimeoutMs: 15_000, transactionMaxWaitMs: 5_000,
} as const;

export const CAPTION_TESTS_CONFIG = [
  entry({ key: 'captionTests.policy', group: 'Caption tests', label: 'Caption tests', kind: 'json', description: 'Switch and rules: how many captions a test compares, the compare-after and minimum-views defaults and bounds, how long to wait for fresh figures before giving up, the worker batch, and which stored per-post measures count as a view (the first one a post has) and as engagements (summed). The measure names are those the channel’s platform module stores.', defaultValue: CAPTION_TESTS_DEFAULTS, schema: captionTestsPolicySchema, consumption: 'active' }),
  entry({ key: 'captionTests.copy', group: 'Caption tests', label: 'Caption tests English / French copy', kind: 'json', description: 'Customer labels, messages and the sentence added to the workspace voice when a result is learned.', defaultValue: CAPTION_TESTS_COPY, schema: captionTestsCopySchema, consumption: 'active' }),
] as const;
