import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const AI_DEFAULTS = {
  enabled: false, provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
  openaiModel: 'gpt-6-luna', openaiEndpoint: 'https://api.openai.com/v1/chat/completions', geminiModel: 'gemini-3.6-flash', geminiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models', requestTimeoutMs: 30000, maxOutputTokens: 600,
  maxInputCharacters: 4000, hourlyRequestsPerWorkspace: 60, maxHashtags: 10, hashtagBodyMaxCharacters: 60, outputInputMultiplier: 2, languageMaxCharacters: 32,
  monthlyBudgetUsd: 0, fallbackInputPricePerMillionUsd: 0, fallbackOutputPricePerMillionUsd: 0, charactersPerToken: 4,
  summaryMaxCharacters: 1200, summarySubjectMaxCharacters: 200, sentimentLookbackDays: 15, transactionTimeoutMs: 10000, transactionMaxWaitMs: 5000,
} as const;
export const AI_BOUNDS = {
  requestTimeoutMs: { min: 2000, max: 120000 }, maxOutputTokens: { min: 50, max: 4000 }, maxInputCharacters: { min: 100, max: 20000 },
  hourlyRequestsPerWorkspace: { min: 1, max: 100000 }, maxHashtags: { min: 1, max: 30 }, transactionTimeoutMs: { min: 1000, max: 60000 }, transactionMaxWaitMs: { min: 100, max: 10000 },
  summaryMaxCharacters: { min: 100, max: 10000 }, sentimentLookbackDays: { min: 1, max: 365 },
  summarySubjectMaxCharacters: { min: 0, max: 2000 },
  monthlyBudgetUsd: { min: 0, max: 1_000_000 }, pricePerMillionUsd: { min: 0, max: 100_000 }, charactersPerToken: { min: 1, max: 10 }, priceOverrideMaxModels: { min: 1, max: 200 },
  hashtagBodyMaxCharacters: { min: 1, max: 256 }, outputInputMultiplier: { min: 1, max: 10 }, languageMaxCharacters: { min: 2, max: 256 },
} as const;
/** Only providers with a shipped implementation may be selected. */
export const AI_PROVIDER_CHOICES = [{ value: 'anthropic', label: 'Anthropic (Claude)' }, { value: 'openai', label: 'OpenAI' }, { value: 'gemini', label: 'Google Gemini' }] as const;
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProviderId = typeof AI_PROVIDERS[number];
const int = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const G = 'Publishing · AI writing assist';
const price = z.number().min(AI_BOUNDS.pricePerMillionUsd.min).max(AI_BOUNDS.pricePerMillionUsd.max);
const modelPrice = z.object({ inputPerMillionUsd: price, outputPerMillionUsd: price }).strict();
export const priceOverridesSchema = z.record(z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:/-]+$/), modelPrice)
  .refine(v => Object.keys(v).length <= AI_BOUNDS.priceOverrideMaxModels.max, 'Too many models in the price table.');
export type ModelPrices = z.infer<typeof priceOverridesSchema>;

