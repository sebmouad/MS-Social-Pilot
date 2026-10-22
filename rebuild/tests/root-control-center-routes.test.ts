import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ requireRootPage: vi.fn(), getRootOverview: vi.fn(), listRootActivity: vi.fn(), runtimeConfig: vi.fn() }));
vi.mock('@/server/config/access', () => ({ requireRootPage: state.requireRootPage }));
vi.mock('@/server/root/read-model', () => ({ getRootOverview: state.getRootOverview }));
vi.mock('@/server/root/activity', () => ({ listRootActivity: state.listRootActivity }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('@/modules/root/ui/RootFrame', () => ({ RootFrame: 'div' }));
vi.mock('@/modules/root/ui/RootJobHealth', () => ({ RootJobHealth: 'section' }));
vi.mock('../src/app/root/root-control-center.css', () => ({}));
vi.mock('../src/app/root/config/root-config.css', () => ({}));

import RootOverviewPage from '../src/app/root/page';
import RootOperationsPage from '../src/app/root/operations/page';
import RootActivityPage from '../src/app/root/activity/page';

describe('Root control center access ordering', () => {
  beforeEach(() => { vi.clearAllMocks(); state.requireRootPage.mockRejectedValue(new Error('root access required')); });

  it('checks Root access before loading overview data', async () => {
    await expect(RootOverviewPage()).rejects.toThrow('root access required');
    expect(state.getRootOverview).not.toHaveBeenCalled();
  });

  it('checks Root access before rendering operations', async () => {
    await expect(RootOperationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('root access required');
  });

  it('checks Root access before loading activity', async () => {
    await expect(RootActivityPage({ searchParams: Promise.resolve({ limit: '25' }) })).rejects.toThrow('root access required');
    expect(state.listRootActivity).not.toHaveBeenCalled();
    expect(state.runtimeConfig).not.toHaveBeenCalled();
  });
});
