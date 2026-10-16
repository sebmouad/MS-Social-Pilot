import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ targets: vi.fn(), enabled: vi.fn(), adapter: vi.fn() }));
vi.mock('../src/server/data', () => ({ getTargets: deps.targets }));
vi.mock('../src/server/entitlements', () => ({ hasPlatformCapability: deps.enabled }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: deps.adapter }));
import { publishingDestinationChoices } from '../src/server/publishing/destinations';
import type { requireViewer } from '../src/server/context';

const now = new Date('2026-10-16T09:00:00Z');
const target = (id: string, overrides = {}) => ({ id, name: id, type: 'channel', canPublish: true, socialAccount: { provider: 'example-network', invalidatedAt: null, tokenExpiresAt: null }, ...overrides });
const viewer = { workspaceId: 'workspace-a', entitlements: {}, permissions: { pageScope: { all: false, ids: ['current', 'expired', 'revoked'] } } } as unknown as Awaited<ReturnType<typeof requireViewer>>;
beforeEach(() => { vi.clearAllMocks(); deps.enabled.mockReturnValue(true); deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true }); });

describe('shared publishing destination choices', () => {
  it('requests scoped selected targets and marks expired and revoked sources unavailable', async () => {
    deps.targets.mockResolvedValue([
      target('current'),
      target('expired', { socialAccount: { provider: 'example-network', invalidatedAt: null, tokenExpiresAt: now } }),
      target('revoked', { socialAccount: { provider: 'example-network', invalidatedAt: new Date(), tokenExpiresAt: null } }),
    ]);
    const choices = await publishingDestinationChoices(viewer, now);
    expect(deps.targets).toHaveBeenCalledWith('workspace-a', ['current', 'expired', 'revoked']);
    expect(choices.map(item => [item.id, item.canPublish])).toEqual([['current', true], ['expired', false], ['revoked', false]]);
    expect(choices[0]).not.toHaveProperty('socialAccount');
  });

  it('does not offer unsupported or disabled module destinations as publish-ready', async () => {
    deps.targets.mockResolvedValue([target('current')]);
    deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => false });
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    deps.enabled.mockReturnValue(false);
    deps.adapter.mockClear();
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    expect(deps.adapter).not.toHaveBeenCalled();
  });
});
