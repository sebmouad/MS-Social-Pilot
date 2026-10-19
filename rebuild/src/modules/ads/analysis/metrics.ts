/**
 * Provider-neutral Ads analysis. Pure functions over stored daily rows:
 * totals are recomputed from additive flows (spend, impressions, clicks), never
 * averaged from stored ratios, and reach is never summed because it is not
 * additive across days or objects. Missing comparison data is null, not zero.
 */
export type AdsAnalysisPolicy = {
  minImpressions: number;
  minClicks: number;
  changeThresholdPercent: number;
  concentrationPercent: number;
  bestCtrRatio: number;
  costlyCpcRatio: number;
  costlyMinSpendSharePercent: number;
  staleAfterHours: number;
  maxCompareAccounts: number;
  maxObjects: number;
};

export const ADS_ANALYSIS_DEFAULT_POLICY: AdsAnalysisPolicy = {
  minImpressions: 1000, minClicks: 30, changeThresholdPercent: 15, concentrationPercent: 60,
  bestCtrRatio: 1.5, costlyCpcRatio: 1.5, costlyMinSpendSharePercent: 10, staleAfterHours: 36,
  maxCompareAccounts: 12, maxObjects: 500,
};

export type AdsFlowRow = { date: string; spend: number; impressions: number; clicks: number };
export type AdsTotals = { spend: number; impressions: number; clicks: number; cpc: number | null; cpm: number | null; ctr: number | null; days: number };
export type AdsKpiKey = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm';
export type AdsKpi = { key: AdsKpiKey; current: number | null; previous: number | null; changePercent: number | null; direction: 'up' | 'down' | 'flat' | null; goodWhen: 'up' | 'down' | 'neutral' };
export type AdsFindingTone = 'good' | 'warning' | 'info';
export type AdsFinding = { tone: AdsFindingTone; key: AdsFindingKey; params: Record<string, string | number> };
export type AdsFindingKey = 'noSpend' | 'cpcDown' | 'cpcUp' | 'ctrUp' | 'ctrDown' | 'concentrated' | 'bestCtr' | 'costlyClicks';
export type AdsObjectFigures = { objectId: string; name: string; spend: number; impressions: number; clicks: number; cpc: number | null; ctr: number | null; cpm: number | null };

const round = (value: number, places = 2) => { const f = 10 ** places; return Math.round(value * f) / f; };

export function totalsFromRows(rows: readonly AdsFlowRow[]): AdsTotals {
  let spend = 0, impressions = 0, clicks = 0;
  const days = new Set<string>();
  for (const row of rows) {
    if (![row.spend, row.impressions, row.clicks].every(Number.isFinite)) continue;
    spend += row.spend; impressions += row.impressions; clicks += row.clicks; days.add(row.date);
  }
  return {
    spend: round(spend), impressions, clicks, days: days.size,
    cpc: clicks > 0 ? round(spend / clicks, 4) : null,
    cpm: impressions > 0 ? round((spend / impressions) * 1000, 4) : null,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 4) : null,
  };
}

