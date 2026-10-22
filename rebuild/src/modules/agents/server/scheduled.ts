import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { instantToWall, isValidTimeZone, weekdayOfKey } from '@/lib/calendar-dates';
import { authorizeAi, type AiActor } from '@/modules/ai/server/access';
import { complete, settings, type AiDeps } from '@/modules/ai/server/ai';
import { cleanOutput } from '@/modules/ai/ai';
import { createPublishingPost } from '@/modules/publishing/server/api-writes';
import { agentPolicySchema } from '../config';
import { agentCopy } from './copy';
import type { AgentActor } from './service';

export type ScheduledAgent = { id: string; targetId: string; targetName: string | null; brief: string; weekday: number; count: number; enabled: boolean; lastRunOn: string | null; createdAt: Date | string };
export type ScheduledChannel = { id: string; name: string };

export const CREATE_SCHEDULED_CONFIRMATION = 'CREATE SCHEDULED AGENT';
export const updateScheduledConfirmation = (id: string) => `UPDATE SCHEDULED AGENT ${id}`;
export const deleteScheduledConfirmation = (id: string) => `DELETE SCHEDULED AGENT ${id}`;
export const runScheduledConfirmation = (id: string) => `RUN SCHEDULED AGENT ${id}`;

const scheduledRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('save'), id: z.string().min(1).optional(), targetId: z.string().min(1), brief: z.string(), weekday: z.number().int().min(0).max(6), count: z.number().int().min(1).max(14), enabled: z.boolean(), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().min(1), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('run'), id: z.string().min(1), confirmation: z.string() }).strict(),
]);

type SchedPolicy = { enabled: boolean; batchAgents: number; maxDrafts: number; briefMax: number; usageWindowMs: number; systemPrompt: string };
const fail = (code: OperationErrorCode) => new OperationError(code, code);

async function schedPolicy(): Promise<SchedPolicy> {
  const values = await runtimeConfigBatch(['agents.scheduledRunsEnabled', 'agents.scheduledRunsBatchAgents', 'agents.scheduledRunsMaxDrafts', 'agents.scheduledRunsBriefMaxCharacters', 'agents.policy']);
  const enabled = z.boolean().safeParse(values['agents.scheduledRunsEnabled']);
  const batch = z.number().int().min(1).max(500).safeParse(values['agents.scheduledRunsBatchAgents']);
  const drafts = z.number().int().min(1).max(14).safeParse(values['agents.scheduledRunsMaxDrafts']);
  const brief = z.number().int().min(3).max(20000).safeParse(values['agents.scheduledRunsBriefMaxCharacters']);
  const base = agentPolicySchema.safeParse(values['agents.policy']);
  if (!enabled.success || !batch.success || !drafts.success || !brief.success || !base.success) throw fail('unavailable');
  return { enabled: enabled.data, batchAgents: batch.data, maxDrafts: drafts.data, briefMax: brief.data, usageWindowMs: base.data.usageWindowMs, systemPrompt: base.data.systemPrompt };
}

