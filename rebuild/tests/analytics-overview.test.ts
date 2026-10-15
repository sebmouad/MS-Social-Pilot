import { describe, expect, it } from 'vitest';
import { buildOverview, computeChange, type OverviewAdRow, type OverviewInput, type OverviewPageRow } from '../src/server/analytics/overview';
import { PLATFORM_MODULES } from '../src/platforms';
import { isRetired } from '../src/platforms/metrics';

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);
const range = { start: '2026-10-08', end: '2026-10-14' };
const pageA = { id: 'a', name: 'Channel A' };
const pageB = { id: 'b', name: 'Channel B' };
const channels = [{ id: 'a', type: 'page', name: 'Channel A' }, { id: 'b', type: 'page', name: 'Channel B' }];

function row(metric: string, day: string, value: number, target = pageA, period = 'day'): OverviewPageRow {
  return { metric, period, endTime: at(day), fetchedAt: at('2026-10-15'), numeric: value, value, target };
}
function ad(day: string, account: { id: string; name: string; currency: string | null }, spend: number, impressions: number, clicks: number, reach: number, extra: Partial<OverviewAdRow> = {}): OverviewAdRow {
  return { date: new Date(`${day}T00:00:00.000Z`), spend, impressions, clicks, reach, actions: null, fields: null, fetchedAt: at('2026-10-15'), adAccount: account, ...extra };
}
const build = (input: Partial<OverviewInput>) => buildOverview({ range, timeZone: 'UTC', now: at('2026-10-15'), channels, pageRows: [], ...input });
const find = (overview: ReturnType<typeof build>, id: string) => overview.series.find(item => item.id === id);