export const AI_CONFIG = [
  entry({ key: 'ai.sentimentBatchSize', group: 'AI · Comment sentiment', label: 'Comment classification batch size', kind: 'number', description: 'Maximum stored comments examined per alert pass. Classification requires AI enabled, a key and workspace opt-in.', defaultValue: 20, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'ai.sentimentDailyCap', group: 'AI · Comment sentiment', label: 'Daily comment classification cap per workspace', kind: 'number', description: 'UTC-day request ceiling, including failed attempts.', defaultValue: 200, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'ai.sentimentLookbackDays', group: 'AI · Comment sentiment', label: 'Comment classification lookback (days)', kind: 'number', description: 'Maximum comment age considered for automatic sentiment classification.', defaultValue: AI_DEFAULTS.sentimentLookbackDays, schema: int(AI_BOUNDS.sentimentLookbackDays), consumption: 'active' }),
  entry({ key: 'ai.monthlyBudgetUsd', group: 'AI · Budget and prices', label: 'Monthly AI budget per workspace (USD)', kind: 'number', description: 'Estimated spend ceiling per workspace per UTC month, counted from recorded AI usage. 0 means no budget. Spend is estimated from text length and the prices below; unpriced requests count as unknown, not zero, and are not stopped by the budget.', defaultValue: AI_DEFAULTS.monthlyBudgetUsd, schema: z.number().min(AI_BOUNDS.monthlyBudgetUsd.min).max(AI_BOUNDS.monthlyBudgetUsd.max), consumption: 'active' }),
  entry({ key: 'ai.priceOverrides', group: 'AI · Budget and prices', label: 'Model price table (USD per million tokens)', kind: 'json', description: 'Object keyed by model identifier, each with inputPerMillionUsd and outputPerMillionUsd. Models not listed use the fallback prices.', defaultValue: {}, schema: priceOverridesSchema, consumption: 'active' }),
  entry({ key: 'ai.fallbackInputPricePerMillionUsd', group: 'AI · Budget and prices', label: 'Fallback input price (USD per million tokens)', kind: 'number', description: 'Used for models absent from the price table. 0 with a 0 output price means unpriced: usage is counted but its cost is reported as unknown.', defaultValue: AI_DEFAULTS.fallbackInputPricePerMillionUsd, schema: price, consumption: 'active' }),
  entry({ key: 'ai.fallbackOutputPricePerMillionUsd', group: 'AI · Budget and prices', label: 'Fallback output price (USD per million tokens)', kind: 'number', description: 'Used for models absent from the price table.', defaultValue: AI_DEFAULTS.fallbackOutputPricePerMillionUsd, schema: price, consumption: 'active' }),
  entry({ key: 'ai.charactersPerToken', group: 'AI · Budget and prices', label: 'Characters per token (estimate)', kind: 'number', description: 'Providers return no token counts to the application, so usage is estimated as characters divided by this number.', defaultValue: AI_DEFAULTS.charactersPerToken, schema: int(AI_BOUNDS.charactersPerToken), consumption: 'active' }),
  entry({ key: 'ai.enabled', group: G, label: 'Enable AI services', kind: 'boolean', description: 'AI requires this switch and a saved provider key. Writing suggestions require review; opted-in workspaces can classify stored inbound comments for spike alerts.', defaultValue: AI_DEFAULTS.enabled, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'ai.provider', group: G, label: 'AI provider', kind: 'select', description: 'Provider used for writing assist, report recaps and comment sentiment. Its key, model and endpoint below must be set.', defaultValue: AI_DEFAULTS.provider, schema: z.enum(AI_PROVIDERS), options: AI_PROVIDER_CHOICES, consumption: 'active' }),
  entry({ key: 'ai.apiKey', group: G, label: 'Anthropic API key', kind: 'secret', description: 'Encrypted at rest. The saved value is never returned by the configuration API.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'ai.model', group: G, label: 'Anthropic model', kind: 'text', description: 'Claude model identifier used when the provider is Anthropic.', defaultValue: AI_DEFAULTS.model, schema: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/-]*$/), consumption: 'active' }),
  entry({ key: 'ai.endpoint', group: G, label: 'Anthropic endpoint', kind: 'text', description: 'HTTPS address of the Anthropic Messages endpoint.', defaultValue: AI_DEFAULTS.endpoint, schema: z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.'), consumption: 'active' }),
  entry({ key: 'ai.openaiApiKey', group: G, label: 'OpenAI API key', kind: 'secret', description: 'Encrypted at rest. Used when the provider is OpenAI.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'ai.openaiModel', group: G, label: 'OpenAI model', kind: 'text', description: 'Model identifier used when the provider is OpenAI.', defaultValue: AI_DEFAULTS.openaiModel, schema: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/-]*$/), consumption: 'active' }),
  entry({ key: 'ai.openaiEndpoint', group: G, label: 'OpenAI endpoint', kind: 'text', description: 'HTTPS address of the OpenAI Chat Completions endpoint.', defaultValue: AI_DEFAULTS.openaiEndpoint, schema: z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.'), consumption: 'active' }),
  entry({ key: 'ai.geminiApiKey', group: G, label: 'Gemini API key', kind: 'secret', description: 'Encrypted at rest. Used when the provider is Google Gemini.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'ai.geminiModel', group: G, label: 'Gemini model', kind: 'text', description: 'Model identifier used when the provider is Google Gemini.', defaultValue: AI_DEFAULTS.geminiModel, schema: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/-]*$/), consumption: 'active' }),
  entry({ key: 'ai.geminiEndpoint', group: G, label: 'Gemini endpoint', kind: 'text', description: 'HTTPS base address of the Gemini models API; the model and :generateContent are appended.', defaultValue: AI_DEFAULTS.geminiEndpoint, schema: z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.'), consumption: 'active' }),
  entry({ key: 'ai.requestTimeoutMs', group: G, label: 'AI request timeout (ms)', kind: 'number', description: 'Longest wait for one provider answer.', defaultValue: AI_DEFAULTS.requestTimeoutMs, schema: int(AI_BOUNDS.requestTimeoutMs), consumption: 'active' }),
  entry({ key: 'ai.maxOutputTokens', group: G, label: 'AI maximum output tokens', kind: 'number', description: 'Upper bound on one generated answer.', defaultValue: AI_DEFAULTS.maxOutputTokens, schema: int(AI_BOUNDS.maxOutputTokens), consumption: 'active' }),
  entry({ key: 'ai.maxInputCharacters', group: G, label: 'AI input limit', kind: 'number', description: 'Longest text a member may send for assist.', defaultValue: AI_DEFAULTS.maxInputCharacters, schema: int(AI_BOUNDS.maxInputCharacters), consumption: 'active' }),
  entry({ key: 'ai.hourlyRequestsPerWorkspace', group: G, label: 'AI requests per workspace per hour', kind: 'number', description: 'Requests counted from the audit trail over a rolling hour; further requests are refused.', defaultValue: AI_DEFAULTS.hourlyRequestsPerWorkspace, schema: int(AI_BOUNDS.hourlyRequestsPerWorkspace), consumption: 'active' }),
  entry({ key: 'ai.maxHashtags', group: G, label: 'Hashtag suggestions', kind: 'number', description: 'Most hashtags returned by one suggestion.', defaultValue: AI_DEFAULTS.maxHashtags, schema: int(AI_BOUNDS.maxHashtags), consumption: 'active' }),
  entry({ key: 'ai.hashtagBodyMaxCharacters', group: G, label: 'Hashtag character limit', kind: 'number', description: 'Maximum characters allowed after the leading # in one suggested hashtag.', defaultValue: AI_DEFAULTS.hashtagBodyMaxCharacters, schema: int(AI_BOUNDS.hashtagBodyMaxCharacters), consumption: 'active' }),
  entry({ key: 'ai.outputInputMultiplier', group: G, label: 'AI output to input ratio', kind: 'number', description: 'Maximum generated text characters relative to the configured input ceiling.', defaultValue: AI_DEFAULTS.outputInputMultiplier, schema: int(AI_BOUNDS.outputInputMultiplier), consumption: 'active' }),
  entry({ key: 'ai.languageMaxCharacters', group: G, label: 'AI language text limit', kind: 'number', description: 'Maximum characters in the language name supplied for translation or recaps.', defaultValue: AI_DEFAULTS.languageMaxCharacters, schema: int(AI_BOUNDS.languageMaxCharacters), consumption: 'active' }),
  entry({ key: 'ai.summaryMaxCharacters', group: G, label: 'AI recap length', kind: 'number', description: 'Maximum characters retained in a generated AI recap.', defaultValue: AI_DEFAULTS.summaryMaxCharacters, schema: int(AI_BOUNDS.summaryMaxCharacters), consumption: 'active' }),
  entry({ key: 'ai.summarySubjectMaxCharacters', group: G, label: 'AI recap subject length', kind: 'number', description: 'Maximum characters accepted for an AI recap subject.', defaultValue: AI_DEFAULTS.summarySubjectMaxCharacters, schema: int(AI_BOUNDS.summarySubjectMaxCharacters), consumption: 'active' }),
  entry({ key: 'ai.transactionTimeoutMs', group: G, label: 'AI usage transaction timeout (ms)', kind: 'number', description: 'Maximum duration of the usage-claim write.', defaultValue: AI_DEFAULTS.transactionTimeoutMs, schema: int(AI_BOUNDS.transactionTimeoutMs), consumption: 'active' }),
  entry({ key: 'ai.transactionMaxWaitMs', group: G, label: 'AI usage transaction wait (ms)', kind: 'number', description: 'Maximum wait for the usage-claim slot.', defaultValue: AI_DEFAULTS.transactionMaxWaitMs, schema: int(AI_BOUNDS.transactionMaxWaitMs), consumption: 'active' }),
] as const;
