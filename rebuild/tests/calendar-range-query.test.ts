import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCalendarRange, prisma } from '../src/server/data';

describe('calendar range query', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies channel scope, optional filters and both publish timestamps without truncating', async () => {
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    const from = new Date('2026-10-09T00:00:00Z');
    const to = new Date('2026-10-20T00:00:00Z');
    await listCalendarRange('workspace-1', from, to, ['page-1'], 'author-1', { channelId: 'page-1', status: 'scheduled' });
    const args = findMany.mock.calls[0]![0]!;
    expect(args.where).toEqual({
      workspaceId: 'workspace-1',
      OR: [
        { targets: { some: { targetId: { in: ['page-1'] } }, every: { targetId: { in: ['page-1'] } } } },
        { targets: { none: {} }, authorId: 'author-1' },
      ],
      AND: [
        { OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }] },
        { targets: { some: { targetId: 'page-1' } } },
        { status: 'scheduled' },
      ],
    });
    expect(args).not.toHaveProperty('take');
  });

  it('uses a safe empty target scope when resolved selected IDs are missing', async () => {
    const findMany = vi.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    await listCalendarRange('workspace-1', new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), null, 'author-1');
    expect(findMany.mock.calls[0]![0]!.where).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ], AND: [{ OR: [expect.anything(), expect.anything()] }] });
  });
});
