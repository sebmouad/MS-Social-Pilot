import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), targets: vi.fn(), selectedTargets: vi.fn(), posts: vi.fn(), ads: vi.fn(), adWhere: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children }: { children: unknown }) => children }));
vi.mock('../src/server/platforms/registry', () => ({ enabledSocialAccountWhere: async () => ({ provider: { in: ['facebook'] } }) }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: () => true }));
vi.mock('../src/server/ads/queries', () => ({ getAdsAccountWhere: state.adWhere }));
vi.mock('../src/server/data', () => ({ getTargets: state.selectedTargets, prisma: { target: { findMany: state.targets }, post: { count: state.posts }, adAccount: { count: state.ads } } }));
import HomePage from '../src/app/home/page';

const workspaceId = 'workspace-a';
const accountWhere = { workspaceId, enabled: true, socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: ['facebook'] } } } };
beforeEach(() => {
  vi.resetAllMocks();
  state.viewer.mockResolvedValue({ user: { id: 'owner' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: {}, permissions: { pageScope: { all: true, ids: [] } } });
  state.targets.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ socialAccountId: `source-${i}` })));
  state.selectedTargets.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({ id: `channel-${i}`, socialAccount: { invalidatedAt: null } })));
  state.posts.mockResolvedValue(2); state.ads.mockResolvedValue(3); state.adWhere.mockResolvedValue(accountWhere);
});

describe('Home resource inventory', () => {
  it('counts the same selected resources as customer lists', async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('<dt>Connected channels</dt><dd>4</dd>');
    expect(state.ads).toHaveBeenCalledWith({ where: accountWhere });
    expect(state.adWhere).toHaveBeenCalledWith(workspaceId, undefined);
  });
  it('uses the current member scope and excludes posts partly assigned elsewhere', async () => {
    state.viewer.mockResolvedValue({ user: { id: 'member' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: {}, permissions: { pageScope: { all: false, ids: ['channel-allowed'] } } });
    await HomePage();
    expect(state.adWhere).toHaveBeenCalledWith(workspaceId, ['channel-allowed']);
    expect(state.posts).toHaveBeenCalledWith({ where: { workspaceId, status: 'published', targets: { some: { targetId: { in: ['channel-allowed'] } }, every: { targetId: { in: ['channel-allowed'] } } } } });
  });
});
