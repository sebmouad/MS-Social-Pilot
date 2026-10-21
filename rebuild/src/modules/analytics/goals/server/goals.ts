import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { goalsText, type GoalsCatalog } from '../copy';
import { analyticsLanguage } from '../../server/error-copy';
const goalCopy = cache(() => runtimeConfig('analytics.goalsCopy'));
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { platformAnalytics } from '@/server/platforms/registry';
import { audit, authorize, bad, lockActor, type Actor } from '../../server/access';
import { usableChannelIds } from '../../reports/server/access';
import { validTimeZone } from '../../reports/schedule-time';
import {
  GOAL_LABELS, GOAL_METRICS, PACE_LABELS, elapsed, goalPace, goalPercent, goalsConfirmation, monthIn, monthWindow, readGoalsSchema, setGoalsSchema,
  type ChannelGoals, type GoalMetric, type GoalMonth, type GoalProgress,
} from '../contracts';

const FEATURE = 'analytics/goals' as const;
const WRITERS = ['owner', 'admin', 'editor'] as const;

type Channel = { id: string; name: string; provider: string | null };
type StoredGoal = { targetId: string; metric: string; target: number };

async function channelsFor(actor: Actor, scope: string[] | null, only?: string) {
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false });
  const providers = entitlements ? (await selectedResourceConnectionWhere(actor.workspaceId, entitledPlatformIds(entitlements))).provider.in : [];
  if (scope !== null && only && !scope.includes(only)) return [];
  const ids = await usableChannelIds(prisma, actor.workspaceId, providers, only ? [only] : scope);
  return scope === null ? ids : ids.filter(id => scope.includes(id));
}

async function channelRows(workspaceId: string, ids: string[]): Promise<Channel[]> {
  if (!ids.length) return [];
  return prisma.$queryRaw<Channel[]>`SELECT t.id, t.name, a.provider FROM targets t LEFT JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${workspaceId} AND t.id = ANY(${ids}::text[]) ORDER BY t.name ASC`;
}

async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ timezone: string | null }>>`SELECT timezone FROM workspaces WHERE id = ${workspaceId}`;
  const zone = rows[0]?.timezone;
  return zone && validTimeZone(zone) ? zone : 'UTC';
}

/** Posts published counts for every channel; the other metrics need the channel module's goal measures. */
async function trackableFor(channel: Channel): Promise<GoalMetric[]> {
  const analytics = channel.provider ? await platformAnalytics(channel.provider) : null;
  return analytics?.goalMeasures ? [...GOAL_METRICS] : ['posts'];
}

/** Actuals over [from, to) for one channel; null means unknown, never zero. */
async function actualsFor(workspaceId: string, channel: Channel, from: Date, to: Date): Promise<Record<GoalMetric, number | null>> {
  const [count] = await prisma.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM post_targets pt JOIN targets t ON t.id = pt."targetId" WHERE pt."targetId" = ${channel.id} AND t."workspaceId" = ${workspaceId} AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}`;
  const analytics = channel.provider ? await platformAnalytics(channel.provider) : null;
  const measures = analytics?.goalMeasures ? await analytics.goalMeasures({ workspaceId, targetId: channel.id, from, to }) : null;
  return { posts: Number(count?.count ?? 0), followers: measures?.audienceGained ?? null, views: measures?.views ?? null, engagements: measures?.engagements ?? null };
}

/** Goals of one channel for a workspace-local month: a past month is judged whole, the current one up to `now`. */
async function progressFor(workspaceId: string, channel: Channel, stored: StoredGoal[], window: { start: Date; end: Date }, now: Date, locale?: 'en' | 'fr'): Promise<GoalProgress[]> {
  const rows = GOAL_METRICS.flatMap(metric => stored.filter(g => g.targetId === channel.id && g.metric === metric).slice(0, 1).map(g => ({ metric, target: g.target })));
  if (!rows.length) return [];
  const until = now < window.end ? now : window.end;
  const share = elapsed(window.start, window.end, until);
  const actuals = await actualsFor(workspaceId, channel, window.start, until);
  const copy = await goalCopy();
  const language = locale ?? await analyticsLanguage();
  return rows.map(({ metric, target }) => {
    const actual = actuals[metric];
    const pace = goalPace(target, actual, share);
    return { metric, label: goalsText(language, `metric.${metric}`, {}, copy), target, actual, percent: goalPercent(target, actual), pace, paceLabel: goalsText(language, `pace.${pace}`, {}, copy) };
  });
}

function monthView(window: { month: string; start: Date; end: Date }, timeZone: string): GoalMonth {
  const last = new Date(window.end.getTime() - 1);
  return { month: window.month, start: `${window.month}-01`, end: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(last), timeZone };
}

/** Goals with month-to-date progress for every channel the actor may see (or one channel). */
export async function readGoals(actor: Actor, input: unknown = {}, now = new Date()): Promise<{ ok: true; month: GoalMonth; channels: ChannelGoals[]; canManage: boolean }> {
  try {
  const parsed = readGoalsSchema.safeParse(input ?? {}); if (!parsed.success) throw bad();
  const auth = await authorize(actor, FEATURE, 'read');
  const ids = await channelsFor(actor, auth.scope, parsed.data.channelId);
  if (parsed.data.channelId && !ids.length) throw await analyticsError('not_found', "This channel is unavailable in the current workspace.");
  if (actor.maxResultItems !== undefined && ids.length > actor.maxResultItems) throw await analyticsError('invalid_request', "The goals result exceeds the current MCP limit. Choose one channel.");
  const timeZone = await workspaceTimeZone(actor.workspaceId);
  const window = monthWindow(monthIn(now, timeZone), timeZone);
  const [channels, stored] = await Promise.all([
    channelRows(actor.workspaceId, ids),
    ids.length ? prisma.$queryRaw<StoredGoal[]>`SELECT "targetId", metric, target FROM page_goals WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" = ANY(${ids}::text[])` : Promise.resolve([] as StoredGoal[]),
  ]);
  const result: ChannelGoals[] = [];
  for (const channel of channels) {
    result.push({ channelId: channel.id, channelName: channel.name, trackable: await trackableFor(channel), goals: await progressFor(actor.workspaceId, channel, stored, window, now) });
  }
  let canManage = false;
  try { await authorize(actor, FEATURE, 'write'); canManage = (WRITERS as readonly string[]).includes(auth.role); } catch { canManage = false; }
  return { ok: true, month: monthView(window, timeZone), channels: result, canManage };

  } catch (error) { throw await localizeAnalyticsError(error); }
}

