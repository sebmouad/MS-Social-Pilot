import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { instagramLocale } from './locale';
import { safeNumber, type AnalyticsMetricInput } from '@/modules/analytics/server/catalog';
import type { PlatformAnalyticsHost } from '@/server/platforms/host';
import { configuredInstagramPolicy } from './runtime';
import { normalizeInstagramAudience, normalizeInstagramInsights, type InstagramInsight } from './insights';
import { object } from './transport';
import { OperationError } from '@/lib/operation-error';
import { readChannelRollupPreference, type ChannelRollupPreference } from '@/modules/analytics/rollups/read';
import { hasUnrolledInstagramDayBreakdowns } from './rollups';
import { INSTAGRAM_POLICY_DEFAULTS } from './config';

/** Older rows have no range-total provenance: conservatively keep them non-additive. */
export function storedInstagramInsight(row: { metric: string; period: string; endTime: Date; value: unknown }): InstagramInsight {
  const envelope = object(row.value);
  const versioned = envelope.instagramHostVersion === 1;
  return { metric: row.metric, period: versioned && typeof envelope.period === 'string' ? envelope.period : row.period, asOf: row.endTime,
    value: versioned ? envelope.value : row.value, rangeTotal: versioned ? envelope.rangeTotal !== false : true,
    raw: versioned ? object(envelope.raw) : {} };
}

function targetWhere(workspaceId: string) {
  return { workspaceId, enabled: true, type: 'instagram' as const,
    socialAccount: { is: { workspaceId, provider: 'instagram', invalidatedAt: null } } };
}

/**
 * Resolve the precomputed day-series for this read, if any. A weekly span with
 * unrolled breakdowns falls back to the daily cascade; anything else uncovered
 * reads in full detail. Never throws: rollups are a fast path, not a gate.
 */
async function resolveDayRollup(workspaceId: string, targetIds: string[], range: { from: Date; to: Date }): Promise<ChannelRollupPreference | null> {
  try {
    const preference = await readChannelRollupPreference({ provider: 'instagram', workspaceId, targetIds, from: range.from, to: range.to });
    if (!preference) return null;
    if (!await hasUnrolledInstagramDayBreakdowns({ workspaceId, targetIds, from: preference.rolledFrom, to: preference.rolledTo })) return preference;
    if (preference.granularity !== 'weekly') return null;
    const daily = await readChannelRollupPreference({ provider: 'instagram', workspaceId, targetIds, from: range.from, to: range.to, granularities: ['daily'] });
    if (!daily || daily.granularity !== 'daily') return null;
    return await hasUnrolledInstagramDayBreakdowns({ workspaceId, targetIds, from: daily.rolledFrom, to: daily.rolledTo }) ? null : daily;
  } catch {
    return null;
  }
}

