import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Post version history (NEXT_PHASES H9): creating and editing a post each keep
 * a version, a save that changes nothing versioned keeps none, and a post keeps
 * at most MAX_VERSIONS.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let posts: typeof import('../src/lib/posts');
let versions: typeof import('../src/lib/post-versions');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('post_versions');
  ({ prisma } = await import('../src/lib/prisma'));
  posts = await import('../src/lib/posts');
  versions = await import('../src/lib/post-versions');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('post versions', () => {
  it('keeps one version per save that changes the post, newest first, capped', async () => {
    const stamp = `${Date.now()}`;
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}`, timezone: 'UTC' } });
    const owner = await prisma.user.create({ data: { email: `owner-${stamp}@example.test`, name: 'Owner', passwordHash: 'x' } });
    await prisma.membership.create({ data: { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner } });
    const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `p-${stamp}`, name: 'Page 1' } });
    const context = { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner, requiresApproval: false };

    const created = await posts.createPost(context, {
      message: 'Product launch on Friday',
      media: [],
      targetIds: [page.id],
      publishMode: 'worker',
      timezone: 'UTC',
      useQueue: false,
      saveAsDraft: true,
    });
    await posts.updatePost(context, created.postId, { message: 'Product launch on Monday' });
    // Only an unversioned setting: no new version.
    await posts.updatePost(context, created.postId, { firstCommentDelayMinutes: 5 });

    const listed = await versions.listVersions(created.postId, 'UTC');
    expect(listed.map((version) => version.message)).toEqual(['Product launch on Monday', 'Product launch on Friday']);
    expect(listed[0]).toMatchObject({ authorName: 'Owner', targetIds: [page.id], scheduledAtLocal: null });

    for (let index = 0; index < versions.MAX_VERSIONS + 3; index += 1) {
      await prisma.post.update({ where: { id: created.postId }, data: { message: `Edit ${index}` } });
      await versions.recordVersion(created.postId, owner.id);
    }
    expect(await prisma.postVersion.count({ where: { postId: created.postId } })).toBe(versions.MAX_VERSIONS);
    expect((await versions.listVersions(created.postId, 'UTC'))[0]!.message).toBe(`Edit ${versions.MAX_VERSIONS + 2}`);
  });
});
