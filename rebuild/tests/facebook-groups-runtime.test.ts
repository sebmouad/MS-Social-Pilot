import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => state.values.get(key),
  runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, state.values.get(key)])),
  runtimeSecret: async () => 'fixture-secret',
}));

import { configuredFacebookGroupOperations } from '../src/platforms/facebook/runtime';
import { CONFIG_BY_KEY, safeConfigShape } from '../src/lib/config/registry';

beforeEach(() => {
  state.values = new Map([...CONFIG_BY_KEY].map(([key, setting]) => [key, setting.defaultValue]));
  state.values.set('meta.graphBaseUrl', 'https://configured.example.test');
  state.values.set('meta.pageSize', 3);
  state.values.set('meta.groupDiscoveryScopes', ['custom_discovery']);
  state.values.set('meta.groupPublishScopes', ['custom_publish']);
  state.values.set('meta.groupReadScopes', ['custom_read']);
});
afterEach(() => vi.unstubAllGlobals());

describe('Root-configured private Group transport', () => {
  it('registers typed policies and uses the saved discovery grants and endpoint', async () => {
    for (const key of ['meta.groupDiscoveryScopes', 'meta.groupPublishScopes', 'meta.groupReadScopes']) {
      const setting = CONFIG_BY_KEY.get(key)!;
      expect(safeConfigShape().find(item => item.key === key)?.owner).toEqual({ kind: 'platform', id: 'facebook' });
      expect(setting.schema.safeParse(['']).success).toBe(false);
      expect(setting.schema.safeParse([]).success).toBe(true);
    }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal('fetch', fetcher);
    const groups = await configuredFacebookGroupOperations();
    await expect(groups.discover({ accessToken: 'fixture', grantedScopes: ['groups_access_member_info'] }))
      .resolves.toMatchObject({ state: 'unavailable', reason: 'missing_grant' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(groups.discover({ accessToken: 'fixture', grantedScopes: ['custom_discovery'] }))
      .resolves.toEqual({ state: 'available', targets: [] });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe('https://configured.example.test');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('consumes independent publishing and status policies without relaxing either', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const groups = await configuredFacebookGroupOperations();
    const request = { target: { id: '123', kind: 'group', name: 'Example' }, credential: { accessToken: 'fixture', grantedScopes: ['custom_discovery', 'publish_to_groups', 'groups_access_member_info'] } };
    await expect(groups.publish({ ...request, text: 'Example' })).rejects.toThrow();
    await expect(groups.getRemoteStatus({ ...request, remoteId: '123_456' })).resolves.toEqual({ state: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('permits the saved custom publishing/read policies only with exact target discovery', async () => {
    const payloads = [
      { data: [{ id: '123', name: 'Example' }] }, { id: '123_456' },
      { data: [{ id: '123', name: 'Example' }] }, { id: '123_456', is_published: true },
    ];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payloads.shift()))));
    const groups = await configuredFacebookGroupOperations();
    const request = { target: { id: '123', kind: 'group', name: 'Example' }, credential: { accessToken: 'fixture', grantedScopes: ['custom_discovery', 'custom_publish', 'custom_read'] } };
    await expect(groups.publish({ ...request, text: 'Example' })).resolves.toMatchObject({ state: 'submitted', remoteId: '123_456' });
    await expect(groups.getRemoteStatus({ ...request, remoteId: '123_456' })).resolves.toMatchObject({ state: 'published', targetId: '123', remoteId: '123_456' });
  });
});
