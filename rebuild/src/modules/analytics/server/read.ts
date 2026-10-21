import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, loadEntitlements, entitledPlatformIds } from '@/server/entitlements';
import { prisma } from '@/server/data';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { buildAnalytics, type MetricView } from '@/modules/analytics/server/aggregate';
import { loadAnalytics, type AnalyticsAdScope } from '@/modules/analytics/server/data';
import { AnalyticsComparisonError, analyticsDateRange, compareAnalytics } from './comparison';
import { buildPreviousPoints } from './previous-points';
import type { AnalyticsReadActor, AnalyticsReadConstraints, AnalyticsReadResult, AnalyticsSnapshot } from './types';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const metricKeySchema = z.string().min(1).max(500).regex(/^[^\u0000-\u001F\u007F]+$/);
const pageSchema = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).refine(Number.isSafeInteger),
]);
const invalid = () => new OperationError('invalid_request', 'Choose valid Analytics filters, or reset the filters and try again.');
const forbiddenResource = () => new OperationError('forbidden', 'A selected Analytics resource is unavailable. Choose an available resource or reset the filters.');
const metricIdentity = (metric: MetricView) => JSON.stringify([metric.key, metric.sourceLabel, metric.resourceKind, metric.unit]);

type ParsedInput = {
  start?: string;
  end?: string;
  compare?: 'none' | 'previous' | 'year';
  filter?: '1';
  channel?: string | string[];
  adFilter?: '1';
  adAccount?: string | string[];
  search?: string;
  metric?: string;
  page?: number;
  pointPage?: number;
  rowPage?: number;
};

function parsePage(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

function parseInput(input: unknown, searchMaxLength: number): ParsedInput {
  const parsed = z.object({
    start: z.string().optional(), end: z.string().optional(), compare: z.enum(['none', 'previous', 'year']).optional(),
    filter: z.literal('1').optional(), channel: z.union([idSchema, z.array(idSchema)]).optional(),
    adFilter: z.literal('1').optional(), adAccount: z.union([idSchema, z.array(idSchema)]).optional(),
    search: z.string().max(searchMaxLength).optional(), metric: metricKeySchema.optional(),
    page: z.unknown().optional(), pointPage: z.unknown().optional(), rowPage: z.unknown().optional(),
  }).strict().safeParse(input ?? {});
  if (!parsed.success) throw invalid();
  const value = parsed.data;
  const uniqueIds = (ids: string | string[] | undefined) => {
    const values = ids === undefined ? [] : Array.isArray(ids) ? ids : [ids];
    if (new Set(values).size !== values.length) throw invalid();
    return values;
  };
  const channels = uniqueIds(value.channel);
  const adAccounts = uniqueIds(value.adAccount);
  if ((channels.length > 0 && value.filter !== '1') || (adAccounts.length > 0 && value.adFilter !== '1')) throw invalid();
  const search = value.search?.trim();
  if (search && search.length > searchMaxLength) throw invalid();
  return {
    ...(value.start !== undefined ? { start: value.start } : {}), ...(value.end !== undefined ? { end: value.end } : {}),
    ...(value.compare !== undefined ? { compare: value.compare } : {}), ...(value.filter ? { filter: value.filter } : {}),
    ...(value.channel !== undefined ? { channel: value.channel } : {}), ...(value.adFilter ? { adFilter: value.adFilter } : {}),
    ...(value.adAccount !== undefined ? { adAccount: value.adAccount } : {}), ...(search !== undefined ? { search } : {}),
    ...(value.metric !== undefined ? { metric: value.metric } : {}), page: parsePage(value.page), pointPage: parsePage(value.pointPage), rowPage: parsePage(value.rowPage),
  };
}

function idList(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id));
}

function pager<T>(items: T[], requestedPage: number | undefined, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage ?? 1, pages);
  const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), total: items.length, page, pages, pageSize };
}

function canonicalQuery(input: ParsedInput, period: AnalyticsSnapshot['period'], channelIds: string[], adAccountIds: string[], pages: { page?: number; pointPage?: number; rowPage?: number }): string {
  const query = new URLSearchParams();
  query.set('start', period.start); query.set('end', period.end);
  if (input.compare) query.set('compare', input.compare);
  if (input.filter) { query.set('filter', '1'); channelIds.forEach(id => query.append('channel', id)); }
  if (input.adFilter) { query.set('adFilter', '1'); adAccountIds.forEach(id => query.append('adAccount', id)); }
  if (input.search) query.set('search', input.search);
  if (input.metric) query.set('metric', input.metric);
  if (input.page !== undefined) query.set('page', String(pages.page ?? input.page));
  if (input.pointPage !== undefined) query.set('pointPage', String(pages.pointPage ?? input.pointPage));
  if (input.rowPage !== undefined) query.set('rowPage', String(pages.rowPage ?? input.rowPage));
  return query.toString();
}

function searchMetrics(metrics: MetricView[], search?: string): MetricView[] {
  if (!search) return metrics;
  const query = search.toLocaleLowerCase();
  return metrics.filter(metric => `${metric.key} ${metric.label} ${metric.sourceLabel}`.toLocaleLowerCase().includes(query));
}

