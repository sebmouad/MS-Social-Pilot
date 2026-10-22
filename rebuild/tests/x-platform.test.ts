import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createXAdapter } from '@/platforms/x/adapter';
import { X_CONFIG, X_POLICY_DEFAULTS } from '@/platforms/x/config';
import { xModule } from '@/platforms/x/manifest';
const credential = { accessToken: 'fixture' }, target = { id: '12', name: '@fixture', kind: 'x' };
const make = (responses: unknown[]) => {
  const transport = vi.fn<typeof fetch>(async () => { const value = responses.shift(); if (value instanceof Error) throw value; return Response.json(value); });
  return { adapter: createXAdapter(X_POLICY_DEFAULTS, { clientId: 'id', clientSecret: 'secret' }, { fetch: transport, now: () => 0 }), transport };
};
describe('X staged protocol adapter', () => {
  it('fails closed and validates settings', () => {
    expect(xModule.capabilities.connection).toBe('supported');
    for (const setting of X_CONFIG) expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true);
  });
  it('uses S256 and trusted origin', () => {
    const { adapter } = make([]); const start = adapter.startOAuth({ requestOrigin: 'https://app.example', state: 'bound' });
    const url = new URL(start.url);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(start.verifier).digest('base64url'));
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/api/connections/x/callback');
    expect(() => adapter.startOAuth({ requestOrigin: 'https://app.example/evil', state: 'state' })).toThrow();
  });
  it('discovers the authenticated identity', async () => {
    const { adapter } = make([{ data: { id: '12', username: 'fixture' } }]);
    expect(await adapter.discover!({ credential })).toEqual({ targets: [target] });
  });
  it('uploads image bytes before creating one post', async () => {
    const { adapter, transport } = make([{ data: { id: '31' } }, { data: { id: '42' } }]);
    expect(await adapter.publish!({ credential, target, text: 'fixture', media: [{ kind: 'image', url: '', localFile: { bytes: new Uint8Array([1]), mimeType: 'image/png', fileName: 'test.png' } }] })).toEqual({ remoteId: '42', url: 'https://x.com/i/status/42', state: 'published' });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
  });
  it('rejects unsupported media and foreign target before networking', async () => {
    const { adapter, transport } = make([]);
    await expect(adapter.publish!({ credential, target, text: 'fixture', media: [{ kind: 'video', url: 'https://example.test/video' }] })).rejects.toThrow();
    await expect(adapter.publish!({ credential, target: { ...target, kind: 'foreign' }, text: 'fixture' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('never retries uncertain writes or leaks provider failures', async () => {
    const { adapter, transport } = make([new Error('private provider failure')]);
    try { await adapter.publish!({ credential, target, text: 'fixture' }); expect.fail(); } catch (error) { expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain'); expect(String(error)).not.toContain('private provider'); }
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('checks status author and explicit deletion receipt', async () => {
    const { adapter } = make([{ data: { id: '42', author_id: '99' } }, { data: { deleted: false } }]);
    expect(await adapter.getRemoteStatus!({ credential, target, remoteId: '42' })).toEqual({ state: 'unknown' });
    await expect(adapter.deleteRemote!({ credential, remoteId: '42' })).rejects.toThrow();
  });
  it('blocks after credential persistence fails', async () => {
    const { adapter } = make([{ access_token: 'new', refresh_token: 'rotated', expires_in: 7200 }]);
    const save = vi.fn(async () => { throw new Error('storage unavailable'); });
    await expect(adapter.renewCredential({ ...credential, refreshToken: 'old', expiresAt: new Date(0) }, save)).rejects.toThrow('storage unavailable');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rotated' }));
  });
});