/** Percentage change; null when either side is unknown or the baseline is zero. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

const KPI_GOOD: Record<AdsKpiKey, 'up' | 'down' | 'neutral'> = { spend: 'neutral', impressions: 'up', clicks: 'up', ctr: 'up', cpc: 'down', cpm: 'down' };

/** previous === null means the previous window has no stored data: no comparison is shown. */
export function buildKpis(current: AdsTotals, previous: AdsTotals | null): AdsKpi[] {
  return (Object.keys(KPI_GOOD) as AdsKpiKey[]).map(key => {
    const prev = previous ? previous[key] : null;
    const changePercent = percentChange(current[key], prev);
    return { key, current: current[key], previous: prev, changePercent, direction: changePercent === null ? null : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat', goodWhen: KPI_GOOD[key] };
  });
}

export function buildFindings(input: { current: AdsTotals; previous: AdsTotals | null; objects: readonly AdsObjectFigures[]; policy: AdsAnalysisPolicy }): AdsFinding[] {
  const { current, previous, objects, policy } = input;
  if (current.spend === 0) return [{ tone: 'info', key: 'noSpend', params: {} }];
  const out: AdsFinding[] = [];
  const cpc = previous ? percentChange(current.cpc, previous.cpc) : null;
  if (cpc !== null && Math.abs(cpc) >= policy.changeThresholdPercent) out.push({ tone: cpc < 0 ? 'good' : 'warning', key: cpc < 0 ? 'cpcDown' : 'cpcUp', params: { percent: Math.abs(cpc) } });
  const ctr = previous ? percentChange(current.ctr, previous.ctr) : null;
  if (ctr !== null && Math.abs(ctr) >= policy.changeThresholdPercent) out.push({ tone: ctr > 0 ? 'good' : 'warning', key: ctr > 0 ? 'ctrUp' : 'ctrDown', params: { percent: Math.abs(ctr) } });
  const spending = objects.filter(item => item.spend > 0);
  if (spending.length >= 2) {
    const top = [...spending].sort((a, b) => b.spend - a.spend || a.objectId.localeCompare(b.objectId))[0]!;
    const share = Math.round((top.spend / current.spend) * 100);
    if (share >= policy.concentrationPercent) out.push({ tone: 'info', key: 'concentrated', params: { name: top.name, share } });
  }
  if (current.ctr !== null && current.ctr > 0) {
    const best = objects.filter(item => item.impressions >= policy.minImpressions && item.ctr !== null).sort((a, b) => b.ctr! - a.ctr! || a.objectId.localeCompare(b.objectId))[0];
    if (best && best.ctr! >= current.ctr * policy.bestCtrRatio) out.push({ tone: 'good', key: 'bestCtr', params: { name: best.name, ratio: round(best.ctr! / current.ctr, 1) } });
  }
  if (current.cpc !== null && current.cpc > 0) {
    const costly = objects.filter(item => item.clicks >= policy.minClicks && item.cpc !== null && (item.spend / current.spend) * 100 >= policy.costlyMinSpendSharePercent)
      .sort((a, b) => b.cpc! - a.cpc! || a.objectId.localeCompare(b.objectId))[0];
    if (costly && costly.cpc! >= current.cpc * policy.costlyCpcRatio) out.push({ tone: 'warning', key: 'costlyClicks', params: { name: costly.name, ratio: round(costly.cpc! / current.cpc, 1) } });
  }
  return out;
}

const FINDING_TEXT: Record<AdsFindingKey, (p: Record<string, string | number>) => string> = {
  noSpend: () => 'No spend was recorded in this period.',
  cpcDown: p => `Cost per click fell ${p.percent}% compared with the previous period.`,
  cpcUp: p => `Cost per click rose ${p.percent}% compared with the previous period.`,
  ctrUp: p => `Click-through rate rose ${p.percent}% compared with the previous period.`,
  ctrDown: p => `Click-through rate fell ${p.percent}% compared with the previous period.`,
  concentrated: p => `${p.name} accounts for ${p.share}% of spend.`,
  bestCtr: p => `${p.name} has a click-through rate ${p.ratio} times the account average.`,
  costlyClicks: p => `Clicks on ${p.name} cost ${p.ratio} times the account average.`,
};
export const findingMessage = (finding: AdsFinding) => FINDING_TEXT[finding.key](finding.params);

export const OBJECT_SORT_KEYS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'name'] as const;
export type AdsObjectSortKey = (typeof OBJECT_SORT_KEYS)[number];
/** Stable sort; unknown (null) values always sort last regardless of direction. */
export function sortObjects<T extends AdsObjectFigures>(items: readonly T[], key: AdsObjectSortKey, direction: 'asc' | 'desc'): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const tie = (a: T, b: T) => {
    const aAccount = (a as T & { accountId?: string }).accountId ?? '';
    const bAccount = (b as T & { accountId?: string }).accountId ?? '';
    return aAccount.localeCompare(bAccount) || a.objectId.localeCompare(b.objectId);
  };
  return [...items].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name) || tie(a, b);
    const x = a[key], y = b[key];
    if (x === null && y === null) return tie(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y) || tie(a, b);
  });
}

export type AdsFreshness = { status: 'fresh' | 'stale' | 'unknown'; newestFetchAt: string | null; oldestFetchAt: string | null; ageHours: number | null };
export function assessFreshness(fetchedAt: readonly (Date | null)[], now: Date, staleAfterHours: number): AdsFreshness {
  const times = fetchedAt.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime())).map(value => value.getTime());
  if (!times.length) return { status: 'unknown', newestFetchAt: null, oldestFetchAt: null, ageHours: null };
  const newest = Math.max(...times), oldest = Math.min(...times);
  const ageHours = round((now.getTime() - newest) / 3_600_000, 1);
  return { status: ageHours > staleAfterHours ? 'stale' : 'fresh', newestFetchAt: new Date(newest).toISOString(), oldestFetchAt: new Date(oldest).toISOString(), ageHours };
}

/** Share of the group's spend as a whole percent; null when there is no spend to share. */
export function spendSharePercent(spend: number, totalSpend: number | null): number | null {
  if (totalSpend === null || !Number.isFinite(totalSpend) || totalSpend <= 0 || !Number.isFinite(spend)) return null;
  return Math.round((spend / totalSpend) * 100);
}

/** Sum per-day action maps (`{ type: count }`). Non-numeric entries are ignored; the result is sorted by count. */
export function sumActions(maps: readonly unknown[], maxKeys = 200): Record<string, number> {
  const totals = new Map<string, number>();
  for (const map of maps) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return Object.fromEntries([...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxKeys));
}

/** Reach counts people, so days cannot be added: the highest single day is the only honest period figure. */
export function peakReach(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

/** Previous window of the same length ending where the current one starts. */
export function previousWindow(since: Date, until: Date): { since: Date; until: Date } {
  const span = until.getTime() - since.getTime();
  return { since: new Date(since.getTime() - span), until: new Date(since.getTime()) };
}
