import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ requireRootPage: vi.fn(), listRootUsers: vi.fn(), listRootWorkspaces: vi.fn(), runtimeConfig: vi.fn() }));
vi.mock('@/server/config/access', () => ({ requireRootPage: state.requireRootPage }));
vi.mock('@/server/root/users', () => ({ loadRootUsers: state.listRootUsers }));
vi.mock('@/server/root/directory', () => ({ listRootUsers: state.listRootUsers, listRootWorkspaces: state.listRootWorkspaces }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('@/modules/root/ui/RootFrame', () => ({ RootFrame: 'div' }));

import RootUsersPage from '../src/app/root/users/page';
import RootWorkspacesPage from '../src/app/root/workspaces/page';

describe('Root directory access', () => {
  beforeEach(() => { vi.clearAllMocks(); state.requireRootPage.mockRejectedValue(new Error('root access required')); });

  it('checks installation-owner access before listing users', async () => {
    await expect(RootUsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('root access required');
    expect(state.listRootUsers).not.toHaveBeenCalled();
    expect(state.runtimeConfig).not.toHaveBeenCalled();
  });

  it('checks installation-owner access before listing workspaces', async () => {
    await expect(RootWorkspacesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('root access required');
    expect(state.listRootWorkspaces).not.toHaveBeenCalled();
    expect(state.runtimeConfig).not.toHaveBeenCalled();
  });
});
