import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryAttemptStore, deleteFacebookNativeRemote, mapFacebookVideoStatus,
  postFacebookNativeFirstComment, readFacebookNativeStatus, reconcileFacebookNativeAttempt,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeAttemptRecord, FacebookNativeReadTransport } from '../src/platforms/facebook/formats';

const published = { status: { video_status: 'ready' }, published: true };
const scheduled = { status: { video_status: 'ready' }, published: false, scheduled_publish_time: 1_800_000_000 };
const emptyTransport = (): FacebookNativeReadTransport => ({
  postGraph: vi.fn(async () => ({})), upload: vi.fn(),
  getGraph: vi.fn(async () => published), deleteGraph: vi.fn(async () => ({})),
});
const row = (patch: Partial<FacebookNativeAttemptRecord> = {}): FacebookNativeAttemptRecord => ({
  operationId: 'op', format: 'video', state: 'uncertain', knownIds: ['STAGED'], remoteId: null, ...patch,
});

describe('native status boundary safety', () => {
  it('reports cancellation without inventing an unread durable state', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempts = createMemoryAttemptStore();
    const get = vi.spyOn(attempts, 'get');
    expect(await reconcileFacebookNativeAttempt('op', { attempts, transport: emptyTransport(), signal: controller.signal }))
      .toEqual({ state: 'unknown', readback: null, cancelled: true });
    expect(get).not.toHaveBeenCalled();
  });

  it('preserves the last observed durable state when cancellation follows its read', async () => {
    const controller = new AbortController();
    const attempts = { ...createMemoryAttemptStore(), get: vi.fn(async () => {
      controller.abort();
      return row({ state: 'published', remoteId: 'FINAL' });
    }) };
    expect(await reconcileFacebookNativeAttempt('op', { attempts, transport: emptyTransport(), signal: controller.signal }))
      .toEqual({ state: 'published', readback: null, cancelled: true });
  });

  it('retains a deletion receipt without overwriting a concurrently held parent', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin(row({ state: 'published', remoteId: 'FINAL' }));
    const transport = { ...emptyTransport(), deleteGraph: vi.fn(async () => {
      await attempts.update('op', { state: 'uncertain' });
      return { success: true };
    }) };
    expect(await deleteFacebookNativeRemote('op', { attempts, transport }))
      .toEqual({ status: 'deleted', alreadyAbsent: false });
    expect(await attempts.get('op:delete')).toMatchObject({ state: 'deleted' });
    expect(await attempts.get('op')).toMatchObject({ state: 'uncertain', remoteId: 'FINAL' });
  });

  it('does not read a staged identity or use it for comment/delete', async () => {
    const transport = emptyTransport();
    expect(await readFacebookNativeStatus(row(), { transport })).toMatchObject({ status: 'unknown', detail: 'no_remote_id', polls: 0 });
    const attempts = createMemoryAttemptStore();
    await attempts.begin(row({ state: 'published' }));
    expect(await postFacebookNativeFirstComment('op', 'hi', { attempts, transport })).toEqual({ status: 'no_publication' });
    expect(await deleteFacebookNativeRemote('op', { attempts, transport })).toEqual({ status: 'no_publication' });
    expect(transport.getGraph).not.toHaveBeenCalled();
    expect(transport.postGraph).not.toHaveBeenCalled();
    expect(transport.deleteGraph).not.toHaveBeenCalled();
  });

  it.each(['story_photo', 'story_video'] as const)('keeps %s status unsupported', async (format) => {
    const transport = emptyTransport();
    expect(mapFacebookVideoStatus(format, published)).toMatchObject({ status: 'unknown', detail: 'readback_unsupported' });
    expect(await readFacebookNativeStatus(row({ format, remoteId: 'FINAL' }), { transport })).toMatchObject({ status: 'unknown', detail: 'readback_unsupported', polls: 0 });
    expect(transport.getGraph).not.toHaveBeenCalled();
  });

  it('does not persist scheduled readback as confirmation', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin(row({ remoteId: 'FINAL' }));
    const transport = { ...emptyTransport(), getGraph: vi.fn(async () => scheduled) };
    const result = await reconcileFacebookNativeAttempt('op', { attempts, transport });
    expect(result).toMatchObject({ state: 'uncertain', readback: { status: 'scheduled' } });
    expect((await attempts.get('op'))?.state).toBe('uncertain');
  });

  it('holds known remote IDs after a failed readback', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin(row({ remoteId: 'FINAL', knownIds: ['STAGED', 'FINAL'] }));
    const transport = { ...emptyTransport(), getGraph: vi.fn(async () => ({ status: { video_status: 'error' } })) };
    const result = await reconcileFacebookNativeAttempt('op', { attempts, transport });
    expect(result.state).toBe('uncertain');
    expect((await attempts.get('op'))).toMatchObject({ state: 'uncertain', knownIds: ['STAGED', 'FINAL'] });
  });

  it.each([
    ['false', async () => false], ['void', async () => undefined], ['malformed', async () => ({ applied: true })],
    ['throw', async () => { throw new Error('write failed'); }],
  ])('does not claim confirmation when CAS returns %s', async (_label, update) => {
    const base = createMemoryAttemptStore();
    await base.begin(row({ state: 'started', remoteId: 'FINAL' }));
    const attempts = {
      ...base,
      update: vi.fn(update as (operationId: string, patch: never, expected?: never) => Promise<unknown>),
    };
    const result = await reconcileFacebookNativeAttempt('op', { attempts, transport: emptyTransport() });
    expect(result.state).toBe('started'); // last durable state remains the only safe receipt
    expect(result.state).not.toBe('confirmed');
    expect((await base.get('op'))?.state).toBe('started');
  });

  it('returns the durable state when CAS refuses an update', async () => {
    const base = createMemoryAttemptStore();
    await base.begin(row({ state: 'started', remoteId: 'FINAL' }));
    const attempts = {
      ...base,
      update: vi.fn(async () => false),
      get: vi.fn().mockImplementationOnce(() => base.get('op')).mockImplementationOnce(async () => row({ state: 'published', remoteId: 'FINAL' })),
    };
    const result = await reconcileFacebookNativeAttempt('op', { attempts, transport: emptyTransport() });
    expect(result.state).toBe('published');
    expect(result.state).not.toBe('confirmed');
  });

  it('does not settle after cancellation and uses fresh fields for each request', async () => {
    const controller = new AbortController();
    const transport = emptyTransport();
    transport.getGraph = vi.fn(async (_path, fields) => { fields.push('mutated'); controller.abort(); return published; });
    const result = await readFacebookNativeStatus(row({ remoteId: 'FINAL' }), { transport, signal: controller.signal });
    expect(result).toMatchObject({ status: 'unknown', detail: 'aborted', polls: 1 });
    expect(transport.getGraph).toHaveBeenCalledTimes(1);

    const fields = emptyTransport();
    const observed: string[][] = [];
    fields.getGraph = vi.fn(async (_path, requested) => { observed.push([...requested]); requested.push('transport_mutation'); return { status: { video_status: 'processing' } }; });
    await readFacebookNativeStatus(row({ state: 'uncertain', remoteId: 'FINAL' }), {
      transport: fields, policy: { ...((await import('../src/platforms/facebook/formats')).facebookNativePolicyFrom()), poll: { maxPolls: 2, intervalMs: 5000 } }, sleep: async () => {},
    });
    expect(observed).toEqual([
      ['status', 'published', 'scheduled_publish_time'], ['status', 'published', 'scheduled_publish_time'],
    ]);
  });

  it('uses the format and final ID captured before the transport await', async () => {
    const transport = emptyTransport();
    const mutable = row({ remoteId: 'FINAL' });
    transport.getGraph = vi.fn(async (path) => {
      mutable.format = 'story_photo';
      mutable.remoteId = 'LATER';
      return published;
    });
    expect(await readFacebookNativeStatus(mutable, { transport })).toMatchObject({ status: 'published', polls: 1 });
    expect(transport.getGraph).toHaveBeenCalledWith('FINAL', expect.any(Array), undefined);
  });

  it('keeps a remote receipt returned just as cancellation fires', async () => {
    const controller = new AbortController();
    const attempts = createMemoryAttemptStore();
    await attempts.begin(row({ state: 'published', remoteId: 'FINAL' }));
    const transport = {
      ...emptyTransport(),
      postGraph: vi.fn(async () => { controller.abort(); return { id: 'COMMENT' }; }),
    };
    expect(await postFacebookNativeFirstComment('op', 'hello', { attempts, transport, signal: controller.signal }))
      .toEqual({ status: 'commented', commentId: 'COMMENT' });
    expect(await attempts.get('op:comment')).toMatchObject({ state: 'published', remoteId: 'COMMENT', knownIds: ['FINAL'] });
  });

  it('interrupts an injected polling sleep when the caller aborts', async () => {
    const controller = new AbortController();
    const transport = { ...emptyTransport(), getGraph: vi.fn(async () => ({ status: { video_status: 'processing' } })) };
    const pendingSleep = new Promise<void>(() => {});
    const result = readFacebookNativeStatus(row({ remoteId: 'FINAL' }), {
      transport,
      signal: controller.signal,
      policy: { ...((await import('../src/platforms/facebook/formats')).facebookNativePolicyFrom()), poll: { maxPolls: 2, intervalMs: 5000 } },
      sleep: () => { controller.abort(); return pendingSleep; },
    });
    await expect(result).resolves.toMatchObject({ status: 'unknown', detail: 'aborted', polls: 1 });
  });

  it('returns aborted when the final transport read rejects after cancellation', async () => {
    const controller = new AbortController();
    const transport = { ...emptyTransport(), getGraph: vi.fn(async () => { controller.abort(); throw new Error('cancelled'); }) };
    expect(await readFacebookNativeStatus(row({ remoteId: 'FINAL' }), { transport, signal: controller.signal }))
      .toMatchObject({ status: 'unknown', detail: 'aborted', polls: 1 });
  });

  it('keeps poll limits snapshotted while the transport is awaited', async () => {
    const defaults = (await import('../src/platforms/facebook/formats')).facebookNativePolicyFrom();
    const policy = { ...defaults, poll: { maxPolls: 2, intervalMs: 5000 } };
    const seen: string[][] = [];
    const transport = { ...emptyTransport(), getGraph: vi.fn(async (_path, fields) => {
      seen.push([...fields]);
      policy.poll.maxPolls = 1;
      return { status: { video_status: 'processing' } };
    }) };
    const result = await readFacebookNativeStatus(row({ remoteId: 'FINAL' }), { transport, policy, sleep: async () => {} });
    expect(result).toMatchObject({ status: 'processing', polls: 2 });
    expect(seen).toHaveLength(2);
  });

  it('rejects malformed polling bounds by registry schema but permits the one-read deletion interval', async () => {
    const transport = emptyTransport();
    const defaults = (await import('../src/platforms/facebook/formats')).facebookNativePolicyFrom();
    expect(await readFacebookNativeStatus(row({ remoteId: 'FINAL' }), {
      transport, policy: { ...defaults, poll: { maxPolls: 31, intervalMs: 0 } },
    })).toMatchObject({ status: 'unknown', detail: 'invalid_poll_policy', polls: 0 });
    expect(transport.getGraph).not.toHaveBeenCalled();
    expect(await readFacebookNativeStatus(row({ remoteId: 'FINAL' }), {
      transport, policy: { ...defaults, poll: { maxPolls: 1, intervalMs: 0 } },
    })).toMatchObject({ status: 'published', polls: 1 });
  });
});
