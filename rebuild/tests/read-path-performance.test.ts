import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async () => 50) }));
import { listPostPage, prisma } from '@/server/data';
import { publishingPostSearchWhere } from '@/modules/publishing/server/read-query';

describe('Posts list query budget', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, 'scheduled_asc', 'created_asc'] as const)('keeps a filtered 96-post listing bounded for order %s', async order => {
    // Use a synthetic SQL result page; no database or server is started.
    const inventory = Array.from({ length: 96 }, (_, index) => ({ id: `synthetic-${index}`, targets: [{ firstCommentError: null }] }));
    const count = vi.spyOn(prisma.post, 'count').mockResolvedValue(inventory.length);
    const find = vi.spyOn(prisma.post, 'findMany').mockResolvedValue(inventory.slice(50) as never);
    const where = { AND: [{ status: 'scheduled' as const }, { targets: { some: { targetId: 'channel-1' } } }, publishingPostSearchWhere('Café 50%')] };
    const result = await listPostPage('workspace-1', 2, 50, ['channel-1'], undefined, { where, order });
    expect(result).toMatchObject({ total: 96, page: 2, pages: 2 });
    expect(result.posts).toHaveLength(46);
    expect(count).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);
    const query = find.mock.calls[0]![0]!;
    expect(query).toMatchObject({ skip: 50, take: 50 });
    expect(query.where).toEqual(count.mock.calls[0]![0]!.where);
    expect(query.where).toMatchObject({ AND: [expect.objectContaining({ workspaceId: 'workspace-1' }), where] });
    expect(query.orderBy).toEqual(order === 'created_asc' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ scheduledAt: order === 'scheduled_asc' ? 'asc' : 'desc' }, { createdAt: order === 'scheduled_asc' ? 'asc' : 'desc' }, { id: order === 'scheduled_asc' ? 'asc' : 'desc' }]);
  });
});

describe('additive read-path indexes', () => {
  it('pins the SQL checksum and covers the list ordering and analytics date-range prefixes', () => {
    const sql = readFileSync('../prisma/migrations/20261031160000_rebuild_read_path_indexes/migration.sql', 'utf8');
    expect(createHash('sha256').update(sql).digest('hex')).toBe('afada5e8886f5b725e5ba1907315048ccb11b6d9c300939d649220c9b9638762');
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean);
    expect(statements).toHaveLength(4);
    for (const statement of statements) expect(statement).toMatch(/^CREATE INDEX IF NOT EXISTS /);
    expect(sql).toContain('ON posts ("workspaceId", "scheduledAt", "createdAt", id)');
    expect(sql).toContain('ON posts ("workspaceId", status, "scheduledAt", "createdAt", id)');
    expect(sql).toContain('ON posts ("workspaceId", "createdAt", id)');
    expect(sql).toContain('ON page_insights ("targetId", "endTime", metric)');
  });
});
