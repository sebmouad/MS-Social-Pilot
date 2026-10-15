import { findMetric, type CatalogueMetric } from '@/platforms';
import { METRIC_GROUP_LABELS, isRetired, type MetricDefinition, type MetricScope } from '@/platforms/metrics';
import type { AnalyticsOverview, BreakdownView, Change, ChannelValues, OverviewSeries, RetiredMetric, SeriesTechnical, ValueFormat } from '@/lib/analytics/types';
import { enumerateDays, previousRange, utcDay, zonedDay, type DayRange } from './time';

/**
 * Pure aggregation for the Analytics overview. Every rule lives here so it can
 * be tested without a database:
 *
 * - Events (`sum`) add across channels and days.
 * - Distinct people (`unique`) do not add: the total is an upper bound ("up to"), and each channel keeps its own value.
 * - Running totals (`latest`, for example followers) take each channel's newest value and add channels.
 * - Rates (`rate`) are recomputed from the summed parts, never averaged.
 * - Money is never mixed across currencies: each currency is its own series.
 * - Days are calendar days in the workspace time zone (advertising report days are already calendar dates).
 * - The previous period has the same number of days and ends the day before the range starts.
 */

export type OverviewPageRow = { metric: string; period?: string; endTime: Date; fetchedAt?: Date; numeric: number | null; value: unknown; target: { id: string; name: string } };
export type OverviewInstagramRow = { metric: string; period: string; endTime: Date; fetchedAt: Date; numeric: number | null; value: unknown; account: { id: string; igUserId: string; username: string } };
export type OverviewAdRow = { date: Date; spend: number; impressions: number; clicks: number; reach: number; actions: unknown; fields: unknown; fetchedAt: Date; adAccount: { id: string; name: string; currency: string | null } };
export type OverviewChannel = { id: string; type: string; name: string; providerId?: string };

export type OverviewInput = {
  range: DayRange;
  timeZone: string;
  now?: Date;
  channels: OverviewChannel[];
  pageRows: OverviewPageRow[];
  instagramRows?: OverviewInstagramRow[];
  adRows?: OverviewAdRow[];
  /** Number of selected ad accounts, for coverage wording. */
  adAccountCount?: number;
  /** Catalogue lookup; defaults to the installed platform modules. */
  resolve?: (scope: MetricScope, key: string) => CatalogueMetric;
};

type Source = 'page' | 'instagram' | 'ads';
type Obs = { scope: MetricScope; key: string; period: string; source: Source; entityId: string; entityName: string; day: string; value: number; currency: string | null; fetchedAt: Date | null };
type BreakdownObs = Omit<Obs, 'value'> & { value: Record<string, number> };

const asMap = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
const WINDOW_LABELS: Record<string, string> = { week: 'last 7 days', days_28: 'last 28 days' };

/** Change between two period values; null when either is missing. */
export function computeChange(current: number | null, previous: number | null, definition: Pick<MetricDefinition, 'lowerIsBetter' | 'neutral'> = {}): Change | null {
  if (current === null || previous === null) return null;
  const absolute = current - previous;
  const direction = Math.abs(absolute) < 1e-9 ? 'flat' : absolute > 0 ? 'up' : 'down';
  const percent = previous === 0 ? (direction === 'flat' ? 0 : null) : absolute / Math.abs(previous) * 100;
  const favourable = direction === 'flat' || definition.neutral ? null : (direction === 'up') !== Boolean(definition.lowerIsBetter);
  return { absolute, percent, direction, favourable };
}

type EntityDays = Map<string, { name: string; byDay: Map<string, number> }>;

function entitiesOf(observations: Obs[]): EntityDays {
  const entities: EntityDays = new Map();
  for (const obs of observations) {
    const entity = entities.get(obs.entityId) ?? { name: obs.entityName, byDay: new Map<string, number>() };
    entity.byDay.set(obs.day, (entity.byDay.get(obs.day) ?? 0) + obs.value);
    entities.set(obs.entityId, entity);
  }
  return entities;
}

/** One value per day: the sum of what every entity stored that day. */
function dailySums(entities: EntityDays, days: string[]): Array<number | null> {
  return days.map(day => {
    let total = 0; let found = false;
    for (const entity of entities.values()) { const value = entity.byDay.get(day); if (value !== undefined) { total += value; found = true; } }
    return found ? total : null;
  });
}

