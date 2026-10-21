import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), conversations: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: {
  $queryRaw: mocks.query,
  conversation: { aggregate: async () => ({ _max: { fetchedAt: null } }), findMany: mocks.conversations },
  postComment: { aggregate: async () => ({ _max: { fetchedAt: null } }) },
} }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.access }));
vi.mock('@/modules/inbox/server/service-copy', () => ({ inboxServiceText: async () => 'Invalid cursor' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'inbox.listPageSize': 25, 'inbox.threadPageSize': 50, 'inbox.searchMaxCharacters': 200, 'inbox.cursorMaxCharacters': 4096, 'inbox.bulkMaxItems': 50 })[key] }));
import { readInboxList } from '@/modules/inbox/server/read';

const actor = { userId: 'user', workspaceId: 'tenant' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ channelIds: ['allowed'], channels: [], timeZone: 'UTC' });
  mocks.query.mockResolvedValue([]);
});

describe('Inbox search query budget', () => {
  it('filters once for the count and page, preserving literal escaping and tenant scope', async () => {
    mocks.query.mockImplementation(async (sql: { text?: string }) => sql.text?.includes('WITH activity AS MATERIALIZED') ? [{ id: null, kind: null, time: null, count: BigInt(82) }] : []);
    const result = await readInboxList(actor, { q: 'Café 50%_\\' });
    expect(result).toMatchObject({ items: [], total: 82 });
    // One combined activity query plus two synchronization timestamp reads.
    expect(mocks.query).toHaveBeenCalledTimes(3);
    const query = mocks.query.mock.calls[0]![0] as { text: string; values: unknown[] };
    expect(query.text).toContain('totals LEFT JOIN page ON true');
    expect(query.text).toContain('COUNT(*) AS count FROM activity');
    expect(query.text).toContain('t."workspaceId"');
    expect(query.text).toContain('p."workspaceId"');
    expect(query.values).toContain('tenant');
    expect(query.values).toContain('allowed');
    expect(query.values).toContain('%Café 50\\%\\_\\\\%');
    expect(mocks.conversations).not.toHaveBeenCalled();
  });

  it('returns a truthful zero count when nothing matches', async () => {
    mocks.query.mockResolvedValue([{ id: null, kind: null, time: null, count: BigInt(0) }]);
    const result = await readInboxList(actor, { q: 'missing' });
    expect(result).toMatchObject({ total: 0, items: [], olderCursor: null, newerCursor: null });
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it('hydrates one bounded page and retains exact totals and continuation beyond the last page', async () => {
    const inventory = Array.from({ length: 26 }, (_, index) => ({ id: `conversation-${index}`, kind: 'message', time: new Date(Date.UTC(2026, 9, 20, 12, 0, -index)), count: BigInt(96) }));
    let page = inventory;
    mocks.query.mockImplementation(async (sql: { text?: string }) => sql.text?.includes('WITH activity AS MATERIALIZED')
      ? page.length ? page : [{ id: null, kind: null, time: null, count: BigInt(96) }] : []);
    mocks.conversations.mockResolvedValue(inventory.map(row => ({ id: row.id, snippet: 'matching text', unreadCount: 0, updatedTime: row.time, resolvedAt: null,
      target: { id: 'allowed', name: 'Channel', providerId: 'remote', socialAccount: { provider: 'example' } }, messages: [] })));
    const first = await readInboxList(actor, { q: 'matching' });
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(96);
    expect(first.olderCursor).toBeTruthy();
    expect(first.newerCursor).toBeNull();
    // One metadata read for the whole authorized page, rather than one per item.
    expect(mocks.query).toHaveBeenCalledTimes(4);
    const metadataQuery = mocks.query.mock.calls[3]![0] as { text: string; values: unknown[] };
    expect(metadataQuery.text).toContain('"inboxMetadata" AS metadata');
    expect(metadataQuery.values.filter(value => String(value).startsWith('conversation-'))).toHaveLength(25);
    expect(mocks.conversations).toHaveBeenCalledTimes(1);
    expect(mocks.conversations.mock.calls[0]![0].where.id.in).toHaveLength(25);
    page = [];
    const pastEnd = await readInboxList(actor, { q: 'matching', cursor: first.olderCursor! });
    expect(pastEnd).toMatchObject({ total: 96, items: [] });
    expect(mocks.query).toHaveBeenCalledTimes(7);
    expect(mocks.conversations).toHaveBeenCalledTimes(1);
  });
});

describe('optional trigram migration', () => {
  it('pins the reviewed SQL and skips acceleration only for expected extension installation failures', () => {
    const sql = readFileSync('../prisma/migrations/20261031170000_rebuild_search_trigrams/migration.sql', 'utf8');
    expect(createHash('sha256').update(sql).digest('hex')).toBe('2a5c27ac493fedbed7174ebb1c2bab19d0f33f220a341cb23b271f42e5cf572e');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(sql).toContain('WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN');
    expect(sql).toContain('IF extension_schema IS NULL THEN\n    RETURN;');
    expect(sql).toContain('USING gin (%I %I.gin_trgm_ops)');
    expect(sql).not.toContain('WHEN OTHERS');
    expect(sql.match(/_trgm_idx'\)/g)).toHaveLength(8);
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE)\b/);
  });
});
