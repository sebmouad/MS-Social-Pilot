import { configValueOrDefault } from '@/server/config/config-or-default';
import { workspaceCopyDefaults, workspaceText, type WorkspaceCopy } from '../../workspace-copy';
import { analyticsLanguage } from '../../server/error-copy';
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import type { MetricView } from '@/modules/analytics/server/aggregate';
import { compareAnalytics } from '../../server/comparison';
import { readAnalyticsSnapshot } from '../../server/read';
import type { AnalyticsSnapshot } from '../../server/types';
import { authorize, bad, type Actor } from '../../server/access';
import { comparisonInputSchema, type ComparisonRow, type ComparisonSide, type ComparisonStatus } from '../contracts';

const identity = (metric: MetricView) => JSON.stringify([metric.key, metric.sourceLabel, metric.resourceKind, metric.unit]);
const side = (metric: MetricView | undefined): ComparisonSide => metric ? { total: metric.total, ...(metric.displayTotal ? { displayTotal: metric.displayTotal } : {}), coverage: metric.coverage, available: metric.available, latestAt: metric.latestAt } : null;
const REASONS: Record<ComparisonStatus, string> = {
  comparable: workspaceCopyDefaults["Both sides measure the same thing in the same way."].en,
  missing: workspaceCopyDefaults["One side has no stored measurement, so the difference is unknown."].en,
  coverage_changed: workspaceCopyDefaults["Different channels or ad accounts reported on each side, so no difference is calculated."].en,
  not_comparable: workspaceCopyDefaults["This measure cannot be subtracted across the two sides (for example reach, breakdowns or incomplete coverage)."].en,
};
function reasonFor(status: ComparisonStatus, metric: MetricView, copy: WorkspaceCopy, locale: 'en' | 'fr'): string {
  const t = workspaceText(copy, locale);
  const reason = (source: string) => t(source as keyof WorkspaceCopy);
  if (status !== 'not_comparable') return reason(REASONS[status]);
  if (metric.kind === 'breakdown') return t("Category breakdowns are distributions, not single measures that can be subtracted.");
  if (metric.kind === 'ratio') return t("This is a calculated ratio; the available data does not support subtracting it across these groups.");
  if (metric.unit === 'currency') return t("Currency totals are not compared across resource groups because the neutral report cannot prove matching denominations.");
  if (metric.aggregationNote) return t("No difference is shown because of this measure's aggregation caveat: {0}", metric.aggregationNote);
  if (metric.displayTotal !== undefined) return t("This value is display-only and has no comparable numeric total.");
  if (metric.coverage < metric.available) return t("Some selected resources have no value, so the difference is unknown.");
  return reason(REASONS[status]);
}

/** Group-versus-group rule: both sides fully covered, same additive kind and aggregation, no provider caveat on a multi-resource total. */
function groupDelta(a: MetricView, b: MetricView): { status: ComparisonStatus; delta: number | null; percent: number | null } {
  // Ratios are calculated measures; group subtraction lacks a neutral combined denominator.
  const additive = ['flow', 'stock'].includes(a.kind) && a.kind === b.kind && a.aggregationLabel === b.aggregationLabel && a.unit === b.unit && a.unit !== 'currency';
  const complete = a.available > 0 && b.available > 0 && a.coverage === a.available && b.coverage === b.available;
  // Any module-supplied aggregation caveat means the value is not safe to
  // subtract across distinct groups, even when each group has one resource.
  const caveat = Boolean(a.aggregationNote || b.aggregationNote);
  if (!additive || !complete || caveat || a.displayTotal !== undefined || b.displayTotal !== undefined || a.total === null || b.total === null || !Number.isFinite(a.total) || !Number.isFinite(b.total)) {
    return { status: 'not_comparable', delta: null, percent: null };
  }
  const delta = a.total - b.total;
  const percent = b.total === 0 ? (a.total === 0 ? 0 : null) : (delta / Math.abs(b.total)) * 100;
  if (!Number.isFinite(delta) || (percent !== null && !Number.isFinite(percent))) return { status: 'not_comparable', delta: null, percent: null };
  return { status: 'comparable', delta, percent };
}

