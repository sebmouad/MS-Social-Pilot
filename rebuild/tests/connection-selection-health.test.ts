// Actual publishing destination lock interaction is covered by the PostgreSQL concurrency suite.
vi.mock('@/modules/publishing/server/guard', () => ({ lockPublishingTargets: async () => {}, assertPublishingTargetsSettled: async () => {} }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: vi.fn(),
  membership: { findUnique: vi.fn() },
  target: { findFirst: vi.fn(), updateMany: vi.fn() },
  adAccount: { findFirst: vi.fn(), updateMany: vi.fn() },
  socialAccount: { findFirst: vi.fn() },
  entitlements: vi.fn(), queryRaw: vi.fn(), platformEnabled: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { membership: state.membership, $transaction: state.transaction } }));
vi.mock('../src/server/entitlements', async importOriginal => ({ ...await importOriginal<typeof import('../src/server/entitlements')>(), loadEntitlements: state.entitlements }));
vi.mock('../src/server/platforms/registry', () => ({ isPlatformEnabled: state.platformEnabled }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { setConnectionSelections } from '../src/server/connection-mutations';

const actor = { userId: 'owner', workspaceId: 'workspace' };
const now = new Date('2026-10-16T10:00:00Z');

describe('connection selection readiness', () => {
  it('refuses oversized changes using the current shared Root ceiling', async () => {
    state.config.mockResolvedValue(1);
    await expect(setConnectionSelections(actor, [{ kind: 'target', id: 'one', enabled: false }, { kind: 'adAccount', id: 'two', enabled: false }])).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.config).toHaveBeenCalledWith('data.connectionSelectionMaxItems');
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.resetAllMocks();
    state.config.mockResolvedValue(250);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    state.membership.findUnique.mockResolvedValue({ role: 'owner' });
    state.target.findFirst.mockResolvedValue({ id: 'channel', type: 'page', socialAccountId: 'source' });
    state.adAccount.findFirst.mockResolvedValue({ id: 'ad', socialAccountId: 'source' });
    state.socialAccount.findFirst.mockResolvedValue({ id: 'source', provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null });
    state.platformEnabled.mockResolvedValue(true);
    state.entitlements.mockResolvedValue({ workspaceId: 'workspace', features: { 'settings/connections': true }, platformCapabilities: { facebook: true } });
    state.queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('pg_try_advisory') ? [{ acquired: true }] : [{ pending: false }]);
    state.transaction.mockImplementation(callback => callback({ ...state, $queryRaw: state.queryRaw, $executeRaw: state.executeRaw }));
  });

  it.each(['target', 'adAccount'] as const)('rejects enabling an expired %s without changing selection', async kind => {
    state.socialAccount.findFirst.mockResolvedValue({ id: 'source', provider: 'facebook', invalidatedAt: null, tokenExpiresAt: now });
    await expect(setConnectionSelections(actor, [{ kind, id: kind === 'target' ? 'channel' : 'ad', enabled: true }])).rejects.toThrow(/Reconnect/);
    expect(state.target.updateMany).not.toHaveBeenCalled();
    expect(state.adAccount.updateMany).not.toHaveBeenCalled();
    expect(state.executeRaw).not.toHaveBeenCalled();
  });

  it.each(['target', 'adAccount'] as const)('denies selecting an unentitled %s', async kind => {
    state.entitlements.mockResolvedValue({ workspaceId: 'workspace', features: { 'settings/connections': true }, platformCapabilities: { facebook: false } });
    await expect(setConnectionSelections(actor, [{ kind, id: kind === 'target' ? 'channel' : 'ad', enabled: true }])).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.target.updateMany).not.toHaveBeenCalled();
    expect(state.adAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects enabling resources from a disabled platform module', async () => {
    state.platformEnabled.mockResolvedValue(false);
    await expect(setConnectionSelections(actor, [{ kind: 'target', id: 'channel', enabled: true }])).rejects.toThrow(/unavailable/);
    expect(state.target.updateMany).not.toHaveBeenCalled();
  });

  it.each(['target', 'adAccount'] as const)('still allows removing an expired or revoked %s from the workspace', async kind => {
    state.socialAccount.findFirst.mockResolvedValue({ id: 'source', provider: 'facebook', invalidatedAt: now, tokenExpiresAt: now });
    await setConnectionSelections(actor, [{ kind, id: kind === 'target' ? 'channel' : 'ad', enabled: false }]);
    const changes = kind === 'target' ? state.target.updateMany : state.adAccount.updateMany;
    expect(changes).toHaveBeenCalledWith({ where: { id: kind === 'target' ? 'channel' : 'ad', workspaceId: actor.workspaceId }, data: { enabled: false } });
    expect(state.socialAccount.findFirst).not.toHaveBeenCalled();
  });

  it('keeps a channel selected while its comment deletion needs recovery', async () => {
    state.queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('pg_try_advisory') ? [{ acquired: true }] : [{ pending: true }]);
    await expect(setConnectionSelections(actor, [{ kind: 'target', id: 'channel', enabled: false }])).rejects.toMatchObject({ code: 'conflict' });
    expect(state.target.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a selected resource with a valid connection and records the change', async () => {
    state.socialAccount.findFirst.mockResolvedValue({ id: 'source', provider: 'facebook', invalidatedAt: null, tokenExpiresAt: new Date(now.getTime() + 1) });
    await setConnectionSelections(actor, [{ kind: 'adAccount', id: 'ad', enabled: true }]);
    expect(state.adAccount.updateMany).toHaveBeenCalled();
    expect(state.executeRaw).toHaveBeenCalled();
  });
});
