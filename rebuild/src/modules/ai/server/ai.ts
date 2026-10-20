import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch, runtimeSecret } from '@/server/config/store';
import { AI_BOUNDS, AI_PROVIDERS, type AiProviderId } from '../config';
import {
  AI_KINDS, AI_REQUEST_SCHEMA, SUMMARIZE_SCHEMA, TONES, buildPrompt, buildSummaryPrompt, cleanOutput, parseHashtags,
  type AiContext, type AiPort, type AiResult, type AiStatus, type SummarizeRequest, type SummaryResult,
} from '../ai';
import { authorizeAi, type AiActor } from './access';
import { anthropicPort } from './anthropic';
import { openaiPort } from './openai';
import { geminiPort } from './gemini';

/** Composer assist is available to members who may write posts. */
export const COMPOSER_FEATURE = 'publishing/posts';
/** Report recaps are available to members who may write reports. */
export const SUMMARY_FEATURE = 'analytics/reports';

export type AiDeps = { port?: AiPort; now?: () => Date };
const unavailable = () => new OperationError('unavailable', 'AI writing assist is not available.');
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;

/** Each provider's Root keys and adapter; adding a provider means one adapter plus one entry here. */
const PROVIDER_KEYS: Record<AiProviderId, { secret: string; model: string; endpoint: string; port: (s: { apiKey: string; endpoint: string }) => AiPort }> = {
  anthropic: { secret: 'ai.apiKey', model: 'ai.model', endpoint: 'ai.endpoint', port: anthropicPort },
  openai: { secret: 'ai.openaiApiKey', model: 'ai.openaiModel', endpoint: 'ai.openaiEndpoint', port: openaiPort },
  gemini: { secret: 'ai.geminiApiKey', model: 'ai.geminiModel', endpoint: 'ai.geminiEndpoint', port: geminiPort },
};

type Settings = { port: AiPort; model: string; timeoutMs: number; maxTokens: number; maxInput: number; hourly: number; maxHashtags: number; txTimeout: number; txWait: number };
/** Resolve everything assist needs; null when anything is unconfigured, so customer surfaces stay hidden. */
export async function settings(deps: AiDeps): Promise<Settings | null> {
  try {
    const c = await runtimeConfigBatch(['ai.enabled', 'ai.provider', 'ai.model', 'ai.endpoint', 'ai.openaiModel', 'ai.openaiEndpoint', 'ai.geminiModel', 'ai.geminiEndpoint', 'ai.requestTimeoutMs', 'ai.maxOutputTokens', 'ai.maxInputCharacters', 'ai.hourlyRequestsPerWorkspace', 'ai.maxHashtags', 'ai.transactionTimeoutMs', 'ai.transactionMaxWaitMs']);
    const B = AI_BOUNDS;
    const provider = c['ai.provider'] as AiProviderId;
    const keys = PROVIDER_KEYS[provider];
    const model = keys ? c[keys.model] : undefined; const endpoint = keys ? c[keys.endpoint] : undefined; const timeoutMs = c['ai.requestTimeoutMs']; const maxTokens = c['ai.maxOutputTokens'];
    const maxInput = c['ai.maxInputCharacters']; const hourly = c['ai.hourlyRequestsPerWorkspace']; const maxHashtags = c['ai.maxHashtags'];
    const txTimeout = c['ai.transactionTimeoutMs']; const txWait = c['ai.transactionMaxWaitMs'];
    if (c['ai.enabled'] !== true || !AI_PROVIDERS.includes(provider) || typeof model !== 'string' || !model || typeof endpoint !== 'string'
      || !inRange(timeoutMs, B.requestTimeoutMs) || !inRange(maxTokens, B.maxOutputTokens) || !inRange(maxInput, B.maxInputCharacters)
      || !inRange(hourly, B.hourlyRequestsPerWorkspace) || !inRange(maxHashtags, B.maxHashtags) || !inRange(txTimeout, B.transactionTimeoutMs) || !inRange(txWait, B.transactionMaxWaitMs)) return null;
    let port = deps.port;
    if (!port) {
      const apiKey = await runtimeSecret(keys.secret);
      if (!apiKey) return null;
      port = keys.port({ apiKey, endpoint });
    }
    return { port, model, timeoutMs, maxTokens, maxInput, hourly, maxHashtags, txTimeout, txWait };
  } catch { return null; }
}

/** The workspace's own switch and writing preferences. A missing or unreadable row means assist is off. */
async function workspaceContext(workspaceId: string): Promise<(AiContext & { enabled: boolean }) | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ aiEnabled: boolean; aiTone: string | null; aiBrandVoice: string | null; aiAvoidWords: string | null }>>`SELECT "aiEnabled", "aiTone", "aiBrandVoice", "aiAvoidWords" FROM workspaces WHERE id = ${workspaceId}`;
    const row = rows[0];
    return row ? { enabled: row.aiEnabled === true, defaultTone: row.aiTone, brandVoice: row.aiBrandVoice, avoidWords: row.aiAvoidWords } : null;
  } catch { return null; }
}

