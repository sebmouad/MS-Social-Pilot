import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { instantToWall, wallTimeToInstant } from '@/lib/calendar-dates';
import { authorizeAi, type AiActor } from '@/modules/studio/server/access';
import { autopilotPolicySchema, autopilotTierSchema, type AutopilotTier } from '../../config';
import { agentCopy } from './copy';
import type { AgentActor } from './service';

export type { AutopilotTier };
export const AUTOPILOT_TIERS = autopilotTierSchema.options;
export const autopilotTierConfirmation = (tier: AutopilotTier) => `SET AUTOPILOT TIER ${tier}`;

/** Workspace guardrails: a workspace can only narrow the Root ceilings, never widen them. */
export const autopilotGuardrailsSchema = z.object({
  maxSendsPerDay: z.number().int().min(0).max(200).optional(),
  quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(),
  /** Channels autopilot may schedule; absent or empty means every channel. */
  targetIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  /** Channels that always stay drafts, even in the supervised-auto tier. */
  draftsOnlyTargetIds: z.array(z.string().min(1).max(200)).max(500).optional(),
}).strict();
export type AutopilotGuardrails = z.infer<typeof autopilotGuardrailsSchema>;
export type ResolvedAutopilotPolicy = {
  tier: AutopilotTier;
  maxSendsPerDay: number; quietStartHour: number; quietEndHour: number;
  targetIds: string[] | null; draftsOnlyTargetIds: string[];
  newTargetGraceDays: number;
};

const fail = (code: OperationErrorCode) => new OperationError(code, code);
const MANAGERS = new Set(['owner', 'admin']);

type RootPolicy = z.infer<typeof autopilotPolicySchema>;
async function rootPolicy(): Promise<RootPolicy> {
  const parsed = autopilotPolicySchema.safeParse(await runtimeConfig('agents.autopilotPolicy'));
  if (!parsed.success) throw fail('unavailable');
  return parsed.data;
}

const asGuardrails = (value: unknown): AutopilotGuardrails => {
  const parsed = autopilotGuardrailsSchema.safeParse(value ?? {});
  if (!parsed.success) throw fail('unavailable');
  return parsed.data;
};

/**
 * The workspace autopilot policy. Workspaces without a row run assisted (today's behavior:
 * the worker writes drafts, a person reviews and sends). A missing table (older database)
 * also resolves to assisted so reads never fail mid-deploy; only writes need the migration.
 */
export async function getAutopilotPolicy(workspaceId: string): Promise<ResolvedAutopilotPolicy> {
  const root = await rootPolicy();
  let row: { tier: string; guardrails: unknown } | undefined;
  try {
    [row] = await prisma.$queryRaw<Array<{ tier: string; guardrails: unknown }>>`SELECT tier, guardrails FROM autopilot_policies WHERE "workspaceId" = ${workspaceId}`;
  } catch { row = undefined; }
  const tier = autopilotTierSchema.safeParse(row?.tier ?? 'assisted');
  const saved = asGuardrails(row?.guardrails);
  return {
    tier: tier.success ? tier.data : 'assisted',
    maxSendsPerDay: Math.min(saved.maxSendsPerDay ?? root.sendsCeilingPerDay, root.sendsCeilingPerDay),
    quietStartHour: saved.quietStartHour ?? root.defaultQuietStartHour,
    quietEndHour: saved.quietEndHour ?? root.defaultQuietEndHour,
    targetIds: saved.targetIds?.length ? [...new Set(saved.targetIds)] : null,
    draftsOnlyTargetIds: [...new Set(saved.draftsOnlyTargetIds ?? [])],
    newTargetGraceDays: root.newTargetGraceDays,
  };
}

export type AutopilotRefusal = 'quiet_hours' | 'daily_cap' | 'out_of_scope' | 'drafts_only' | 'new_destination' | 'uncertain_destination' | 'approval_required' | 'queue_refused';

/** Tier only, for worker hot paths: any failure resolves to assisted (drafts only, today's behavior). */
export async function workspaceAutopilotTier(workspaceId: string): Promise<AutopilotTier> {
  try {
    return (await getAutopilotPolicy(workspaceId)).tier;
  } catch { return 'assisted'; }
}

