import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '../src/server/entitlements';

const platformFor = vi.hoisted(() => vi.fn());
vi.mock('../src/server/platforms/registry', () => ({ platformFor }));
vi.mock('../src/server/platforms/resource-visibility', () => ({
  selectedResourceConnectionWhere: vi.fn(async (workspaceId: string) => ({ workspaceId, invalidatedAt: null, provider: { in: ['facebook', 'other'] } })),
}));

import { prisma } from '../src/server/data';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from '../src/modules/publishing/server/read-scope';

const entitlements = {
  workspaceId: 'workspace-1', modules: { publishing: true }, features: { 'publishing/posts': true },
  platformCapabilities: { facebook: true, other: false },
} as unknown as Entitlements;

describe('publishing read scope', () => {
  afterEach(() => { vi.restoreAllMocks(); platformFor.mockReset(); });

  it('filters selected publishing targets by module/platform entitlement and neutral resource-kind metadata', async () => {
    const findMany = vi.spyOn(prisma.target, 'findMany').mockResolvedValue([
      { id: 'selected-supported', type: 'kind-a', canPublish: false, socialAccount: { provider: 'facebook' } },
      { id: 'selected-unsupported', type: 'kind-b', socialAccount: { provider: 'facebook' } },
      { id: 'unentitled', type: 'kind-a', socialAccount: { provider: 'other' } },
    ] as never);
    platformFor.mockImplementation(async (_provider: string) => ({
      publish: vi.fn(), supportsTargetKind: (kind: string) => kind === 'kind-a',
    }));

    await expect(selectedPublishingTargetIds('workspace-1', entitlements, ['selected-supported', 'unentitled']))
      .resolves.toEqual(['selected-supported']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      workspaceId: 'workspace-1', enabled: true,
      id: { in: ['selected-supported', 'unentitled'] }, socialAccount: { is: expect.objectContaining({ workspaceId: 'workspace-1', invalidatedAt: null }) },
    }) }));
    expect(platformFor).toHaveBeenCalledTimes(1);
  });

  it('resolves a provider once for 96 selected destinations and rechecks on the next read', async () => {
    const targets = Array.from({ length: 96 }, (_, index) => ({ id: `channel-${index}`, type: index % 2 ? 'supported' : 'unsupported', socialAccount: { provider: 'facebook' } }));
    const findMany = vi.spyOn(prisma.target, 'findMany').mockResolvedValue(targets as never);
    platformFor.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: (kind: string) => kind === 'supported' });
    expect(await selectedPublishingTargetIds('workspace-1', entitlements)).toHaveLength(48);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(platformFor).toHaveBeenCalledTimes(1);
    platformFor.mockResolvedValue(null);
    expect(await selectedPublishingTargetIds('workspace-1', entitlements)).toEqual([]);
    expect(platformFor).toHaveBeenCalledTimes(2);
  });

  it('does not couple retained history visibility to the posts feature switch', async () => {
    const findMany = vi.spyOn(prisma.target, 'findMany').mockResolvedValue([
      { id: 'selected', type: 'kind-a', canPublish: false, socialAccount: { provider: 'facebook' } },
    ] as never);
    platformFor.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true });
    const featureSpecificEntitlements = { ...entitlements, features: { 'publishing/posts': false, 'publishing/calendar': true } } as unknown as Entitlements;
    await expect(selectedPublishingTargetIds('workspace-1', featureSpecificEntitlements)).resolves.toEqual(['selected']);
    expect(findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty('canPublish');
  });

  it('rejects a mismatched entitlement workspace before querying resources', async () => {
    const findMany = vi.spyOn(prisma.target, 'findMany');
    await expect(selectedPublishingTargetIds('workspace-2', entitlements)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps unrestricted access distinct from an empty selection and excludes mixed posts whole', () => {
    expect(publishingPostVisibilityWhere('workspace-1', null, 'author-1')).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] });
    expect(publishingPostVisibilityWhere('workspace-1', ['selected'], 'author-1')).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: ['selected'] } }, every: { targetId: { in: ['selected'] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] });
    expect(publishingPostVisibilityWhere('workspace-1', [], 'author-1')).toEqual({ workspaceId: 'workspace-1', OR: [
      { targets: { some: { targetId: { in: [] } }, every: { targetId: { in: [] } } } },
      { targets: { none: {} }, authorId: 'author-1' },
    ] });
  });
});
