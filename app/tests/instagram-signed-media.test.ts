import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ config: vi.fn(), secret: vi.fn(), source: vi.fn(), imageUrls: [] as string[] }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: m.secret }));
vi.mock('@/platforms/instagram/source-binding', () => ({ assertInstagramSource: m.source }));
vi.mock('@/platforms/instagram/container-journal', () => ({ instagramContainerJournal: () => ({ begin: async () => undefined, receipt: async () => undefined }) }));

import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
import { configuredInstagramAdapter } from '@/platforms/instagram/runtime';
import { verifyMediaShare } from '@/modules/publishing/server/media/signed-urls';
import type { PublishRequest } from '@/platforms/types';

const SECRET = 'test-share-secret';
const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = Math.floor(Date.now() / 1000);

function graphResponse(body: unknown) { return { ok: true, status: 200, json: async () => body }; }

function request(media: PublishRequest['media'], publication: PublishRequest['publication'] = { workspaceId: 'workspace-a', postId: 'post-a', postTargetId: 'target-row-a', targetId: 'target-a', actorId: 'user-a' }): PublishRequest {
  return {
    credential: { accessToken: 'token', grantedScopes: [...INSTAGRAM_POLICY_DEFAULTS.publishScopes] },
    target: { id: 'remote-ig', name: '', kind: 'professional' },
    formatId: 'image', text: 'hello', media, publication, operationId: 'operation-a',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.imageUrls = [];
  m.config.mockImplementation(async (key: string) => {
    if (key === 'instagram.policy') return INSTAGRAM_POLICY_DEFAULTS;
    if (key === 'publishing.maxImageUploadBytes') return 1000;
    if (key === 'publishing.allowedImageMimeTypes') return ['image/jpeg', 'image/png'];
    if (key === 'publishing.mediaShareExpirySeconds') return 3600;
    if (key === 'app.publicOrigin') return 'https://app.test';
    return undefined;
  });
  m.secret.mockImplementation(async (key: string) => key === 'instagram.appSecret' ? 'app-secret' : key === 'publishing.mediaShareSecret' ? SECRET : null);
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: { method?: string; body?: unknown }) => {
    const path = String(url);
    if (init?.method === 'POST' && path.includes('/media_publish')) return graphResponse({ id: 'ig-media-1' });
    if (init?.method === 'POST') {
      const fields = init.body as URLSearchParams;
      m.imageUrls.push(fields.get('image_url') ?? '');
      return graphResponse({ id: 'container-1' });
    }
    if (path.includes('status_code')) return graphResponse({ status_code: 'FINISHED' });
    return graphResponse({ permalink: 'https://www.instagram.com/p/x/' });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('instagram uploaded-image declaration', () => {
  it('advertises the shared media limits while signed delivery is available', async () => {
    const adapter = await configuredInstagramAdapter('en');
    expect(adapter.localImageUpload).toEqual({ maxBytes: 1000, mimeTypes: ['image/jpeg', 'image/png'] });
  });

  it.each([
    ['missing share secret', null, 'https://app.test'],
    ['plain HTTP origin', SECRET, 'http://app.test'],
  ])('advertises nothing with %s', async (_name, secret, origin) => {
    m.secret.mockImplementation(async (key: string) => key === 'instagram.appSecret' ? 'app-secret' : key === 'publishing.mediaShareSecret' ? secret : null);
    m.config.mockImplementation(async (key: string) => {
      if (key === 'instagram.policy') return INSTAGRAM_POLICY_DEFAULTS;
      if (key === 'publishing.maxImageUploadBytes') return 1000;
      if (key === 'publishing.allowedImageMimeTypes') return ['image/jpeg'];
      if (key === 'app.publicOrigin') return origin;
      return undefined;
    });
    expect((await configuredInstagramAdapter('en')).localImageUpload).toBeUndefined();
  });
});

describe('instagram stored-media publishing', () => {
  const stored = { kind: 'image' as const, url: `media:${IMAGE_ID}`, localFile: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', fileName: 'a.jpg' } };

  it('sends a signed workspace URL for a stored image instead of refusing it', async () => {
    const adapter = await configuredInstagramAdapter('en');
    await expect(adapter.publish!(request([stored]))).resolves.toMatchObject({ remoteId: 'ig-media-1', state: 'published' });
    expect(m.imageUrls).toHaveLength(1);
    const url = new URL(m.imageUrls[0]!);
    expect(url.origin + url.pathname).toBe(`https://app.test/api/media/${IMAGE_ID}`);
    expect(verifyMediaShare({ workspaceId: url.searchParams.get('ws')!, id: IMAGE_ID, exp: Number(url.searchParams.get('exp')), sig: url.searchParams.get('sig')! }, SECRET, NOW)).toBe(true);
  });

  it('passes public media URLs through untouched', async () => {
    const adapter = await configuredInstagramAdapter('en');
    await adapter.publish!(request([{ kind: 'image', url: 'https://cdn.test/a.jpg' }]));
    expect(m.imageUrls).toEqual(['https://cdn.test/a.jpg']);
  });

  it('refuses stored images without dispatching when signed delivery is unavailable', async () => {
    m.secret.mockImplementation(async (key: string) => key === 'instagram.appSecret' ? 'app-secret' : null);
    const adapter = await configuredInstagramAdapter('en');
    await expect(adapter.publish!(request([stored]))).rejects.toMatchObject({ outcome: 'rejected' });
    expect(m.imageUrls).toEqual([]);
  });

  it('refuses stored images without a workspace to scope the grant to', async () => {
    const adapter = await configuredInstagramAdapter('en');
    await expect(adapter.publish!({ ...request([stored]), publication: undefined })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(m.imageUrls).toEqual([]);
  });
});