/** Pure guardrail check shared by the worker and tests; quiet hours wrap midnight (22–7 by default). */
export function evaluateAutoSchedule(input: {
  policy: ResolvedAutopilotPolicy; now: Date; timeZone: string; sendsToday: number;
  targetId: string; targetCreatedAt: Date | null; targetEverPublished: boolean; requiresApproval: boolean;
}): { ok: true } | { ok: false; reason: AutopilotRefusal } {
  const { policy } = input;
  if (input.requiresApproval) return { ok: false, reason: 'approval_required' };
  if (policy.targetIds && !policy.targetIds.includes(input.targetId)) return { ok: false, reason: 'out_of_scope' };
  if (policy.draftsOnlyTargetIds.includes(input.targetId)) return { ok: false, reason: 'drafts_only' };
  if (input.targetCreatedAt && input.policy.newTargetGraceDays > 0 && input.now.getTime() - input.targetCreatedAt.getTime() < policy.newTargetGraceDays * 86_400_000) return { ok: false, reason: 'new_destination' };
  if (!input.targetEverPublished) return { ok: false, reason: 'uncertain_destination' };
  const hour = Number(instantToWall(input.now, input.timeZone).time.slice(0, 2));
  const { quietStartHour: start, quietEndHour: end } = policy;
  const quiet = start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (quiet) return { ok: false, reason: 'quiet_hours' };
  if (input.sendsToday >= policy.maxSendsPerDay) return { ok: false, reason: 'daily_cap' };
  return { ok: true };
}

/** Start of the workspace day, bounding the daily automatic-send count. */
export function workspaceDayStart(timeZone: string, at: Date): Date {
  const wall = instantToWall(at, timeZone);
  const start = wallTimeToInstant(wall.date, '00:00', timeZone);
  if (!start.ok) throw fail('unavailable');
  return start.instant;
}

const setRequest = z.object({ action: z.literal('tier'), tier: autopilotTierSchema, guardrails: autopilotGuardrailsSchema.optional(), confirmation: z.string() }).strict();

/**
 * Read or change the workspace autopilot tier. Only owners and admins may change it, with the
 * exact `SET AUTOPILOT TIER <tier>` confirmation; named channels must belong to this workspace.
 * UI, REST and MCP share this service.
 */
export async function autopilotTier(actor: AgentActor, raw: unknown, deps: { locale?: 'en' | 'fr' } = {}) {
  const copy = await agentCopy(deps.locale ?? 'en');
  try {
    if ((raw as { action?: unknown } | null)?.action === 'get') {
      await authorizeAi(actor, 'studio/agents', 'read');
      return { policy: await getAutopilotPolicy(actor.workspaceId) };
    }
    const parsed = setRequest.safeParse(raw);
    if (!parsed.success) throw fail('invalid_request');
    const auth = await authorizeAi(actor, 'studio/agents', 'write');
    if (!MANAGERS.has(auth.role)) throw fail('forbidden');
    const { tier, guardrails: rawGuardrails, confirmation } = parsed.data;
    if (confirmation !== autopilotTierConfirmation(tier)) throw fail('invalid_request');
    const root = await rootPolicy();
    const guardrails = rawGuardrails ?? {};
    const named = [...new Set([...(guardrails.targetIds ?? []), ...(guardrails.draftsOnlyTargetIds ?? [])])];
    if (named.length > root.maxScopedTargets) throw fail('invalid_request');
    if (named.length) {
      const found = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${named})`;
      if (found.length !== named.length) throw fail('invalid_request');
    }
    const stored = JSON.stringify({ ...(guardrails.maxSendsPerDay !== undefined ? { maxSendsPerDay: Math.min(guardrails.maxSendsPerDay, root.sendsCeilingPerDay) } : {}), ...(guardrails.quietStartHour !== undefined ? { quietStartHour: guardrails.quietStartHour } : {}), ...(guardrails.quietEndHour !== undefined ? { quietEndHour: guardrails.quietEndHour } : {}), ...(guardrails.targetIds ? { targetIds: [...new Set(guardrails.targetIds)] } : {}), ...(guardrails.draftsOnlyTargetIds ? { draftsOnlyTargetIds: [...new Set(guardrails.draftsOnlyTargetIds)] } : {}) });
    await prisma.$executeRaw`INSERT INTO autopilot_policies ("workspaceId", tier, guardrails, "updatedById", "updatedAt") VALUES (${actor.workspaceId}, ${tier}, ${stored}::jsonb, ${actor.userId}, NOW())
      ON CONFLICT ("workspaceId") DO UPDATE SET tier = ${tier}, guardrails = ${stored}::jsonb, "updatedById" = ${actor.userId}, "updatedAt" = NOW()`;
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'agents.autopilot.tier_changed', ${JSON.stringify({ tier, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) })}::jsonb, NOW())`;
    return { policy: await getAutopilotPolicy(actor.workspaceId), ok: true as const };
  } catch (error) {
    const code = error instanceof OperationError ? error.code : 'upstream_failure';
    throw new OperationError(code, copy[code]);
  }
}
