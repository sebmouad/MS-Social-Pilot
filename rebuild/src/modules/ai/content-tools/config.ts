import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';
import { TOOLS_COPY } from './copy';

const https = z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.');
const model = z.string().trim().max(120).regex(/^[A-Za-z0-9._:/-]*$/);
const pattern = z.string().max(120).refine(v => { try { new RegExp(v, 'i'); return true; } catch { return false; } }, 'Use a valid pattern.');
const usd = z.number().min(0).max(1000);
const ms = (max: number) => z.number().int().min(1000).max(max);
const bilingual = z.object({ en: z.string().trim().min(1).max(80), fr: z.string().trim().min(1).max(80) }).strict();
const slug = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,31}$/);
const group = 'AI · Pictures, video, voice and checks';

/** Provider ports shipped for each media kind; adding one means an adapter plus an entry in server/media-ports.ts. */
export const IMAGE_PROVIDERS = ['openai'] as const;
export const VOICE_PROVIDERS = ['openai'] as const;
export const VIDEO_PROVIDERS = ['gemini'] as const;

export const imagePolicySchema = z.object({
  enabled: z.boolean(), provider: z.enum(IMAGE_PROVIDERS), endpoint: https, modelsEndpoint: https,
  model, modelPattern: pattern,
  sizes: z.array(z.object({ id: slug, size: z.string().regex(/^\d{3,4}x\d{3,4}$/), label: bilingual }).strict()).min(1).max(8), defaultSize: slug,
  promptMinCharacters: z.number().int().min(1).max(200), promptMaxCharacters: z.number().int().min(10).max(4000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), fileName: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  maxDownloadBytes: z.number().int().min(10_000).max(50_000_000), timeoutMs: ms(300_000), costPerImageUsd: usd,
}).strict().refine(v => v.sizes.some(s => s.id === v.defaultSize), 'The default size must be one of the sizes.');

export const voicePolicySchema = z.object({
  enabled: z.boolean(), provider: z.enum(VOICE_PROVIDERS), endpoint: https, modelsEndpoint: https,
  model, modelPattern: pattern,
  voices: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)).min(1).max(40), defaultVoice: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  textMinCharacters: z.number().int().min(1).max(200), textMaxCharacters: z.number().int().min(10).max(20000),
  format: z.string().regex(/^[a-z0-9]{2,8}$/), mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/),
  maxAudioBytes: z.number().int().min(10_000).max(50_000_000), timeoutMs: ms(300_000), costPerRequestUsd: usd,
}).strict().refine(v => v.voices.includes(v.defaultVoice), 'The default voice must be one of the voices.');

export const videoPolicySchema = z.object({
  enabled: z.boolean(), provider: z.enum(VIDEO_PROVIDERS), baseEndpoint: https,
  model, modelPattern: pattern, excludePattern: pattern,
  aspectRatios: z.array(z.object({ id: z.string().regex(/^\d{1,2}:\d{1,2}$/), label: bilingual }).strict()).min(1).max(6), defaultAspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/),
  promptMinCharacters: z.number().int().min(1).max(200), promptMaxCharacters: z.number().int().min(10).max(4000),
  giveUpMs: z.number().int().min(60_000).max(86_400_000), listLimit: z.number().int().min(1).max(100), pollPerRead: z.number().int().min(0).max(20), workerBatch: z.number().int().min(1).max(100),
  mimeType: z.enum(['video/mp4', 'video/webm', 'video/quicktime']), fileName: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  maxDownloadBytes: z.number().int().min(100_000).max(2_000_000_000), timeoutMs: ms(600_000), finishTransactionTimeoutMs: ms(900_000), costPerVideoUsd: usd,
}).strict().refine(v => v.aspectRatios.some(a => a.id === v.defaultAspectRatio), 'The default format must be one of the formats.');

export const linkPreviewPolicySchema = z.object({
  enabled: z.boolean(), timeoutMs: ms(60_000), maxBytes: z.number().int().min(10_000).max(5_000_000), maxRedirects: z.number().int().min(0).max(10),
  allowHttp: z.boolean(), hostAllowlist: z.array(z.string().trim().min(1).max(253)).max(200),
  userAgent: z.string().trim().min(3).max(200), accept: z.string().trim().min(3).max(200),
  headScanBytes: z.number().int().min(1000).max(1_000_000), fieldMaxCharacters: z.number().int().min(20).max(2000), urlMaxCharacters: z.number().int().min(20).max(4000),
  hourlyPerWorkspace: z.number().int().min(1).max(100_000),
}).strict();

