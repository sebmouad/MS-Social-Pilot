import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Acting on several selected posts at once: each post keeps its own rules. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let bulk: typeof import('../src/lib/post-bulk');
let context: Parameters<typeof import('../src/lib/post-bulk')['bulkPostAction']>[0];
const ids: Record<string, string> = {};

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('post_bulk');
  ({ prisma } = await import('../src/lib/prisma'));
  bulk = await import('../src/lib/post-bulk');

  const author = await prisma.user.create({ data: { email: 'a@example.test', name: 'A', passwordHash: 'x' } });
  const other = await prisma.user.create({ data: { email: 'b@example.test', name: 'B', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', timezone: 'UTC' } });
  const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'p', name: 'Page' } });
  const at = new Date(Date.now() + 3 * 86_400_000);
  at.setUTCHours(10, 30, 0, 0);
  const make = async (key: string, authorId: string, status: 'scheduled' | 'published') => {
    ids[key] = (
      await prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId,
          message: key,
          status,
          scheduledAt: at,
          timezone: 'UTC',
          targets: { create: { targetId: page.id, status: status === 'published' ? 'published' : 'pending' } },
        },
      })
    ).id;
  };
  await make('mine', author.id, 'scheduled');
  await make('mine2', author.id, 'scheduled');
  await make('theirs', other.id, 'scheduled');
  await make('out', author.id, 'published');
  ids.label = (await prisma.label.create({ data: { workspaceId: workspace.id, name: 'Launch', color: 'blue' } })).id;
  context = {
    workspaceId: workspace.id,
    userId: author.id,
    role: WorkspaceRole.contributor,
    requiresApproval: false,
    pageScope: { all: true },
  };
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('bulk post actions', () => {
  it('moves by whole days and keeps the time', () => {
    expect(bulk.shiftedLocal(new Date('2026-10-30T22:30:00Z'), 'Europe/Paris', 2)).toBe('2026-11-01T23:30');
  });

  it('moves the posts it may, and reports the others', async () => {
    const before = (await prisma.post.findUniqueOrThrow({ where: { id: ids.mine! } })).scheduledAt!;
    const result = await bulk.bulkPostAction(context, [ids.mine!, ids.theirs!, ids.out!], { kind: 'shift', days: 7 });
    expect(result.done).toBe(1);
    expect(result.failed.map((entry) => entry.id).sort()).toEqual([ids.theirs, ids.out].sort());
    const after = (await prisma.post.findUniqueOrThrow({ where: { id: ids.mine! } })).scheduledAt!;
    expect(after.getTime() - before.getTime()).toBe(7 * 86_400_000);
  });

  it('labels and unlabels, published posts included', async () => {
    expect((await bulk.bulkPostAction(context, [ids.mine!, ids.out!], { kind: 'label', labelId: ids.label!, add: true })).done).toBe(2);
    expect(await prisma.postLabel.count({ where: { labelId: ids.label! } })).toBe(2);
    await bulk.bulkPostAction(context, [ids.out!], { kind: 'label', labelId: ids.label!, add: false });
    expect(await prisma.postLabel.count({ where: { labelId: ids.label! } })).toBe(1);
  });

  it('cancels its own posts only', async () => {
    const result = await bulk.bulkPostAction(context, [ids.mine2!, ids.theirs!], { kind: 'cancel' });
    expect(result.done).toBe(1);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: ids.mine2! } })).status).toBe('cancelled');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: ids.theirs! } })).status).toBe('scheduled');
  });
});
