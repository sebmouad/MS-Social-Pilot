import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), config: vi.fn(), fetch: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, $transaction: m.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/modules/publishing/server/media/network/net-guard', () => ({ defaultFetchDeps: () => ({}), guardedFetch: m.fetch }));
import { refreshDefaults } from '@/modules/calendar-extras/config';
import { parseHolidays, parseTrends, refreshHolidays, refreshTrends, formatRefreshSummary } from '@/modules/calendar-extras/server/refresh';
import { adjustDaySlots } from '@/modules/calendar-extras/server/seasons';
import { seasonAdjuster } from '@/modules/calendar-extras/server/queue-seasons';
import { nextAvailableSlot } from '@/modules/publishing/collaboration/server/executors';
import { CALENDAR_EXTRAS_JOBS } from '@/modules/calendar-extras/manifest';

const now = new Date('2026-10-22T10:00:00Z');
const ok = (body: unknown, status = 200) => ({ notModified: false, status, bytes: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockResolvedValue(refreshDefaults);
  m.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $executeRaw: m.execute }));
  m.execute.mockResolvedValue(1);
});

describe('calendar refresh parsing', () => {
  it('keeps nationwide holidays only and bounds names', () => {
    const rows = parseHolidays([{ date: '2026-12-25', name: 'Christmas Day', localName: 'Noël', global: true }, { date: '2026-12-26', name: 'Regional', global: false }, { date: 'bad', name: 'x' }, { date: '2026-01-01', name: 'N'.repeat(900) }], refreshDefaults);
    expect(rows.map(r => r.date)).toEqual(['2026-12-25', '2026-01-01']);
    expect(rows[1]!.name).toHaveLength(refreshDefaults.holidayNameLength);
  });
  it('parses trending items, decodes entities and ignores unsafe news links', () => {
    const xml = `<rss><channel><item><title>Fish &amp; chips</title><ht:approx_traffic>20,000+</ht:approx_traffic><pubDate>Thu, 22 Oct 2026 08:00:00 +0000</pubDate><ht:news_item><ht:news_item_title><![CDATA[Story]]></ht:news_item_title><ht:news_item_url>javascript:alert(1)</ht:news_item_url></ht:news_item></item><item><title></title></item></channel></rss>`;
    const [trend, ...rest] = parseTrends(xml, refreshDefaults);
    expect(rest).toHaveLength(0);
    expect(trend).toMatchObject({ title: 'Fish & chips', traffic: '20,000+', newsTitle: 'Story', newsUrl: null });
    expect(trend!.startedAt?.toISOString()).toBe('2026-10-22T08:00:00.000Z');
  });
});

