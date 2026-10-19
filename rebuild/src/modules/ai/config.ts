import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const AI_DEFAULTS = {
  enabled: false, provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages', requestTimeoutMs: 30000, maxOutputTokens: 600,
  maxInputCharacters: 4000, hourlyRequestsPerWorkspace: 60, maxHashtags: 10, transactionTimeoutMs: 10000, transactionMaxWaitMs: 5000,
} as const;
export const AI_BOUNDS = {
  requestTimeoutMs: { min: 2000, max: 120000 }, maxOutputTokens: { min: 50, max: 4000 }, maxInputCharacters: { min: 100, max: 20000 },
  hourlyRequestsPerWorkspace: { min: 1, max: 100000 }, maxHashtags: { min: 1, max: 30 }, transactionTimeoutMs: { min: 1000, max: 60000 }, transactionMaxWaitMs: { min: 100, max: 10000 },
} as const;
/** Only providers with a shipped implementation may be selected. */
export const AI_PROVIDER_CHOICES = [{ value: 'anthropic', label: 'Anthropic Messages API' }] as const;
const int = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const G = 'Publishing · AI writing assist';

export const AI_CONFIG = [
  entry({ key: 'ai.enabled', group: G, label: 'Offer AI writing assist', kind: 'boolean', description: 'Customers see AI writing help only when this is on and a provider key is saved. Suggestions are never saved or published automatically.', defaultValue: AI_DEFAULTS.enabled, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'ai.provider', group: G, label: 'AI provider', kind: 'select', description: 'Implemented provider used for writing assist.', defaultValue: AI_DEFAULTS.provider, schema: z.enum(['anthropic']), options: AI_PROVIDER_CHOICES, consumption: 'active' }),
  entry({ key: 'ai.apiKey', group: G, label: 'AI provider key', kind: 'secret', description: 'Encrypted at rest. The saved value is never returned by the configuration API.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'ai.model', group: G, label: 'AI model', kind: 'text', description: 'Model identifier sent to the provider (default claude-sonnet-5-5).', defaultValue: AI_DEFAULTS.model, schema: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/-]*$/), consumption: 'active' }),
  entry({ key: 'ai.endpoint', group: G, label: 'AI provider endpoint', kind: 'text', description: 'HTTPS address of the provider messages endpoint.', defaultValue: AI_DEFAULTS.endpoint, schema: z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.'), consumption: 'active' }),
  entry({ key: 'ai.requestTimeoutMs', group: G, label: 'AI request timeout (ms)', kind: 'number', description: 'Longest wait for one provider answer.', defaultValue: AI_DEFAULTS.requestTimeoutMs, schema: int(AI_BOUNDS.requestTimeoutMs), consumption: 'active' }),
  entry({ key: 'ai.maxOutputTokens', group: G, label: 'AI maximum output tokens', kind: 'number', description: 'Upper bound on one generated answer.', defaultValue: AI_DEFAULTS.maxOutputTokens, schema: int(AI_BOUNDS.maxOutputTokens), consumption: 'active' }),
  entry({ key: 'ai.maxInputCharacters', group: G, label: 'AI input limit', kind: 'number', description: 'Longest text a member may send for assist.', defaultValue: AI_DEFAULTS.maxInputCharacters, schema: int(AI_BOUNDS.maxInputCharacters), consumption: 'active' }),
  entry({ key: 'ai.hourlyRequestsPerWorkspace', group: G, label: 'AI requests per workspace per hour', kind: 'number', description: 'Requests counted from the audit trail over a rolling hour; further requests are refused.', defaultValue: AI_DEFAULTS.hourlyRequestsPerWorkspace, schema: int(AI_BOUNDS.hourlyRequestsPerWorkspace), consumption: 'active' }),
  entry({ key: 'ai.maxHashtags', group: G, label: 'Hashtag suggestions', kind: 'number', description: 'Most hashtags returned by one suggestion.', defaultValue: AI_DEFAULTS.maxHashtags, schema: int(AI_BOUNDS.maxHashtags), consumption: 'active' }),
  entry({ key: 'ai.transactionTimeoutMs', group: G, label: 'AI usage transaction timeout (ms)', kind: 'number', description: 'Maximum duration of the usage-claim write.', defaultValue: AI_DEFAULTS.transactionTimeoutMs, schema: int(AI_BOUNDS.transactionTimeoutMs), consumption: 'active' }),
  entry({ key: 'ai.transactionMaxWaitMs', group: G, label: 'AI usage transaction wait (ms)', kind: 'number', description: 'Maximum wait for the usage-claim slot.', defaultValue: AI_DEFAULTS.transactionMaxWaitMs, schema: int(AI_BOUNDS.transactionMaxWaitMs), consumption: 'active' }),
] as const;
