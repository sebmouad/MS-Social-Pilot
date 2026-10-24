import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkedinAdapter, linkedinCommentary } from '../src/platforms/linkedin/adapter';
import { POLICY_DEFAULTS as li, policySchema as liSchema, LINKEDIN_CONFIG } from '../src/platforms/linkedin/config';
import { createPinterestAdapter } from '../src/platforms/pinterest/adapter';
import { POLICY_DEFAULTS as pin, policySchema as pinSchema, PINTEREST_CONFIG } from '../src/platforms/pinterest/config';
import { createState as liState, openState as liOpen } from '../src/platforms/linkedin/oauth-state';
import { createState as pinState, openState as pinOpen } from '../src/platforms/pinterest/oauth-state';
import type { PublishRequest } from '../src/platforms/types';

const credential = { accessToken: 'synthetic-token', grantedScopes: ['w_member_social', 'w_organization_social', 'r_member_social', 'r_organization_social', 'rw_organization_admin', 'pins:write', 'pins:read'] };
const linkedinRequest: PublishRequest = { credential, target: { id: 'urn:li:person:fixture', name: 'Example Studio', kind: 'linkedin' }, text: 'An example #publication' };
const image = { kind: 'image' as const, url: 'https://media.example.test/photo.jpg', altText: 'A studio', localFile: { bytes: new Uint8Array([1, 2]), mimeType: 'image/jpeg', fileName: 'photo.jpg' } };
const pinterestRequest: PublishRequest = { credential, target: { id: 'board-fixture', name: 'Example recipes', kind: 'pinterest' }, text: 'An example recipe', media: [image] };
function fixture(...responses: Array<unknown | Response | Error>) {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('Unexpected request');
    return next instanceof Response ? next : Response.json(next);
  });
  return { fetcher, body: (index: number) => JSON.parse(String(fetcher.mock.calls[index]![1]!.body)), url: (index: number) => new URL(String(fetcher.mock.calls[index]![0])) };
}
const receipt = () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:fixture' } });
afterEach(() => vi.unstubAllEnvs());

