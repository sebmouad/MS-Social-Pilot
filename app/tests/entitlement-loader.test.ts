import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), settings: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: state.query, appSetting: { findMany: state.settings } } }));
import { loadEntitlements } from '../src/server/entitlements';
beforeEach(() => {
  state.query.mockResolvedValue([{ workspaceId: 'workspace', workspaceDisabled: [], memberDisabled: [], planFeatures: null, suspendedAt: new Date(), isInstanceOwner: true }]);
  state.settings.mockResolvedValue([]);
});
describe('workspace entitlement loader', () => {
  it('does not confer a private inspection exception on ordinary workspace loads', async () => {
    const access = await loadEntitlements('root-owner', 'workspace');
    expect(access?.modules.publishing).toBe(false);
    expect(access?.platformCapabilities.facebook).toBe(false);
  });
  it('requires explicit internal inspection opt-in', async () => {
    const access = await loadEntitlements('root-owner', 'workspace', { allowInstallationInspection: true });
    expect(access?.modules.publishing).toBe(true);
  });
});
