import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Inbox response time read from stored comments and
 * messages: per Page, per member, and only the asked Pages of the workspace.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let reader: typeof import('../src/lib/inbox-response');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('inbox_response');
  ({ prisma } = await import('../src/lib/prisma'));
  reader = await import('../src/lib/inbox-response');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

const at = (time: string) => new Date(`2026-10-05T${time}:00Z`);
const MINUTE = 60_000;

describe('inbox response time', () => {
  it('measures comments and messages per Page and per member, inside the asked Pages only', async () => {
    const stamp = `${Date.now()}`;
    const user = await prisma.user.create({ data: { email: `editor-${stamp}@example.com`, name: 'Editor One', passwordHash: 'x' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}`, timezone: 'UTC' } });
    const other = await prisma.workspace.create({ data: { name: 'Client B', slug: `client-b-${stamp}`, timezone: 'UTC' } });
    const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'page-a', name: 'Page A' } });
    const foreign = await prisma.target.create({ data: { workspaceId: other.id, type: 'page', providerId: 'page-b', name: 'Page B' } });

    const post = await prisma.post.create({ data: { workspaceId: workspace.id, authorId: user.id, message: 'Product launch' } });
    const postTarget = await prisma.postTarget.create({ data: { postId: post.id, targetId: page.id } });
    await prisma.postComment.createMany({
      data: [
        { postTargetId: postTarget.id, remoteId: 'c1', fromId: 'fan', message: 'Price?', createdTime: at('10:00') },
        { postTargetId: postTarget.id, remoteId: 'r1', parentRemoteId: 'c1', fromId: 'page-a', message: 'Sent you a message', createdTime: at('10:20'), sentById: user.id },
        { postTargetId: postTarget.id, remoteId: 'c2', fromId: 'fan2', message: 'Nice', createdTime: at('11:00') },
      ],
    });
    const thread = await prisma.conversation.create({ data: { targetId: page.id, remoteId: 't1', updatedTime: at('12:00'), resolvedAt: at('13:00') } });
    await prisma.conversationMessage.createMany({
      data: [
        { conversationId: thread.id, remoteId: 'm1', fromId: 'fan', message: 'Hello', createdTime: at('11:00') },
        { conversationId: thread.id, remoteId: 'm2', fromId: 'page-a', message: 'Hi', createdTime: at('12:00') },
      ],
    });

    const result = await reader.readResponseTimes({
      workspaceId: workspace.id,
      targetIds: [page.id, foreign.id],
      from: at('00:00'),
      to: new Date('2026-10-06T00:00:00Z'),
      timeZone: 'UTC',
      hours: null,
    });

    expect(result.pages.map((entry) => entry.name)).toEqual(['Page A']);
    const [summary] = result.pages;
    expect(summary!.comments).toMatchObject({ total: 2, answered: 1, medianFirstMs: 20 * MINUTE });
    expect(summary!.messages).toMatchObject({ total: 1, answered: 1, medianFirstMs: 60 * MINUTE, resolved: 1, medianResolveMs: 120 * MINUTE });
    expect(result.members).toEqual([
      expect.objectContaining({ userId: user.id, name: 'Editor One', summary: expect.objectContaining({ answered: 1 }) }),
      expect.objectContaining({ userId: null, summary: expect.objectContaining({ answered: 1 }) }),
    ]);
  });

  it('counts business hours only when the workspace sets them', () => {
    expect(reader.businessHoursOf({ businessDays: [], businessStart: 9, businessEnd: 18 })).toBeNull();
    expect(reader.businessHoursOf({ businessDays: [1, 2], businessStart: 9, businessEnd: 18 })).toEqual({ days: [1, 2], start: 9, end: 18 });
  });
});
