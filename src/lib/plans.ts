import { z } from 'zod';
import { TargetType, WorkspaceRole } from '@prisma/client';

import { AppError } from './errors';
import { prisma } from './prisma';
import { PLAN_FEATURES, PLATFORM_ADDONS, platformFeature, type PlanFeature, type PlatformAddon } from './product-catalog';

/**
 * Subscription plans (Root › Plans). A plan belongs to the subscriber, the
 * workspace's first owner, and its limits count across every workspace that
 * person owns. No plan, or root, means no limits.
 */

export { PLAN_FEATURES };
export type PlanLimit = 'channels' | 'members' | 'workspaces';

async function ownedWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await prisma.membership.findMany({ where: { userId, role: WorkspaceRole.owner }, select: { workspaceId: true } });
  return rows.map((row) => row.workspaceId);
}

/** The person whose plan a workspace runs on: its first owner. */
export async function subscriberOf(workspaceId: string) {
  const owner = await prisma.membership.findFirst({
    where: { workspaceId, role: WorkspaceRole.owner },
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { id: true, isInstanceOwner: true, extraChannels: true, plan: true } } },
  });
  return owner?.user ?? null;
}

type Subscriber = NonNullable<Awaited<ReturnType<typeof subscriberOf>>>;

/** What the subscriber uses now, counted across their workspaces. */
export async function usageOf(userId: string): Promise<Record<PlanLimit, number>> {
  const workspaceIds = await ownedWorkspaceIds(userId);
  const [channels, members] = await Promise.all([
    prisma.target.count({ where: { workspaceId: { in: workspaceIds }, type: { not: TargetType.group }, enabled: true } }),
    prisma.membership.findMany({
      where: { workspaceId: { in: workspaceIds }, role: { not: WorkspaceRole.client } },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);
  return { channels, members: members.length, workspaces: workspaceIds.length };
}

export function limitOf(subscriber: Pick<Subscriber, 'isInstanceOwner' | 'extraChannels' | 'plan'>, kind: PlanLimit): number {
  const plan = subscriber.plan;
  if (!plan || subscriber.isInstanceOwner) return Infinity;
  const base = plan[kind];
  if (base === null) return Infinity;
  return kind === 'channels' ? base + subscriber.extraChannels : base;
}

/** How many more of `kind` the subscriber may add. */
async function room(subscriber: Subscriber | null, kind: PlanLimit): Promise<number> {
  if (!subscriber) return Infinity;
  const limit = limitOf(subscriber, kind);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - (await usageOf(subscriber.id))[kind]);
}

/** Used and allowed of one kind for a workspace's subscriber; `limit` is null when the plan has none. */
export async function planUsage(workspaceId: string, kind: Exclude<PlanLimit, 'workspaces'>): Promise<{ used: number; limit: number | null }> {
  const subscriber = await subscriberOf(workspaceId);
  if (!subscriber) return { used: 0, limit: null };
  const limit = limitOf(subscriber, kind);
  return { used: (await usageOf(subscriber.id))[kind], limit: limit === Infinity ? null : limit };
}

export async function channelRoom(workspaceId: string): Promise<number> {
  return room(await subscriberOf(workspaceId), 'channels');
}

export function planLimitReached(kind: PlanLimit, limit: number): AppError {
  return new AppError({
    key: `errors.planLimit_${kind}`,
    fallback: `Your plan allows ${limit} ${kind}. Ask for a bigger plan to add more.`,
    status: 402,
    params: { limit },
  });
}

/** Refuses when adding one more `kind` to this workspace would pass the plan. */
export async function assertRoom(workspaceId: string, kind: Exclude<PlanLimit, 'workspaces'>): Promise<void> {
  const subscriber = await subscriberOf(workspaceId);
  if ((await room(subscriber, kind)) < 1) throw planLimitReached(kind, limitOf(subscriber!, kind));
}

export type MonthlyLimit = 'postsPerMonth' | 'aiCredits';

/**
 * Refuses one more post or AI generation this calendar month (UTC) when the
 * subscriber's plan has used them all, counted across every workspace they own.
 */
export async function assertMonthlyRoom(workspaceId: string, kind: MonthlyLimit, now: Date = new Date()): Promise<void> {
  const subscriber = await subscriberOf(workspaceId);
  const limit = subscriber?.plan && !subscriber.isInstanceOwner ? subscriber.plan[kind] : null;
  if (limit === null || limit === undefined) return;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const where = { workspaceId: { in: await ownedWorkspaceIds(subscriber!.id) }, createdAt: { gte: since } };
  const used = kind === 'aiCredits' ? await prisma.aiGeneration.count({ where }) : await prisma.post.count({ where });
  if (used >= limit) {
    throw new AppError({ key: `errors.planLimit_${kind}`, fallback: `Your plan includes ${limit} a month, all used.`, status: 402, params: { limit } });
  }
}

/** Refuses a new workspace for an owner whose plan is full. */
export async function assertWorkspaceRoom(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isInstanceOwner: true, extraChannels: true, plan: true } });
  if (user && (await room(user, 'workspaces')) < 1) throw planLimitReached('workspaces', limitOf(user, 'workspaces'));
}

