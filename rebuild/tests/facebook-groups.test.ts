import { describe, expect, it, vi } from 'vitest';
import { createFacebookGroupOperations } from '../src/platforms/facebook/groups';
import { createFacebookAdapter, createFacebookEngine } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://login.example.test', graphVersion: 'v99.0',
  requestTimeoutMs: 2000, maxPages: 2, pageSize: 7, pageInsightMetrics: [], adInsightFields: [],
  maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: 'fixture-secret',
};
const policy = { discoveryScopes: ['groups_access_member_info'], publishScopes: ['publish_to_groups'], readScopes: ['groups_access_member_info'] };
const credential = { accessToken: 'fixture-user-token', grantedScopes: ['groups_access_member_info', 'publish_to_groups'] };
const target = { id: '123', name: 'Example community', kind: 'group' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const listing = () => reply({ data: [{ id: '123', name: 'Example community' }] });
function transport(...responses: Response[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected fixture request');
    return next;
  });
}

describe('private Facebook Group protocol compatibility', () => {
  it('does not expose Groups as usable customer targets or publishing formats', () => {
    const adapter = createFacebookAdapter(config, transport());
    expect(adapter.supportsTargetKind?.('group', 'publishing')).toBe(false);
    expect(adapter.publishingFormats?.map(format => format.id)).toEqual(['post']);
  });

  it('discovers neutral Group targets using the user token, signing and Root pagination bounds', async () => {
    const fetcher = transport(reply({ data: [{ id: '123', name: 'Example community' }], paging: { next: 'https://graph.example.test/v99.0/me/groups?after=next&access_token=other' } }), reply({ data: [{ id: '456', name: 'Second community' }] }));
    const result = await createFacebookGroupOperations(config, policy, fetcher).discover(credential);
    expect(result).toEqual({ state: 'available', targets: [target, { id: '456', name: 'Second community', kind: 'group' }] });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/v99.0/me/groups');
    expect(url.searchParams.get('limit')).toBe('7');
    expect(url.searchParams.get('admin_only')).toBe('true');
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
    const next = new URL(String(fetcher.mock.calls[1][0]));
    expect(next.searchParams.get('access_token')).toBe('fixture-user-token');
    expect(next.searchParams.get('appsecret_proof')).toBe(url.searchParams.get('appsecret_proof'));
  });

  it('distinguishes a successful empty collection from missing grants and provider denial', async () => {
    const fetcher = transport(reply({ data: [] }));
    const groups = createFacebookGroupOperations(config, policy, fetcher);
    await expect(groups.discover(credential)).resolves.toEqual({ state: 'available', targets: [] });
    fetcher.mockClear();
    await expect(groups.discover({ accessToken: 'fixture', grantedScopes: ['pages_manage_posts'] })).resolves.toEqual({ state: 'unavailable', targets: [], reason: 'missing_grant' });
    expect(fetcher).not.toHaveBeenCalled();
    for (const code of [10, 100, 200]) {
      await expect(createFacebookGroupOperations(config, policy, transport(reply({ error: { code, message: 'Private provider text' } }, 400))).discover(credential))
        .resolves.toEqual({ state: 'unavailable', targets: [], reason: 'provider_denied' });
    }
  });

  it.each([190, 4])('does not disguise authentication/rate failures (%s) as an empty collection', async code => {
    await expect(createFacebookGroupOperations(config, policy, transport(reply({ error: { code } }, 400))).discover(credential)).rejects.toMatchObject({ code });
  });

  it.each([
    { data: [{ id: '123', name: 'Example' }], paging: { next: 'https://evil.example/v99.0/me/groups' } },
    { data: [{ id: '123', name: 'Example' }], paging: { next: 'https://graph.example.test/v99.0/me/groups?after=1' } },
  ])('never treats an unsafe or truncated listing as complete authority', async body => {
    await expect(createFacebookGroupOperations({ ...config, maxPages: 1 }, policy, transport(reply(body))).discover(credential)).rejects.toThrow();
  });

  it.each([{ text: 'A community update' }, { text: 'Read this', link: 'https://example.test/article' }])('publishes feed/link content only after positive discovery', async content => {
    const fetcher = transport(listing(), reply({ id: '123_987' }));
    const result = await createFacebookGroupOperations(config, policy, fetcher).publish({ credential, target, ...content });
    expect(result).toEqual({ state: 'submitted', remoteId: '123_987', url: null });
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/v99.0/123/feed');
    const form = fetcher.mock.calls[1][1]?.body as URLSearchParams;
    expect(form.get('message')).toBe(content.text);
    expect(form.get('link')).toBe('link' in content ? content.link : null);
    expect(form.get('access_token')).toBe('fixture-user-token');
    expect(form.has('appsecret_proof')).toBe(true);
  });

  it('uses Group photo message semantics and keeps the post receipt rather than the photo id', async () => {
    const fetcher = transport(listing(), reply({ id: 'photo987', post_id: '123_987' }));
    await expect(createFacebookGroupOperations(config, policy, fetcher).publish({ credential, target, text: 'Photo caption', media: [{ kind: 'image', url: 'https://example.test/image.jpg' }] }))
      .resolves.toEqual({ state: 'submitted', remoteId: '123_987', url: null });
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/v99.0/123/photos');
    const body = fetcher.mock.calls[1][1]?.body as URLSearchParams;
    expect(body.get('message')).toBe('Photo caption');
    expect(body.has('caption')).toBe(false);
    expect(body.get('url')).toBe('https://example.test/image.jpg');
  });

  it('refuses Page grants, absent targets, denied discovery and empty policy before creating content', async () => {
    for (const [grants, discovered, selectedPolicy] of [
      [['pages_manage_posts'], listing(), policy],
      [credential.grantedScopes, reply({ data: [{ id: '456', name: 'Other' }] }), policy],
      [credential.grantedScopes, reply({ error: { code: 200 } }, 400), policy],
      [credential.grantedScopes, listing(), { ...policy, publishScopes: [] }],
    ] as const) {
      const fetcher = transport(discovered);
      await expect(createFacebookGroupOperations(config, selectedPolicy, fetcher).publish({ credential: { ...credential, grantedScopes: grants }, target, text: 'Example' })).rejects.toThrow();
      expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1]?.method === 'GET')).toBe(true);
    }
  });

  it.each([
    { scheduledAt: new Date('2030-01-01') }, { formatId: 'reel' },
    { media: [{ kind: 'video' as const, url: 'https://example.test/video.mp4' }] },
    { media: [{ kind: 'image' as const, url: 'https://example.test/a.jpg' }, { kind: 'image' as const, url: 'https://example.test/b.jpg' }] },
  ])('rejects Page-only intent without transport', async input => {
    const fetcher = transport();
    await expect(createFacebookGroupOperations(config, policy, fetcher).publish({ credential, target, text: 'Example', ...input })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: '123_987', is_published: true, created_time: '2026-10-01T12:00:00Z' }, 'published'],
    [{ id: 'photo987', to: { data: [{ id: '123' }] }, is_published: true }, 'published'],
    [{ id: '123_987', is_published: false }, 'unknown'],
    [{ id: '123_987', created_time: '2026-10-01T12:00:00Z' }, 'unknown'],
    [{ id: '456_987', is_published: true }, 'unknown'],
    [{ id: '123_987', to: { data: [{ id: '456' }] }, is_published: true }, 'unknown'],
  ])('maps only exact Group identity and explicit publication proof (%s)', async (body, state) => {
    const fetcher = transport(listing(), reply(body));
    const remoteId = body.id === 'photo987' ? 'photo987' : '123_987';
    const result = await createFacebookGroupOperations(config, policy, fetcher).getRemoteStatus({ credential, target, remoteId });
    expect(result.state).toBe(state);
    if (result.state === 'published') expect(result).toMatchObject({ remoteId, targetId: '123' });
  });

  it('maps denied readback to unknown rather than published, scheduled or deleted', async () => {
    const groups = createFacebookGroupOperations(config, policy, transport(listing(), reply({ error: { code: 200 } }, 400)));
    await expect(groups.getRemoteStatus({ credential, target, remoteId: '123_987' })).resolves.toEqual({ state: 'unknown' });
  });

  it('guards the low-level Group publish path against native schedules too', async () => {
    const fetcher = transport();
    await expect(createFacebookEngine(config, fetcher).publish({ accessToken: 'fixture', targetId: '123', targetKind: 'group', text: 'Example', scheduledUnix: 1900000000 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains local photo validation and multipart signing for Group uploads', async () => {
    const fetcher = transport(listing(), reply({ id: 'photo987', post_id: '123_987' }));
    const groups = createFacebookGroupOperations(config, policy, fetcher);
    await groups.publish({ credential, target, text: 'Example', media: [{ kind: 'image', url: 'local-reference', localFile: { bytes: new Uint8Array([255, 216, 255, 224]), mimeType: 'image/jpeg', fileName: 'example.jpg' } }] });
    const body = fetcher.mock.calls[1][1]?.body as FormData;
    expect(body.get('source')).toBeInstanceOf(Blob);
    expect(body.get('message')).toBe('Example');
    expect(body.get('access_token')).toBe('fixture-user-token');
    expect(body.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
    const invalid = transport(listing());
    await expect(createFacebookGroupOperations(config, policy, invalid).publish({ credential, target, text: 'Example', media: [{ kind: 'image', url: 'local-reference', localFile: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', fileName: 'example.jpg' } }] })).rejects.toThrow('content does not match');
    expect(invalid.mock.calls).toHaveLength(1); // Discovery only; no upload.
  });

  it('does not create a post after cancellation during discovery', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => { controller.abort(); return listing(); });
    await expect(createFacebookGroupOperations(config, policy, fetcher).publish({ credential, target, text: 'Example', signal: controller.signal })).rejects.toThrow('cancelled');
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it('does not suppress transient provider failures as retired-edge denial', async () => {
    await expect(createFacebookGroupOperations(config, policy, transport(reply({ error: { code: 200, is_transient: true } }, 400))).discover(credential)).rejects.toMatchObject({ transient: true });
  });

  it('does not accept targets from pagination that changes to another Graph collection', async () => {
    const fetcher = transport(reply({ data: [], paging: { next: 'https://graph.example.test/v99.0/me/accounts?after=1' } }), listing());
    await expect(createFacebookGroupOperations(config, policy, fetcher).discover(credential)).rejects.toThrow();
    expect(fetcher.mock.calls).toHaveLength(1);
  });
});
