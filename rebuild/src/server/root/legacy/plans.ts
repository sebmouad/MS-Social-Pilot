import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { PLATFORM_MODULES } from '@/platforms';
import { assertRootActor, lockRootActor, conflict, invalid } from './authz';
import { writeRootAudit } from './audit';
import { rootResultLimit, legacySetting, rootTransaction } from './policy';
import { planAssignSchema, planConfirmation, planFeatureCatalog, planPatchSchema, planUpdateSchema, type PlanPatch } from './shared';

type PlanRow = {
  id: string; key: string; name: string; position: number; currency: string; priceMonthly: number; priceYearly: number; extraChannelPrice: number;
  channels: number | null; members: number | null; workspaces: number | null; postsPerMonth: number | null; aiCredits: number | null;
  features: string[]; isDefault: boolean; subscribers?: number;
};
const FIELDS = ['name', 'currency', 'priceMonthly', 'priceYearly', 'extraChannelPrice', 'channels', 'members', 'workspaces', 'postsPerMonth', 'aiCredits', 'features', 'isDefault'] as const;
const PLAN_ACTIONS = ['root.plan_updated', 'root.plan_assigned', 'plan.changed'];

export const featureCatalog = () => planFeatureCatalog(PLATFORM_MODULES.map(module => ({ id: module.id, name: module.name })));

/** Plan catalog with subscriber counts and the per-module feature grouping used to edit it. */
export async function listRootPlans(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const limit = rootResultLimit(await legacySetting('root.legacy.planCatalogLimit'), resultCap);
  const fetched = await prisma.$queryRaw<PlanRow[]>`SELECT p.id, p.key, p.name, p.position, p.currency, p."priceMonthly", p."priceYearly", p."extraChannelPrice", p.channels, p.members, p.workspaces, p."postsPerMonth", p."aiCredits", p.features, p."isDefault", (SELECT COUNT(*)::int FROM users u WHERE u."planId" = p.id) AS subscribers FROM plans p ORDER BY p.position, p.name, p.id LIMIT ${limit + 1}`;
  const truncated = fetched.length > limit;
  const plans = fetched.slice(0, limit);
  const known = new Set(featureCatalog().flatMap(group => group.features.map(feature => feature.key)));
  return { plans: plans.map(plan => ({ ...plan, unlistedFeatures: plan.features.filter(key => !known.has(key)) })), featureGroups: featureCatalog(), limit, truncated };
}

