import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Internal notes (NEXT_PHASES H8): a note emails only the members it really
 * mentions who may see the post, never its author; only its author or an
 * editor removes it.
 */

const mentions: string[][] = [];
vi.mock('../src/lib/email/notify', async (original) => ({
  ...(await original<typeof import('../src/lib/email/notify')>()),
  notifyNoteMention: async (options: { userIds: string[] }) => {
    mentions.push(options.userIds);
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let notes: typeof import('../src/lib/post-notes');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('post_notes');
  ({ prisma } = await import('../src/lib/prisma'));
  notes = await import('../src/lib/post-notes');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('post notes', () => {
  it('mentions only members who may see the post, and guards removal', async () => {
    const stamp = `${Date.now()}`;
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}` } });
    const user = (name: string) => prisma.user.create({ data: { email: `${name}-${stamp}@example.test`, name, passwordHash: 'x' } });
    const [owner, writer, outsider] = [await user('Alex Morgan'), await user('Sam Lee'), await user('Kim Park')];
    const pageA = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `a-${stamp}`, name: 'Page A' } });
    const pageB = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `b-${stamp}`, name: 'Page B' } });
    await prisma.membership.create({ data: { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner } });
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: writer.id, role: WorkspaceRole.contributor, allPages: false, pages: { create: { targetId: pageA.id } } },
    });
    // Kim may only see Page B, so cannot be mentioned on a Page A post.
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: outsider.id, role: WorkspaceRole.contributor, allPages: false, pages: { create: { targetId: pageB.id } } },
    });
    const post = await prisma.post.create({
      data: { workspaceId: workspace.id, authorId: writer.id, message: 'Product launch', targets: { create: { targetId: pageA.id } } },
    });

    expect((await notes.postMembers(workspace.id, post.id)).map((member) => member.name)).toEqual(['Alex Morgan', 'Sam Lee']);

    const note = await notes.addNote({
      workspaceId: workspace.id,
      postId: post.id,
      author: { id: writer.id, name: writer.name },
      input: { body: '@Alex Morgan @Kim Park @Sam Lee check the price', mentionIds: [owner.id, outsider.id, writer.id] },
    });
    expect(mentions).toEqual([[owner.id]]);
    expect(await notes.listNotes(post.id)).toMatchObject([{ id: note.id, authorName: 'Sam Lee' }]);

    const scope = { all: true } as const;
    await expect(
      notes.deleteNote({ workspaceId: workspace.id, pageScope: scope, noteId: note.id, userId: outsider.id, role: WorkspaceRole.contributor }),
    ).rejects.toMatchObject({ status: 404 });
    await notes.deleteNote({ workspaceId: workspace.id, pageScope: scope, noteId: note.id, userId: owner.id, role: WorkspaceRole.owner });
    expect(await prisma.postNote.count()).toBe(0);
  });
});
