import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Undo send: "Publish now" is held for the workspace's
 * delay as a worker post; until then it can go back to the drafts, after
 * that it cannot.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let posts: typeof import('../src/lib/posts');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('undo_send');
  ({ prisma } = await import('../src/lib/prisma'));
  posts = await import('../src/lib/posts');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('undo send', () => {
  it('holds "Publish now", takes it back before the time, and refuses after', async () => {
    const user = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', passwordHash: 'x' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-undo', timezone: 'UTC' } });
    const target = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'p', name: 'Client A Page' } });
    const now = new Date();
    const context = { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner, requiresApproval: false, undoSendSeconds: 30 };
    const input = { message: 'Hello', targetIds: [target.id], media: [], publishMode: 'immediate' as const, timezone: 'UTC', useQueue: false, saveAsDraft: false };

    const held = await posts.createPost(context, input, now);
    expect(held.status).toBe('scheduled');
    expect(held.undoUntil?.getTime()).toBe(now.getTime() + 30_000);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: held.postId } })).toMatchObject({ publishMode: 'worker', status: 'scheduled' });

    expect(await posts.undoSend(workspace.id, held.postId, new Date(now.getTime() + 10_000))).toBe(true);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: held.postId } })).toMatchObject({ status: 'draft', scheduledAt: null });

    const late = await posts.createPost(context, input, now);
    expect(await posts.undoSend(workspace.id, late.postId, new Date(now.getTime() + 31_000))).toBe(false);
    expect(await posts.undoSend('another-workspace', late.postId, now)).toBe(false);

    // A scheduled post is not something "Undo" can reach.
    const later = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 16);
    const scheduled = await posts.createPost(context, { ...input, publishMode: 'worker', scheduledAtLocal: later }, now);
    expect(scheduled.undoUntil).toBeUndefined();
  });
});