/** Recent plan edits and assignments, newest first. Detail is limited to our own audit shape. */
export async function listRootPlanHistory(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const limit = rootResultLimit(await legacySetting('root.legacy.planHistoryLimit'), resultCap);
  const rows = await prisma.$queryRaw<Array<{ id: string; action: string; createdAt: Date; actorEmail: string | null; detail: Record<string, unknown> | null; subjectEmail: string | null }>>`SELECT a.id, a.action, a."createdAt", u.email AS "actorEmail", a.detail, s.email AS "subjectEmail" FROM root_activities a LEFT JOIN users u ON u.id = a."actorId" LEFT JOIN users s ON s.id = a.detail->>'userId' WHERE a.action = ANY(${PLAN_ACTIONS}::text[]) ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${limit}`;
  return { items: rows.map(row => {
    const detail = row.detail ?? {};
    const pick = (key: string) => typeof detail[key] === 'string' ? detail[key] as string : null;
    return { id: row.id, action: row.action, at: row.createdAt.toISOString(), actor: row.actorEmail, subject: row.subjectEmail, plan: pick('planKey') ?? pick('plan'), fromPlan: pick('fromPlanKey'), toPlan: pick('toPlanKey'), changes: detail.changes && typeof detail.changes === 'object' ? Object.keys(detail.changes as object) : [] };
  }), limit };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Edit one plan. Exact confirmation; making a plan default needs its own phrase. Atomic with audit. */
export async function updateRootPlan(actorId: string, planId: string, input: unknown) {
  const parsed = planUpdateSchema.safeParse(input);
  if (!planId || !parsed.success) throw invalid('Enter valid plan values and the exact confirmation.');
  const { patch, confirmation } = parsed.data;
  if (!Object.keys(patch).length) throw invalid('Change at least one plan value.');
  return rootTransaction(async tx => {
    await assertRootActor(tx, actorId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('root-plan-catalog', 0))::text`;
    await lockRootActor(tx, actorId);
    const rows = await tx.$queryRaw<PlanRow[]>`SELECT id, key, name, position, currency, "priceMonthly", "priceYearly", "extraChannelPrice", channels, members, workspaces, "postsPerMonth", "aiCredits", features, "isDefault" FROM plans WHERE id = ${planId} FOR UPDATE`;
    const plan = rows[0];
    if (!plan) throw new OperationError('not_found', 'Plan not found.');
    const next: PlanPatch = { ...patch };
    if (next.features) {
      next.features = [...new Set(next.features)];
      const known = new Set(featureCatalog().flatMap(group => group.features.map(feature => feature.key)));
      const unknown = next.features.filter(key => !known.has(key) && !plan.features.includes(key));
      if (unknown.length) throw invalid('Choose plan features from the module list.');
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of FIELDS) if (field in next && !same(next[field], plan[field])) changes[field] = { from: plan[field], to: next[field] };
    if (!Object.keys(changes).length) return { changed: false, planId, key: plan.key };
    if (changes.isDefault && changes.isDefault.to === false) throw conflict('Choose another plan as the default instead of removing this one.');
    const becomesDefault = changes.isDefault?.to === true;
    const phrase = becomesDefault ? planConfirmation.makeDefault(plan.key) : planConfirmation.update(plan.key);
    if (confirmation !== phrase) throw invalid('Enter the exact confirmation shown.');
    if (becomesDefault) await tx.$executeRaw`UPDATE plans SET "isDefault" = false WHERE id <> ${planId} AND "isDefault" = true`;
    const merged = { ...plan, ...Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to])) } as PlanRow;
    const updated = await tx.$executeRaw`UPDATE plans SET name = ${merged.name}, currency = ${merged.currency}, "priceMonthly" = ${merged.priceMonthly}, "priceYearly" = ${merged.priceYearly}, "extraChannelPrice" = ${merged.extraChannelPrice}, channels = ${merged.channels}, members = ${merged.members}, workspaces = ${merged.workspaces}, "postsPerMonth" = ${merged.postsPerMonth}, "aiCredits" = ${merged.aiCredits}, features = ${merged.features}::text[], "isDefault" = ${merged.isDefault}, "updatedAt" = NOW() WHERE id = ${planId}`;
    if (updated !== 1) throw conflict('The plan changed. Reload and try again.');
    await writeRootAudit(tx, actorId, 'root.plan_updated', { planId, planKey: plan.key, changes });
    return { changed: true, planId, key: plan.key, changedFields: Object.keys(changes) };
  });
}

/** Assign (or clear) the plan a subscriber runs on. Takes effect for automatic sync and entitlements on the next check. */
export async function assignRootPlan(actorId: string, input: unknown) {
  const parsed = planAssignSchema.safeParse(input);
  if (!parsed.success) throw invalid('Choose an account, a plan and the exact confirmation.');
  const { userId, planKey, confirmation } = parsed.data;
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId, [userId]);
    const users = await tx.$queryRaw<Array<{ id: string; email: string; planId: string | null; disabledAt: Date | null }>>`SELECT id, email, "planId", "disabledAt" FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = users[0];
    if (!user) throw new OperationError('not_found', 'Account not found.');
    let target: { id: string; key: string } | null = null;
    if (planKey) {
      target = (await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id, key FROM plans WHERE key = ${planKey}`)[0] ?? null;
      if (!target) throw new OperationError('not_found', 'Plan not found.');
    }
    const phrase = target ? planConfirmation.assign(target.key, user.email) : planConfirmation.unassign(user.email);
    if (confirmation !== phrase) throw invalid('Enter the exact confirmation shown.');
    if ((user.planId ?? null) === (target?.id ?? null)) return { changed: false, userId };
    const current = user.planId ? (await tx.$queryRaw<Array<{ key: string }>>`SELECT key FROM plans WHERE id = ${user.planId}`)[0]?.key ?? null : null;
    const updated = await tx.$executeRaw`UPDATE users SET "planId" = ${target?.id ?? null}, "updatedAt" = NOW() WHERE id = ${userId}`;
    if (updated !== 1) throw conflict('The account changed. Reload and try again.');
    await writeRootAudit(tx, actorId, 'root.plan_assigned', { userId, fromPlanKey: current, toPlanKey: target?.key ?? null });
    return { changed: true, userId, planKey: target?.key ?? null };
  });
}

/** Subscribers (accounts owning a workspace) with their plan, for assignment. Bounded and private. */
export async function listRootSubscribers(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const limit = rootResultLimit(await legacySetting('root.legacy.subscriberListLimit'), resultCap);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; email: string; isInstanceOwner: boolean; disabled: boolean; planKey: string | null; workspaces: number }>>`SELECT u.id, u.name, u.email, u."isInstanceOwner", (u."disabledAt" IS NOT NULL) AS disabled, p.key AS "planKey", (SELECT COUNT(*)::int FROM memberships m WHERE m."userId" = u.id AND m.role = 'owner') AS workspaces FROM users u LEFT JOIN plans p ON p.id = u."planId" WHERE EXISTS (SELECT 1 FROM memberships m WHERE m."userId" = u.id AND m.role = 'owner') ORDER BY u.email, u.id LIMIT ${limit + 1}`;
  return { items: rows.slice(0, limit), limit, truncated: rows.length > limit };
}
