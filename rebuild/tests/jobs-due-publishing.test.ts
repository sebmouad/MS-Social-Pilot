import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn(), withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));

const state = vi.hoisted(() => ({
  findMany: vi.fn(), config: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), publish: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { post: { findMany: state.findMany } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (value: { allowed: boolean }) => value.allowed }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: (value: { allowed: boolean }) => value.allowed }));
vi.mock('@/server/publishing/lifecycle', () => ({ publishPost: state.publish }));

import { publishDuePosts } from '@/server/jobs/sync';

describe('due post publishing job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.config.mockResolvedValue(50);
    state.findMany.mockResolvedValue([{ id: 'post-1', authorId: 'author-1', workspaceId: 'workspace-1' }]);
    state.permissions.mockResolvedValue({ allowed: true, pageScope: { all: false, ids: ['page-1'] } });
    state.entitlements.mockResolvedValue({ allowed: true });
    state.publish.mockResolvedValue({ published: 1, failed: 0, needsReconciliation: 0 });
  });

  it('dispatches due posts with the author’s current channel scope', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(await publishDuePosts(now)).toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'scheduled', scheduledAt: { lte: now } }) }));
    expect(state.publish).toHaveBeenCalledWith({ userId: 'author-1', workspaceId: 'workspace-1', allowedTargetIds: ['page-1'] }, 'post-1');
  });

  it('does not publish after the author loses write access', async () => {
    state.permissions.mockResolvedValue({ allowed: false, pageScope: { all: true } });
    expect(await publishDuePosts()).toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(state.publish).not.toHaveBeenCalled();
  });
});
