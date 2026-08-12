import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Retention for the tables that only ever grow.
 *
 * The interesting assertions here are the *exclusions*. Pruning the RSS
 * de-duplication ledger would make a feed republish its entire archive to a
 * client's page, and pruning insight snapshots would throw away the two years of
 * history the analytics module exists to preserve. Both are easy to sweep by
 * accident when someone later adds "and anything else old", so both are pinned.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let housekeeping: typeof import('../src/lib/housekeeping');
let links: typeof import('../src/lib/links');
let settings: typeof import('../src/lib/settings');

const now = new Date('2026-09-01T10:00:00Z');
/** Comfortably past every default retention window. */
const ancient = new Date('2024-01-01T10:00:00Z');
/** Ten days old: inside every default window, outside the shortest allowed. */
const recent = new Date('2026-08-22T10:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('housekeeping');

  ({ prisma } = await import('../src/lib/prisma'));
  housekeeping = await import('../src/lib/housekeeping');
  links = await import('../src/lib/links');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.appSetting.deleteMany();
  settings.invalidateSettings();
  await settings.ensureSettings();

  await prisma.linkClick.deleteMany();
  await prisma.shortLink.deleteMany();
  await prisma.aiGeneration.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.pageInsight.deleteMany();
  await prisma.feedItem.deleteMany();
  await prisma.feedSource.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(label = 'client') {
  const suffix = randomBytes(3).toString('hex');

  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: label,
      slug: `${label}-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });

  return { user, workspace };
}

/** One old row and one recent row in each swept table. */
async function fill(workspaceId: string, userId: string) {
  for (const createdAt of [ancient, recent]) {
    await prisma.activityLog.create({
      data: { workspaceId, action: 'post.published', createdAt },
    });
    await prisma.emailLog.create({
      data: {
        workspaceId,
        to: 'someone@example.com',
        template: 'postFailed',
        subject: 'A post failed',
        status: 'sent',
        createdAt,
      },
    });
    await prisma.aiGeneration.create({
      data: {
        workspaceId,
        userId,
        kind: 'generate',
        prompt: 'p',
        output: 'o',
        model: 'claude-sonnet-5',
        createdAt,
      },
    });
  }

  const link = await prisma.shortLink.create({
    data: {
      workspaceId,
      slug: randomBytes(4).toString('hex'),
      targetUrl: 'https://example.com',
      clickCount: 2,
    },
  });
  for (const createdAt of [ancient, recent]) {
    await prisma.linkClick.create({ data: { shortLinkId: link.id, createdAt } });
  }

  return { link };
}

describe('pruneHistory', () => {
  it('removes what is past its window and keeps what is not', async () => {
    const { workspace, user } = await seed();
    await fill(workspace.id, user.id);

    const result = await housekeeping.pruneHistory({ workspaceId: workspace.id, now });

    expect(result).toEqual({
      activityLogs: 1,
      emailLogs: 1,
      linkClicks: 1,
      aiGenerations: 1,
    });

    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.emailLog.count()).toBe(1);
    expect(await prisma.aiGeneration.count()).toBe(1);
    expect(await prisma.linkClick.count()).toBe(1);
  });

  it('leaves the click total alone when it deletes the detail', async () => {
    // The headline number lives on the link, so pruning costs the day-by-day
    // breakdown and nothing a report leads with.
    const { workspace, user } = await seed();
    const { link } = await fill(workspace.id, user.id);

    await housekeeping.pruneHistory({ workspaceId: workspace.id, now });

    expect((await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } })).clickCount).toBe(2);
  });

  it('honours a retention window set on the config screen', async () => {
    const { workspace, user } = await seed();
    await fill(workspace.id, user.id);

    // Seven days is the shortest window the registry allows, and the recent
    // row is ten days old, so it now falls outside.
    await settings.writeSetting('retention.activityDays', 7, null);
    await settings.ensureSettings();

    const result = await housekeeping.pruneHistory({ workspaceId: workspace.id, now });
    expect(result.activityLogs).toBe(2);
    // The others keep their own, longer, windows.
    expect(result.emailLogs).toBe(1);
  });

  it('never touches another workspace', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');
    await fill(theirs.workspace.id, theirs.user.id);

    const result = await housekeeping.pruneHistory({ workspaceId: mine.workspace.id, now });

    expect(housekeeping.prunedTotal(result)).toBe(0);
    expect(await prisma.activityLog.count()).toBe(2);
    expect(await prisma.linkClick.count()).toBe(2);
  });

  it('does nothing on a workspace with no history', async () => {
    const { workspace } = await seed();
    const result = await housekeeping.pruneHistory({ workspaceId: workspace.id, now });
    expect(housekeeping.prunedTotal(result)).toBe(0);
  });
});

describe('what must never be pruned', () => {
  it('keeps the RSS de-duplication ledger, however old', async () => {
    // Its guids are what stop a feed republishing its archive. Pruning them
    // would flood a client's page with years-old articles.
    const { workspace } = await seed();
    const source = await prisma.feedSource.create({
      data: { workspaceId: workspace.id, url: 'https://example.com/feed.xml', name: 'Blog' },
    });
    await prisma.feedItem.create({
      data: { feedSourceId: source.id, guid: 'ancient-article', createdAt: ancient },
    });

    await housekeeping.pruneHistory({ workspaceId: workspace.id, now });

    expect(await prisma.feedItem.count()).toBe(1);
  });

  it('keeps insight snapshots, which are the reason the module exists', async () => {
    // Graph serves about two years of history; these are the copy that
    // outlives it.
    const { workspace } = await seed();
    const target = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'page',
        providerId: 'page-1',
        name: 'Client Page',
      },
    });
    await prisma.pageInsight.create({
      data: {
        targetId: target.id,
        metric: 'page_impressions',
        period: 'day',
        endTime: ancient,
        value: 100,
        numeric: 100,
      },
    });

    await housekeeping.pruneHistory({ workspaceId: workspace.id, now });

    expect(await prisma.pageInsight.count()).toBe(1);
  });
});

describe('the housekeeping job', () => {
  it('reports nothing when there is nothing to do', async () => {
    const jobs = await import('../src/lib/scheduler/jobs');
    await seed();

    expect(await jobs.runHousekeeping({ now, logger: () => undefined })).toBeNull();
  });

  it('summarises what it pruned', async () => {
    const jobs = await import('../src/lib/scheduler/jobs');
    const { workspace, user } = await seed();
    await fill(workspace.id, user.id);

    const summary = await jobs.runHousekeeping({ now, logger: () => undefined });
    expect(summary).toMatch(/pruned 4 record/);
  });

  it('is scheduled at the configured interval', async () => {
    const jobs = await import('../src/lib/scheduler/jobs');

    await settings.writeSetting('retention.sweepHours', 6, null);
    await settings.ensureSettings();

    const job = jobs.jobDefinitions().find((entry) => entry.name === 'housekeeping');
    expect(job?.intervalMs).toBe(6 * 60 * 60 * 1000);
  });
});

/**
 * What counts as a click.
 *
 * One person arriving at the destination, not one page load. The number ends
 * up in a report a client reads, so a visitor who refreshes, or taps back and
 * forward a few times, must not read as a campaign that worked.
 */
describe('recording a click', () => {
  async function seedLink() {
    const workspace = await prisma.workspace.create({
      data: { name: 'Clicks', slug: `clicks-${randomBytes(4).toString('hex')}`, timezone: 'UTC' },
    });
    return prisma.shortLink.create({
      data: {
        workspaceId: workspace.id,
        slug: randomBytes(4).toString('hex'),
        targetUrl: 'https://example.com/article',
      },
    });
  }

  const visitor = (link: { id: string }, ip: string | null, at?: Date) =>
    links.recordClick({ shortLinkId: link.id, ip, userAgent: 'Mozilla/5.0', referer: null, now: at });

  it('counts a visitor arriving', async () => {
    const link = await seedLink();
    await visitor(link, '203.0.113.7');

    const after = await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.clickCount).toBe(1);
    expect(await prisma.linkClick.count({ where: { shortLinkId: link.id } })).toBe(1);
  });

  it('does not count the same visitor refreshing', async () => {
    const link = await seedLink();
    const at = new Date('2026-09-01T10:00:00Z');

    await visitor(link, '203.0.113.7', at);
    for (let refresh = 1; refresh <= 5; refresh += 1) {
      await visitor(link, '203.0.113.7', new Date(at.getTime() + refresh * 60_000));
    }

    // Six page loads, one person, one click.
    const after = await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.clickCount).toBe(1);
  });

  it('counts two different visitors separately', async () => {
    const link = await seedLink();
    await visitor(link, '203.0.113.7');
    await visitor(link, '203.0.113.8');

    const after = await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.clickCount).toBe(2);
  });

  it('counts the same visitor again once the window has passed', async () => {
    const link = await seedLink();
    const at = new Date('2026-09-01T10:00:00Z');

    await visitor(link, '203.0.113.7', at);
    await visitor(link, '203.0.113.7', new Date(at.getTime() + links.CLICK_DEDUPE_MS + 1000));

    // Coming back an hour later is a second visit, not a refresh.
    const after = await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.clickCount).toBe(2);
  });

  it('does not let one link suppress a click on another', async () => {
    const first = await seedLink();
    const second = await seedLink();

    await visitor(first, '203.0.113.7');
    await visitor(second, '203.0.113.7');

    expect((await prisma.shortLink.findUniqueOrThrow({ where: { id: first.id } })).clickCount).toBe(1);
    expect((await prisma.shortLink.findUniqueOrThrow({ where: { id: second.id } })).clickCount).toBe(1);
  });

  it('counts every load when there is no address to recognise', async () => {
    const link = await seedLink();
    await visitor(link, null);
    await visitor(link, null);

    // Nothing to tell these apart. Counting both overstates by a little;
    // folding them together would merge every anonymous visitor into one.
    const after = await prisma.shortLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.clickCount).toBe(2);
  });
});
