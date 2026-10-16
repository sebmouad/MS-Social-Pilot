import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ count: vi.fn(), find: vi.fn(), access: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { count: state.count, findMany: state.find }, workspace: { count: state.count, findMany: state.find }, $queryRaw: state.access } }));
import { listRootWorkspaces, rootDirectoryQuery } from '../src/server/root/directory';

describe('Root directory pagination', () => {
  it('normalizes search and keeps page within safe bounds', () => {
    expect(rootDirectoryQuery({ q: '  Mouad  ', page: '2' }, 25)).toEqual({ query: 'Mouad', page: 2, skip: 25, take: 25 });
    expect(rootDirectoryQuery({ q: ' ', page: '-8' }, 25)).toEqual({ query: '', page: 1, skip: 0, take: 25 });
  });

  it('rejects unsafe page sizes', () => {
    expect(() => rootDirectoryQuery({}, 0)).toThrow(/page size/);
  });

  it('keeps empty workspace searches on page one without an unbounded access query', async () => {
    state.count.mockResolvedValue(0); state.find.mockResolvedValue([]); state.access.mockClear();
    const result = await listRootWorkspaces({ q: 'Missing', page: '999999' }, 25);
    expect(result).toMatchObject({ page: 1, skip: 0, total: 0, workspaces: [] });
    expect(state.access).not.toHaveBeenCalled();
  });
});
