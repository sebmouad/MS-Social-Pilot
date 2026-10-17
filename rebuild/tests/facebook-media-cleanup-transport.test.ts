import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFacebookEngine } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const { findTarget, configValues, secret, engine } = vi.hoisted(() => ({
  findTarget: vi.fn(), configValues: new Map<string, unknown>(), secret: vi.fn(), engine: { getPhotoCleanupState: vi.fn(), deletePhoto: vi.fn() },
}));
vi.mock('@/server/data', () => ({ prisma: { target: { findFirst: findTarget } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => configValues.get(key)), runtimeSecret: secret }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: vi.fn(() => 'page-token') }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: vi.fn(async () => engine) }));

import { prepareFacebookMediaDeletion } from '../src/platforms/facebook/media-cleanup-transport';

const binding = { workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1', remotePhotoId: 'photo-1' };
const target = {
  id: binding.targetId, workspaceId: binding.workspaceId, providerId: binding.remoteTargetId, accessToken: 'encrypted-page-token',
  socialAccount: { provider: 'facebook', workspaceId: binding.workspaceId, scopes: 'pages_read_engagement pages_manage_posts', invalidatedAt: null, tokenExpiresAt: null },
};
const readyConfig = () => {
  configValues.set('meta.manualMediaCleanupEnabled', true);
  configValues.set('meta.mediaReadScopes', ['pages_read_engagement']);
  configValues.set('meta.mediaDeleteScopes', ['pages_manage_posts']);
  configValues.set('meta.appSecretProofEnabled', false);
  secret.mockResolvedValue(null);
  findTarget.mockResolvedValue(target);
};
const state = (changes: Record<string, unknown> = {}) => ({ id: 'photo-1', page_story_id: null, can_delete: true, ...changes });
const engineConfig: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: 'app-secret',
};

describe('Facebook staged photo cleanup transport', () => {
  beforeEach(() => {
    vi.clearAllMocks(); configValues.clear(); readyConfig();
    engine.getPhotoCleanupState.mockResolvedValue(state());
    engine.deletePhoto.mockResolvedValue(undefined);
  });

  it('checks policy, target binding, scopes, and token before returning a callback', async () => {
    configValues.set('meta.manualMediaCleanupEnabled', false);
    await expect(prepareFacebookMediaDeletion(binding)).rejects.toThrow('not currently ready');
    configValues.set('meta.manualMediaCleanupEnabled', true);
    findTarget.mockResolvedValue({ ...target, providerId: 'other-page' });
    await expect(prepareFacebookMediaDeletion(binding)).rejects.toThrow('not currently ready');
    findTarget.mockResolvedValue({ ...target, socialAccount: { ...target.socialAccount, scopes: 'pages_read_engagement' } });
    await expect(prepareFacebookMediaDeletion(binding)).rejects.toThrow('not currently ready');
    expect(engine.getPhotoCleanupState).not.toHaveBeenCalled();
  });

  it('reads the current photo immediately before deleting and confirms only an explicit success', async () => {
    const callback = await prepareFacebookMediaDeletion(binding);
    expect(engine.getPhotoCleanupState).not.toHaveBeenCalled();
    await expect(callback(new AbortController().signal)).resolves.toBe('confirmed');
    expect(engine.getPhotoCleanupState).toHaveBeenCalledWith('page-token', binding.remotePhotoId);
    expect(engine.deletePhoto).toHaveBeenCalledWith('page-token', binding.remotePhotoId, expect.any(Function));
  });

  it('allows a missing story field only under Root cleanup policy and does not treat it as proof of absence', async () => {
    engine.getPhotoCleanupState.mockResolvedValue({ id: 'photo-1', can_delete: true });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('confirmed');
    expect(configValues.get('meta.manualMediaCleanupEnabled')).toBe(true);
    expect(engine.deletePhoto).toHaveBeenCalledTimes(1);

    configValues.set('meta.manualMediaCleanupEnabled', false);
    await expect(prepareFacebookMediaDeletion(binding)).rejects.toThrow('not currently ready');
  });

  it.each([
    ['positive story link', state({ page_story_id: 'post-1' })],
    ['malformed story link', state({ page_story_id: 42 })],
    ['empty present story link', state({ page_story_id: '' })],
    ['not deletable', state({ can_delete: false })],
    ['mismatched identity', state({ id: 'other-photo' })],
    ['malformed identity', state({ id: null })],
  ])('refuses deletion when the fresh photo state has %s', async (_label, photoState) => {
    engine.getPhotoCleanupState.mockResolvedValue(photoState);
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
  });

  it('treats a failed fresh read as rejected without issuing delete', async () => {
    engine.getPhotoCleanupState.mockRejectedValue(new Error('provider internals with token=secret'));
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
  });

  it('does not delete when the cleanup policy is disabled during the fresh read', async () => {
    engine.getPhotoCleanupState.mockImplementation(async () => {
      configValues.set('meta.manualMediaCleanupEnabled', false);
      return state();
    });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
  });

  it('does not delete when the Page connection is revoked during the fresh read', async () => {
    engine.getPhotoCleanupState.mockImplementation(async () => {
      findTarget.mockResolvedValue({ ...target, socialAccount: { ...target.socialAccount, invalidatedAt: new Date() } });
      return state();
    });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
  });

  it('honors cancellation before the callback or before delete dispatch', async () => {
    const before = new AbortController(); before.abort();
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(before.signal)).resolves.toBe('rejected');
    engine.getPhotoCleanupState.mockImplementation(async () => { const controller = new AbortController(); controller.abort(); throw new Error('cancel'); });
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
  });

  it('classifies a definite Graph rejection after dispatch as rejected', async () => {
    engine.deletePhoto.mockImplementation(async (_token: string, _id: string, onDispatch: () => void) => {
      onDispatch();
      const { FacebookApiError } = await import('../src/platforms/facebook/publishing');
      throw new FacebookApiError('safe rejection', 400, 100);
    });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('rejected');
  });

  it('classifies any unproven result after dispatch as uncertain', async () => {
    engine.deletePhoto.mockImplementation(async (_token: string, _id: string, onDispatch: () => void) => { onDispatch(); throw new Error('raw response secret'); });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('uncertain');
  });

  it('keeps cancellation after DELETE dispatch uncertain', async () => {
    engine.deletePhoto.mockImplementation(async (_token: string, _id: string, onDispatch: () => void) => {
      onDispatch();
      const { FacebookApiError } = await import('../src/platforms/facebook/publishing');
      throw new FacebookApiError('cancelled after dispatch', 0);
    });
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('uncertain');
  });
});

