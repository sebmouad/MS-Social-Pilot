import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor }, $queryRaw: state.read } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { listRootActivity } from '../src/server/root/activity';
import { rootActivitySearchParams } from '../src/lib/root-activity';

const row = (id: string) => ({ id, action: 'root.workspace_suspended', createdAt: new Date('2026-10-16T12:00:00Z'), actorName: 'Owner', actorEmail: 'owner@example.test', detail: { suspended: true, accessToken: 'DO-NOT-RETURN', message: 'private content' } });
beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.config.mockImplementation(async (key: string) => key === 'root.activityPageSize' ? 50 : key === 'root.activityCursorMaxCharacters' ? 4096 : 200);
  state.read.mockResolvedValue([]);
});

describe('private audit history', () => {
  it.each([null, { isInstanceOwner: false, disabledAt: null }, { isInstanceOwner: true, disabledAt: new Date() }])('checks current installation-owner authority before reading audit rows', async actor => {
    state.actor.mockResolvedValue(actor);
    await expect(listRootActivity('actor', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.read).not.toHaveBeenCalled();
    expect(state.config).not.toHaveBeenCalled();
  });

  it('binds literal search values, caps reads and returns only safe detail', async () => {
    state.read.mockResolvedValue([row('b'), row('a')]);
    const result = await listRootActivity('root', { q: '  50%_\\  ', workspaceId: 'workspace-a', from: '2026-10-01', to: '2026-10-16', limit: 999 }, 1);
    expect(result.limit).toBe(1);
    expect(result.items.map(item => item.id)).toEqual(['b']);
    expect(result.olderCursor).toEqual(expect.any(String));
    expect(result.newerCursor).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/DO-NOT-RETURN|private content|accessToken/);
    const query = state.read.mock.calls[0]![0];
    expect(query.values).toContain('%50\\%\\_\\\\%');
    expect(query.values).toContain('workspace-a');
    expect(query.values).toContain('2026-10-16');
    expect(query.sql).toContain("::date + INTERVAL '1 day'");
    expect(query.values.at(-1)).toBe(2);
  });

  it.each([{ from: '2026-02-30' }, { from: '2026-10-16', to: '2026-10-15' }, { limit: '2' }, { q: 'x'.repeat(201) }, { cursor: 'malformed!' }, { unknown: true }])('rejects invalid filters and cursor before querying', async input => {
    await expect(listRootActivity('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.read).not.toHaveBeenCalled();
  });

  it('binds cursors to filters and reverses nearest-newer results back into display order', async () => {
    state.read.mockResolvedValueOnce([row('c'), row('b'), row('a')]);
    const first = await listRootActivity('root', { q: 'root', limit: 2 });
    state.read.mockClear();
    await expect(listRootActivity('root', { q: 'other', cursor: first.olderCursor! })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.read).not.toHaveBeenCalled();
    state.read.mockResolvedValueOnce([row('a')]);
    const older = await listRootActivity('root', { q: 'root', limit: 2, cursor: first.olderCursor! });
    expect(older.newerCursor).toEqual(expect.any(String));
    state.read.mockResolvedValueOnce([row('b'), row('c'), row('d')]);
    const newer = await listRootActivity('root', { q: 'root', limit: 2, cursor: older.newerCursor! });
    expect(newer.items.map(item => item.id)).toEqual(['c', 'b']);
    expect(newer.newerCursor).toEqual(expect.any(String));
    expect(newer.olderCursor).toEqual(expect.any(String));
  });

  it('rejects duplicate query parameters and malformed numeric limits rather than coercing', () => {
    expect(rootActivitySearchParams({ limit: '2', q: 'Root' })).toEqual({ limit: 2, q: 'Root' });
    expect(() => rootActivitySearchParams({ q: ['a', 'b'] })).toThrow();
    expect(() => rootActivitySearchParams({ limit: '1e2' })).toThrow();
  });

  it('rejects noncanonical cursor versions, dates, encodings and oversized payloads', async () => {
    state.read.mockResolvedValueOnce([row('b'), row('a')]);
    const first = await listRootActivity('root', { limit: 1 });
    const cursor = JSON.parse(Buffer.from(first.olderCursor!, 'base64url').toString());
    state.read.mockClear();
    for (const patch of [{ v: 2 }, { at: '0000-01-01T00:00:00.000Z' }, { at: '2026-10-16T12:00:00Z' }, { extra: true }]) {
      const value = Buffer.from(JSON.stringify({ ...cursor, ...patch })).toString('base64url');
      await expect(listRootActivity('root', { cursor: value })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(listRootActivity('root', { cursor: `${first.olderCursor}=` })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listRootActivity('root', { cursor: 'x'.repeat(4097) })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.read).not.toHaveBeenCalled();
  });
});
