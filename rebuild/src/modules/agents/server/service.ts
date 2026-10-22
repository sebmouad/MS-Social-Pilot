import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { authorizeAi, type AiActor } from '@/modules/ai/server/access';
import { settings, complete, type AiDeps } from '@/modules/ai/server/ai';
import { cleanOutput } from '@/modules/ai/ai';
import { agentPolicySchema } from '../config';
import { agentCopy } from './copy';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import type { Prisma } from '../../../../generated/client';
export type AgentActor = AiActor & { apiKeyId?: string };
export type Agent = { id: string; name: string; instructions: string; voice: string };
export type AgentRun = { id: string; agentId: string | null; name: string | null; kind: 'post' | 'reply'; status: 'pending' | 'completed' | 'failed'; errorCode: string | null; createdAt: Date | string; completedAt: Date | string | null };
export const agentRequest = z.discriminatedUnion('action', [
 z.object({ action: z.literal('list') }).strict(),
 z.object({ action: z.literal('history'), offset: z.number().int().nonnegative().optional() }).strict(),
 z.object({ action: z.literal('save'), id: z.string().min(1).optional(), name: z.string(), instructions: z.string(), voice: z.string(), confirmation: z.string() }).strict(),
 z.object({ action: z.literal('delete'), id: z.string().min(1), confirmation: z.string() }).strict(),
 z.object({ action: z.literal('draft'), id: z.string().min(1), text: z.string().trim().min(1), kind: z.enum(['post', 'reply']), confirmation: z.string() }).strict(),
]);
type Policy = z.infer<typeof agentPolicySchema>;
type Tx = Prisma.TransactionClient;
const fail = (code: OperationErrorCode) => new OperationError(code, code);
/** Lock the workspace, active member and account before re-reading live grants and entitlements. */
async function lockActor(tx: Tx, actor: AgentActor) {
 const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m."userId" AS id FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL AND w."suspendedAt" IS NULL FOR SHARE OF w FOR UPDATE OF m, u`;
 if (!rows.length) throw fail('forbidden');
 await authorizeAi(actor, 'agents/library', 'write');
}
async function transact<T>(actor: AgentActor, policy: Policy, action: (tx: Tx) => Promise<T>, aiClaim = false) {
 return prisma.$transaction(async tx => {
  if (aiClaim) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${actor.workspaceId}`}))::text`;
  await lockActor(tx, actor);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`agents:${actor.workspaceId}`}))::text`;
  return action(tx);
 }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
}
async function audit(tx: Tx, actor: AgentActor, action: string, detail: object, now = new Date()) {
 const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify({ ...detail, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) })}::jsonb, ${now})`;
 if (count !== 1) throw fail('unavailable');
}
export function agentDraftPrompt(agent: Agent, kind: 'post' | 'reply', text: string, policy: Pick<Policy, 'systemPrompt' | 'postPrompt' | 'replyPrompt'>) {
 // JSON quoting keeps each role explicit, including user-supplied delimiter-like text.
 return { system: policy.systemPrompt, prompt: `${kind === 'post' ? policy.postPrompt : policy.replyPrompt}\n${JSON.stringify({ brief: agent.instructions, voice: agent.voice, context: text })}` };
}
/** Dedicated metered generation; consumes the same provider settings and workspace AI budget as assist. */
async function draft(actor: AgentActor, input: Extract<z.infer<typeof agentRequest>, { action: 'draft' }>, policy: Policy, deps: AiDeps) {
 await authorizeAi(actor, 'publishing/posts', 'write');
 const s = await settings(deps);
 if (!s || input.text.length > s.maxInput) throw fail(s ? 'invalid_request' : 'unavailable');
 const now = (deps.now ?? (() => new Date()))();
 const runId = randomUUID();
 const agent = await transact(actor, policy, async tx => {
  await authorizeAi(actor, 'publishing/posts', 'write');
  const workspace = await tx.$queryRaw<Array<{ aiEnabled: boolean }>>`SELECT "aiEnabled" FROM workspaces WHERE id = ${actor.workspaceId}`;
  if (!workspace[0]?.aiEnabled) throw fail('unavailable');
  const agents = await tx.$queryRaw<Agent[]>`SELECT id, name, instructions, voice FROM rebuild_writing_agents WHERE id = ${input.id} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`;
  if (!agents[0]) throw fail('not_found');
  if (agents[0].instructions.length + agents[0].voice.length + input.text.length > s.maxInput) throw fail('invalid_request');
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${actor.workspaceId}`}))::text`;
  const since = new Date(now.getTime() - policy.usageWindowMs);
  const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'ai.requested' AND "createdAt" > ${since}`;
  if (Number(used[0]?.count ?? 0) >= s.hourly) throw fail('conflict');
  await audit(tx, actor, 'ai.requested', { kind: 'agent-draft', inputLength: input.text.length, runId }, now);
  await tx.$executeRaw`INSERT INTO rebuild_writing_agent_runs (id, "workspaceId", "agentId", "createdById", kind, status, "createdAt") VALUES (${runId}, ${actor.workspaceId}, ${input.id}, ${actor.userId}, ${input.kind}, 'pending', ${now})`;
  return agents[0];
 }, true);
 try {
  await authorizeAi(actor, 'agents/library', 'write');
  await authorizeAi(actor, 'publishing/posts', 'write');
  const prompt = agentDraftPrompt(agent, input.kind, input.text, policy);
  const suggestion = cleanOutput(await complete(s, prompt.system, prompt.prompt), s.maxInput * s.outputInputMultiplier);
  if (!suggestion) throw fail('upstream_failure');
  await transact(actor, policy, async tx => {
   await authorizeAi(actor, 'publishing/posts', 'write');
   await tx.$executeRaw`UPDATE rebuild_writing_agent_runs SET status = 'completed', "completedAt" = now() WHERE id = ${runId} AND "workspaceId" = ${actor.workspaceId}`;
   await audit(tx, actor, 'agents.draft.completed', { runId });
  });
  return { suggestion, runId, reviewRequired: true as const };
 } catch (error) {
  const code = error instanceof OperationError ? error.code : 'upstream_failure';
  // A content-free failure receipt remains available even when the initiating member loses access.
  await prisma.$transaction(async tx => {
   await tx.$executeRaw`UPDATE rebuild_writing_agent_runs SET status = 'failed', "errorCode" = ${code}, "completedAt" = now() WHERE id = ${runId} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`;
   await audit(tx, actor, 'agents.draft.failed', { runId, code });
  }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
  throw error;
 }
}
/** UI, REST and MCP share validation, fresh tenant authority, exact confirmations and atomic audit. */
export async function writingAgents(actor: AgentActor, raw: unknown, deps: AiDeps & { locale?: 'en' | 'fr' } = {}) {
 const copy = await agentCopy(deps.locale ?? 'en');
 try {
  const parsed = agentRequest.safeParse(raw);
  if (!parsed.success) throw fail('invalid_request');
  const input = parsed.data;
  await authorizeAi(actor, 'agents/library', input.action === 'list' || input.action === 'history' ? 'read' : 'write');
  const policy = agentPolicySchema.parse(await runtimeConfig('agents.policy'));
  if (input.action === 'list') return { agents: await prisma.$queryRaw<Agent[]>`SELECT id, name, instructions, voice FROM rebuild_writing_agents WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name, id LIMIT ${policy.maxAgents}` };
  if (input.action === 'history') {
   const offset = input.offset ?? 0;
   const runs = await prisma.$queryRaw<AgentRun[]>`SELECT r.id, r."agentId", a.name, r.kind, r.status, r."errorCode", r."createdAt", r."completedAt" FROM rebuild_writing_agent_runs r LEFT JOIN rebuild_writing_agents a ON a.id = r."agentId" AND a."workspaceId" = r."workspaceId" WHERE r."workspaceId" = ${actor.workspaceId} ORDER BY r."createdAt" DESC, r.id DESC LIMIT ${policy.historyPageSize + 1} OFFSET ${offset}`;
   return { runs: runs.slice(0, policy.historyPageSize), hasMore: runs.length > policy.historyPageSize, pageSize: policy.historyPageSize, offset };
  }
  const expected = input.action === 'save' ? `SAVE ${input.name.trim()}` : `${input.action.toUpperCase()} ${input.id}`;
  if (input.confirmation !== expected) throw fail('invalid_request');
  if (input.action === 'draft') return await withWorkspaceOperation(actor.workspaceId, () => draft(actor, input, policy, deps));
  return await transact(actor, policy, async tx => {
   let id: string;
   if (input.action === 'save') {
    const parsedData = z.object({ name: z.string().trim().min(1).max(policy.nameCharacters), instructions: z.string().trim().min(1).max(policy.instructionsCharacters), voice: z.string().trim().max(policy.voiceCharacters) }).safeParse(input);
    if (!parsedData.success) throw fail('invalid_request');
    const data = parsedData.data;
    id = input.id ?? randomUUID();
    if (input.id) {
     const changed = await tx.$executeRaw`UPDATE rebuild_writing_agents SET name = ${data.name}, instructions = ${data.instructions}, voice = ${data.voice}, "updatedAt" = now() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
     if (!changed) throw fail('not_found');
    } else {
     const counts = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM rebuild_writing_agents WHERE "workspaceId" = ${actor.workspaceId}`;
     if (Number(counts[0]?.count ?? 0) >= policy.maxAgents) throw fail('conflict');
     await tx.$executeRaw`INSERT INTO rebuild_writing_agents (id, "workspaceId", "createdById", name, instructions, voice) VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${data.name}, ${data.instructions}, ${data.voice})`;
    }
   } else {
    id = input.id;
    const changed = await tx.$executeRaw`DELETE FROM rebuild_writing_agents WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!changed) throw fail('not_found');
   }
   await audit(tx, actor, `agents.${input.action}`, { id });
   return { id, ok: true as const };
  });
 } catch (error) {
  const code = error instanceof OperationError ? error.code : 'upstream_failure';
  throw new OperationError(code, copy[code]);
 }
}
