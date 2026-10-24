import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, FacebookApiError } from '../src/platforms/facebook/publishing';
import { availablePublishingFormats } from '../src/modules/publishing/formats';

const config = { graphBaseUrl: 'https://graph.example.com', oauthBaseUrl: 'https://www.example.com', graphVersion: 'v21.0', requestTimeoutMs: 1000, maxPages: 1, pageSize: 10,
  pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };
const labels = { videoLabel: 'Video post', reelLabel: 'Reel', storyPhotoLabel: 'Photo Story', storyVideoLabel: 'Video Story' };
const deleteCredential = { accessToken: 't', grantedScopes: ['pages_manage_posts'] } as never;
const commentCredential = { accessToken: 't', grantedScopes: ['pages_manage_engagement'] } as never;

function build(answer: unknown, nativeOn = true) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = createFacebookAdapter(config, fetchMock, { postDeleteScopes: ['pages_manage_posts'], firstCommentScopes: ['pages_manage_engagement'],
    ...(nativeOn ? { native: { publish: vi.fn(), ...labels } } : {}) });
  return { adapter, calls };
}

describe('native format catalog reaches the neutral authoring projection', () => {
  it('exposes video, Reel and both Stories only while the private switch is on', () => {
    const on = availablePublishingFormats(build({}).adapter.publishingFormats).map(f => f.id);
    expect(on).toHaveLength(5);
    expect(on.slice(1)).toEqual(['video', 'reel', 'story_photo', 'story_video']);
    expect(availablePublishingFormats(build({}, false).adapter.publishingFormats)).toHaveLength(1);
  });

  it('declares comment and delete only where the adapter honours them', () => {
    const formats = Object.fromEntries(build({}).adapter.publishingFormats!.map(f => [f.id, f]));
    for (const id of Object.keys(formats).filter(id => !id.startsWith('story_'))) expect(formats[id]).toMatchObject({ firstComment: true, remoteDelete: true });
    for (const id of ['story_photo', 'story_video']) expect(formats[id]).toMatchObject({ firstComment: false, remoteDelete: false });
  });
});

describe('format-aware remote deletion', () => {
  it('deletes a video or Reel only on an explicit success:true answer', async () => {
    for (const formatId of ['video', 'reel']) {
      const { adapter, calls } = build({ success: true });
      await adapter.deleteRemote!({ credential: deleteCredential, remoteId: `${formatId}-1`, formatId });
      expect(calls).toEqual([`DELETE /v21.0/${formatId}-1`]);
    }
  });

  it.each([{ success: 'true' }, { success: false }, {}, { id: 'x' }, []])('does not treat %j as a confirmed deletion', async answer => {
    const { adapter, calls } = build(answer);
    await expect(adapter.deleteRemote!({ credential: deleteCredential, remoteId: 'reel-1', formatId: 'reel' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toHaveLength(1);
  });

  it('refuses Stories, unknown formats and unsafe ids before any request', async () => {
    const { adapter, calls } = build({ success: true });
    for (const formatId of ['story_photo', 'story_video', 'story', 'groups']) {
      await expect(adapter.deleteRemote!({ credential: deleteCredential, remoteId: 'x-1', formatId })).rejects.toBeInstanceOf(FacebookApiError);
    }
    for (const remoteId of ['', '../me', 'a/b', 'a?fields=id', ' 1', 'x'.repeat(129)]) {
      await expect(adapter.deleteRemote!({ credential: deleteCredential, remoteId, formatId: 'reel' })).rejects.toBeInstanceOf(FacebookApiError);
    }
    expect(calls).toEqual([]);
  });

  it('keeps existing video and Reel content removable with the private switch off, but never a Story', async () => {
    const { adapter, calls } = build({ success: true }, false);
    await adapter.deleteRemote!({ credential: deleteCredential, remoteId: 'reel-1', formatId: 'reel' });
    await expect(adapter.deleteRemote!({ credential: deleteCredential, remoteId: 's-1', formatId: 'story_photo' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toEqual(['DELETE /v21.0/reel-1']);
  });

  it('keeps the feed path unchanged when no format is sent and still requires the delete grant', async () => {
    const { adapter, calls } = build({ success: true });
    await adapter.deleteRemote!({ credential: deleteCredential, remoteId: 'page_post-1' });
    await expect(adapter.deleteRemote!({ credential: { accessToken: 't', grantedScopes: [] } as never, remoteId: 'reel-1', formatId: 'reel' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toEqual(['DELETE /v21.0/page_post-1']);
  });
});

describe('format-aware first comments', () => {
  it('comments on feed, video and Reel and refuses Stories or unknown formats before any request', async () => {
    const { adapter, calls } = build({ id: 'c1' });
    for (const formatId of [undefined, 'post', 'video', 'reel']) {
      expect(await adapter.publishFirstComment!({ credential: commentCredential, remotePostId: 'p-1', text: 'Hi', formatId })).toEqual({ remoteId: 'c1' });
    }
    expect(calls).toHaveLength(4);
    for (const formatId of ['story_photo', 'story_video', 'story', 'groups']) {
      await expect(adapter.publishFirstComment!({ credential: commentCredential, remotePostId: 'p-1', text: 'Hi', formatId })).rejects.toBeInstanceOf(FacebookApiError);
    }
    expect(calls).toHaveLength(4);
  });

  it('refuses a native comment while the private switch is off', async () => {
    const { adapter, calls } = build({ id: 'c1' }, false);
    await expect(adapter.publishFirstComment!({ credential: commentCredential, remotePostId: 'p-1', text: 'Hi', formatId: 'reel' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toEqual([]);
  });
});
