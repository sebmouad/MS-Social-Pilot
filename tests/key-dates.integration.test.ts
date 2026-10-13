import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Key dates and seasons: public holidays fetched by the
 * worker for the countries in use, the calendar's key days for the Pages in
 * view, and seasonal modes in the queue.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let holidays: typeof import('../src/lib/holidays');
let keyDaysBetween: typeof import('../src/lib/calendar-days')['keyDaysBetween'];
let allocateQueueSlot: typeof import('../src/lib/posts')['allocateQueueSlot'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('key_dates');
  ({ prisma } = await import('../src/lib/prisma'));
  holidays = await import('../src/lib/holidays');
  ({ keyDaysBetween } = await import('../src/lib/calendar-days'));
  ({ allocateQueueSlot } = await import('../src/lib/posts'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.publicHoliday.deleteMany();
  await prisma.holidayYear.deleteMany();
  await prisma.workspace.deleteMany();
});

const now = new Date('2026-10-12T09:00:00Z');

function fakeFetch(calls: string[]) {
  return (async (url: string) => {
    calls.push(url);
    if (url.includes('/XK')) return new Response(null, { status: 404 });
    if (url.includes('/ZZ')) return new Response('down', { status: 503 });
    const year = url.split('/').at(-2);
    return Response.json([
      { date: `${year}-12-25`, name: 'Christmas Day', localName: 'Noël', global: true },
      { date: `${year}-06-01`, name: 'Regional Day', localName: 'Regional', global: false },
    ]);
  }) as unknown as typeof fetch;
}

describe('public holidays', () => {
  it('are fetched once per country-year in use, nationwide ones only', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-h', audienceCountries: ['FR'] } });
    await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'p', name: 'A', audienceCountries: ['XK', 'ZZ'] } });

    const calls: string[] = [];
    const fetched = await holidays.refreshHolidays(now, fakeFetch(calls));
    expect(calls).toHaveLength(6);
    expect(fetched.sort()).toEqual(['FR:2026', 'FR:2027', 'XK:2026', 'XK:2027']);
    expect(await holidays.holidaysBetween(['FR'], '2026-01-01', '2026-12-31')).toEqual([
      expect.objectContaining({ country: 'FR', date: '2026-12-25', name: 'Christmas Day', localName: 'Noël' }),
    ]);
    expect(await holidays.uncoveredCountries(['FR', 'XK'])).toEqual(['XK']);

    // Fresh ones are not asked again; the one that failed is.
    const again: string[] = [];
    await holidays.refreshHolidays(new Date(now.getTime() + 86_400_000), fakeFetch(again));
    expect(again.map((url) => url.split('/').slice(-2).join('/')).sort()).toEqual(['2026/ZZ', '2027/ZZ']);
  });
});

describe('key days on the calendar', () => {
  it('follow the audiences of the Pages in view, and the team’s own dates', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-k', audienceCalendars: ['international_days'] } });
    const plain = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'p1', name: 'Plain' } });
    const western = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: 'p2', name: 'Western', audienceCalendars: ['christian_western', 'public_holidays'], audienceCountries: ['FR'] },
    });
    await prisma.publicHoliday.create({ data: { country: 'FR', date: '2026-12-25', name: 'Christmas Day', localName: 'Noël' } });
    await prisma.keyDate.createMany({
      data: [
        { workspaceId: workspace.id, date: '2025-12-20', title: 'Anniversary', yearly: true },
        { workspaceId: workspace.id, date: '2026-12-22', title: 'Western launch', targetIds: [western.id] },
      ],
    });

    const forPlain = await keyDaysBetween(workspace.id, [plain.id], '2026-12-15', '2026-12-31');
    expect([...forPlain.entries()].map(([date, days]) => [date, days.map((day) => day.kind)])).toEqual([
      ['2026-12-31', ['computed']],
      ['2026-12-20', ['custom']],
    ]);

    const forWestern = await keyDaysBetween(workspace.id, [western.id], '2026-12-15', '2026-12-31');
    expect(forWestern.get('2026-12-25')?.map((day) => day.kind)).toEqual(['computed', 'holiday']);
    expect(forWestern.get('2026-12-22')).toEqual([expect.objectContaining({ kind: 'custom', title: 'Western launch' })]);
    // Its own calendars replace the workspace's: no New Year's Eve here.
    expect(forWestern.has('2026-12-31')).toBe(false);
  });
});

describe('seasonal modes in the queue', () => {
  it('skip paused days and move shifted times, for their Pages only', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-s', timezone: 'UTC' } });
    const a = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'a', name: 'A' } });
    const b = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'b', name: 'B' } });
    await prisma.queueSlot.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ workspaceId: workspace.id, dayOfWeek, hour: 10, minute: 0 })) });
    await prisma.seasonalMode.createMany({
      data: [
        { workspaceId: workspace.id, name: 'Break', startsOn: '2026-10-12', endsOn: '2026-10-13', targetIds: [a.id], rule: 'pause' },
        { workspaceId: workspace.id, name: 'Later', startsOn: '2026-10-12', endsOn: '2026-10-20', targetIds: [b.id], rule: 'shift', shiftMinutes: 120 },
      ],
    });
    const slot = (ids: string[]) => prisma.$transaction((tx) => allocateQueueSlot(tx, workspace.id, 'UTC', now, ids));
    expect((await slot([a.id])).toISOString()).toBe('2026-10-14T10:00:00.000Z');
    expect((await slot([b.id])).toISOString()).toBe('2026-10-12T12:00:00.000Z');
  });
});
