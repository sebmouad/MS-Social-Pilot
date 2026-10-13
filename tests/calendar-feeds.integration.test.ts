import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Calendar feeds: a feed shows the Pages it was made for,
 * never more than the member may see now, and dies with a revoke or with the
 * membership.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let feeds: typeof import('../src/lib/calendar-feeds');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('calendar_feeds');
  ({ prisma } = await import('../src/lib/prisma'));
  feeds = await import('../src/lib/calendar-feeds');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

const tokenOf = (url: string) => url.split('/').pop()!;

describe('calendar feeds', () => {
  it('narrows to the chosen Pages and the member’s scope, and stops when revoked or the member leaves', async () => {
    const stamp = `${Date.now()}`;
    const now = new Date('2026-10-12T09:00:00Z');
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}` } });
    const member = await prisma.user.create({ data: { email: `m-${stamp}@example.test`, name: 'Sam Lee', passwordHash: 'x' } });
    const pageA = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `a-${stamp}`, name: 'Page A' } });
    const pageB = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `b-${stamp}`, name: 'Page B' } });
    const membership = await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: WorkspaceRole.editor, allPages: false, pages: { create: { targetId: pageA.id } } },
    });
    const post = (message: string, targetId: string, days: number, status: PostStatus = PostStatus.scheduled) =>
      prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId: member.id,
          message,
          status,
          scheduledAt: new Date(now.getTime() + days * 86_400_000),
          targets: { create: { targetId } },
        },
      });
    await post('Launch on Page A', pageA.id, 2);
    await post('Only on Page B', pageB.id, 2);
    await post('A draft with a time', pageA.id, 3, PostStatus.draft);
    await post('Long ago', pageA.id, -90, PostStatus.published);

    const scope = { all: false as const, ids: [pageA.id] };
    // Page B is outside the member's reach: refused, not dropped.
    await expect(
      feeds.createFeed({ workspaceId: workspace.id, userId: member.id, pageScope: scope, pageIds: [pageB.id], groupId: null, allName: 'All' }),
    ).rejects.toMatchObject({ status: 404 });

    const { url, feed } = await feeds.createFeed({ workspaceId: workspace.id, userId: member.id, pageScope: scope, pageIds: [], groupId: null, allName: 'All' });
    const text = (await feeds.renderFeed(tokenOf(url), now))!;
    expect(text).toContain('SUMMARY:Page A: Launch on Page A');
    expect(text).not.toContain('Only on Page B');
    expect(text).not.toContain('A draft with a time');
    expect(text).not.toContain('Long ago');
    expect((await feeds.listFeeds(workspace.id, member.id))[0]!.lastUsedAt).toBe(now.toISOString());

    expect(await feeds.renderFeed('not-a-real-token-at-all', now)).toBeNull();
    await prisma.membership.delete({ where: { id: membership.id } });
    expect(await feeds.renderFeed(tokenOf(url), now)).toBeNull();

    await feeds.revokeFeed(workspace.id, member.id, feed.id);
    await expect(feeds.revokeFeed(workspace.id, member.id, feed.id)).rejects.toMatchObject({ status: 404 });
  });
});
