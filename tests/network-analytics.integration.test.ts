import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let readNetworkPosts: typeof import('../src/lib/network-analytics')['readNetworkPosts'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('network_analytics');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ readNetworkPosts } = await import('../src/lib/network-analytics'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('other-network reporting', () => {
  it('reads past 500 published posts without dropping totals or selected-channel scope', async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', passwordHash: 'x' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Agency', slug: 'agency', timezone: 'UTC' } });
    const target = await prisma.target.create({ data: {
      workspaceId: workspace.id, type: 'bluesky', providerId: 'did:plc:reporting', name: 'Selected',
    } });
    const other = await prisma.target.create({ data: {
      workspaceId: workspace.id, type: 'bluesky', providerId: 'did:plc:other', name: 'Not selected',
    } });
    await prisma.post.createMany({ data: Array.from({ length: 501 }, (_, index) => ({
      workspaceId: workspace.id, authorId: owner.id, message: `Post ${index}`, status: 'published',
    })) });
    const posts = await prisma.post.findMany({ where: { workspaceId: workspace.id }, select: { id: true } });
    const publishedAt = new Date('2026-10-01T12:00:00Z');
    await prisma.postTarget.createMany({ data: [
      ...posts.map((post) => ({ postId: post.id, targetId: target.id, status: 'published' as const, publishedAt, insights: { reactions: 1 } })),
      { postId: posts[0]!.id, targetId: other.id, status: 'published', publishedAt, insights: { reactions: 99 } },
    ] });

    const rows = await readNetworkPosts({
      workspaceId: workspace.id, scope: { all: false, ids: [target.id] },
      from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z'),
    });
    expect(rows).toHaveLength(501);
    expect(rows.reduce((sum, row) => sum + (row.likes ?? 0), 0)).toBe(501);
    expect(rows.every((row) => row.channel === 'Selected')).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(501);
  });
});