export const outlookPolicySchema = z.object({
  enabled: z.boolean(), lookbackDays: z.number().int().min(7).max(1100), maxPosts: z.number().int().min(10).max(5000),
  minHistory: z.number().int().min(3).max(1000), minShared: z.number().int().min(1).max(100),
  aboveRatio: z.number().min(1).max(10), belowRatio: z.number().min(0.01).max(1), ratioFloor: z.number().min(0.001).max(1),
  shortMaxLength: z.number().int().min(1).max(2000), mediumMaxLength: z.number().int().min(2).max(70000),
  nightEndsHour: z.number().int().min(1).max(23), morningEndsHour: z.number().int().min(1).max(23), afternoonEndsHour: z.number().int().min(1).max(23),
  maxTextCharacters: z.number().int().min(100).max(100000),
}).strict().refine(v => v.shortMaxLength < v.mediumMaxLength && v.nightEndsHour < v.morningEndsHour && v.morningEndsHour < v.afternoonEndsHour, 'Boundaries must increase.');

export const spamPolicySchema = z.object({
  enabled: z.boolean(), pagesThreshold: z.number().int().min(2).max(500), similarity: z.number().min(0.1).max(1), minWords: z.number().int().min(1).max(100),
  nearbyPostLimit: z.number().int().min(10).max(5000), maxChannels: z.number().int().min(1).max(500), maxTextCharacters: z.number().int().min(100).max(100000),
}).strict();

export const toolsLimitsSchema = z.object({ transactionTimeoutMs: ms(60_000), transactionMaxWaitMs: z.number().int().min(100).max(10_000) }).strict();

const copyShape = z.object(Object.fromEntries(Object.keys(TOOLS_COPY.en).map(key => [key, z.string().min(1).max(600)])));
export const toolsCopySchema = z.object({ en: copyShape, fr: copyShape });

