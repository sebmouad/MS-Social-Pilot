import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizeFeature, type ToolActor } from '@/modules/media/server/access';
import { AI_BOUNDS } from '../config';
import { AI_KINDS, AI_REQUEST_SCHEMA, TONES, buildPrompt, cleanOutput, parseHashtags, type AiPort, type AiResult, type AiStatus } from '../ai';
import { anthropicPort } from './anthropic';

const FEATURE = 'publishing/posts' as const;
export type AiDeps = { port?: AiPort; now?: () => Date };
const unavailable = () => new OperationError('unavailable', 'AI writing assist is not available.');
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;

type Settings = { port: AiPort; model: string; timeoutMs: number; maxTokens: number; maxInput: number; hourly: number; maxHashtags: number; txTimeout: number; txWait: number };
/** Resolve everything assist needs; null when anything is unconfigured, so customer surfaces stay hidden. */
async function settings(deps: AiDeps): Promise<Settings | null> {
  try {
    const enabled = await runtimeConfig('ai.enabled');
    if (enabled !== true) return null;
    const [provider, model, endpoint, timeoutMs, maxTokens, maxInput, hourly, maxHashtags, txTimeout, txWait, workspaceTimeout] = await Promise.all(['ai.provider', 'ai.model', 'ai.endpoint', 'ai.requestTimeoutMs', 'ai.maxOutputTokens', 'ai.maxInputCharacters', 'ai.hourlyRequestsPerWorkspace', 'ai.maxHashtags', 'ai.transactionTimeoutMs', 'ai.transactionMaxWaitMs', 'data.workspaceOperationTimeoutMs'].map(k => runtimeConfig(k)));
    const B = AI_BOUNDS;
    if (provider !== 'anthropic' || typeof model !== 'string' || !model || typeof endpoint !== 'string' || !inRange(timeoutMs, B.requestTimeoutMs) || !inRange(maxTokens, B.maxOutputTokens) || !inRange(maxInput, B.maxInputCharacters)
      || !inRange(hourly, B.hourlyRequestsPerWorkspace) || !inRange(maxHashtags, B.maxHashtags) || !inRange(txTimeout, B.transactionTimeoutMs) || !inRange(txWait, B.transactionMaxWaitMs) || !inRange(workspaceTimeout, B.workspaceTimeoutMs) || txTimeout + txWait >= workspaceTimeout) return null;
    let port = deps.port;
    if (!port) {
      const apiKey = await runtimeSecret('ai.apiKey');
      if (!apiKey) return null;
      port = anthropicPort({ apiKey, endpoint });
    }
    return { port, model, timeoutMs, maxTokens, maxInput, hourly, maxHashtags, txTimeout, txWait };
  } catch { return null; }
}

/** What the composer may offer. Everything false/empty when assist is unconfigured or the member cannot write posts. */
export async function aiStatus(actor: ToolActor, deps: AiDeps = {}): Promise<AiStatus> {
  const none: AiStatus = { available: false, kinds: [], tones: [], maxInputCharacters: null };
  try { await authorizeFeature(actor, FEATURE, 'write'); } catch { return none; }
  const s = await settings(deps);
  return s ? { available: true, kinds: AI_KINDS, tones: TONES, maxInputCharacters: s.maxInput } : none;
}

/**
 * Generate suggested text. The result is returned to the member to review; nothing is saved
 * or published. Each request is claimed in the audit trail first (rolling hourly limit per
 * workspace) and counts even when the provider then fails, so a failing provider cannot be
 * used to bypass the limit.
 */
export async function runAssist(actor: ToolActor, input: unknown, deps: AiDeps = {}): Promise<AiResult> {
  const parsed = AI_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Enter the text and options for AI assist.');
  const request = parsed.data;
  await authorizeFeature(actor, FEATURE, 'write');
  const s = await settings(deps);
  if (!s) throw unavailable();
  if (request.text.length > s.maxInput) throw new OperationError('invalid_request', 'Shorten the text for AI assist.');
  const now = (deps.now ?? (() => new Date()))();

  await withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${actor.workspaceId}`}))::text`;
    const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
    if (!rows[0] || rows[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
    const since = new Date(now.getTime() - 3600_000);
    const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'ai.requested' AND "createdAt" > ${since}`;
    if (Number(used[0]?.count ?? 0) >= s.hourly) throw new OperationError('conflict', 'This workspace has reached its hourly AI assist limit. Try again later.');
    const claimed = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'ai.requested', ${JSON.stringify({ kind: request.kind, inputLength: request.text.length })}::jsonb, ${now})`;
    if (claimed !== 1) throw unavailable();
  }, { timeout: s.txTimeout, maxWait: s.txWait }));

  const { system, prompt } = buildPrompt(request, s.maxHashtags);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  let raw: string;
  try { raw = await s.port.complete({ system, prompt, model: s.model, maxTokens: s.maxTokens, signal: controller.signal }); }
  catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', 'AI assist could not complete this request. Try again later.'); }
  finally { clearTimeout(timer); }
  if (request.kind === 'hashtags') {
    const hashtags = parseHashtags(raw, s.maxHashtags);
    if (!hashtags.length) throw new OperationError('upstream_failure', 'AI assist returned no usable hashtags. Try again.');
    return { kind: request.kind, text: hashtags.join(' '), hashtags };
  }
  const text = cleanOutput(raw, s.maxInput * 2);
  if (!text) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
  return { kind: request.kind, text, hashtags: [] };
}