/** One value per day: each entity's newest value up to that day, added together. */
function carriedSums(entities: EntityDays, days: string[]): Array<number | null> {
  const sorted = [...entities.values()].map(entity => [...entity.byDay].sort(([a], [b]) => a.localeCompare(b)));
  const cursors = sorted.map(() => -1);
  return days.map(day => {
    let total = 0; let found = false;
    sorted.forEach((points, index) => {
      while (cursors[index]! + 1 < points.length && points[cursors[index]! + 1]![0] <= day) cursors[index]!++;
      if (cursors[index]! >= 0) { total += points[cursors[index]!]![1]; found = true; }
    });
    return found ? total : null;
  });
}

function totalInDays(entities: EntityDays, daySet: Set<string>): number | null {
  let total = 0; let found = false;
  for (const entity of entities.values()) for (const [day, value] of entity.byDay) if (daySet.has(day)) { total += value; found = true; }
  return found ? total : null;
}

/** An entity's newest value within the days, or null. */
function latestIn(entity: { byDay: Map<string, number> }, daySet: Set<string>): number | null {
  let bestDay = ''; let best: number | null = null;
  for (const [day, value] of entity.byDay) if (daySet.has(day) && day >= bestDay) { bestDay = day; best = value; }
  return best;
}

function latestTotalIn(entities: EntityDays, daySet: Set<string>): number | null {
  let total = 0; let found = false;
  for (const entity of entities.values()) { const value = latestIn(entity, daySet); if (value !== null) { total += value; found = true; } }
  return found ? total : null;
}

const ratio = (numerator: number | null, denominator: number | null, scale: number) => numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator * scale : null;

