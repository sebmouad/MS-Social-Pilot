import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.hoisted(() => vi.fn());
vi.mock('../src/server/data', () => ({ prisma: { workspaceDataPurge: { findUnique } } }));
import { assertWorkspaceNotPurging } from '../src/server/data-control/guard';

beforeEach(() => { findUnique.mockReset(); });

describe('workspace purge write guard', () => {
  it.each(['requested', 'db_deleted'])('denies workspace actions during %s', async status => {
    findUnique.mockResolvedValue({ status });
    await expect(assertWorkspaceNotPurging('workspace-1')).rejects.toThrow('Workspace data deletion is in progress.');
    expect(findUnique).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' }, select: { status: true } });
  });

  it.each([null, { status: 'completed' }])('permits actions outside an active purge', async job => {
    findUnique.mockResolvedValue(job);
    await expect(assertWorkspaceNotPurging('workspace-1')).resolves.toBeUndefined();
  });
});
