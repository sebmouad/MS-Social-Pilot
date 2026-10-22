import { describe, expect, it, vi } from 'vitest';
import { createMastodonAdapter, normaliseInstance } from '@/platforms/mastodon/adapter';
import { MASTODON_POLICY_DEFAULTS as policy, MASTODON_CONFIG } from '@/platforms/mastodon/config';
import { mastodonModule } from '@/platforms/mastodon/manifest';
const credential = { accessToken: 'fixture-token' };
const target = { id: '1@mastodon.social', name: 'Example', kind: 'mastodon-account' };
const me = { id: '1', display_name: 'Example', acct: 'example' };
function fixture(responses: unknown[]) {
  const transport = vi.fn(async (_url: string, _init: RequestInit & { timeoutMs: number }) => { const response = responses.shift(); if (response instanceof Error) throw response; return response; });
  return { transport, adapter: createMastodonAdapter(policy, { instance: 'mastodon.social', transport, sleep: async () => {} }) };
}
describe('Mastodon isolated platform', () => {
  it('sanitizes transport failures in the selected language', async () => {
    const adapter = createMastodonAdapter(policy, { instance: 'mastodon.social', locale: 'fr', transport: async () => { throw new Error('private-token-and-host'); } });
    await expect(adapter.discover({ credential })).rejects.toThrow(policy.copy.unavailable.fr);
    expect(adapter.capabilities).toEqual(mastodonModule.capabilities);
  });
  it('normalises server and account input while rejecting unsafe URL shapes', () => {
    expect(normaliseInstance('@example@mastodon.social')).toBe('https://mastodon.social');
    for (const input of ['http://mastodon.social', 'https://user:pass@mastodon.social', 'https://mastodon.social/path', 'https://127.0.0.1', 'localhost', 'https://foo.internal', 'https://mastodon.social:444']) expect(() => normaliseInstance(input)).toThrow();
  });
  it('keeps customer capabilities unavailable until persistence and host integration', () => {
    expect(Object.values(mastodonModule.capabilities).every(value => value === 'unsupported')).toBe(true);
    expect(MASTODON_CONFIG.find(item => item.key === 'platforms.mastodon.enabled')?.defaultValue).toBe(false);
  });
  it('registers per-server OAuth app and exchanges authorization code', async () => {
    const { adapter, transport } = fixture([{ client_id: 'app', client_secret: 'secret' }, { access_token: 'token' }]);
    expect(await adapter.registerApp('https://app.example/callback', 'https://app.example')).toEqual({ clientId: 'app', clientSecret: 'secret' });
    const start = new URL(adapter.getAuthorizationUrl({ appId: 'app', redirectUri: 'https://app.example/callback', state: 'signed-state', scopes: [] }));
    expect(start.searchParams.get('state')).toBe('signed-state');
    expect(start.searchParams.get('scope')).toContain('write:media');
    expect(await adapter.exchangeCode({ appId: 'app', appSecret: 'secret', code: 'code', redirectUri: 'https://app.example/callback' })).toEqual({ accessToken: 'token' });
    expect(transport.mock.calls[0]?.[0]).toBe('https://mastodon.social/api/v1/apps');
  });
  it('discovers the authenticated server-scoped account and preserves publish idempotency', async () => {
    const { adapter, transport } = fixture([me, me, { id: '10', url: 'https://mastodon.social/@example/10' }]);
    expect((await adapter.discover({ credential })).targets).toEqual([target]);
    expect(await adapter.publish({ credential, target, text: 'Hello', operationId: 'attempt-1' })).toMatchObject({ remoteId: '10', state: 'published' });
    expect(transport.mock.calls[2]?.[1]).toMatchObject({ redirect: 'error', timeoutMs: policy.timeoutMs, headers: { 'idempotency-key': 'attempt-1' } });
  });
  it('rejects target substitution before a status write', async () => {
    const { adapter, transport } = fixture([me]);
    await expect(adapter.publish({ credential, target: { ...target, id: '2@mastodon.social' }, text: 'Hello', operationId: 'attempt' })).rejects.toThrow('ownership');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('polls uploaded local media, then publishes', async () => {
    const { adapter, transport } = fixture([me, { id: '20', url: null }, { id: '20', url: 'https://cdn.example/image' }, { id: '10' }]);
    await adapter.publish({ credential, target, text: 'Hello', operationId: 'attempt', media: [{ kind: 'image', url: '', altText: 'A tree', localFile: { bytes: new Uint8Array([1, 2]), mimeType: 'image/png', fileName: 'tree.png' } }] });
    expect(transport.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(transport.mock.calls[3]?.[1]?.body))).toMatchObject({ media_ids: ['20'] });
  });
  it('does not publish while media preparation remains unresolved', async () => {
    const transport = vi.fn(async (url: string) => url.endsWith('verify_credentials') ? me : { id: '20', url: null });
    const adapter = createMastodonAdapter({ ...policy, pollAttempts: 1 }, { instance: 'mastodon.social', transport, sleep: async () => {} });
    await expect(adapter.publish({ credential, target, text: 'Hello', operationId: 'attempt', media: [{ kind: 'image', url: '', localFile: { bytes: new Uint8Array([1]), mimeType: 'image/png', fileName: 'a.png' } }] })).rejects.toThrow('unresolved');
    expect(transport.mock.calls.some(([url]) => url.endsWith('/statuses'))).toBe(false);
  });
  it('checks status and delete ownership without hiding uncertain failures', async () => {
    const { adapter, transport } = fixture([me, { id: '10', account: { id: '2' } }]);
    await expect(adapter.deleteRemote({ credential, remoteId: '10' })).rejects.toThrow('ownership');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(adapter.classifyPublishingFailure()).toBe('uncertain');
    const owned = fixture([me, { id: '10', account: { id: '1' } }, me, { id: '10', account: { id: '1' } }, { id: '10' }]);
    expect(await owned.adapter.getRemoteStatus({ credential, target, remoteId: '10' })).toEqual({ state: 'published', remoteId: '10', targetId: target.id });
    await owned.adapter.deleteRemote({ credential, remoteId: '10' });
    expect(owned.transport.mock.calls[4]?.[1]?.method).toBe('DELETE');
  });
});
