import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), count: vi.fn(), find: vi.fn(), access: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor, count: state.count, findMany: state.find }, workspace: { count: state.count, findMany: state.find }, $queryRaw: state.access } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'root.directoryPageSize': 25, 'root.legacy.searchMaxCharacters': 200, 'root.pageMaxNumber': 1000000 }[key]) }));
import { listRootWorkspaces, rootDirectoryQuery } from '../src/server/root/directory';

describe('Root directory pagination', () => {
  it.each([{ page: '0' }, { page: '1.5' }, { page: 'wrong' }, { page: '1000001' }, { q: 'x'.repeat(201) }])('refuses invalid filters at the service boundary: %j', async input => {
    state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
    state.count.mockClear();
    await expect(listRootWorkspaces('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.count).not.toHaveBeenCalled();
  });

  it('applies the transport result cap within the configured page size', async () => {
    state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
    state.count.mockResolvedValue(20); state.find.mockResolvedValue([]);
    expect(await listRootWorkspaces('root', {}, 5)).toMatchObject({ take: 5 });
    expect(await listRootWorkspaces('root', {}, 100)).toMatchObject({ take: 25 });
  });

  it('refuses direct directory reads without current Root authority', async () => {
    state.count.mockClear();
    state.actor.mockResolvedValue(null);
    await expect(listRootWorkspaces('visitor', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.count).not.toHaveBeenCalled();
  });

  it('normalizes search and keeps page within safe bounds', () => {
    expect(rootDirectoryQuery({ q: '  Mouad  ', page: '2' }, 25)).toEqual({ query: 'Mouad', page: 2, skip: 25, take: 25 });
    expect(rootDirectoryQuery({ q: ' ', page: '-8' }, 25)).toEqual({ query: '', page: 1, skip: 0, take: 25 });
  });

  it('rejects unsafe page sizes', () => {
    expect(() => rootDirectoryQuery({}, 0)).toThrow(/page size/);
  });

  it('keeps empty workspace searches on page one without an unbounded access query', async () => {
    state.count.mockResolvedValue(0); state.find.mockResolvedValue([]); state.access.mockClear();
    state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
    const result = await listRootWorkspaces('root', { q: 'Missing', page: '999999' }, 25);
    expect(result).toMatchObject({ page: 1, skip: 0, total: 0, workspaces: [] });
    expect(state.access).not.toHaveBeenCalled();
  });
});
