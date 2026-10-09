import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The audience summary across Meta's switch from Page likes to follows.
 *
 * In November 2025 Meta retired the `page_fans*` and `page_fan_*` metrics on
 * every Graph version. A Page synced since then only has follows; one synced
 * before has only fans. Both must read as an audience, and a Page with both
 * must not count the same people twice.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let analytics: typeof import('../src/lib/analytics');

const from = new Date('2026-09-01T00:00:00Z');
const to = new Date('2026-09-30T23:59:59Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('audience');

  ({ prisma } = await import('../src/lib/prisma'));
  analytics = await import('../src/lib/analytics');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.pageInsight.deleteMany();
  await prisma.target.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seedPage() {
  const suffix = randomBytes(3).toString('hex');
  const workspace = await prisma.workspace.create({
    data: { name: 'client', slug: `client-${suffix}`, timezone: 'UTC' },
  });
  return prisma.target.create({
    data: { workspaceId: workspace.id, type: 'page', providerId: `page-${suffix}`, name: 'Page' },
  });
}

async function insight(
  targetId: string,
  metric: string,
  value: number | Record<string, number>,
  endTime = new Date('2026-09-15T07:00:00Z'),
) {
  await prisma.pageInsight.create({
    data: {
      targetId,
      metric,
      period: typeof value === 'number' ? 'day' : 'lifetime',
      endTime,
      value,
      numeric: typeof value === 'number' ? value : null,
    },
  });
}

describe('readAudience', () => {
  it('reads follows for a Page synced since Meta retired Page likes', async () => {
    const target = await seedPage();
    await insight(target.id, 'page_follows_country', { MA: 120, FR: 40 });
    await insight(target.id, 'page_follows_city', { 'Casablanca, Morocco': 70 });
    await insight(target.id, 'page_daily_follows_unique', 9);
    await insight(target.id, 'page_daily_unfollows_unique', 2);

    const audience = await analytics.readAudience({ targetId: target.id, from, to });

    expect(audience.byCountry).toEqual({ MA: 120, FR: 40 });
    expect(audience.byCity).toEqual({ 'Casablanca, Morocco': 70 });
    expect(audience.adds).toBe(9);
    expect(audience.removes).toBe(2);
    expect(audience.net).toBe(7);
  });

  it('still reads Page likes stored before the switch', async () => {
    const target = await seedPage();
    await insight(target.id, 'page_fans_country', { MA: 100 });
    await insight(target.id, 'page_fan_adds', 5);
    await insight(target.id, 'page_fan_removes', 1);

    const audience = await analytics.readAudience({ targetId: target.id, from, to });

    expect(audience.byCountry).toEqual({ MA: 100 });
    expect(audience.adds).toBe(5);
    expect(audience.removes).toBe(1);
  });

  it('prefers follows over likes rather than adding the two', async () => {
    // Follows and likes count largely the same people; summing them would
    // roughly double the Page's growth.
    const target = await seedPage();
    await insight(target.id, 'page_follows_country', { MA: 120 });
    await insight(target.id, 'page_fans_country', { MA: 100 });
    await insight(target.id, 'page_daily_follows_unique', 9);
    await insight(target.id, 'page_fan_adds', 5);

    const audience = await analytics.readAudience({ targetId: target.id, from, to });

    expect(audience.byCountry).toEqual({ MA: 120 });
    expect(audience.adds).toBe(9);
  });
});