/** Set or clear (null) monthly goals for one channel. Omitted metrics are left unchanged. */
export async function setGoals(actor: Actor, input: unknown) {
  try {
  const parsed = setGoalsSchema.safeParse(input); if (!parsed.success) throw bad();
  const value = parsed.data;
  if (value.confirmation !== goalsConfirmation(value.channelId)) throw bad();
  const changes = Object.entries(value.goals) as Array<[GoalMetric, number | null]>;
  if (!changes.length) throw bad( errorCopyDefaults["Choose at least one goal to change."].en);
  const auth = await authorize(actor, FEATURE, 'write');
  if (!(WRITERS as readonly string[]).includes(auth.role)) throw await analyticsError('forbidden', "Goals are managed by owners, admins and editors.");
  if (!(await channelsFor(actor, auth.scope, value.channelId)).length) throw await analyticsError('not_found', "This channel is unavailable in the current workspace.");
  const [channel] = await channelRows(actor.workspaceId, [value.channelId]);
  if (!channel) throw await analyticsError('not_found', "This channel is unavailable in the current workspace.");
  const trackable = await trackableFor(channel);
  if (changes.some(([metric, target]) => target !== null && !trackable.includes(metric))) throw bad( errorCopyDefaults["This goal cannot be tracked for this channel."].en);
  return withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await lockActor(tx, actor, WRITERS);
    const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE id = ${value.channelId} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`;
    if (!owned.length) throw await analyticsError('not_found', "This channel is unavailable in the current workspace.");
    for (const [metric, target] of changes) {
      if (target === null) await tx.$executeRaw`DELETE FROM page_goals WHERE "targetId" = ${value.channelId} AND "workspaceId" = ${actor.workspaceId} AND metric = ${metric}`;
      else await tx.$executeRaw`INSERT INTO page_goals (id, "workspaceId", "targetId", metric, target, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${value.channelId}, ${metric}, ${target}, NOW(), NOW()) ON CONFLICT ("targetId", metric) DO UPDATE SET target = EXCLUDED.target, "updatedAt" = NOW() WHERE page_goals."workspaceId" = ${actor.workspaceId}`;
    }
    await audit(tx, actor, 'analytics.goals_changed', { channelId: value.channelId, metrics: changes.map(([metric, target]) => ({ metric, cleared: target === null })) });
    return { ok: true as const, channelId: value.channelId, changed: changes.length };
  }));

  } catch (error) { throw await localizeAnalyticsError(error); }
}

/**
 * Goals for one already-authorized channel in the workspace-local month holding the report period's last day.
 * A past month is judged whole; the current one up to `now`. Used by Reports.
 */
export async function channelGoalProgress(workspaceId: string, channelId: string, periodEnd: string, now = new Date(), locale?: 'en' | 'fr'): Promise<{ month: GoalMonth; goals: GoalProgress[] }> {
  try {
  const timeZone = await workspaceTimeZone(workspaceId);
  const window = monthWindow(/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ? periodEnd.slice(0, 7) : monthIn(now, timeZone), timeZone);
  const [channel] = await channelRows(workspaceId, [channelId]);
  if (!channel) return { month: monthView(window, timeZone), goals: [] };
  const stored = await prisma.$queryRaw<StoredGoal[]>`SELECT "targetId", metric, target FROM page_goals WHERE "workspaceId" = ${workspaceId} AND "targetId" = ${channelId}`;
  return { month: monthView(window, timeZone), goals: await progressFor(workspaceId, channel, stored, window, now, locale) };

  } catch (error) { throw await localizeAnalyticsError(error); }
}
