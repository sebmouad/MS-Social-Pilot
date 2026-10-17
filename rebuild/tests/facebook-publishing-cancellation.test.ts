import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, createFacebookEngine, createFacebookPublisher, FacebookApiError, FacebookMediaRecoveryError } from '../src/platforms/facebook/publishing';
import type { FacebookMediaJournal } from '../src/platforms/facebook/media-journal-port';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend', 'impressions'], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg', 'image/png'], appSecretProofEnabled: false,
};
const policy = { postPublishScopes: ['pages_manage_posts'], postDeleteScopes: ['pages_manage_posts'], postReadScopes: ['pages_read_engagement'], firstCommentScopes: ['pages_manage_engagement'] };
const credential = { accessToken: 'page-token', grantedScopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement'] };
const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const publishRequest = (signal?: AbortSignal) => ({
  credential, target: { id: 'page-1', name: 'Page', kind: 'page' }, text: 'Hello',
  ...(signal ? { signal } : {}),
});
const jpeg = (fileName: string) => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mimeType: 'image/jpeg', fileName });

describe('Facebook publishing cancellation', () => {
  it('does not dispatch a publish request when its signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const publish = createFacebookPublisher(config, fetcher as unknown as typeof fetch);

    await expect(publish({ ...publishRequest(controller.signal), media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] })).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops a multi-image upload before dispatching the next request after cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return response({ id: 'photo-1' });
    }) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher);

    await expect(publish({ ...publishRequest(controller.signal), media: [
      { kind: 'image', url: 'https://cdn.test/a.jpg', localFile: jpeg('a.jpg') },
      { kind: 'image', url: 'https://cdn.test/b.jpg', localFile: jpeg('b.jpg') },
    ] })).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps a photo whose response races cancellation in recovery state without dispatching another request', async () => {
    const controller = new AbortController();
    const journal: FacebookMediaJournal = {
      beginPhoto: vi.fn(), recordPhoto: vi.fn(), rejectPhoto: vi.fn(),
      beginFeed: vi.fn(), recordFeed: vi.fn(), rejectFeed: vi.fn(),
    };
    const fetcher = vi.fn(async () => {
      controller.abort();
      return response({ id: 'photo-accepted-before-cancel' });
    }) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher, {
      ...policy,
      mediaJournalFactory: () => journal,
    });
    let failure: unknown;
    try {
      await adapter.publish!({ ...publishRequest(controller.signal), operationId: 'cancelled-operation', media: [
        { kind: 'image', url: 'https://cdn.test/a.jpg' }, { kind: 'image', url: 'https://cdn.test/b.jpg' },
      ] });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(adapter.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(journal.beginPhoto).toHaveBeenCalledWith(1);
    expect(journal.recordPhoto).not.toHaveBeenCalled();
    expect(journal.beginFeed).not.toHaveBeenCalled();
  });

  it('returns the post result without dispatching a first-comment request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => response({ id: 'post-1' })) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher, policy);

    await expect(adapter.publish!({ ...publishRequest(controller.signal) })).resolves.toMatchObject({ remoteId: 'post-1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dispatches a first comment separately and requires a nonempty remote comment id', async () => {
    const fetcher = vi.fn(async () => response({ id: 'comment-1' })) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher, policy);

    await expect(adapter.publishFirstComment!({ credential, remotePostId: 'post-1', text: 'Follow-up' }))
      .resolves.toEqual({ remoteId: 'comment-1' });
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('/post-1/comments');

    const invalidAdapter = createFacebookAdapter(config, vi.fn(async () => response({ id: '  ' })) as unknown as typeof fetch, policy);
    await expect(invalidAdapter.publishFirstComment!({ credential, remotePostId: 'post-1', text: 'Follow-up' }))
      .rejects.toBeInstanceOf(FacebookApiError);
  });

  it('does not dispatch first-comment work when its signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const adapter = createFacebookAdapter(config, fetcher as unknown as typeof fetch, policy);

    await expect(adapter.publishFirstComment!({ credential, remotePostId: 'post-1', text: 'Follow-up', signal: controller.signal }))
      .rejects.toBeInstanceOf(FacebookApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes a combined abortable signal to an in-flight Graph request', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher);
    const pending = publish({ ...publishRequest(controller.signal), media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] });

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(FacebookApiError);
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal).not.toBe(controller.signal);
  });

  it('propagates cancellation to remote status and deletion operations', async () => {
    for (const operation of ['status', 'delete'] as const) {
      const controller = new AbortController();
      let requestSignal: AbortSignal | undefined;
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal as AbortSignal | undefined;
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
      })) as unknown as typeof fetch;
      const adapter = createFacebookAdapter(config, fetcher, policy);
      const pending = operation === 'status'
        ? adapter.getRemoteStatus!({ credential, remoteId: 'post-1', signal: controller.signal })
        : adapter.deleteRemote!({ credential, remoteId: 'post-1', signal: controller.signal });

      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(FacebookApiError);
      expect(requestSignal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps successful publishing behavior unchanged without a signal', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? response({ id: 'post-1' }) : response({})) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher);

    await expect(publish({ ...publishRequest(), link: 'https://example.test' })).resolves.toEqual({ remoteId: 'post-1', url: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps successful remote status and deletion behavior unchanged without a signal', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE'
      ? response({ success: true }) : response({ is_published: true, created_time: '2026-01-01T00:00:00Z' })) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher, policy);

    await expect(adapter.getRemoteStatus!({ credential, remoteId: 'post-1' })).resolves.toMatchObject({ state: 'published' });
    await expect(adapter.deleteRemote!({ credential, remoteId: 'post-1' })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