describe('Facebook photo cleanup Graph requests', () => {
  it('reads the exact safety fields with appsecret proof and validates DELETE confirmation', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(state()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const subject = createFacebookEngine(engineConfig, fetcher as unknown as typeof fetch);
    await expect(subject.getPhotoCleanupState('page-token', 'photo-1')).resolves.toEqual(state());
    let dispatched = false;
    await subject.deletePhoto('page-token', 'photo-1', () => { dispatched = true; });
    expect(dispatched).toBe(true);
    const readUrl = new URL((fetcher.mock.calls[0][0] as URL).toString());
    expect(readUrl.pathname).toBe('/v99.0/photo-1');
    expect(readUrl.searchParams.get('fields')).toBe('id,page_story_id,can_delete');
    expect(readUrl.searchParams.get('appsecret_proof')).toBeTruthy();
    expect(fetcher.mock.calls[1][1]?.method).toBe('DELETE');
  });

  it('rejects false or malformed delete success bodies', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const subject = createFacebookEngine({ ...engineConfig, appSecretProofEnabled: false }, fetcher as unknown as typeof fetch);
    await expect(subject.deletePhoto('page-token', 'photo-1')).rejects.toThrow('did not confirm photo deletion');
  });

  it.each([{ success: false }, {}, { success: 'true' }])('treats ambiguous DELETE response %j as uncertain through the real Graph engine', async deletePayload => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'photo-1', can_delete: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(deletePayload), { status: 200 }));
    const realEngine = createFacebookEngine({ ...engineConfig, appSecretProofEnabled: false }, fetcher as unknown as typeof fetch);
    engine.getPhotoCleanupState = vi.fn(realEngine.getPhotoCleanupState);
    engine.deletePhoto = vi.fn(realEngine.deletePhoto);
    const callback = await prepareFacebookMediaDeletion(binding);
    await expect(callback(new AbortController().signal)).resolves.toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.method).toBe('DELETE');
  });
});
