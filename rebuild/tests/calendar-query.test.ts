import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCalendarPosts, prisma } from '../src/server/data';

describe('calendar month query', () => {
  afterEach(() => vi.restoreAllMocks());

  it('queries both publish timestamps with workspace scope before local-month filtering', async () => {
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    await listCalendarPosts('workspace-1', 2026, 10, ['page-1'], 'author-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: 'workspace-1',
        AND: [
          { OR: [
            { targets: { some: { targetId: { in: ['page-1'] } }, every: { targetId: { in: ['page-1'] } } } },
            { targets: { none: {} }, authorId: 'author-1' },
          ] },
          { OR: [
            { scheduledAt: { gte: new Date('2026-09-29T00:00:00.000Z'), lt: new Date('2026-11-03T00:00:00.000Z') } },
            { publishedAt: { gte: new Date('2026-09-29T00:00:00.000Z'), lt: new Date('2026-11-03T00:00:00.000Z') } },
          ] },
        ],
      },
    }));
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('take');
  });
});
