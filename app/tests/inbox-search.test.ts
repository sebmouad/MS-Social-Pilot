import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), authorize: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));

import { searchInbox } from '@/modules/inbox/server/search';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const hit = { kind: 'message' as const, threadKey: 'message:conv-a', itemId: 'msg-a', channelId: 'channel-a', channelName: 'Page', author: 'Sam', excerpt: 'hello <b>there</b>', time: new Date('2026-10-22T00:00:00Z'), rank: 0.5, total: BigInt(1) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ channels: [{ id: 'channel-a', name: 'Page' }], channelIds: ['channel-a'], timeZone: 'UTC' });
  mocks.config.mockImplementation(async (key: string) => {
    if (key === 'inbox.searchMaxCharacters') return 200;
    if (key === 'inbox.listPageSize') return 25;
    throw new Error(`unexpected config ${key}`);
  });
  mocks.queryRaw.mockResolvedValue([hit]);
});

describe('inbox full-text search', () => {
  it('returns ranked hits with the thread to open', async () => {
    const result = await searchInbox(actor, { q: 'hello there' });
    expect(result).toMatchObject({ total: 1, q: 'hello there', limit: 25 });
    expect(result.hits[0]).toMatchObject({ kind: 'message', threadKey: 'message:conv-a', itemId: 'msg-a', channelName: 'Page', rank: 0.5 });
  });

  it('searches stored content with plain queries inside the workspace scope', async () => {
    await searchInbox(actor, { q: 'hello' });
    const sql = (mocks.queryRaw.mock.calls[0][0] as { sql: string }).sql;
    expect(sql).toContain(`plainto_tsquery('simple'`);
    expect(sql).toContain(`to_tsvector('simple'`);
    expect(sql).toContain('ts_rank');
    expect(sql).toContain('conversation_messages');
    expect(sql).toContain('post_comments');
    expect(sql).toContain('t."workspaceId"');
    expect(sql).toContain('p."workspaceId"');
  });

  it('refuses channels outside the scope and empty channels return nothing', async () => {
    await expect(searchInbox(actor, { q: 'hello', channelId: 'channel-b' })).rejects.toMatchObject({ code: 'forbidden' });
    mocks.authorize.mockResolvedValue({ channels: [], channelIds: [], timeZone: 'UTC' });
    expect(await searchInbox(actor, { q: 'hello' })).toMatchObject({ hits: [], total: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('rejects empty or overlong queries and honors the result ceiling', async () => {
    await expect(searchInbox(actor, { q: '  ' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(searchInbox(actor, { q: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await searchInbox(actor, { q: 'hello', limit: 5 }, { maxItems: 3 });
    expect(result.limit).toBe(3);
  });
});