function assertUniqueMetricKeys(metrics: Array<{ key: string }>): void {
  const keys = new Set<string>();
  for (const metric of metrics) {
    if (keys.has(metric.key)) throw new OperationError('unavailable', 'Analytics returned duplicate metric keys. Refresh the report or try again later.');
    keys.add(metric.key);
  }
}

async function authorizeAnalytics(actor: AnalyticsReadActor, constraints: AnalyticsReadConstraints) {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to view Analytics.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  const feature = constraints.feature ?? 'analytics/overview';
  if (!entitlements || !permissions || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature)) {
    throw new OperationError('forbidden', 'Analytics access is unavailable in this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  const granted = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedChannelIds = constraints.allowedChannelIds === undefined
    ? granted
    : constraints.allowedChannelIds.filter(id => granted === undefined || granted.includes(id));
  const scope = actor.adAccountTargetScope;
  const adScope: AnalyticsAdScope = {
    ...(actor.allowedAdAccountIds === undefined ? {} : { accountIds: [...actor.allowedAdAccountIds] }),
    ...(scope === undefined ? {} : {
      independentTargets: true,
      ...(scope.all ? (granted === undefined ? {} : { targetIds: [...granted] }) : { targetIds: scope.ids.filter(id => granted === undefined || granted.includes(id)) }),
    }),
  };
  return { allowedChannelIds, allowedProviders: entitledPlatformIds(entitlements), adScope };
}

async function runtimeLimits() {
  const [defaultDays, maxDays, metricPageSize, detailPageSize, chartPoints, searchMaxLength, reportMaxChannels] = await Promise.all([
    runtimeConfig('analytics.defaultRangeDays'), runtimeConfig('analytics.maxRangeDays'), runtimeConfig('analytics.metricPageSize'),
    runtimeConfig('analytics.detailPageSize'), runtimeConfig('analytics.chartPoints'), runtimeConfig('analytics.searchMaxLength'),
    runtimeConfig('analytics.reportMaxChannels'),
  ]);
  const values = [defaultDays, maxDays, metricPageSize, detailPageSize, chartPoints, searchMaxLength, reportMaxChannels].map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value < 1)) throw new OperationError('unavailable', 'Analytics settings are unavailable. Contact your workspace administrator.');
  return { defaultDays: Math.min(values[0]!, values[1]!), maxDays: values[1]!, metricPageSize: values[2]!, detailPageSize: values[3]!, chartPoints: values[4]!, searchMaxLength: values[5]!, reportMaxChannels: values[6]! };
}