/** Whether the workspace's plan includes a feature. No plan: yes. */
export async function hasFeature(workspaceId: string, feature: PlanFeature): Promise<boolean> {
  const subscriber = await subscriberOf(workspaceId);
  if (!subscriber?.plan || subscriber.isInstanceOwner) return true;
  return subscriber.plan.features.includes(feature);
}

/** Platforms are add-ons: an unassigned customer plan includes Facebook only. */
export async function includedPlatforms(workspaceId: string): Promise<Set<PlatformAddon>> {
  const subscriber = await subscriberOf(workspaceId);
  if (subscriber?.isInstanceOwner) return new Set<PlatformAddon>(PLATFORM_ADDONS);
  const features = subscriber?.plan?.features ?? [];
  return new Set(PLATFORM_ADDONS.filter((platform) => features.includes(platformFeature(platform))));
}

export async function hasPlatform(workspaceId: string, platform: PlatformAddon): Promise<boolean> {
  return (await includedPlatforms(workspaceId)).has(platform);
}

/** Refuses an action the workspace's plan does not include. */
export async function assertFeature(workspaceId: string, feature: PlanFeature): Promise<void> {
  if (!(await hasFeature(workspaceId, feature))) {
    throw new AppError({ key: `errors.planFeature_${feature}`, fallback: 'Your plan does not include this. Ask for a bigger plan.', status: 402 });
  }
}

/** The plan new sign-ups start on. */
export async function defaultPlanId(): Promise<string | null> {
  return (await prisma.plan.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
}

const limit = z.number().int().min(0).max(1_000_000).nullable();
export const planSchema = z.object({
  name: z.string().trim().min(1).max(60),
  currency: z.string().trim().length(3).toUpperCase(),
  priceMonthly: z.number().int().min(0).max(10_000_000),
  priceYearly: z.number().int().min(0).max(100_000_000),
  extraChannelPrice: z.number().int().min(0).max(1_000_000),
  channels: limit,
  members: limit,
  workspaces: limit,
  postsPerMonth: limit,
  aiCredits: limit,
  features: z.array(z.enum(PLAN_FEATURES)),
  isDefault: z.boolean(),
}).partial();

/** Root edits a plan; one default at most. */
export async function updatePlan(id: string, input: z.infer<typeof planSchema>) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.plan.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    return tx.plan.update({ where: { id }, data: input });
  });
}

/** Every subscriber (a user who owns a workspace), with plan and usage. */
export async function listSubscribers() {
  const users = await prisma.user.findMany({
    where: { memberships: { some: { role: WorkspaceRole.owner } } },
    select: { id: true, name: true, email: true, isInstanceOwner: true, extraChannels: true, planId: true, plan: true },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(users.map(async (user) => ({ ...user, usage: await usageOf(user.id) })));
}
