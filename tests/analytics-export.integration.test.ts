import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The ads export, against a real database.
 *
 * The property pinned here is that money is never summed across currencies.
 * The export used to read the whole workspace in one pass, so two accounts
 * billing in euros and dollars came out as one daily figure with no currency
 * on it — and a spreadsheet adds up whatever it is given.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let exports: typeof import('../src/lib/analytics-export');
let ads: typeof import('../src/lib/ads');

const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('analytics_export');

  ({ prisma } = await import('../src/lib/prisma'));
  exports = await import('../src/lib/analytics-export');
  ads = await import('../src/lib/ads');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.adInsight.deleteMany();
  await prisma.adAccount.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const suffix = randomBytes(3).toString('hex');
  const workspace = await prisma.workspace.create({
    data: { name: 'Client', slug: `client-${suffix}`, timezone: 'UTC' },
  });

  const account = async (actId: string, name: string, currency: string, spend: number, enabled = true) => {
    const created = await prisma.adAccount.create({
      data: { workspaceId: workspace.id, actId, name, currency, enabled },
    });
    const date = new Date('2026-08-10T00:00:00Z');
    await prisma.adInsight.createMany({
      data: [
        { adAccountId: created.id, level: 'account', objectId: actId, date, spend, impressions: 1000, clicks: 10 },
        {
          adAccountId: created.id,
          level: 'campaign',
          objectId: `${actId}-c`,
          objectName: `${name} campaign`,
          date,
          spend,
          impressions: 1000,
          clicks: 10,
        },
        {
          adAccountId: created.id,
          level: 'adset',
          objectId: `${actId}-s`,
          objectName: 'Ad set 1',
          date,
          spend,
          impressions: 1000,
          clicks: 10,
          fields: { campaign_name: `${name} campaign` },
        },
      ],
    });
    return created;
  };

  const euros = await account('act_1', 'Paris', 'EUR', 100);
  const dollars = await account('act_2', 'Boston', 'USD', 40);
  return { workspace, euros, dollars };
}

function parse(csv: string): Array<Record<string, string>> {
  const [head, ...lines] = csv.trim().split('\n');
  const columns = head!.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [columns[index], value])));
}

describe('adsCsv', () => {
  it('never adds two currencies into one figure', async () => {
    const { workspace } = await seed();
    const rows = parse(await exports.adsCsv({ workspaceId: workspace.id, from, to }));

    const daily = rows.filter((row) => row.level === 'account');
    // One row per account per day, each in its own currency — not one row of 140.
    expect(daily.map((row) => [row.ad_account, row.currency, row.spend]).sort()).toEqual([
      ['Boston', 'USD', '40'],
      ['Paris', 'EUR', '100'],
    ]);
    expect(rows.every((row) => row.currency === 'EUR' || row.currency === 'USD')).toBe(true);
    expect(rows.some((row) => row.spend === '140')).toBe(false);
  });

  it('covers only the account asked for', async () => {
    const { workspace, dollars } = await seed();
    const rows = parse(await exports.adsCsv({ workspaceId: workspace.id, from, to, adAccountId: dollars.id }));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.ad_account === 'Boston' && row.currency === 'USD')).toBe(true);
  });

  it('names the campaign an ad set belongs to', async () => {
    const { workspace, euros } = await seed();
    const rows = parse(await exports.adsCsv({ workspaceId: workspace.id, from, to, adAccountId: euros.id }));

    expect(rows.find((row) => row.level === 'adset')?.campaign).toBe('Paris campaign');
  });

  it('leaves a disabled account out of the workspace-wide file', async () => {
    const { workspace, dollars } = await seed();
    await prisma.adAccount.update({ where: { id: dollars.id }, data: { enabled: false } });

    const rows = parse(await exports.adsCsv({ workspaceId: workspace.id, from, to }));
    expect(rows.some((row) => row.ad_account === 'Boston')).toBe(false);
  });
});

describe('listAdAccounts', () => {
  it('offers only enabled accounts unless asked for the rest', async () => {
    const { workspace, dollars } = await seed();
    await prisma.adAccount.update({ where: { id: dollars.id }, data: { enabled: false } });

    expect((await ads.listAdAccounts(workspace.id)).map((account) => account.name)).toEqual(['Paris']);
    expect(
      (await ads.listAdAccounts(workspace.id, { includeDisabled: true })).map((account) => account.name),
    ).toEqual(['Boston', 'Paris']);
  });
});

describe('ad metric details', () => {
  it('keeps latest daily rates separate from period action totals', async () => {
    const { workspace, euros } = await seed();
    await prisma.adInsight.update({
      where: { adAccountId_level_objectId_date: {
        adAccountId: euros.id, level: 'campaign', objectId: 'act_1-c', date: new Date('2026-08-10T00:00:00Z'),
      } },
      data: {
        actions: { actions: [{ action_type: 'link_click', value: '5' }], cost_per_action_type: [{ action_type: 'link_click', value: '2.5' }] },
        fields: { video_p25_watched_actions: '12', campaign_name: 'Paris campaign', campaign_id: '123456789012345678' },
        frequency: 1.5,
      },
    });
    const [row] = await ads.readCampaigns({ workspaceId: workspace.id, adAccountId: euros.id, from, to });
    expect(row?.actions).toEqual({ link_click: 5 });
    expect(row?.latestReading).toMatchObject({ date: '2026-08-10', metrics: {
      frequency: 1.5, video_p25_watched_actions: 12,
      'actions: link_click': 5, 'cost_per_action_type: link_click': 2.5,
    } });
    expect(row?.latestReading?.metrics).not.toHaveProperty('campaign_name');
    expect(row?.latestReading?.metrics).not.toHaveProperty('campaign_id');
  });
});