/** What the composer may offer. Everything false/empty when assist is unconfigured, switched off or the member cannot write posts. */
export async function aiStatus(actor: AiActor, deps: AiDeps = {}): Promise<AiStatus> {
  const none: AiStatus = { available: false, kinds: [], tones: [], maxInputCharacters: null };
  try { await authorizeAi(actor, COMPOSER_FEATURE, 'write'); } catch { return none; }
  const [s, workspace] = await Promise.all([settings(deps), workspaceContext(actor.workspaceId)]);
  return s && workspace?.enabled ? { available: true, kinds: AI_KINDS, tones: TONES, maxInputCharacters: s.maxInput } : none;
}

/** Whether a report recap can be offered to this actor now: write access to Reports, AI configured and on for the workspace. No provider call, nothing claimed. */
export async function summaryAvailable(actor: AiActor, deps: AiDeps = {}): Promise<boolean> {
  try { await authorizeAi(actor, SUMMARY_FEATURE, 'write'); } catch { return false; }
  const [s, workspace] = await Promise.all([settings(deps), workspaceContext(actor.workspaceId)]);
  return Boolean(s && workspace?.enabled);
}

/**
 * Claim one request in the audit trail (rolling hourly limit per workspace). The claim counts even
 * when the provider then fails, so a failing provider cannot be used to bypass the limit. The claim
 * records the kind and input length only, never the text.
 */
async function claim(actor: AiActor, s: Settings, kind: string, inputLength: number, now: Date) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${actor.workspaceId}`}))::text`;
    const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null; suspendedAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt", w."suspendedAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR SHARE OF w FOR UPDATE OF m, u`;
    if (!rows[0] || rows[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
    if (rows[0].suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
    const since = new Date(now.getTime() - 3600_000);
    const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'ai.requested' AND "createdAt" > ${since}`;
    if (Number(used[0]?.count ?? 0) >= s.hourly) throw new OperationError('conflict', 'This workspace has reached its hourly AI assist limit. Try again later.');
    const claimed = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'ai.requested', ${JSON.stringify({ kind, inputLength })}::jsonb, ${now})`;
    if (claimed !== 1) throw unavailable();
  }, { timeout: s.txTimeout, maxWait: s.txWait });
}

export async function complete(s: Settings, system: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  try { return await s.port.complete({ system, prompt, model: s.model, maxTokens: s.maxTokens, signal: controller.signal }); }
  catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', 'AI assist could not complete this request. Try again later.'); }
  finally { clearTimeout(timer); }
}

/**
 * Generate suggested text. The result is returned to the member to review; nothing is saved
 * or published. Used by the composer, the HTTP API and MCP through this one function.
 */
export async function runAssist(actor: AiActor, input: unknown, deps: AiDeps = {}): Promise<AiResult> {
  const parsed = AI_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Enter the text and options for AI assist.');
  const request = parsed.data;
  await authorizeAi(actor, COMPOSER_FEATURE, 'write');
  const [s, workspace] = await Promise.all([settings(deps), workspaceContext(actor.workspaceId)]);
  if (!s || !workspace?.enabled) throw unavailable();
  if (request.text.length > s.maxInput) throw new OperationError('invalid_request', 'Shorten the text for AI assist.');
  await claim(actor, s, request.kind, request.text.length, (deps.now ?? (() => new Date()))());

  const { system, prompt } = buildPrompt(request, s.maxHashtags, workspace);
  const raw = await complete(s, system, prompt);
  if (request.kind === 'hashtags') {
    const hashtags = parseHashtags(raw, s.maxHashtags);
    if (!hashtags.length) throw new OperationError('upstream_failure', 'AI assist returned no usable hashtags. Try again.');
    return { kind: request.kind, text: hashtags.join(' '), hashtags };
  }
  const text = cleanOutput(raw, s.maxInput * 2);
  if (!text) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
  return { kind: request.kind, text, hashtags: [] };
}

/**
 * Reusable plain-language recap, for example the "AI recap" section of an Analytics report.
 * The caller supplies compact, already-authorized figures as `facts`; this function authorizes
 * the actor for `options.feature` (default: write on Reports), applies the same Root switch,
 * size bound and hourly workspace limit as composer assist, sends only `facts`/`subject` to the
 * provider and returns text for the caller to place. It saves and publishes nothing and throws
 * OperationError('unavailable') when AI is off so callers can omit the section.
 */
export async function summarize(actor: AiActor, input: SummarizeRequest, options: { feature?: string } & AiDeps = {}): Promise<SummaryResult> {
  const parsed = SUMMARIZE_SCHEMA.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Provide the figures to summarise.');
  const request = parsed.data;
  await authorizeAi(actor, options.feature ?? SUMMARY_FEATURE, 'write');
  const [s, workspace] = await Promise.all([settings(options), workspaceContext(actor.workspaceId)]);
  if (!s || !workspace?.enabled) throw unavailable();
  if (request.facts.length > s.maxInput) throw new OperationError('invalid_request', 'Provide fewer figures to summarise.');
  await claim(actor, s, 'summarize', request.facts.length, (options.now ?? (() => new Date()))());
  const { system, prompt } = buildSummaryPrompt(request);
  const text = cleanOutput(await complete(s, system, prompt), 1200);
  if (!text) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
  return { text };
}
