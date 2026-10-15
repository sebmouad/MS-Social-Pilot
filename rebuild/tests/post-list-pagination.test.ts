import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPostPage, prisma } from '../src/server/data';

describe('scoped post pagination', () => {
  afterEach(() => vi.restoreAllMocks());

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
});