export function buildOverview(input: OverviewInput): AnalyticsOverview {
  const resolve = input.resolve ?? findMetric;
  const now = input.now ?? new Date();
  const days = enumerateDays(input.range);
  const prior = previousRange(input.range);
  const previousDays = enumerateDays(prior);
  const daySet = new Set(days);
  const priorSet = new Set(previousDays);
  const windowStart = prior.start;
  const inWindow = (day: string) => day >= windowStart && day <= input.range.end;

  const selectedPages = input.channels.filter(channel => channel.type === 'page');
  const selectedInstagram = input.channels.filter(channel => channel.type === 'instagram');
  const available: Record<Source, number> = { page: selectedPages.length, instagram: selectedInstagram.length, ads: input.adAccountCount ?? new Set((input.adRows ?? []).map(row => row.adAccount.id)).size };

  // 1. Normalise every stored value to one observation with a calendar day.
  const observations: Obs[] = [];
  const breakdowns: BreakdownObs[] = [];
  const add = (obs: Obs | BreakdownObs) => { (typeof obs.value === 'number' ? observations : breakdowns).push(obs as never); };

  for (const row of input.pageRows) {
    const day = zonedDay(row.endTime, input.timeZone);
    if (!inWindow(day)) continue;
    const base = { scope: 'channel' as const, key: row.metric, period: row.period ?? 'day', source: 'page' as const, entityId: row.target.id, entityName: row.target.name, day, currency: null, fetchedAt: row.fetchedAt ?? null };
    const numeric = row.numeric ?? safeNumber(row.value);
    if (numeric !== null) add({ ...base, value: numeric });
    else { const map = breakdownMap(row.value); if (map) add({ ...base, value: map }); }
  }
  for (const row of input.instagramRows ?? []) {
    const channel = selectedInstagram.find(candidate => candidate.providerId === row.account.igUserId);
    if (!channel) continue;
    const day = zonedDay(row.endTime, input.timeZone);
    if (!inWindow(day)) continue;
    const base = { scope: 'channel' as const, key: row.metric, period: row.period, source: 'instagram' as const, entityId: channel.id, entityName: channel.name || `@${row.account.username}`, day, currency: null, fetchedAt: row.fetchedAt };
    const numeric = row.numeric ?? safeNumber(row.value);
    if (numeric !== null) add({ ...base, value: numeric });
    else { const map = breakdownMap(row.value); if (map) add({ ...base, value: map }); }
  }
  const currencies = new Set<string>();
  for (const row of input.adRows ?? []) {
    const day = utcDay(row.date);
    if (!inWindow(day)) continue;
    const currency = row.adAccount.currency || null;
    currencies.add(currency ?? '');
    const base = { scope: 'ads' as const, period: 'day', source: 'ads' as const, entityId: row.adAccount.id, entityName: row.adAccount.name, day, currency, fetchedAt: row.fetchedAt };
    for (const key of ['spend', 'impressions', 'clicks', 'reach'] as const) add({ ...base, key, value: row[key] });
    for (const extra of adExtras(row)) add({ ...base, key: extra.key, value: extra.value });
  }

  // 2. Group observations into series.
  const groups = new Map<string, Obs[]>();
  for (const obs of observations) {
    const metric = resolve(obs.scope, obs.key);
    const splitByCurrency = obs.scope === 'ads' && metric.definition.unit === 'currency';
    const id = `${obs.scope}:${obs.key}:${obs.period}${splitByCurrency ? `:${obs.currency ?? ''}` : ''}`;
    const group = groups.get(id) ?? []; group.push(obs); groups.set(id, group);
  }
  const multiCurrency = currencies.size > 1;
  const adObservations = observations.filter(obs => obs.scope === 'ads');

  const series: OverviewSeries[] = [];
  const retired = new Map<string, RetiredMetric>();

  const finish = (metric: CatalogueMetric, id: string, period: string, currency: string | null, parts: { entities: EntityDays; observations: Obs[] } | null, ratioParts: { numerator: Obs[]; denominator: Obs[] } | null, sourceHint: Source) => {
    const def = metric.definition;
    const windowed = period !== 'day' && def.aggregation !== 'rate';
    const entityLabel: OverviewSeries['entityLabel'] = def.scope === 'ads' ? 'ad account' : 'channel';
    const scale = def.valueScale ?? 1;
    const format: ValueFormat = { unit: def.unit, ...(def.rate ? { style: def.rate.style } : {}), currency: def.unit === 'currency' ? currency : null };
    const name = (multiCurrency && def.unit === 'currency' ? `${def.name} (${currency ?? 'currency not reported'})` : def.name) + (windowed && WINDOW_LABELS[period] ? ` (${WINDOW_LABELS[period]})` : '');
    let values: Array<number | null>; let previousValues: Array<number | null>;
    let total: number | null; let previousTotal: number | null;
    let channelRows: ChannelValues[]; let approximate = false; let upTo = false;
    let usedObservations: Obs[];

    if (def.aggregation === 'rate' && def.rate && ratioParts) {
      const numerator = entitiesOf(ratioParts.numerator);
      const denominator = entitiesOf(ratioParts.denominator);
      const scaleBy = def.rate.scale ?? 1;
      const rateAt = (list: string[]) => {
        const n = dailySums(numerator, list); const d = dailySums(denominator, list);
        return list.map((_, index) => ratio(n[index]!, d[index]!, scaleBy));
      };
      values = rateAt(days); previousValues = rateAt(previousDays);
      total = ratio(totalInDays(numerator, daySet), totalInDays(denominator, daySet), scaleBy);
      previousTotal = ratio(totalInDays(numerator, priorSet), totalInDays(denominator, priorSet), scaleBy);
      const denominatorDefinition = resolve(def.scope, def.rate.denominator).definition;
      approximate = denominatorDefinition.aggregation === 'unique' || resolve(def.scope, def.rate.numerator).definition.aggregation === 'unique';
      const ids = new Set([...numerator.keys(), ...denominator.keys()]);
      channelRows = [...ids].map(entityId => {
        const n = numerator.get(entityId); const d = denominator.get(entityId);
        const one = (list: string[]) => list.map(day => ratio(n?.byDay.get(day) ?? null, d?.byDay.get(day) ?? null, scaleBy));
        const nSet = (set: Set<string>) => n ? totalInDays(new Map([[entityId, n]]), set) : null;
        const dSet = (set: Set<string>) => d ? totalInDays(new Map([[entityId, d]]), set) : null;
        return { id: entityId, name: (n ?? d)!.name, total: ratio(nSet(daySet), dSet(daySet), scaleBy), previousTotal: ratio(nSet(priorSet), dSet(priorSet), scaleBy), values: one(days) };
      }).filter(row => row.total !== null);
      usedObservations = [...ratioParts.numerator, ...ratioParts.denominator];
      // A rate needs both parts inside the range to say anything.
      if (total === null && channelRows.length === 0) return;
    } else {
      const entities = parts!.entities;
      usedObservations = parts!.observations;
      const carry = def.aggregation === 'latest' || windowed;
      values = (carry ? carriedSums : dailySums)(entities, days);
      previousValues = (carry ? carriedSums : dailySums)(entities, previousDays);
      total = carry ? latestTotalIn(entities, daySet) : totalInDays(entities, daySet);
      previousTotal = carry ? latestTotalIn(entities, priorSet) : totalInDays(entities, priorSet);
      channelRows = [...entities].map(([entityId, entity]) => {
        const one = new Map([[entityId, entity]]);
        return { id: entityId, name: entity.name, total: carry ? latestTotalIn(one, daySet) : totalInDays(one, daySet), previousTotal: carry ? latestTotalIn(one, priorSet) : totalInDays(one, priorSet), values: (carry ? carriedSums : dailySums)(one, days) };
      }).filter(row => row.total !== null);
      if (def.aggregation === 'unique') {
        const observedDays = new Set(usedObservations.filter(obs => daySet.has(obs.day)).map(obs => obs.day));
        upTo = channelRows.length > 1 || (!windowed && observedDays.size > 1);
      }
    }
    if (scale !== 1) {
      const apply = (value: number | null) => value === null ? null : value * scale;
      values = values.map(apply); previousValues = previousValues.map(apply); total = apply(total); previousTotal = apply(previousTotal);
      channelRows = channelRows.map(row => ({ ...row, total: apply(row.total), previousTotal: apply(row.previousTotal), values: row.values.map(apply) }));
    }
    if (total === null && previousTotal === null && values.every(value => value === null)) return;

    const inRange = usedObservations.filter(obs => daySet.has(obs.day));
    if (isRetired(def, now)) {
      if (!inRange.length) return;
      const key = `${def.scope}:${def.key}`;
      if (!retired.has(key)) {
        const replacement = def.retired?.replacedBy ? resolve(def.scope, def.retired.replacedBy) : null;
        retired.set(key, { id: key, name: def.name, definition: def.definition, retiredOn: def.retired!.on, replacedByName: replacement?.known ? replacement.definition.name : null, source: metric.module?.name ?? null, storedName: def.key });
      }
      return;
    }
    channelRows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const dayList = usedObservations.map(obs => obs.day).sort();
    const fetched = usedObservations.flatMap(obs => obs.fetchedAt ? [obs.fetchedAt.getTime()] : []);
    const technical: SeriesTechnical = { storedName: def.key, period, source: metric.module?.name ?? null, firstDay: dayList[0] ?? null, lastDay: dayList.at(-1) ?? null, lastSynced: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null, points: usedObservations.length };
    series.push({
      id, name, definition: def.definition, group: def.group, groupLabel: METRIC_GROUP_LABELS[def.group], format, aggregation: def.aggregation,
      headline: Boolean(def.headline), lowerIsBetter: Boolean(def.lowerIsBetter), total, upTo, approximate, previousTotal,
      change: computeChange(total, previousTotal, def), values, previousValues, entityLabel, channels: channelRows,
      coverage: channelRows.length, available: Math.max(available[sourceHint], channelRows.length), windowLabel: windowed ? WINDOW_LABELS[period] ?? period : null, technical,
    });
  };

  for (const [id, group] of groups) {
    const first = group[0]!;
    const metric = resolve(first.scope, first.key);
    if (metric.definition.aggregation === 'rate') continue;
    const currency = first.scope === 'ads' && metric.definition.unit === 'currency' ? first.currency : null;
    finish(metric, id, first.period, currency, { entities: entitiesOf(group), observations: group }, null, first.source);
  }
  // Rates over advertising parts: one series per currency for cost rates, one overall for the rest.
  if (adObservations.length) {
    const adKeys = ['ctr', 'cpc', 'cpm', 'cpp', 'frequency'];
    for (const key of adKeys) {
      const metric = resolve('ads', key);
      const rate = metric.definition.rate;
      if (!rate || metric.definition.aggregation !== 'rate') continue;
      const scopes = rate.style === 'money' ? [...currencies] : [null];
      for (const currency of scopes) {
        const pool = currency === null ? adObservations : adObservations.filter(obs => (obs.currency ?? '') === currency);
        const numerator = pool.filter(obs => obs.key === rate.numerator);
        const denominator = pool.filter(obs => obs.key === rate.denominator);
        finish(metric, `ads:${key}:day${currency === null ? '' : `:${currency}`}`, 'day', currency === null ? null : currency || null, null, { numerator, denominator }, 'ads');
      }
    }
  }

  // 3. Breakdowns: category tables rather than trends.
  const breakdownViews: BreakdownView[] = [];
  const breakdownGroups = new Map<string, BreakdownObs[]>();
  for (const obs of breakdowns) {
    if (!daySet.has(obs.day)) continue;
    const id = `${obs.scope}:${obs.key}:${obs.period}`;
    const group = breakdownGroups.get(id) ?? []; group.push(obs); breakdownGroups.set(id, group);
  }
  for (const [id, group] of breakdownGroups) {
    const first = group[0]!;
    const metric = resolve(first.scope, first.key);
    const def = metric.definition;
    if (isRetired(def, now)) {
      const key = `${def.scope}:${def.key}`;
      if (!retired.has(key)) {
        const replacement = def.retired?.replacedBy ? resolve(def.scope, def.retired.replacedBy) : null;
        retired.set(key, { id: key, name: def.name, definition: def.definition, retiredOn: def.retired!.on, replacedByName: replacement?.known ? replacement.definition.name : null, source: metric.module?.name ?? null, storedName: def.key });
      }
      continue;
    }
    const totals = new Map<string, number>();
    const accumulate = (value: Record<string, number>) => { for (const [label, amount] of Object.entries(value)) totals.set(label, (totals.get(label) ?? 0) + amount); };
    if (def.aggregation === 'sum') for (const obs of group) accumulate(obs.value);
    else {
      const newest = new Map<string, BreakdownObs>();
      for (const obs of group) { const previous = newest.get(obs.entityId); if (!previous || obs.day >= previous.day) newest.set(obs.entityId, obs); }
      for (const obs of newest.values()) accumulate(obs.value);
    }
    const rows = [...totals].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, 30);
    if (!rows.length) continue;
    const entityIds = new Set(group.map(obs => obs.entityId));
    const fetched = group.flatMap(obs => obs.fetchedAt ? [obs.fetchedAt.getTime()] : []);
    const dayList = group.map(obs => obs.day).sort();
    breakdownViews.push({
      id, name: def.name, definition: def.definition, rows, coverage: entityIds.size, available: Math.max(available[first.source], entityIds.size), asOf: dayList.at(-1) ?? null,
      technical: { storedName: def.key, period: first.period, source: metric.module?.name ?? null, firstDay: dayList[0] ?? null, lastDay: dayList.at(-1) ?? null, lastSynced: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null, points: group.length },
    });
  }

  const groupOrder = Object.keys(METRIC_GROUP_LABELS);
  series.sort((a, b) => Number(b.headline) - Number(a.headline) || groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || a.name.localeCompare(b.name));
  breakdownViews.sort((a, b) => a.name.localeCompare(b.name));
  return { days, previousDays, timeZone: input.timeZone, series, breakdowns: breakdownViews, retired: [...retired.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function breakdownMap(value: unknown): Record<string, number> | null {
  const entries = Object.entries(asMap(value)).flatMap(([label, raw]) => { const n = safeNumber(raw); return n === null ? [] : [[label, n] as const]; });
  return entries.length ? Object.fromEntries(entries) : null;
}

const BASE_AD_KEYS = new Set(['spend', 'impressions', 'clicks', 'reach', 'cpc', 'cpm', 'cpp', 'ctr', 'frequency']);

/** Action counts and values kept in an ad row's stored JSON, as `group:action` keys. */
function adExtras(row: OverviewAdRow): Array<{ key: string; value: number }> {
  const found: Array<{ key: string; value: number }> = [];
  const take = (group: string, items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const record = asMap(item);
      const value = safeNumber(record.value);
      if (typeof record.action_type === 'string' && value !== null) found.push({ key: `${group}:${record.action_type}`, value });
    }
  };
  for (const [key, value] of Object.entries(asMap(row.fields))) if (!BASE_AD_KEYS.has(key)) take(key, value);
  if (Array.isArray(row.actions)) take('actions', row.actions);
  else for (const [key, value] of Object.entries(asMap(row.actions))) take(key, value);
  // The same action can be stored in both places; keep one value per key.
  const unique = new Map<string, number>();
  for (const item of found) if (!unique.has(item.key)) unique.set(item.key, item.value);
  return [...unique].map(([key, value]) => ({ key, value }));
}
