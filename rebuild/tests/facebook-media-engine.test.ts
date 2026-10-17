import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, createFacebookPublisher, FacebookApiError, FacebookMediaRecoveryError } from '../src/platforms/facebook/publishing';
import type { FacebookMediaJournal, FacebookMediaJournalFactory } from '../src/platforms/facebook/media-journal-port';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const credential = { accessToken: 'page-token', grantedScopes: ['pages_manage_posts'] };
const target = { id: 'page-1', name: 'Page', kind: 'page' };
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const media = [
  { kind: 'image' as const, url: 'https://cdn.test/a.jpg' },
  { kind: 'image' as const, url: 'https://cdn.test/b.jpg' },
];
function journalHarness(events: string[] = []) {
  const journal: FacebookMediaJournal = {
    beginPhoto: vi.fn(async ordinal => { events.push(`beginPhoto:${ordinal}`); }),
    recordPhoto: vi.fn(async (ordinal, remoteId) => { events.push(`recordPhoto:${ordinal}:${remoteId}`); }),
    rejectPhoto: vi.fn(async ordinal => { events.push(`rejectPhoto:${ordinal}`); }),
    beginFeed: vi.fn(async photoIds => { events.push(`beginFeed:${photoIds.join(',')}`); }),
    recordFeed: vi.fn(async remoteId => { events.push(`recordFeed:${remoteId}`); }),
    rejectFeed: vi.fn(async () => { events.push('rejectFeed'); }),
  };
  const factory: FacebookMediaJournalFactory = vi.fn(() => journal);
  return { journal, factory, events };
}
function adapter(fetcher: typeof fetch, factory: FacebookMediaJournalFactory) {
  return createFacebookAdapter(config, fetcher, { postPublishScopes: ['pages_manage_posts'], mediaJournalFactory: factory });
}