describe('overview aggregation rules', () => {
  it('adds events across channels and days and compares with the equal-length previous period', () => {
    const overview = build({ pageRows: [
      row('page_media_view', '2026-10-08', 10), row('page_media_view', '2026-10-09', 20), row('page_media_view', '2026-10-09', 5, pageB),
      row('page_media_view', '2026-10-01', 10), row('page_media_view', '2026-10-02', 5), // previous period: 1–7 Oct
    ] });
    const views = find(overview, 'channel:page_media_view:day')!;
    expect(views.total).toBe(35);
    expect(views.previousTotal).toBe(15);
    expect(views.change).toMatchObject({ absolute: 20, direction: 'up', favourable: true });
    expect(views.change!.percent).toBeCloseTo(133.33, 1);
    expect(views.upTo).toBe(false);
    expect(overview.days).toHaveLength(7);
    expect(overview.previousDays).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    expect(views.values).toEqual([10, 25, null, null, null, null, null]);
    expect(views.previousValues).toEqual([10, 5, null, null, null, null, null]);
    expect(views.channels.map(item => [item.name, item.total, item.previousTotal])).toEqual([['Channel A', 30, 15], ['Channel B', 5, null]]);
    expect(views.name).toBe('Views');
  });

  it('never adds distinct people: totals are an upper bound and each channel keeps its own value', () => {
    const overview = build({ pageRows: [
      row('page_total_media_view_unique', '2026-10-08', 100), row('page_total_media_view_unique', '2026-10-09', 80),
      row('page_total_media_view_unique', '2026-10-08', 50, pageB),
    ] });
    const viewers = find(overview, 'channel:page_total_media_view_unique:day')!;
    expect(viewers.name).toBe('Viewers');
    expect(viewers.upTo).toBe(true);
    expect(viewers.total).toBe(230);
    expect(viewers.channels.map(item => [item.name, item.total])).toEqual([['Channel A', 180], ['Channel B', 50]]);
  });

  it('is exact when a single channel reports a single day of distinct people', () => {
    const overview = build({ channels: [channels[0]!], pageRows: [row('page_total_media_view_unique', '2026-10-09', 100)] });
    expect(find(overview, 'channel:page_total_media_view_unique:day')).toMatchObject({ total: 100, upTo: false });
  });

  it('takes each channel’s newest value for running totals and carries values across days without data', () => {
    const overview = build({ pageRows: [
      row('page_follows', '2026-10-08', 90), row('page_follows', '2026-10-10', 100), row('page_follows', '2026-10-09', 60, pageB),
      row('page_follows', '2026-10-05', 70), row('page_follows', '2026-10-05', 40, pageB),
    ] });
    const followers = find(overview, 'channel:page_follows:day')!;
    expect(followers.name).toBe('Followers');
    expect(followers.total).toBe(160);
    expect(followers.previousTotal).toBe(110);
    expect(followers.values).toEqual([130, 150, 160, 160, 160, 160, 160]);
    expect(followers.upTo).toBe(false);
  });

  it('recomputes rates from summed parts instead of averaging daily rates', () => {
    const account = { id: 'x', name: 'Account', currency: 'USD' };
    const overview = build({ adRows: [ad('2026-10-08', account, 10, 1000, 100, 800), ad('2026-10-09', account, 10, 100, 1, 90)] });
    const ctr = find(overview, 'ads:ctr:day')!;
    // 101 clicks / 1100 impressions, not the mean of 10% and 1%.
    expect(ctr.total).toBeCloseTo(9.18, 2);
    expect(ctr.values.slice(0, 2)).toEqual([10, 1]);
    const cpc = find(overview, 'ads:cpc:day:USD')!;
    expect(cpc.total).toBeCloseTo(20 / 101, 6);
    expect(cpc.lowerIsBetter).toBe(true);
    const cpm = find(overview, 'ads:cpm:day:USD')!;
    expect(cpm.total).toBeCloseTo(20 / 1100 * 1000, 6);
    const frequency = find(overview, 'ads:frequency:day')!;
    expect(frequency.approximate).toBe(true);
    expect(frequency.total).toBeCloseTo(1100 / 890, 6);
  });

  it('leaves a rate empty instead of dividing by zero', () => {
    const account = { id: 'x', name: 'Account', currency: 'USD' };
    const overview = build({ adRows: [ad('2026-10-08', account, 5, 0, 0, 0)] });
    expect(find(overview, 'ads:ctr:day')).toBeUndefined();
    expect(find(overview, 'ads:cpc:day:USD')).toBeUndefined();
    expect(find(overview, 'ads:spend:day:USD')?.total).toBe(5);
  });

  it('keeps each currency separate and never mixes money', () => {
    const usd = { id: 'u', name: 'US account', currency: 'USD' };
    const eur = { id: 'e', name: 'EU account', currency: 'EUR' };
    const overview = build({ adRows: [ad('2026-10-08', usd, 30, 1000, 10, 500), ad('2026-10-08', eur, 20, 500, 10, 300)] });
    const spendUsd = find(overview, 'ads:spend:day:USD')!;
    const spendEur = find(overview, 'ads:spend:day:EUR')!;
    expect(spendUsd).toMatchObject({ name: 'Ad spend (USD)', total: 30, format: { unit: 'currency', currency: 'USD' } });
    expect(spendEur).toMatchObject({ name: 'Ad spend (EUR)', total: 20, format: { currency: 'EUR' } });
    expect(spendUsd.channels.map(item => item.name)).toEqual(['US account']);
    expect(find(overview, 'ads:cpc:day:USD')!.total).toBe(3);
    expect(find(overview, 'ads:cpc:day:EUR')!.total).toBe(2);
    // Counts have no currency, so they add across accounts.
    expect(find(overview, 'ads:clicks:day')!.total).toBe(20);
    expect(overview.series.some(item => item.id === 'ads:spend:day')).toBe(false);
  });

  it('keeps plain names for a single currency and reports unreported currency without a symbol', () => {
    const only = { id: 'u', name: 'US account', currency: 'USD' };
    expect(find(build({ adRows: [ad('2026-10-08', only, 30, 1000, 10, 500)] }), 'ads:spend:day:USD')!.name).toBe('Ad spend');
    const unknown = { id: 'n', name: 'No currency', currency: null };
    expect(find(build({ adRows: [ad('2026-10-08', unknown, 12, 100, 1, 50)] }), 'ads:spend:day:')).toMatchObject({ total: 12, format: { currency: null } });
  });

  it('places channel values on the workspace calendar day but advertising days on their own date', () => {
    const late = { ...row('page_media_view', '2026-10-08', 7), endTime: new Date('2026-10-09T02:00:00.000Z') };
    const utc = build({ pageRows: [late] });
    expect(find(utc, 'channel:page_media_view:day')!.values[1]).toBe(7);
    const newYork = build({ timeZone: 'America/New_York', pageRows: [late] });
    expect(find(newYork, 'channel:page_media_view:day')!.values.slice(0, 2)).toEqual([7, null]);
    const account = { id: 'x', name: 'Account', currency: 'USD' };
    const ads = build({ timeZone: 'Pacific/Auckland', adRows: [ad('2026-10-08', account, 10, 100, 1, 50)] });
    expect(find(ads, 'ads:clicks:day')!.values[0]).toBe(1);
  });

  it('ignores values outside the range and the previous period', () => {
    const overview = build({ pageRows: [row('page_media_view', '2026-10-15', 99), row('page_media_view', '2026-09-20', 99), row('page_media_view', '2026-10-10', 1)] });
    const views = find(overview, 'channel:page_media_view:day')!;
    expect(views.total).toBe(1);
    expect(views.previousTotal).toBeNull();
    expect(views.change).toBeNull();
  });

  it('reports retired metrics as unavailable with the replacement, never as a chart', () => {
    const overview = build({ pageRows: [row('page_impressions', '2026-10-09', 40), row('page_impressions_unique', '2026-10-09', 30), row('page_media_view', '2026-10-09', 5)] });
    expect(overview.series.map(item => item.id)).toEqual(['channel:page_media_view:day']);
    expect(overview.retired).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Impressions', replacedByName: 'Views', retiredOn: '2025-11-15', source: 'Facebook' }),
      expect.objectContaining({ name: 'People reached', replacedByName: 'Viewers' }),
    ]));
  });

  it('adds breakdowns by label: flows over the range, running totals by newest value', () => {
    const breakdown = (metric: string, day: string, value: Record<string, number>, target = pageA): OverviewPageRow => ({ metric, period: 'day', endTime: at(day), numeric: null, value, target });
    const overview = build({ pageRows: [
      breakdown('page_follows_country', '2026-10-08', { AA: 5, BB: 1 }), breakdown('page_follows_country', '2026-10-10', { AA: 7, BB: 2 }), breakdown('page_follows_country', '2026-10-10', { AA: 3 }, pageB),
      breakdown('page_actions_post_reactions_total', '2026-10-08', { like: 4 }), breakdown('page_actions_post_reactions_total', '2026-10-09', { like: 6, love: 1 }),
    ] });
    const country = overview.breakdowns.find(item => item.name === 'Followers by country')!;
    expect(country.rows).toEqual([{ label: 'AA', value: 10 }, { label: 'BB', value: 2 }]);
    expect(country.coverage).toBe(2);
    const reactions = overview.breakdowns.find(item => item.name === 'Reactions by type')!;
    expect(reactions.rows).toEqual([{ label: 'like', value: 10 }, { label: 'love', value: 1 }]);
  });

  it('scales stored values to the catalogue unit', () => {
    const overview = build({ pageRows: [row('page_video_view_time', '2026-10-09', 90_000)] });
    expect(find(overview, 'channel:page_video_view_time:day')).toMatchObject({ total: 90, format: { unit: 'duration' } });
  });

  it('describes unknown stored names without exposing them as the customer name and keeps them in technical details', () => {
    const overview = build({ pageRows: [row('page_brand_new_thing_unique', '2026-10-09', 3)] });
    const unknown = overview.series[0]!;
    expect(unknown.name).toBe('Brand new thing unique');
    expect(unknown.technical.storedName).toBe('page_brand_new_thing_unique');
    expect(unknown.technical.source).toBe('Facebook');
  });

  it('turns ad actions into plain-language series', () => {
    const account = { id: 'x', name: 'Account', currency: 'USD' };
    const overview = build({ adRows: [ad('2026-10-08', account, 10, 100, 4, 50, { actions: [{ action_type: 'link_click', value: '4' }], fields: { quality_ranking: 2 } }), ad('2026-10-09', account, 10, 100, 3, 50, { actions: { actions: [{ action_type: 'link_click', value: '3' }], action_values: [{ action_type: 'purchase', value: '25.5' }] } })] });
    expect(find(overview, 'ads:actions:link_click:day')).toMatchObject({ name: 'Link clicks', total: 7 });
    expect(find(overview, 'ads:action_values:purchase:day:USD')).toMatchObject({ name: 'Purchases value', total: 25.5, format: { currency: 'USD' } });
    expect(overview.series.some(item => item.technical.storedName === 'quality_ranking')).toBe(false);
  });

  it('works against any catalogue, not only the installed modules', () => {
    const overview = build({
      channels: [{ id: 'a', type: 'page', name: 'Channel A' }],
      pageRows: [row('plays', '2026-10-09', 4)],
      resolve: (scope, key) => ({ known: true, module: { id: 'demo', name: 'Demo network' }, definition: { key, scope, name: 'Plays', definition: 'Times a video started.', unit: 'count', aggregation: 'sum', group: 'video' } }),
    });
    expect(overview.series[0]).toMatchObject({ name: 'Plays', total: 4, technical: { source: 'Demo network' } });
  });
});