export const AI_CONTENT_TOOLS_DEFAULTS = {
  image: { enabled: false, provider: 'openai', endpoint: 'https://api.openai.com/v1/images/generations', modelsEndpoint: 'https://api.openai.com/v1/models', model: '', modelPattern: 'image', sizes: [{ id: 'square', size: '1024x1024', label: { en: 'Square', fr: 'Carré' } }, { id: 'portrait', size: '1024x1536', label: { en: 'Portrait', fr: 'Portrait' } }, { id: 'landscape', size: '1536x1024', label: { en: 'Landscape', fr: 'Paysage' } }], defaultSize: 'square', promptMinCharacters: 3, promptMaxCharacters: 1000, mimeType: 'image/png', fileName: 'ai-picture.png', maxDownloadBytes: 20_000_000, timeoutMs: 120_000, costPerImageUsd: 0 },
  voice: { enabled: false, provider: 'openai', endpoint: 'https://api.openai.com/v1/audio/speech', modelsEndpoint: 'https://api.openai.com/v1/models', model: '', modelPattern: 'tts', voices: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'], defaultVoice: 'marin', textMinCharacters: 3, textMaxCharacters: 2000, format: 'mp3', mimeType: 'audio/mpeg', maxAudioBytes: 10_000_000, timeoutMs: 120_000, costPerRequestUsd: 0 },
  video: { enabled: false, provider: 'gemini', baseEndpoint: 'https://generativelanguage.googleapis.com/v1beta', model: '', modelPattern: 'veo', excludePattern: 'fast|lite', aspectRatios: [{ id: '16:9', label: { en: 'Landscape (16:9)', fr: 'Paysage (16:9)' } }, { id: '9:16', label: { en: 'Vertical (9:16)', fr: 'Vertical (9:16)' } }], defaultAspectRatio: '16:9', promptMinCharacters: 3, promptMaxCharacters: 1000, giveUpMs: 1_800_000, listLimit: 10, pollPerRead: 3, workerBatch: 20, mimeType: 'video/mp4', fileName: 'ai-video.mp4', maxDownloadBytes: 200_000_000, timeoutMs: 120_000, finishTransactionTimeoutMs: 300_000, costPerVideoUsd: 0 },
  linkPreview: { enabled: true, timeoutMs: 10_000, maxBytes: 524_288, maxRedirects: 3, allowHttp: true, hostAllowlist: [], userAgent: 'facebookexternalhit/1.1 (+MS-Social-Pilot link preview)', accept: 'text/html,application/xhtml+xml', headScanBytes: 100_000, fieldMaxCharacters: 500, urlMaxCharacters: 2000, hourlyPerWorkspace: 120 },
  outlook: { enabled: true, lookbackDays: 365, maxPosts: 500, minHistory: 10, minShared: 3, aboveRatio: 1.2, belowRatio: 0.8, ratioFloor: 0.05, shortMaxLength: 80, mediumMaxLength: 400, nightEndsHour: 6, morningEndsHour: 12, afternoonEndsHour: 18, maxTextCharacters: 70000 },
  spam: { enabled: true, pagesThreshold: 3, similarity: 0.8, minWords: 5, nearbyPostLimit: 500, maxChannels: 500, maxTextCharacters: 70000 },
  limits: { transactionTimeoutMs: 10_000, transactionMaxWaitMs: 5_000 },
} as const;

const D = AI_CONTENT_TOOLS_DEFAULTS;
export const AI_VIDEO_JOBS = [{ name: 'aiVideos', label: 'AI video progress', configKey: 'ai.videoSchedule' }] as const;

export const AI_CONTENT_TOOLS_CONFIG = [
  entry({ key: 'ai.videoSchedule', group, label: 'AI video progress schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone. The worker checks videos still being made with the provider and saves finished ones to the media library.', defaultValue: '*/2 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'ai.imagePolicy', group, label: 'AI pictures', kind: 'json', description: 'Switch, provider, endpoints, model (empty uses the newest model the provider key lists that matches the pattern), sizes with English/French labels, prompt bounds, stored file name and estimated cost per picture (0 means unpriced: usage is counted but its cost is reported as unknown). Uses the OpenAI key from the AI settings. Generated pictures are saved to the workspace media library and count toward the hourly allowance and monthly budget.', defaultValue: D.image, schema: imagePolicySchema, consumption: 'active' }),
  entry({ key: 'ai.voicePolicy', group, label: 'AI voice', kind: 'json', description: 'Switch, provider, endpoints, speech model (empty uses the newest listed model matching the pattern), the voice names the provider documents, text bounds, audio format and size ceiling, and estimated cost per request. The audio is returned to the member and is not stored.', defaultValue: D.voice, schema: voicePolicySchema, consumption: 'active' }),
  entry({ key: 'ai.videoPolicy', group, label: 'AI video', kind: 'json', description: 'Switch, provider, base endpoint, model (empty uses the newest listed model matching the pattern and not the exclude pattern), formats with labels, prompt bounds, how long a video may take before it is given up, how many are checked per read and per worker pass, the download ceiling and estimated cost per video. Uses the Gemini key from the AI settings.', defaultValue: D.video, schema: videoPolicySchema, consumption: 'active' }),
  entry({ key: 'ai.linkPreviewPolicy', group, label: 'Link previews', kind: 'json', description: 'Fetching a web address to show its title, description and picture in the composer: switch, timeout, size ceiling, redirects, plain-http allowance, optional host allowlist (empty allows any public host), request headers, scan size, field length and the hourly fetch limit per workspace. Private and loopback addresses are always refused.', defaultValue: D.linkPreview, schema: linkPreviewPolicySchema, consumption: 'active' }),
  entry({ key: 'ai.outlookPolicy', group, label: 'Engagement outlook', kind: 'json', description: 'How a draft is compared with a channel’s own past posts: look-back, how many posts are read, the history needed before anything is said, the posts a factor needs, the above/below ratios, length and time-of-day boundaries. Advice only; stored figures, no provider request.', defaultValue: D.outlook, schema: outlookPolicySchema, consumption: 'active' }),
  entry({ key: 'ai.spamGuardPolicy', group, label: 'Spam-risk check', kind: 'json', description: 'Switch and tuning for the check that warns when the same link or text would reach too many channels of one network at once: the channel threshold, how similar two texts must be, the shortest text compared and the planned posts read. The time window is the workspace setting “spacing between similar posts”.', defaultValue: D.spam, schema: spamPolicySchema, consumption: 'active' }),
  entry({ key: 'ai.toolsLimits', group, label: 'AI tools transaction limits', kind: 'json', description: 'Maximum duration and lock wait of the usage-claim write for pictures, video and voice.', defaultValue: D.limits, schema: toolsLimitsSchema, consumption: 'active' }),
  entry({ key: 'ai.toolsCopy', group, label: 'AI tools English / French copy', kind: 'json', description: 'Customer labels and messages for the Create with AI screen and the post check.', defaultValue: TOOLS_COPY, schema: toolsCopySchema, consumption: 'active' }),
] as const;