export async function readAnalyticsComparison(actor: Actor, rawInput: unknown) {
  try {
  await authorize(actor, 'analytics/compare', 'read');
  const parsed = comparisonInputSchema.safeParse(rawInput); if (!parsed.success) throw bad( errorCopyDefaults["Choose valid dates and channels to compare."].en);
  const maxMetrics = Number(await runtimeConfig('analytics.comparison.maxMetrics'));
  if (!Number.isSafeInteger(maxMetrics) || maxMetrics < 10 || maxMetrics > 2000) throw await analyticsError('unavailable', "Comparisons are temporarily unavailable.");
  const input = parsed.data;
  const [copy, locale] = await Promise.all([configValueOrDefault('analytics.workspaceCopy'), analyticsLanguage()]);
  const constraints = { feature: 'analytics/compare' as const, allowedChannelIds: actor.allowedChannelIds };
  let snapA: AnalyticsSnapshot; let snapB: AnalyticsSnapshot;
  if (input.mode === 'period') {
    const filters = { ...(input.channel ? { filter: '1', channel: input.channel } : {}), ...(input.adAccount ? { adFilter: '1', adAccount: input.adAccount } : {}) };
    [snapA, snapB] = await Promise.all([readAnalyticsSnapshot(actor, { ...filters, start: input.a.start, end: input.a.end }, constraints), readAnalyticsSnapshot(actor, { ...filters, start: input.b.start, end: input.b.end }, constraints)]);
  } else {
    if (input.groupA.some(id => input.groupB.includes(id)) || new Set(input.groupA).size !== input.groupA.length || new Set(input.groupB).size !== input.groupB.length) throw bad( errorCopyDefaults["Choose two separate groups of channels."].en);
    const range = { start: input.start, end: input.end, adFilter: '1' };
    [snapA, snapB] = await Promise.all([
      readAnalyticsSnapshot(actor, { ...range, filter: '1', channel: input.groupA }, constraints),
      readAnalyticsSnapshot(actor, { ...range, filter: '1', channel: input.groupB }, constraints),
    ]);
  }
  const aByKey = new Map(snapA.allMetrics.map(metric => [metric.key, metric]));
  const bByKey = new Map(snapB.allMetrics.map(metric => [metric.key, metric]));
  const periodMap = input.mode === 'period' ? compareAnalytics(snapA.allMetrics, snapB.allMetrics) : null;
  const keys = [...new Set([...aByKey.keys(), ...bByKey.keys()])];
  const all: ComparisonRow[] = keys.map(key => {
    const a = aByKey.get(key); const b = bByKey.get(key); const meta = (a ?? b)!;
    let status: ComparisonStatus = 'missing'; let delta: number | null = null; let percent: number | null = null;
    if (a && b) {
      if (periodMap) { const result = periodMap.get(identity(a)); status = result?.status ?? 'missing'; delta = result?.delta ?? null; percent = result?.percent ?? null; }
      else ({ status, delta, percent } = groupDelta(a, b));
    }
    return { key, label: meta.label, sourceLabel: meta.sourceLabel, resourceKind: meta.resourceKind, unit: meta.unit, kind: meta.kind, aggregationLabel: meta.aggregationLabel, a: side(a), b: side(b), status, delta, percent, reason: reasonFor(status, meta, copy, locale) };
  }).sort((x, y) => x.sourceLabel.localeCompare(y.sourceLabel) || x.label.localeCompare(y.label));
  const audienceDelta = (): number | null => snapA.audience.covered === snapA.audience.selected && snapB.audience.covered === snapB.audience.selected && snapA.audience.selected > 0 && snapB.audience.selected > 0
    ? snapA.audience.total - snapB.audience.total : null;
  const audienceSide = (s: AnalyticsSnapshot) => ({ total: s.audience.covered ? s.audience.total : null, covered: s.audience.covered, selected: s.audience.selected, asOf: s.audience.entries.length ? new Date(Math.min(...s.audience.entries.map(e => e.asOf.getTime()))) : null });
  const result = {
    ok: true as const, mode: input.mode,
    periods: { a: { start: snapA.period.start, end: snapA.period.end }, b: { start: snapB.period.start, end: snapB.period.end } },
    selected: { a: snapA.selected, b: snapB.selected },
    audience: { a: audienceSide(snapA), b: audienceSide(snapB), delta: audienceDelta(), note: workspaceText(copy, locale)("Audience adds the latest valid figure for each covered channel; it is not a count of unique people across networks.") },
    metrics: all.slice(0, maxMetrics), truncated: all.length > maxMetrics, totalMetrics: all.length,
    options: snapA.options,
  };
  const returnedItems = all.length + snapA.options.channels.length + snapA.options.adAccounts.length + snapA.options.metrics.length + snapB.selected.channelIds.length + snapB.selected.adAccountIds.length;
  if (actor.maxResultItems !== undefined && (!Number.isSafeInteger(actor.maxResultItems) || actor.maxResultItems < 1 || returnedItems > actor.maxResultItems || all.length > maxMetrics)) {
    throw await analyticsError('invalid_request', "The comparison exceeds the current MCP result limit. Narrow the selected channels or date range.");
  }
  return result;

  } catch (error) { throw await localizeAnalyticsError(error); }
}
