import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), count: vi.fn(), users: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor, count: state.count, findMany: state.users } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { loadRootUsers } from '../src/server/root/users';
import { rootUsersUrl } from '../src/lib/root-users';

beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.config.mockImplementation(async (key: string) => key === 'root.directoryPageSize' ? 25 : 200);
  state.count.mockResolvedValue(27);
  state.users.mockResolvedValue([]);
});

describe('private Root user directory', () => {
  it.each([null, { isInstanceOwner: false, disabledAt: null }, { isInstanceOwner: true, disabledAt: new Date() }])('rejects stale/forged actors before directory reads', async actor => {
    state.actor.mockResolvedValue(actor);
    await expect(loadRootUsers('actor')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.count).not.toHaveBeenCalled();
    expect(state.users).not.toHaveBeenCalled();
  });
  it('combines literal search and account state, clamps stale pages and honors the MCP cap', async () => {
    const result = await loadRootUsers('actor', { q: '  A_%\\  ', status: 'disabled', page: '999' }, 10);
    expect(result).toMatchObject({ query: 'A_%\\', status: 'disabled', page: 3, take: 10, total: 27, installationTotal: 27, searchMaxCharacters: 200 });
    expect(state.users).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10, where: { disabledAt: { not: null }, OR: [
      { name: { contains: 'A\\_\\%\\\\', mode: 'insensitive' } }, { email: { contains: 'A\\_\\%\\\\', mode: 'insensitive' } },
    ] } }));
    const selection = state.users.mock.calls[0][0].select;
    expect(selection._count.select.sessions.where).toMatchObject({ expiresAt: { gt: expect.any(Date) }, pending: null });
    expect(JSON.stringify(selection)).not.toMatch(/password|totpSecret|recoveryCode|tokenHash/);
  });
  it.each([
    { q: ['one', 'two'] }, { page: ['1','2'] }, { status: ['all','disabled'] },
    { status: 'unknown' }, { page: '-1' }, { page: 'wrong' }, { page: '9007199254740992' }, { q: 'x'.repeat(201) },
  ])('rejects malformed/repeated filters before counting: %j', async input => {
    await expect(loadRootUsers('actor', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.count).not.toHaveBeenCalled();
  });
  it.each([['active', { disabledAt: null }], ['owners', { isInstanceOwner: true }], ['all', {}]] as const)('uses the %s filter on the server', async (status, where) => {
    await loadRootUsers('actor', { status });
    expect(state.users.mock.calls[0][0].where).toEqual(where);
  });
  it('distinguishes no matches from an empty installation', async () => {
    state.count.mockResolvedValueOnce(0).mockResolvedValueOnce(7);
    const result = await loadRootUsers('actor', { q: 'No match', page: '100' });
    expect(result).toMatchObject({ page: 1, total: 0, installationTotal: 7, users: [] });
  });
  it('does not classify unexpected store errors as safe product errors', async () => {
    const error = new Error('postgres://private-password@db');
    state.users.mockRejectedValueOnce(error);
    await expect(loadRootUsers('actor')).rejects.toBe(error);
  });
  it('preserves status and literal search in pagination links', () => {
    expect(rootUsersUrl({ q: 'name+email', status: 'disabled', page: 2 })).toBe('/root/users?q=name%2Bemail&status=disabled&page=2');
    expect(rootUsersUrl({})).toBe('/root/users');
  });
});
