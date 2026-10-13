import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Short-link click analytics: clicks per day, Page, article
 * and post, following the selected Pages.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let loadLinkClicks: typeof import('../src/lib/link-analytics')['loadLinkClicks'];
let articleUrl: typeof import('../src/lib/link-analytics')['articleUrl'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('link_analytics');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ loadLinkClicks, articleUrl } = await import('../src/lib/link-analytics'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.linkClick.deleteMany();
  await prisma.shortLink.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

describe('articleUrl', () => {
  it('drops tracking tags, the fragment and a trailing slash', () => {
    expect(articleUrl('https://example.com/a/?utm_source=fb&utm_medium=social&id=4#top')).toBe('https://example.com/a?id=4');
    expect(articleUrl('https://example.com/b/?fbclid=xyz')).toBe('https://example.com/b');
    expect(articleUrl('https://example.com/')).toBe('https://example.com/');
    expect(articleUrl('not a url')).toBe('not a url');
  });
});

describe('loadLinkClicks', () => {
  it('counts clicks per day, Page, article and post, for the chosen Pages only', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
    const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
    const pageA = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'a', name: 'Page A' } });
    const pageB = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'b', name: 'Page B' } });
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Product launch\nMore inside',
        targets: {
          create: [
            { targetId: pageA.id, insights: { impressions: 2000 } },
            { targetId: pageB.id, insights: { impressions: 1000 } },
          ],
        },
      },
    });
    // One link per Page, plus an older link with no Page (counts for the post's first Page).
    const onA = await prisma.shortLink.create({
      data: { workspaceId: workspace.id, slug: 'a1', targetUrl: 'https://example.com/launch?utm_source=a', postId: post.id, targetId: pageA.id },
    });
    const onB = await prisma.shortLink.create({
      data: { workspaceId: workspace.id, slug: 'b1', targetUrl: 'https://example.com/launch?utm_source=b', postId: post.id, targetId: pageB.id },
    });
    const older = await prisma.shortLink.create({
      data: { workspaceId: workspace.id, slug: 'o1', targetUrl: 'https://example.com/other', postId: post.id },
    });
    const click = (shortLinkId: string, at: string) => ({ shortLinkId, createdAt: new Date(at) });
    await prisma.linkClick.createMany({
      data: [
        click(onA.id, '2026-10-01T10:00:00Z'),
        click(onA.id, '2026-10-01T23:30:00Z'), // 2 October in Paris.
        click(onB.id, '2026-10-02T09:00:00Z'),
        click(older.id, '2026-10-02T09:00:00Z'),
        click(onA.id, '2026-09-20T09:00:00Z'), // Outside the period.
      ],
    });

    const range = { workspaceId: workspace.id, from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z'), timezone: 'Europe/Paris' };
    const all = await loadLinkClicks({ ...range, targetIds: null });
    expect(all.total).toBe(4);
    expect(all.byDay).toEqual([
      { day: '2026-10-01', clicks: 1 },
      { day: '2026-10-02', clicks: 3 },
    ]);
    expect(all.byPage).toEqual([
      { targetId: pageA.id, name: 'Page A', clicks: 3 },
      { targetId: pageB.id, name: 'Page B', clicks: 1 },
    ]);
    expect(all.byArticle).toEqual([
      { url: 'https://example.com/launch', clicks: 3 },
      { url: 'https://example.com/other', clicks: 1 },
    ]);
    expect(all.byPost).toHaveLength(1);
    expect(all.byPost[0]).toMatchObject({ postId: post.id, clicks: 4, views: 3000 });
    expect(all.byPost[0]!.perThousand).toBeCloseTo(4 / 3);
    expect(all.byPost[0]!.postTargetId).toBeTruthy();

    const onlyB = await loadLinkClicks({ ...range, targetIds: [pageB.id] });
    expect(onlyB.total).toBe(1);
    expect(onlyB.byPage).toEqual([{ targetId: pageB.id, name: 'Page B', clicks: 1 }]);
    expect(onlyB.byPost[0]).toMatchObject({ clicks: 1, views: 1000, perThousand: 1 });
  });
});