async function audit(actor: { userId: string; workspaceId: string; apiKeyId?: string }, action: string, detail: object) {
  await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify({ ...detail, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) })}::jsonb, NOW())`;
}

async function channels(workspaceId: string): Promise<ScheduledChannel[]> {
  return prisma.$queryRaw<ScheduledChannel[]>`SELECT id, name FROM targets WHERE "workspaceId" = ${workspaceId} AND enabled = true ORDER BY name, id LIMIT 500`;
}

function todayIn(timeZone: string, now: Date): string {
  if (!isValidTimeZone(timeZone)) throw fail('unavailable');
  return instantToWall(now, timeZone).date;
}

/** Claim one AI request against the workspace hourly allowance; the claim counts even if the provider then fails. */
async function claimAiRequest(workspaceId: string, userId: string, hourly: number, windowMs: number, inputLength: number, now: Date) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${workspaceId}`}))::text`;
    const since = new Date(now.getTime() - windowMs);
    const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'ai.requested' AND "createdAt" > ${since}`;
    if (Number(used[0]?.count ?? 0) >= hourly) throw fail('conflict');
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, ${userId}, 'ai.requested', ${JSON.stringify({ kind: 'scheduled-agent-draft', inputLength })}::jsonb, ${now})`;
  });
}

type DueAgent = { id: string; workspaceId: string; userId: string; targetId: string; targetName: string; brief: string; weekday: number; count: number; timezone: string; defaultLocale: string };

/** Write one due agent's drafts as its creator. Returns drafts written; frees the day when AI fails so the next run retries. */
async function runAgent(agent: DueAgent, today: string, policy: SchedPolicy, deps: AiDeps): Promise<number> {
  const actor: AiActor = { userId: agent.userId, workspaceId: agent.workspaceId };
  await authorizeAi(actor, 'agents/library', 'write');
  await authorizeAi(actor, 'publishing/posts', 'write');
  const s = await settings(deps);
  if (!s) throw fail('unavailable');
  const now = (deps.now ?? (() => new Date()))();
  const wanted = Math.min(agent.count, policy.maxDrafts);
  let drafts = 0;
  for (let index = 0; index < wanted; index += 1) {
    const prompt = `Write draft ${index + 1} of ${wanted} for the coming week.\n${JSON.stringify({ brief: agent.brief, channel: agent.targetName, language: agent.defaultLocale === 'fr' ? 'French' : 'English' })}`;
    if (prompt.length > s.maxInput) throw fail('invalid_request');
    await claimAiRequest(agent.workspaceId, agent.userId, s.hourly, policy.usageWindowMs, prompt.length, now);
    let text: string;
    try {
      text = cleanOutput(await complete(s, policy.systemPrompt, prompt), s.maxInput * s.outputInputMultiplier);
      if (!text) throw fail('upstream_failure');
    } catch (error) {
      await prisma.$executeRaw`UPDATE ai_agents SET "lastRunOn" = NULL WHERE id = ${agent.id} AND "lastRunOn" = ${today}`;
      throw error;
    }
    await createPublishingPost({ userId: agent.userId, workspaceId: agent.workspaceId }, { message: text, targetIds: [agent.targetId], media: [], confirmation: 'CREATE POST' });
    drafts += 1;
  }
  await audit(actor, 'agents.scheduled.completed', { agentId: agent.id, drafts });
  return drafts;
}

/**
 * Write the week for every agent whose day it is. An agent is claimed for the day before it runs, so two workers
 * never write the same week twice; one whose creator left or can no longer write, whose channel is gone, or whose
 * workspace switched AI off is skipped with its day kept.
 */
export async function runDueScheduledAgents(now = new Date(), deps: AiDeps = {}): Promise<string> {
  const policy = await schedPolicy();
  if (!policy.enabled) return 'disabled';
  const agents = await prisma.$queryRaw<Array<DueAgent & { aiEnabled: boolean }>>`SELECT a.id, a."workspaceId", a."userId", a."targetId", t.name AS "targetName", a.brief, a.weekday, a.count, w.timezone, w."defaultLocale"::text AS "defaultLocale", w."aiEnabled" AS "aiEnabled" FROM ai_agents a JOIN workspaces w ON w.id = a."workspaceId" JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = a."workspaceId" WHERE a.enabled = true AND w."suspendedAt" IS NULL AND t.enabled = true ORDER BY a.id LIMIT ${policy.batchAgents}`;
  let drafts = 0, skipped = 0, failed = 0;
  for (const agent of agents) {
    let today: string;
    try { today = todayIn(agent.timezone, now); } catch { skipped += 1; continue; }
    if (weekdayOfKey(today) !== agent.weekday) continue;
    const claimed = await prisma.$executeRaw`UPDATE ai_agents SET "lastRunOn" = ${today} WHERE id = ${agent.id} AND ("lastRunOn" IS NULL OR "lastRunOn" <> ${today})`;
    if (claimed !== 1) continue;
    if (!agent.aiEnabled) { skipped += 1; continue; }
    const member = await prisma.$queryRaw<Array<{ id: string }>>`SELECT m."userId" AS id FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${agent.workspaceId} AND m."userId" = ${agent.userId} AND u."disabledAt" IS NULL`;
    if (!member[0]) { skipped += 1; continue; }
    try { drafts += await runAgent(agent, today, policy, deps); }
    catch (error) {
      if (error instanceof OperationError && ['forbidden', 'unauthorized', 'conflict', 'invalid_request'].includes(error.code)) skipped += 1;
      else failed += 1;
      await audit({ userId: agent.userId, workspaceId: agent.workspaceId }, 'agents.scheduled.failed', { agentId: agent.id, code: error instanceof OperationError ? error.code : 'upstream_failure' }).catch(() => null);
    }
  }
  return `agents=${agents.length} drafts=${drafts} skipped=${skipped} failed=${failed}`;
}

/** UI, REST and MCP share validation, fresh tenant authority, exact confirmations and atomic audit. */
export async function scheduledAgents(actor: AgentActor, raw: unknown, deps: AiDeps & { locale?: 'en' | 'fr' } = {}) {
  const copy = await agentCopy(deps.locale ?? 'en');
  try {
    const parsed = scheduledRequest.safeParse(raw);
    if (!parsed.success) throw fail('invalid_request');
    const input = parsed.data;
    await authorizeAi(actor, 'agents/library', input.action === 'list' ? 'read' : 'write');
    const policy = await schedPolicy();
    if (input.action === 'list') {
      const agents = await prisma.$queryRaw<ScheduledAgent[]>`SELECT a.id, a."targetId", t.name AS "targetName", a.brief, a.weekday, a.count, a.enabled, a."lastRunOn", a."createdAt" FROM ai_agents a LEFT JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = a."workspaceId" WHERE a."workspaceId" = ${actor.workspaceId} ORDER BY a."createdAt", a.id LIMIT 200`;
      return { agents, channels: await channels(actor.workspaceId), maxDrafts: policy.maxDrafts, briefMax: policy.briefMax };
    }
    if (input.action === 'run') {
      if (input.confirmation !== runScheduledConfirmation(input.id)) throw fail('invalid_request');
      const rows = await prisma.$queryRaw<Array<DueAgent & { aiEnabled: boolean; enabled: boolean; lastRunOn: string | null }>>`SELECT a.id, a."workspaceId", a."userId", a."targetId", t.name AS "targetName", a.brief, a.weekday, a.count, a.enabled, a."lastRunOn", w.timezone, w."defaultLocale"::text AS "defaultLocale", w."aiEnabled" AS "aiEnabled" FROM ai_agents a JOIN workspaces w ON w.id = a."workspaceId" JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = a."workspaceId" WHERE a.id = ${input.id} AND a."workspaceId" = ${actor.workspaceId} AND t.enabled = true`;
      const agent = rows[0];
      if (!agent || !agent.enabled || !agent.aiEnabled) throw fail(agent ? 'conflict' : 'not_found');
      const today = todayIn(agent.timezone, new Date());
      if (weekdayOfKey(today) !== agent.weekday || agent.lastRunOn === today) throw fail('conflict');
      const claimed = await prisma.$executeRaw`UPDATE ai_agents SET "lastRunOn" = ${today} WHERE id = ${agent.id} AND ("lastRunOn" IS NULL OR "lastRunOn" <> ${today})`;
      if (claimed !== 1) throw fail('conflict');
      return { drafts: await runAgent(agent, today, policy, deps), ok: true as const };
    }
    const expected = input.action === 'delete' ? deleteScheduledConfirmation(input.id) : input.id ? updateScheduledConfirmation(input.id) : CREATE_SCHEDULED_CONFIRMATION;
    if (input.confirmation !== expected) throw fail('invalid_request');
    if (input.action === 'delete') {
      const removed = await prisma.$executeRaw`DELETE FROM ai_agents WHERE id = ${input.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (removed !== 1) throw fail('not_found');
      await audit(actor, 'agents.scheduled.deleted', { id: input.id });
      return { id: input.id, ok: true as const };
    }
    const brief = input.brief.trim();
    if (brief.length < 3 || brief.length > policy.briefMax || input.count > policy.maxDrafts) throw fail('invalid_request');
    const target = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE id = ${input.targetId} AND "workspaceId" = ${actor.workspaceId} AND enabled = true`;
    if (!target[0]) throw fail('invalid_request');
    if (input.id) {
      const changed = await prisma.$executeRaw`UPDATE ai_agents SET "targetId" = ${input.targetId}, brief = ${brief}, weekday = ${input.weekday}, count = ${input.count}, enabled = ${input.enabled} WHERE id = ${input.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (changed !== 1) throw fail('not_found');
      await audit(actor, 'agents.scheduled.updated', { id: input.id });
      return { id: input.id, ok: true as const };
    }
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO ai_agents (id, "workspaceId", "userId", "targetId", brief, weekday, count, enabled) VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${input.targetId}, ${brief}, ${input.weekday}, ${input.count}, ${input.enabled})`;
    await audit(actor, 'agents.scheduled.created', { id });
    return { id, ok: true as const };
  } catch (error) {
    const code = error instanceof OperationError ? error.code : 'upstream_failure';
    throw new OperationError(code, copy[code]);
  }
}
