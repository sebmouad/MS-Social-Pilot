import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPostPage, prisma } from '../src/server/data';

describe('scoped post pagination', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not expose legacy provider error strings in client post data', async () => {
    vi.spyOn(prisma.post, 'count').mockResolvedValue(1);
    vi.spyOn(prisma.post, 'findMany').mockResolvedValue([{ targets: [{ firstCommentError: 'private-provider-detail', firstCommentAt: new Date() }] }] as never);
    const result = await listPostPage('workspace-1', 1, 50, null, 'author-1');
    expect(JSON.stringify(result)).not.toContain('private-provider-detail');
    expect(result.posts[0]?.targets[0]?.firstCommentError).toBe('review_required');
  });

  it('filters channel access before counting and paging, while retaining the author’s unassigned drafts', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(101);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const result = await listPostPage('workspace-1', 3, 50, ['page-1'], 'author-1');
    const expectedWhere = {
      workspaceId: 'workspace-1',
      OR: [
        { targets: { some: { targetId: { in: ['page-1'] } }, every: { targetId: { in: ['page-1'] } } } },
        { targets: { none: {} }, authorId: 'author-1' },
      ],
    };
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere, skip: 100, take: 50 }));
    expect(result).toMatchObject({ total: 101, page: 3, pages: 3 });
  });

  it('clamps an out-of-range page without exposing another workspace', async () => {
    vi.spyOn(prisma.post, 'count').mockResolvedValue(1);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const result = await listPostPage('workspace-2', 99, 50, null, 'author-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace-2' }, skip: 0, take: 50 }));
    expect(result).toMatchObject({ total: 1, page: 1, pages: 1 });
  });

  it('combines sidebar filters with channel access before pagination', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(55);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    await listPostPage('workspace-1', 2, 50, ['page-1', 'page-2'], 'author-1', { status: 'published', channelId: 'page-2' });
    const where = expect.objectContaining({ workspaceId: 'workspace-1', status: 'published', targets: { some: { targetId: 'page-2' } }, OR: expect.any(Array) });
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 50, take: 50 }));
  });

  it('queries scheduled and approval queues before paging in workflow order', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(75);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    await listPostPage('workspace-1', 2, 50, ['page-1'], 'author-1', { status: 'scheduled', order: 'scheduled_asc' });
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ workspaceId: 'workspace-1', status: 'scheduled', OR: expect.any(Array) }) });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 50, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }));
    await listPostPage('workspace-1', 1, 50, ['page-1'], 'author-1', { status: 'pending_approval', order: 'created_asc' });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'pending_approval' }), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
  });
});