describe('change and catalogue rules', () => {
  it('marks improvements and declines, treating costs as better when they fall and spend as neutral', () => {
    expect(computeChange(120, 100)).toMatchObject({ direction: 'up', favourable: true, percent: 20 });
    expect(computeChange(80, 100, { lowerIsBetter: true })).toMatchObject({ direction: 'down', favourable: true, percent: -20 });
    expect(computeChange(80, 100)).toMatchObject({ direction: 'down', favourable: false });
    expect(computeChange(80, 100, { neutral: true })?.favourable).toBeNull();
    expect(computeChange(5, 0)).toMatchObject({ direction: 'up', percent: null });
    expect(computeChange(0, 0)).toMatchObject({ direction: 'flat', percent: 0 });
    expect(computeChange(null, 3)).toBeNull();
    expect(computeChange(3, null)).toBeNull();
  });

  it('gives every catalogue entry a plain customer name and definition', () => {
    const all = PLATFORM_MODULES.flatMap(module => module.metrics);
    expect(all.length).toBeGreaterThan(80);
    const seen = new Set<string>();
    for (const metric of all) {
      expect(metric.name, metric.key).not.toMatch(/[_:]/);
      expect(metric.name, metric.key).not.toBe(metric.key);
      expect(metric.definition.length, metric.key).toBeGreaterThan(10);
      expect(metric.definition, metric.key).not.toMatch(/_/);
      const identity = `${metric.scope}:${metric.key}`;
      expect(seen.has(identity), `duplicate ${identity}`).toBe(false);
      seen.add(identity);
      if (metric.aggregation === 'rate') expect(metric.rate, metric.key).toBeTruthy();
    }
    for (const metric of all.filter(item => item.retired?.replacedBy)) {
      expect(all.some(candidate => candidate.scope === metric.scope && candidate.key === metric.retired!.replacedBy), `${metric.key} replacement`).toBe(true);
    }
  });

  it('treats a metric as retired only from its retirement day', () => {
    const definition = { retired: { on: '2026-07-29' } };
    expect(isRetired(definition, new Date('2026-07-28T23:59:59Z'))).toBe(false);
    expect(isRetired(definition, new Date('2026-07-29T00:00:00Z'))).toBe(true);
    expect(isRetired({}, new Date())).toBe(false);
  });
});
