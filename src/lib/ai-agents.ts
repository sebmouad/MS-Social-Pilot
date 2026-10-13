import { z } from 'zod';

import { aiAvailable, planWeek } from './ai';
import { audienceOf, effectiveAudience } from './audience';
import { voiceWithAvoid } from './brand';
import { canCompose } from './constants';
import { errors } from './errors';
import { createPost } from './posts';
import { prisma } from './prisma';
import { formatInZone } from './time';

/**
 * AI agents: a standing brief that writes a week of drafts on its own day.
 * Nothing is scheduled or published by an agent; someone still reads, edits
 * and schedules each draft, under the role of the person who set the agent up.
 */

export const agentSchema = z.object({
  targetId: z.string().min(1),
  brief: z.string().trim().min(3).max(2000),
  /** 0 = Sunday … 6 = Saturday, in the workspace's time zone. */
  weekday: z.number().int().min(0).max(6),
  count: z.number().int().min(1).max(14).default(5),
  enabled: z.boolean().default(true),
});

export const agentUpdateSchema = agentSchema.partial();

async function assertOwnPage(workspaceId: string, targetId: string | undefined) {
  if (!targetId) return;
  const target = await prisma.target.findFirst({ where: { id: targetId, workspaceId }, select: { id: true } });
  if (!target) throw errors.notFound();
}

export async function listAgents(workspaceId: string) {
  return prisma.aiAgent.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
}

export async function createAgent(workspaceId: string, userId: string, raw: unknown) {
  const input = agentSchema.parse(raw);
  await assertOwnPage(workspaceId, input.targetId);
  return prisma.aiAgent.create({ data: { workspaceId, userId, ...input } });
}

export async function updateAgent(workspaceId: string, id: string, raw: unknown) {
  const input = agentUpdateSchema.parse(raw);
  await assertOwnPage(workspaceId, input.targetId);
  const { count } = await prisma.aiAgent.updateMany({ where: { id, workspaceId }, data: input });
  if (count === 0) throw errors.notFound();
}

export async function deleteAgent(workspaceId: string, id: string) {
  const { count } = await prisma.aiAgent.deleteMany({ where: { id, workspaceId } });
  if (count === 0) throw errors.notFound();
}


/**
 * Write the week for every agent whose day it is. Returns how many drafts were
 * made. An agent is claimed for the day before it runs, so two workers never
 * write the same week twice; one whose creator has left or can no longer
 * compose, or whose Page is gone, is skipped.
 */
export async function runDueAgents(now: Date = new Date()): Promise<number> {
  if (!aiAvailable()) return 0;
  const agents = await prisma.aiAgent.findMany({ where: { enabled: true }, include: { workspace: true } });
  let drafts = 0;
  for (const agent of agents) {
    const { workspace } = agent;
    const today = formatInZone(now, workspace.timezone, 'yyyy-MM-dd');
    const [year, month, date] = today.split('-').map(Number) as [number, number, number];
    if (new Date(Date.UTC(year, month - 1, date)).getUTCDay() !== agent.weekday || agent.lastRunOn === today) continue;

    const claimed = await prisma.aiAgent.updateMany({ where: { id: agent.id, OR: [{ lastRunOn: null }, { lastRunOn: { not: today } }] }, data: { lastRunOn: today } });
    if (claimed.count === 0) continue;

    const [member, page] = await Promise.all([
      prisma.membership.findFirst({ where: { workspaceId: agent.workspaceId, userId: agent.userId } }),
      prisma.target.findFirst({ where: { id: agent.targetId, workspaceId: agent.workspaceId } }),
    ]);
    if (!member || !page || !canCompose(member.role)) continue;

    try {
      const planned = await planWeek({
        workspaceId: agent.workspaceId,
        userId: agent.userId,
        brief: agent.brief,
        count: agent.count,
        days: 7,
        pageName: page.name,
        tone: workspace.aiTone,
        locale: workspace.defaultLocale,
        brandVoice: voiceWithAvoid(page.brandVoice?.trim() || workspace.aiBrandVoice, workspace.aiAvoidWords),
        audience: effectiveAudience(audienceOf(page), audienceOf(workspace), workspace.timezone),
      });
      for (const entry of planned) {
        const day = new Date(Date.UTC(year, month - 1, date + 1 + entry.day)).toISOString().slice(0, 10);
        await createPost(
          { workspaceId: agent.workspaceId, userId: agent.userId, role: member.role, requiresApproval: workspace.requiresApproval },
          {
            message: entry.text,
            targetIds: [page.id],
            media: [],
            saveAsDraft: true,
            publishMode: 'worker',
            useQueue: false,
            scheduledAtLocal: `${day}T${entry.time}`,
            timezone: workspace.timezone,
          },
          now,
        );
        drafts += 1;
      }
    } catch {
      // Free the day so the next hourly run tries again (AI down, limit hit).
      await prisma.aiAgent.updateMany({ where: { id: agent.id, lastRunOn: today }, data: { lastRunOn: null } });
    }
  }
  return drafts;
}

