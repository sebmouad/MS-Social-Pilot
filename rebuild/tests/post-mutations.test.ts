import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  post: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { createLocalDraft, deleteLocalDraft, updateLocalDraft } from '../src/server/post-mutations';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.create.mockResolvedValue({ id: 'new-id' });
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.post.deleteMany.mockResolvedValue({ count: 1 });
});

describe('local draft mutation boundaries', () => {
  it('creates a local-only draft in the actor workspace without scheduling or destination rows', async () => {
    await createLocalDraft(actor, 'Draft text');
    const createArgs = db.post.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({ workspaceId: 'w1', authorId: 'u1', status: 'draft', scheduledAt: null, publishedAt: null });
    expect(createArgs.data).not.toHaveProperty('targets');
    expect(db.membership.findUnique.mock.calls[0][0].where.userId_workspaceId).toEqual({ userId: 'u1', workspaceId: 'w1' });
  });

  it('lets contributors edit and delete only their own unpublished unconnected drafts', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    await updateLocalDraft(actor, 'p1', 'Updated');
    await deleteLocalDraft(actor, 'p2');
    const updateWhere = db.post.updateMany.mock.calls[0][0].where;
    const deleteWhere = db.post.deleteMany.mock.calls[0][0].where;
    for (const where of [updateWhere, deleteWhere]) {
      expect(where).toMatchObject({ id: expect.any(String), workspaceId: 'w1', status: 'draft', authorId: 'u1', publishedAt: null, targets: { none: {} } });
    }
  });

  it('blocks missing memberships, unauthorized roles, and mutations that match anything other than one draft', async () => {
    db.membership.findUnique.mockResolvedValue(null);
    await expect(createLocalDraft(actor, 'x')).rejects.toThrow(/no longer a member/);
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(createLocalDraft(actor, 'x')).rejects.toThrow(/permission/);
    db.membership.findUnique.mockResolvedValue({ role: 'owner' });
    db.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateLocalDraft(actor, 'p1', 'x')).rejects.toThrow(/unavailable/);
    db.post.deleteMany.mockResolvedValue({ count: 2 });
    await expect(deleteLocalDraft(actor, 'p1')).rejects.toThrow(/unavailable/);
  });
});
