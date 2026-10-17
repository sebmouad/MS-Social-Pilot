import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/client';
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

  it('excludes mixed-destination posts as a whole and treats an empty current selection as no targets', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    await listPostPage('workspace-1', 1, 50, ['page-1'], 'author-1');
    expect(count.mock.calls[0]?.[0]?.where).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: ['page-1'] } }, every: { targetId: { in: ['page-1'] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] });
    await listPostPage('workspace-1', 1, 50, [], 'author-1');
    expect(count.mock.calls[1]?.[0]?.where).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] });
  });

  it('clamps an out-of-range page without exposing another workspace', async () => {
    vi.spyOn(prisma.post, 'count').mockResolvedValue(1);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const result = await listPostPage('workspace-2', 99, 50, null, 'author-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace-2', OR: [
      { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] }, skip: 0, take: 50 }));
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

  it('uses one complete authorized search predicate for both page counts and rows', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(3);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const where: Prisma.PostWhereInput = { AND: [
      { workspaceId: 'workspace-1', OR: [{ targets: { every: { targetId: { in: ['page-1'] } } } }] },
      { OR: [{ message: { contains: 'literal\\%', mode: 'insensitive' } }, { firstComment: { contains: 'literal\\%', mode: 'insensitive' } }] },
    ] };
    await listPostPage('workspace-1', 1, 50, [], undefined, { where });
    const scopedWhere = { AND: [
      { workspaceId: 'workspace-1', OR: [
        { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
        { targets: { none: {} } },
      ] },
      where,
    ] };
    expect(count).toHaveBeenCalledWith({ where: scopedWhere });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scopedWhere }));
  });

  it('keeps tenant and selected-channel scope when a caller where is partial or foreign', async () => {
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(0);
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const filter = { workspaceId: 'workspace-attacker', OR: [{ targets: { some: { targetId: 'foreign-channel' } } }] } satisfies Prisma.PostWhereInput;
    await listPostPage('workspace-1', 1, 50, ['selected-channel'], 'author-1', { where: filter });
    const where = count.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ AND: [
      { workspaceId: 'workspace-1', OR: [
        { targets: { some: { targetId: { in: ['selected-channel'] } }, every: { targetId: { in: ['selected-channel'] } } } },
        { targets: { none: {} }, authorId: 'author-1' },
      ] },
      filter,
    ] });
    expect(findMany.mock.calls[0]?.[0]?.where).toEqual(where);
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
