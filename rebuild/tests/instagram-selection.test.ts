// Actual publishing destination lock interaction is covered by the PostgreSQL concurrency suite.
vi.mock('@/modules/publishing/server/guard', () => ({ lockPublishingTargets: async () => {}, assertPublishingTargetsSettled: async () => {} }));
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findFirst: vi.fn(), updateMany: vi.fn() },
  socialAccount: { findFirst: vi.fn() },
  instagramAccount: { updateMany: vi.fn() },
  executeRaw: vi.fn(), transaction: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ ...state, $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('').includes('pg_try_advisory') ? [{ acquired: true }] : [{ pending: false }]), $executeRaw: state.executeRaw }));
vi.mock('@/server/data', () => ({ prisma: { membership: state.membership, $transaction: state.transaction } }));

import { setConnectionSelections } from '@/server/connection-mutations';

describe('Instagram channel selection', () => {
  it('keeps the Instagram account enabled state aligned with its selected channel', async () => {
    state.membership.findUnique.mockResolvedValue({ role: 'owner' });
    state.target.findFirst.mockResolvedValue({ id: 'target-ig', type: 'instagram', providerId: 'ig-user', socialAccountId: 'social-meta' });
    state.socialAccount.findFirst.mockResolvedValue({ id: 'social-meta' });
    await setConnectionSelections({ userId: 'owner', workspaceId: 'workspace' }, [{ kind: 'target', id: 'target-ig', enabled: false }]);
    expect(state.instagramAccount.updateMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace', igUserId: 'ig-user' }, data: { enabled: false } });
  });
});