describe('LinkedIn and Pinterest module fixtures', () => {
  it.each([[liSchema, li, LINKEDIN_CONFIG], [pinSchema, pin, PINTEREST_CONFIG]] as const)('validates Root policy and defaults off', (schema, defaults, config) => {
    expect(schema.parse(defaults)).toEqual(defaults);
    const { renewLeadSeconds: _lead, ...savedBeforeInstallation } = defaults;
    expect(schema.parse(savedBeforeInstallation).renewLeadSeconds).toBe(defaults.renewLeadSeconds);
    expect(config.find(row => row.key.endsWith('.enabled'))?.defaultValue).toBe(false);
    expect(() => schema.parse({ ...defaults, apiBaseUrl: 'https://user:secret@example.test' })).toThrow();
    expect(() => schema.parse({ ...defaults, maxImages: 99 })).toThrow();
    expect(config.every(row => row.consumption === 'active' && row.owner.kind === 'platform')).toBe(true);
  });
  it('encodes LinkedIn commentary and hashtags', () => {
    expect(linkedinCommentary('Hello @team [test] #été')).toBe('Hello \\@team \\[test\\] {hashtag|\\#|été}');
  });
  it('creates provider authorization URLs with the exact callback and state', () => {
    for (const engine of [createLinkedinAdapter(li), createPinterestAdapter(pin)]) {
      const url = new URL(engine.adapter.getAuthorizationUrl!({ appId: 'app', redirectUri: 'https://app.example.test/callback', state: 'nonce', scopes: ['one', 'two'] }));
      expect(url.searchParams.get('state')).toBe('nonce');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/callback');
    }
  });
  it('exchanges LinkedIn credentials without treating requested grants as granted', async () => {
    const f = fixture({ access_token: 'returned', expires_in: 3600 });
    const result = await createLinkedinAdapter(li, f.fetcher).exchange({ appId: 'app', appSecret: 'secret', redirectUri: 'https://app.example.test/cb', code: 'code' });
    expect(result.scopes).toEqual([]);
    expect(f.fetcher.mock.calls[0]![1]!.body).toBeInstanceOf(URLSearchParams);
  });
  it('discovers the member without requesting company access by default', async () => {
    const f = fixture({ sub: 'fixture', name: 'Example Studio' });
    expect(await createLinkedinAdapter(li, f.fetcher).adapter.discover!({ credential })).toEqual({ targets: [{ id: 'urn:li:person:fixture', name: 'Example Studio', kind: 'linkedin' }] });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('paginates approved company administrators and looks up names', async () => {
    const f = fixture({ sub: 'fixture', name: 'Studio' }, { elements: [{ organization: 'urn:li:organization:one' }] }, { localizedName: 'Company One' }, { elements: [] });
    const result = await createLinkedinAdapter({ ...li, organizationsEnabled: true, pageSize: 1 }, f.fetcher).adapter.discover!({ credential });
    expect(result.targets).toHaveLength(2);
    expect(f.url(3).searchParams.get('start')).toBe('1');
  });
  it('refuses truncated company discovery', async () => {
    const f = fixture({ sub: 'fixture', name: 'Studio' }, { elements: [{ organization: 'urn:li:organization:one' }] }, { localizedName: 'Company One' });
    await expect(createLinkedinAdapter({ ...li, organizationsEnabled: true, pageSize: 1, maxPages: 1 }, f.fetcher).adapter.discover!({ credential })).rejects.toThrow();
  });
  it('publishes text with a provider receipt and versioned headers', async () => {
    const f = fixture(receipt());
    const result = await createLinkedinAdapter(li, f.fetcher).adapter.publish!(linkedinRequest);
    expect(result).toMatchObject({ state: 'published', remoteId: 'urn:li:share:fixture' });
    expect(f.body(0).author).toBe(linkedinRequest.target.id);
    expect(new Headers(f.fetcher.mock.calls[0]![1]!.headers).get('linkedin-version')).toBe(li.version);
  });
  it('publishes an article link', async () => {
    const f = fixture(receipt());
    await createLinkedinAdapter(li, f.fetcher).adapter.publish!({ ...linkedinRequest, link: 'https://example.test/story' });
    expect(f.body(0).content.article.source).toBe('https://example.test/story');
  });
  it('uploads local image bytes and retains the link in commentary', async () => {
    const f = fixture({ value: { image: 'urn:li:image:one', uploadUrl: 'https://www.linkedin.com/upload' } }, new Response(null, { status: 201 }), receipt());
    await createLinkedinAdapter(li, f.fetcher).adapter.publish!({ ...linkedinRequest, media: [image], link: 'https://example.test/story' });
    expect(f.body(2).content.media).toEqual({ id: 'urn:li:image:one', altText: 'A studio' });
    expect(f.body(2).commentary).toContain('https://example.test/story');
    expect(f.fetcher.mock.calls[1]![1]!.body).toEqual(image.localFile.bytes);
  });
  it('refuses image upload redirects and hosts outside Root policy', async () => {
    const f = fixture({ value: { image: 'urn:li:image:one', uploadUrl: 'https://evil.example.test/upload' } });
    await expect(createLinkedinAdapter(li, f.fetcher).adapter.publish!({ ...linkedinRequest, media: [image] })).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0]![1]!.redirect).toBe('error');
  });
  it.each([{ ...linkedinRequest, media: [{ ...image, kind: 'video' as const }] }, { ...linkedinRequest, credential: { accessToken: 'x', grantedScopes: ['w_organization_social'] } }, { ...linkedinRequest, scheduledAt: new Date() }])('refuses unsupported LinkedIn intent before network', async request => {
    const f = fixture(); const engine = createLinkedinAdapter(li, f.fetcher);
    await expect(engine.adapter.publish!(request)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('keeps an unreceipted write uncertain', async () => {
    const f = fixture({}); const engine = createLinkedinAdapter(li, f.fetcher);
    const error = await engine.adapter.publish!(linkedinRequest).catch(error => error);
    expect(engine.adapter.classifyPublishingFailure!(error)).toBe('uncertain');
  });
  it('verifies LinkedIn status against both post and author', async () => {
    const f = fixture({ id: 'urn:li:share:fixture', author: 'urn:li:person:someone-else', lifecycleState: 'PUBLISHED' });
    expect(await createLinkedinAdapter(li, f.fetcher).adapter.getRemoteStatus!({ credential, target: linkedinRequest.target, remoteId: 'urn:li:share:fixture' })).toEqual({ state: 'unknown' });
  });
  it('paginates Pinterest boards using opaque bookmarks', async () => {
    const f = fixture({ items: [{ id: 'one', name: 'Board One' }], bookmark: 'a & b' }, { items: [{ id: 'two', name: 'Board Two' }], bookmark: null });
    expect((await createPinterestAdapter(pin, f.fetcher).adapter.discover!({ credential })).targets).toHaveLength(2);
    expect(f.url(1).searchParams.get('bookmark')).toBe('a & b');
  });
  it('rejects repeated bookmarks and exhausted discovery bounds', async () => {
    for (const maxPages of [1, 2]) {
      const f = fixture({ items: [], bookmark: 'again' }, { items: [], bookmark: 'again' });
      await expect(createPinterestAdapter({ ...pin, maxPages }, f.fetcher).adapter.discover!({ credential })).rejects.toThrow();
    }
  });
  it('publishes Pinterest multi-image Pins with alt text', async () => {
    const f = fixture({ id: 'pin-one' });
    expect(await createPinterestAdapter(pin, f.fetcher).adapter.publish!({ ...pinterestRequest, media: [image, image], link: 'https://example.test/recipe' })).toMatchObject({ state: 'published', remoteId: 'pin-one' });
    expect(f.body(0)).toMatchObject({ board_id: 'board-fixture', media_source: { source_type: 'multiple_image_urls' }, link: 'https://example.test/recipe', alt_text: 'A studio' });
    expect(f.body(0).media_source.items).toHaveLength(2);
  });
  it.each([[], [{ ...image, kind: 'video' as const }], Array.from({ length: 6 }, () => image), [{ ...image, url: 'http://example.test/image.jpg' }]].map(media => ({ media })))('refuses unsupported Pinterest media before network', async ({ media }) => {
    const f = fixture();
    await expect(createPinterestAdapter(pin, f.fetcher).adapter.publish!({ ...pinterestRequest, media })).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('requires Pinterest status to match the requested board', async () => {
    const f = fixture({ id: 'pin-one', board_id: 'other-board' }, { id: 'pin-one', board_id: 'board-fixture' });
    const adapter = createPinterestAdapter(pin, f.fetcher).adapter;
    expect(await adapter.getRemoteStatus!({ credential, target: pinterestRequest.target, remoteId: 'pin-one' })).toEqual({ state: 'unknown' });
    expect(await adapter.getRemoteStatus!({ credential, target: pinterestRequest.target, remoteId: 'pin-one' })).toMatchObject({ state: 'published', targetId: 'board-fixture' });
  });
  it('deletes Pinterest Pins and treats an already absent Pin as settled', async () => {
    const f = fixture(new Response(null, { status: 204 }), new Response(null, { status: 404 }));
    const adapter = createPinterestAdapter(pin, f.fetcher).adapter;
    await adapter.deleteRemote!({ credential, remoteId: 'pin/one' });
    await adapter.deleteRemote!({ credential, remoteId: 'pin/one' });
    expect(f.url(0).pathname).toBe('/v5/pins/pin%2Fone');
    expect(f.fetcher.mock.calls[0]![1]!.method).toBe('DELETE');
  });
  it('renews Pinterest tokens with Basic authentication and records provider grants', async () => {
    const f = fixture({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600, scope: 'pins:read,pins:write' });
    const result = await createPinterestAdapter(pin, f.fetcher).renew('app', 'secret', 'old-refresh');
    expect(result).toMatchObject({ accessToken: 'fresh', refreshToken: 'rotated', scopes: ['pins:read', 'pins:write'] });
    expect(new Headers(f.fetcher.mock.calls[0]![1]!.headers).get('authorization')).toBe(`Basic ${Buffer.from('app:secret').toString('base64')}`);
    expect((f.fetcher.mock.calls[0]![1]!.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
  });
  it('treats transport and server failures as uncertain and never exposes the provider body', async () => {
    for (const response of [new Error('timeout'), new Response('private provider detail', { status: 500 })]) {
      const f = fixture(response); const adapter = createPinterestAdapter(pin, f.fetcher).adapter;
      const error = await adapter.publish!(pinterestRequest).catch(error => error);
      expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain');
      expect(String(error)).not.toContain('private provider detail');
    }
  });
  it.each([[liState, liOpen], [pinState, pinOpen]])('binds encrypted state to person, workspace, callback and expiry', (create, open) => {
    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    const redirect = 'https://app.example.test/callback';
    const state = create('user', 'workspace', redirect, 60, 1000);
    expect(state.cookie).not.toContain('workspace');
    expect(open(state.cookie, state.state, 'user', 'workspace', redirect, 1001)).not.toBeNull();
    expect(open(state.cookie, state.state, 'other', 'workspace', redirect, 1001)).toBeNull();
    expect(open(state.cookie, state.state, 'user', 'other', redirect, 1001)).toBeNull();
    expect(open(state.cookie, state.state, 'user', 'workspace', 'https://other.example.test', 1001)).toBeNull();
    expect(open(state.cookie, state.state, 'user', 'workspace', redirect, 61000)).toBeNull();
    expect(open(state.cookie, 'wrong', 'user', 'workspace', redirect, 1001)).toBeNull();
    expect(open(state.cookie + 'tamper', state.state, 'user', 'workspace', redirect, 1001)).toBeNull();
  });
});