async function loadSnapshot(actor: AnalyticsReadActor, rawInput: unknown, constraints: AnalyticsReadConstraints): Promise<{ snapshot: AnalyticsSnapshot; input: ParsedInput; limits: Awaited<ReturnType<typeof runtimeLimits>>; catalogMetrics: MetricView[] }> {
  const access = await authorizeAnalytics(actor, constraints);
  const limits = await runtimeLimits();
  const input = parseInput(rawInput, limits.searchMaxLength);
  if ((input.filter && idList(input.channel).length > limits.reportMaxChannels) || (input.adFilter && idList(input.adAccount).length > limits.reportMaxChannels)) throw invalid();
  let period: AnalyticsSnapshot['period'];
  try {
    period = analyticsDateRange(input, { defaultDays: limits.defaultDays, maxDays: limits.maxDays });
  } catch (error) {
    if (error instanceof AnalyticsComparisonError) throw invalid();
    throw error;
  }
  const initial = await loadAnalytics(actor.workspaceId, [], period.range, access.allowedChannelIds, undefined, access.allowedProviders, access.adScope);
  const channelOptions = initial.targets;
  const adAccountOptions = initial.adAccounts;
  const requestedChannelIds = input.filter ? idList(input.channel) : channelOptions.map(item => item.id);
  const requestedAdIds = input.adFilter ? idList(input.adAccount) : initial.selectedAdIds;
  if (!requestedChannelIds.every(id => channelOptions.some(item => item.id === id)) || !requestedAdIds.every(id => adAccountOptions.some(item => item.id === id))) throw forbiddenResource();
  const selectedChannelIds = channelOptions.filter(item => requestedChannelIds.includes(item.id)).map(item => item.id);
  const selectedAdIds = adAccountOptions.filter(item => requestedAdIds.includes(item.id)).map(item => item.id);
  if (!sameIds(selectedChannelIds, requestedChannelIds) || !sameIds(selectedAdIds, requestedAdIds)) throw forbiddenResource();
  if (selectedChannelIds.length > limits.reportMaxChannels || selectedAdIds.length > limits.reportMaxChannels) throw invalid();

  const currentData = await loadAnalytics(actor.workspaceId, selectedChannelIds, period.range, access.allowedChannelIds, selectedAdIds, access.allowedProviders, access.adScope);
  const selectedReturnedChannels = currentData.selectedTargets.map(item => item.id);
  if (!sameIds(selectedReturnedChannels, selectedChannelIds) || !sameIds(currentData.selectedAdIds, selectedAdIds)) throw forbiddenResource();
  assertUniqueMetricKeys(currentData.metrics);
  const view = buildAnalytics(currentData.metrics, currentData.audienceEntries, currentData.audienceSelected);
  const allMetrics = view.metrics;
  const comparisonData = period.comparison
    ? await loadAnalytics(actor.workspaceId, selectedChannelIds, period.comparison.range, access.allowedChannelIds, selectedAdIds, access.allowedProviders, access.adScope)
    : null;
  if (comparisonData && (!sameIds(comparisonData.selectedTargets.map(item => item.id), selectedChannelIds) || !sameIds(comparisonData.selectedAdIds, selectedAdIds))) throw forbiddenResource();
  if (comparisonData) assertUniqueMetricKeys(comparisonData.metrics);
  const comparisonMetrics = comparisonData ? buildAnalytics(comparisonData.metrics, comparisonData.audienceEntries, comparisonData.audienceSelected).metrics : [];
  let comparisonMap: ReturnType<typeof compareAnalytics> | null = null;
  try {
    if (period.comparison) comparisonMap = compareAnalytics(allMetrics, comparisonMetrics);
  } catch (error) {
    if (error instanceof AnalyticsComparisonError) throw new OperationError('unavailable', 'Analytics comparison could not be completed. Refresh the report or try another range.');
    throw error;
  }
  const comparisons: AnalyticsSnapshot['comparisons'] = Object.create(null);
  for (const metric of allMetrics) {
    const value = comparisonMap?.get(metricIdentity(metric));
    if (value) comparisons[metric.key] = value;
  }

  const previousPoints = buildPreviousPoints(allMetrics, comparisonMetrics, metricIdentity, comparisons, period, period.comparison);

  const publishingRows = selectedChannelIds.length ? await prisma.post.groupBy({
    by: ['status'],
    where: {
      workspaceId: actor.workspaceId,
      targets: { some: { targetId: { in: selectedChannelIds } } },
      OR: [
        { status: 'published', publishedAt: { gte: period.range.from, lte: period.range.to } },
        { status: 'scheduled', scheduledAt: { gte: period.range.from, lte: period.range.to } },
        { status: { in: ['failed', 'partially_failed'] }, createdAt: { gte: period.range.from, lte: period.range.to } },
      ],
    },
    _count: { _all: true },
  }) : [];
  const count = (status: string) => publishingRows.find(item => item.status === status)?._count._all ?? 0;
  const snapshot: AnalyticsSnapshot = {
    period,
    options: { channels: channelOptions, adAccounts: adAccountOptions, metrics: allMetrics.map(({ key, label, sourceLabel }) => ({ key, label, sourceLabel })) },
    selected: { channelIds: selectedChannelIds, adAccountIds: selectedAdIds },
    audience: view.audience,
    publishing: { published: count('published'), scheduled: count('scheduled'), failed: count('failed') + count('partially_failed') },
    comparisons,
    previousPoints,
    query: '',
    chartPoints: limits.chartPoints,
    searchMaxLength: limits.searchMaxLength,
    exportRowLimit: await runtimeConfig('analytics.reportExportRows'),
    allMetrics: searchMetrics(allMetrics, input.search),
  };
  return { snapshot, input, limits, catalogMetrics: allMetrics };
}

export async function readAnalyticsSnapshot(actor: AnalyticsReadActor, input: unknown = {}, constraints: AnalyticsReadConstraints = {}): Promise<AnalyticsSnapshot> {
  const { snapshot, input: parsed, catalogMetrics } = await loadSnapshot(actor, input, constraints);
  if (parsed.metric && !catalogMetrics.some(metric => metric.key === parsed.metric)) throw forbiddenResource();
  snapshot.query = canonicalQuery(parsed, snapshot.period, snapshot.selected.channelIds, snapshot.selected.adAccountIds, {});
  return snapshot;
}

export async function readAnalytics(actor: AnalyticsReadActor, input: unknown = {}, constraints: AnalyticsReadConstraints = {}): Promise<AnalyticsReadResult> {
  const { snapshot, input: parsed, limits, catalogMetrics } = await loadSnapshot(actor, input, constraints);
  const metrics = pager(snapshot.allMetrics, parsed.page, limits.metricPageSize);
  if (parsed.metric && !catalogMetrics.some(metric => metric.key === parsed.metric)) throw forbiddenResource();
  const selectedMetric = parsed.metric ? catalogMetrics.find(metric => metric.key === parsed.metric)! : null;
  const detail = selectedMetric ? {
    metric: selectedMetric,
    points: pager(selectedMetric.points, parsed.pointPage, limits.detailPageSize),
    rows: pager(selectedMetric.rows, parsed.rowPage, limits.detailPageSize),
  } : null;
  const pageState = { page: metrics.page, pointPage: detail?.points.page, rowPage: detail?.rows.page };
  const { allMetrics, ...base } = snapshot;
  return {
    ...base,
    query: canonicalQuery(parsed, snapshot.period, snapshot.selected.channelIds, snapshot.selected.adAccountIds, pageState),
    metrics,
    detail,
  };
}