describe('holiday job', () => {
  it('does nothing when switched off in Root', async () => {
    m.config.mockResolvedValue({ ...refreshDefaults, enabled: false });
    expect(await refreshHolidays({ now })).toMatchObject({ reason: 'disabled', attempted: 0 });
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('fetches only missing or aged country-years, within the Root batch size, from the configured host', async () => {
    m.config.mockResolvedValue({ ...refreshDefaults, holidayCountryYearsPerRun: 2 });
    m.query.mockResolvedValueOnce([{ country: 'FR' }, { country: 'GB' }]).mockResolvedValueOnce([{ country: 'FR', year: 2026, fetchedAt: new Date('2026-10-01T00:00:00Z') }]);
    m.fetch.mockResolvedValue(ok([{ date: '2026-12-25', name: 'Christmas Day', localName: 'Noël', global: true }]));
    const result = await refreshHolidays({ now });
    expect(result).toMatchObject({ attempted: 2, stored: 2, failed: 0 });
    expect(m.fetch.mock.calls.map(c => c[0])).toEqual([`${refreshDefaults.holidaysUrl}/2027/FR`, `${refreshDefaults.holidaysUrl}/2026/GB`]);
    expect(m.fetch.mock.calls[0]![1]).toMatchObject({ hostAllowlist: refreshDefaults.hostAllowlist, allowHttp: false, timeoutMs: refreshDefaults.fetchTimeoutMs });
  });
  it('records an uncovered country with zero and leaves a failing one for a later run', async () => {
    m.query.mockResolvedValueOnce([{ country: 'FR' }, { country: 'ZZ' }]).mockResolvedValueOnce([]);
    m.config.mockResolvedValue({ ...refreshDefaults, holidayYearsAhead: 0 });
    m.fetch.mockResolvedValueOnce(ok('', 404)).mockResolvedValueOnce(ok('', 503));
    const result = await refreshHolidays({ now });
    expect(result).toMatchObject({ attempted: 2, stored: 1, failed: 1 });
    expect(formatRefreshSummary(result)).toBe('countries=2 attempted=2 stored=1 failed=1');
  });
  it('counts a transport error as failed without stopping the others', async () => {
    m.query.mockResolvedValueOnce([{ country: 'FR' }, { country: 'DE' }]).mockResolvedValueOnce([]);
    m.config.mockResolvedValue({ ...refreshDefaults, holidayYearsAhead: 0 });
    m.fetch.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok([]));
    expect(await refreshHolidays({ now })).toMatchObject({ attempted: 2, stored: 1, failed: 1 });
  });
});

describe('trend job', () => {
  it('refreshes only countries whose list has aged and replaces the list atomically', async () => {
    m.query.mockResolvedValueOnce([{ country: 'FR' }, { country: 'GB' }]).mockResolvedValueOnce([{ country: 'FR', fetchedAt: new Date('2026-10-22T09:30:00Z') }]);
    m.fetch.mockResolvedValue(ok('<item><title>Topic</title></item>'));
    const result = await refreshTrends({ now });
    expect(result).toMatchObject({ attempted: 1, stored: 1 });
    expect(m.fetch.mock.calls[0]![0]).toBe(`${refreshDefaults.trendsUrl}?geo=GB`);
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });
  it('keeps the previous list when the source returns nothing usable', async () => {
    m.query.mockResolvedValueOnce([{ country: 'GB' }]).mockResolvedValueOnce([]);
    m.fetch.mockResolvedValue(ok('<rss></rss>'));
    expect(await refreshTrends({ now })).toMatchObject({ stored: 0, failed: 1 });
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

describe('manifest and queue integration', () => {
  it('declares both jobs against registered schedule keys', () => {
    expect(CALENDAR_EXTRAS_JOBS.map(j => j.configKey)).toEqual(['calendarExtras.holidaysSchedule', 'calendarExtras.trendsSchedule']);
  });
  it('shapes only new queue slots by season rules', () => {
    // 2026-10-26 is a Monday; a pause season removes the day, a shift moves it.
    const season = (rule: 'pause' | 'shift', extra = {}) => ({ id: 's', name: 'S', startsOn: '2026-10-26', endsOn: '2026-10-26', targetIds: [], rule, shiftMinutes: 60, extraTimes: [], ...extra });
    const slots = [{ dayOfWeek: 1, hour: 9, minute: 0 }, { dayOfWeek: 2, hour: 9, minute: 0 }];
    const base = { slots, timeZone: 'UTC', takenUtc: [], now: new Date('2026-10-25T12:00:00Z'), horizonDays: 7 };
    expect(nextAvailableSlot(base)?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(nextAvailableSlot({ ...base, adjustDay: seasonAdjuster([season('pause')], ['t1'])! })?.toISOString()).toBe('2026-10-27T09:00:00.000Z');
    expect(nextAvailableSlot({ ...base, adjustDay: seasonAdjuster([season('shift')], ['t1'])! })?.toISOString()).toBe('2026-10-26T10:00:00.000Z');
    expect(seasonAdjuster([], ['t1'])).toBeUndefined();
    expect(adjustDaySlots([{ hour: 9, minute: 0 }], [season('pause')], ['t1'], '2026-10-26')).toEqual([]);
  });
});