describe('Facebook multi-photo journaling', () => {
  it('requires a durable publication operation id before the first remote upload', async () => {
    const fetcher = vi.fn();
    const harness = journalHarness();
    const subject = adapter(fetcher as unknown as typeof fetch, harness.factory);
    await expect(subject.publish!({ credential, target, text: '', media })).rejects.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(subject.classifyPublishingFailure!(new FacebookMediaRecoveryError())).toBe('uncertain');
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('commits each photo receipt before the next request and records the final feed receipt', async () => {
    const events: string[] = [];
    const harness = journalHarness(events);
    const fetcher = vi.fn(async () => {
      const index = events.filter(event => event.startsWith('request:photo')).length;
      events.push(index < 2 ? `request:photo-${index + 1}` : 'request:feed');
      return response({ id: index < 2 ? `photo-${index + 1}` : 'page-post-1' });
    }) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    await expect(subject.publish!({ credential, target, operationId: 'operation-1', text: '', media })).resolves.toEqual({ remoteId: 'page-post-1', url: null });
    expect(events).toEqual([
      'beginPhoto:1', 'request:photo-1', 'recordPhoto:1:photo-1',
      'beginPhoto:2', 'request:photo-2', 'recordPhoto:2:photo-2',
      'beginFeed:photo-1,photo-2', 'request:feed', 'recordFeed:page-post-1',
    ]);
    const feedBody = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[2][1]?.body as URLSearchParams;
    expect(feedBody.get('message')).toBeNull();
    expect(feedBody.get('attached_media[0]')).toBe(JSON.stringify({ media_fbid: 'photo-1' }));
    expect(feedBody.get('attached_media[1]')).toBe(JSON.stringify({ media_fbid: 'photo-2' }));
    expect(harness.factory).toHaveBeenCalledWith('operation-1', 'page-1');
  });

  it('halts after a photo receipt write fails and keeps the operation uncertain', async () => {
    const harness = journalHarness();
    vi.mocked(harness.journal.recordPhoto).mockRejectedValueOnce(new Error('database unavailable'));
    const fetcher = vi.fn(async () => response({ id: 'photo-1' })) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-2', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(harness.journal.beginPhoto).toHaveBeenCalledTimes(1);
    expect(harness.journal.beginFeed).not.toHaveBeenCalled();
  });

  it('does not dispatch an upload when recording its photo intent fails', async () => {
    const harness = journalHarness();
    vi.mocked(harness.journal.beginPhoto).mockRejectedValueOnce(new Error('database unavailable'));
    const fetcher = vi.fn();
    const subject = adapter(fetcher as unknown as typeof fetch, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-3', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('holds a later recognized photo rejection after an earlier photo receipt', async () => {
    const harness = journalHarness();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: 'photo-1' }))
      .mockResolvedValueOnce(response({ error: { message: 'rejected', code: 100 } }, 400)) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-4', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(harness.journal.recordPhoto).toHaveBeenCalledWith(1, 'photo-1');
    expect(harness.journal.rejectPhoto).toHaveBeenCalledWith(2);
    expect(harness.journal.beginFeed).not.toHaveBeenCalled();
  });

  it('allows a recognized rejection of the first photo only after recording that rejection', async () => {
    const harness = journalHarness();
    const fetcher = vi.fn(async () => response({ error: { message: 'rejected', code: 100 } }, 400)) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-5', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(failure).not.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('rejected');
    expect(harness.journal.rejectPhoto).toHaveBeenCalledWith(1);
  });

  it('keeps a feed rejection uncertain and persists its phase outcome', async () => {
    const harness = journalHarness();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: 'photo-1' }))
      .mockResolvedValueOnce(response({ id: 'photo-2' }))
      .mockResolvedValueOnce(response({ error: { message: 'rejected', code: 100 } }, 400)) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-6', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(harness.journal.beginFeed).toHaveBeenCalledWith(['photo-1', 'photo-2']);
    expect(harness.journal.rejectFeed).toHaveBeenCalledTimes(1);
  });

  it('keeps feed creation held when the post receipt cannot be committed', async () => {
    const harness = journalHarness();
    vi.mocked(harness.journal.recordFeed).mockRejectedValueOnce(new Error('database unavailable'));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: 'photo-1' }))
      .mockResolvedValueOnce(response({ id: 'photo-2' }))
      .mockResolvedValueOnce(response({ id: 'page-post-1' })) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-7', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(subject.classifyPublishingFailure!(failure)).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(harness.journal.recordFeed).toHaveBeenCalledWith('page-post-1');
  });

  it('refuses malformed remote photo ids before recording or attaching them', async () => {
    const harness = journalHarness();
    const fetcher = vi.fn(async () => response({ id: 'photo-1\n' })) as unknown as typeof fetch;
    const subject = adapter(fetcher, harness.factory);
    let failure: unknown;
    try { await subject.publish!({ credential, target, operationId: 'operation-8', text: 'album', media }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookMediaRecoveryError);
    expect(harness.journal.recordPhoto).not.toHaveBeenCalled();
    expect(harness.journal.beginFeed).not.toHaveBeenCalled();
  });

  it('commits a valid late photo receipt before surfacing cancellation and sends no following request', async () => {
    const harness = journalHarness();
    const controller = new AbortController();
    const fetcher = vi.fn(async () => { controller.abort(); return response({ id: 'photo-late' }); }) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher, harness.factory);
    await expect(publish({
      credential, target, operationId: 'operation-late-photo', text: 'album', media, signal: controller.signal,
    })).rejects.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(harness.journal.recordPhoto).toHaveBeenCalledWith(1, 'photo-late');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(harness.journal.beginPhoto).toHaveBeenCalledTimes(1);
    expect(harness.journal.beginFeed).not.toHaveBeenCalled();
  });

  it('commits a valid late feed receipt before surfacing cancellation', async () => {
    const harness = journalHarness();
    const controller = new AbortController();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: 'photo-1' }))
      .mockResolvedValueOnce(response({ id: 'photo-2' }))
      .mockImplementationOnce(async () => { controller.abort(); return response({ id: 'feed-late' }); }) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher, harness.factory);
    await expect(publish({
      credential, target, operationId: 'operation-late-feed', text: 'album', media, signal: controller.signal,
    })).rejects.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(harness.journal.recordFeed).toHaveBeenCalledWith('feed-late');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(harness.journal.beginFeed).toHaveBeenCalledWith(['photo-1', 'photo-2']);
  });

  it('does not sequence another photo when committing a late receipt fails', async () => {
    const harness = journalHarness();
    const controller = new AbortController();
    vi.mocked(harness.journal.recordPhoto).mockRejectedValueOnce(new Error('database unavailable'));
    const fetcher = vi.fn(async () => { controller.abort(); return response({ id: 'photo-uncommitted' }); }) as unknown as typeof fetch;
    const publish = createFacebookPublisher(config, fetcher, harness.factory);
    await expect(publish({
      credential, target, operationId: 'operation-late-db-fault', text: 'album', media, signal: controller.signal,
    })).rejects.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(harness.journal.recordPhoto).toHaveBeenCalledWith(1, 'photo-uncommitted');
    expect(harness.journal.beginFeed).not.toHaveBeenCalled();
  });

  it('never records a positive receipt for a malformed or rejected late response', async () => {
    const malformed = journalHarness();
    const malformedController = new AbortController();
    const malformedFetch = vi.fn(async () => { malformedController.abort(); return response({ id: '  ' }); }) as unknown as typeof fetch;
    await expect(createFacebookPublisher(config, malformedFetch, malformed.factory)({
      credential, target, operationId: 'operation-late-malformed', text: 'album', media, signal: malformedController.signal,
    })).rejects.toBeInstanceOf(FacebookMediaRecoveryError);
    expect(malformed.journal.recordPhoto).not.toHaveBeenCalled();
    expect(malformedFetch).toHaveBeenCalledTimes(1);

    const rejected = journalHarness();
    const rejectedController = new AbortController();
    const rejectedFetch = vi.fn(async () => { rejectedController.abort(); return response({ error: { message: 'rejected', code: 100 } }, 400); }) as unknown as typeof fetch;
    await expect(createFacebookPublisher(config, rejectedFetch, rejected.factory)({
      credential, target, operationId: 'operation-late-rejected', text: 'album', media, signal: rejectedController.signal,
    })).rejects.toBeInstanceOf(FacebookApiError);
    expect(rejected.journal.recordPhoto).not.toHaveBeenCalled();
    expect(rejected.journal.rejectPhoto).toHaveBeenCalledWith(1);
    expect(rejectedFetch).toHaveBeenCalledTimes(1);
  });
});