/** Stored reads only. Shared Analytics services authorize membership, feature and resource ceilings. */
export const instagramAnalyticsHost: PlatformAnalyticsHost = {
  async load(request) {
    const empty = { targets: [], selectedTargets: [], adAccounts: [], selectedAdAccountIds: [], metrics: [], audienceEntries: [], audienceSelected: 0 };
    if (await runtimeConfig('platforms.instagram.enabled') !== true) return empty;
    const [policy, locale, targets] = await Promise.all([
      configuredInstagramPolicy(), instagramLocale(),
      prisma.target.findMany({ where: { ...targetWhere(request.workspaceId), ...(request.allowedTargetIds === undefined ? {} : { id: { in: [...request.allowedTargetIds] } }) }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, type: true, providerId: true, socialAccountId: true } }),
    ]);
    const selected = targets.filter(target => request.selectedTargetIds.includes(target.id));
    const targetIds = selected.map(target => target.id);
    // Precomputed day-series replace the detailed day rows they cover: complete
    // past days on the daily path (today still reads in detail), the whole range
    // on the weekly path. Range totals, non-day periods, audience and media
    // cohorts always read in detail; anything uncovered falls back silently.
    const rollup = targetIds.length ? await resolveDayRollup(request.workspaceId, targetIds, request.range) : null;
    const targetNames = new Map(selected.map(target => [target.id, target.name]));
    const dayComplement = !rollup ? {} : rollup.granularity === 'weekly'
      ? { period: { not: 'day' } }
      : { OR: [{ period: { not: 'day' } }, { endTime: { gt: rollup.rolledTo } }] };
    const accounts = selected.length ? await prisma.instagramAccount.findMany({
      where: { workspaceId: request.workspaceId, enabled: true, OR: selected.map(target => ({ targetId: target.id, socialAccountId: target.socialAccountId, igUserId: target.providerId })) },
      select: { id: true, targetId: true, igUserId: true, followersCount: true, lastSyncedAt: true },
    }) : [];
    const metrics = new Map<string, AnalyticsMetricInput>();
    const mergeInput = (input: AnalyticsMetricInput, targetId: string) => {
      const previous = metrics.get(input.key);
      if (!previous) { metrics.set(input.key, { ...input, available: selected.length }); return; }
      previous.observations.push(...input.observations);
      previous.breakdownHistory = [...previous.breakdownHistory ?? [], ...input.breakdownHistory ?? []];
      previous.coveredResourceIds = [...new Set([...previous.coveredResourceIds ?? [], targetId])];
      previous.covered = previous.coveredResourceIds.length;
      if (input.latestAt && (!previous.latestAt || input.latestAt > previous.latestAt)) previous.latestAt = input.latestAt;
      if (input.updatedAt && (!previous.updatedAt || input.updatedAt > previous.updatedAt)) previous.updatedAt = input.updatedAt;
    };
    // Rollup rows are day-series numerics; rehydrate them through the same
    // normalizer so kinds, labels and overlap notes match the detailed path.
    for (const row of rollup?.rows ?? []) {
      const name = targetNames.get(row.targetId);
      if (name === undefined) continue;
      const target = { id: row.targetId, name };
      const insight: InstagramInsight = { metric: row.metric, period: row.period, asOf: row.date, value: row.value, rangeTotal: false, raw: {} };
      for (const input of normalizeInstagramInsights([insight], target, policy, locale, row.fetchedAt)) mergeInput(input, row.targetId);
    }
    const audienceEntries = [] as ReturnType<typeof normalizeInstagramAudience>;
    for (const account of accounts) {
      const target = selected.find(item => item.id === account.targetId && item.providerId === account.igUserId);
      if (!target) continue;
      const rows = await prisma.instagramInsight.findMany({ where: { accountId: account.id, account: { workspaceId: request.workspaceId, enabled: true, targetId: target.id }, endTime: { gte: request.range.from, lte: request.range.to }, ...dayComplement }, orderBy: [{ endTime: 'asc' }, { fetchedAt: 'asc' }], take: policy.analyticsReadMaxRows + 1 });
      if (rows.length > policy.analyticsReadMaxRows) throw new OperationError('unavailable', policy.copy.unavailable[locale]);
      // Keep per-row freshness rather than assigning the freshest fetch to older observations.
      for (const row of rows) for (const input of normalizeInstagramInsights([storedInstagramInsight(row)], target, policy, locale, row.fetchedAt)) mergeInput(input, target.id);
      if (account.lastSyncedAt && account.lastSyncedAt <= request.range.to) audienceEntries.push(...normalizeInstagramAudience({ followersCount: account.followersCount, fetchedAt: account.lastSyncedAt }, target, policy, locale));
    }
    // Weekly points change granularity; disclose them on every affected day-series metric.
    if (rollup?.granularity === 'weekly') {
      const weeklyNote = (policy.copy as { rollupWeeksNote?: { en: string; fr: string } }).rollupWeeksNote?.[locale]
        ?? INSTAGRAM_POLICY_DEFAULTS.copy.rollupWeeksNote[locale];
      for (const metric of metrics.values()) {
        const [, period, range] = metric.key.split('::');
        if (period === 'day' && range === 'series') metric.aggregationNote = [metric.aggregationNote, weeklyNote].filter(Boolean).join(' ');
      }
    }
    const neutral = (target: typeof targets[number]) => ({ id: target.id, name: target.name, type: target.type, providerId: 'instagram' });
    return { targets: targets.map(neutral), selectedTargets: selected.map(neutral), adAccounts: [], selectedAdAccountIds: [], metrics: [...metrics.values()], audienceEntries, audienceSelected: selected.length };
  },
  async postPerformance(request) {
    if (await runtimeConfig('platforms.instagram.enabled') !== true) return [];
    const target = await prisma.target.findFirst({ where: { ...targetWhere(request.workspaceId), id: request.targetId }, select: { providerId: true, socialAccountId: true } });
    if (!target) return [];
    const [policy, locale] = await Promise.all([configuredInstagramPolicy(), instagramLocale()]);
    const rows = await prisma.instagramMedia.findMany({ where: { account: { workspaceId: request.workspaceId, enabled: true, targetId: request.targetId, igUserId: target.providerId, socialAccountId: target.socialAccountId }, timestamp: { gte: request.from, lt: request.to } }, orderBy: [{ timestamp: 'desc' }, { id: 'asc' }], take: policy.analyticsReadMaxRows + 1 });
    if (rows.length > policy.analyticsReadMaxRows) throw new OperationError('unavailable', policy.copy.unavailable[locale]);
    const mapped = rows.map(row => {
      const values = object(row.insights);
      const measures = Object.entries(values).flatMap(([key, value]) => key === 'instagramHostVersion' ? [] : [{ key, label: policy.labels[key]?.[locale] ?? key.replace(/_/g, ' '), value: safeNumber(value) }]);
      return { postId: row.id, text: row.caption ?? '', publishedAt: row.timestamp, url: row.permalink, measures, rankValue: null, rankLabel: policy.copy.source[locale], measuredAt: row.insightsSyncedAt };
    });
    if (request.sort) mapped.sort((a, b) => {
      const value = (post: typeof a) => request.sort === 'publishedAt' ? post.publishedAt.getTime() : post.measures.find(measure => measure.key === request.sort)?.value ?? null;
      const av = value(a), bv = value(b);
      if (av === null || bv === null) return av === bv ? a.postId.localeCompare(b.postId) : av === null ? 1 : -1;
      return (av - bv) * (request.direction === 'asc' ? 1 : -1) || a.postId.localeCompare(b.postId);
    });
    return mapped.slice(request.offset ?? 0, (request.offset ?? 0) + request.limit);
  },
};
