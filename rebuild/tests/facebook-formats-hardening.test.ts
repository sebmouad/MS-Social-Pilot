import { describe, expect, it, vi } from 'vitest';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import {
  createMemoryAttemptStore, createPostgresAttemptStore, deleteFacebookNativeRemote, executeFacebookNative, planFacebookNative,
  postFacebookNativeFirstComment, reconcileFacebookNativeAttempt, FacebookAttemptStoreUnavailableError,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeAttemptStore, FacebookNativeMedia, FacebookNativeReadTransport, FacebookSqlPort } from '../src/platforms/facebook/formats';

const vid: FacebookNativeMedia = { kind: 'video', url: 'https://cdn.example/v.mp4', sizeBytes: 1e6, durationSeconds: 30, width: 540, height: 960 };
const base = { targetId: 'P1', targetKind: 'page', media: [vid], now: new Date('2026-01-01T00:00:00Z') };
const sleep = async () => {};
const READY = { status: { video_status: 'ready' }, published: true };

function transport(over: Partial<FacebookNativeReadTransport> = {}): FacebookNativeReadTransport {
  return { postGraph: vi.fn().mockResolvedValue({ id: 'C1' }), upload: vi.fn(), getGraph: vi.fn().mockResolvedValue(READY), deleteGraph: vi.fn().mockResolvedValue({ success: true }), ...over };
}
async function publishedVideo() {
  const attempts = createMemoryAttemptStore();
  const t = transport({ postGraph: vi.fn().mockResolvedValue({ id: 'VID' }) });
  await executeFacebookNative(planFacebookNative({ ...base, format: 'post' }), 'pub', { transport: t, attempts });
  return attempts;
}
/** Wrap a store so selected operations throw, like an outage after the remote call. */
function flaky(inner: FacebookNativeAttemptStore, fail: { begin?: (id: string) => boolean; update?: (id: string) => boolean; get?: boolean }): FacebookNativeAttemptStore {
  return {
    async begin(r) { if (fail.begin?.(r.operationId)) throw new Error('db down'); return inner.begin(r); },
    async update(id, p, e) { if (fail.update?.(id)) throw new Error('db down'); return inner.update(id, p, e); },
    async get(id) { if (fail.get) throw new Error('db down'); return inner.get(id); },
  };
}

describe('store outages never lose or invent remote outcomes', () => {
  it('comment: begin outage fails closed with the shared error and sends nothing', async () => {
    const inner = await publishedVideo();
    const t = transport();
    await expect(postFacebookNativeFirstComment('pub', 'hi', { transport: t, attempts: flaky(inner, { begin: (id) => id.endsWith(':comment') }), sleep }))
      .rejects.toBeInstanceOf(FacebookAttemptStoreUnavailableError);
    expect(t.postGraph).not.toHaveBeenCalled();
  });
  it('comment: update failure after a successful POST still reports the comment', async () => {
    const inner = await publishedVideo();
    const t = transport();
    const r = await postFacebookNativeFirstComment('pub', 'hi', { transport: t, attempts: flaky(inner, { update: (id) => id.endsWith(':comment') }), sleep });
    expect(r).toEqual({ status: 'commented', commentId: 'C1' });
    expect(t.postGraph).toHaveBeenCalledTimes(1);
    // the row stays 'started': a retry is refused, never resent
    const again = await postFacebookNativeFirstComment('pub', 'hi', { transport: t, attempts: inner, sleep });
    expect(again.status).toBe('already_attempted');
    expect(t.postGraph).toHaveBeenCalledTimes(1);
  });
  it('comment: update failure after a failed POST does not throw and keeps the uncertain answer', async () => {
    const inner = await publishedVideo();
    const t = transport({ postGraph: vi.fn().mockRejectedValue(new FacebookApiError('timeout', 0)) });
    const r = await postFacebookNativeFirstComment('pub', 'hi', { transport: t, attempts: flaky(inner, { update: (id) => id.endsWith(':comment') }), sleep });
    expect(r.status).toBe('uncertain');
  });
  it('delete: begin outage fails closed and update failure keeps a confirmed deletion', async () => {
    const inner = await publishedVideo();
    const t = transport();
    await expect(deleteFacebookNativeRemote('pub', { transport: t, attempts: flaky(inner, { begin: (id) => id.endsWith(':delete') }), sleep }))
      .rejects.toBeInstanceOf(FacebookAttemptStoreUnavailableError);
    expect(t.deleteGraph).not.toHaveBeenCalled();
    const r = await deleteFacebookNativeRemote('pub', { transport: t, attempts: flaky(inner, { update: () => true }), sleep });
    expect(r).toEqual({ status: 'deleted', alreadyAbsent: false });
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
  });
  it('delete: Graph missing error remains uncertain even when recording fails', async () => {
    const inner = await publishedVideo();
    const t = transport({
      deleteGraph: vi.fn().mockRejectedValue(new FacebookApiError('timeout', 0)),
      getGraph: vi.fn().mockRejectedValue(new FacebookApiError('gone', 400, 100, 33)),
    });
    const r = await deleteFacebookNativeRemote('pub', { transport: t, attempts: flaky(inner, { update: () => true }), sleep });
    expect(r.status).toBe('uncertain');
  });
});

describe('terminal state compare-and-set', () => {
  it('memory store: deleted is terminal and expected states are enforced', async () => {
    const s = createMemoryAttemptStore();
    await s.begin({ operationId: 'a', format: 'reel', state: 'uncertain', knownIds: ['V'] });
    expect(await s.update('a', { state: 'confirmed' }, ['published'])).toBe(false);
    expect(await s.update('a', { state: 'confirmed' }, ['uncertain'])).toBe(true);
    expect(await s.update('a', { state: 'deleted' })).toBe(true);
    expect(await s.update('a', { state: 'uncertain' })).toBe(false);
    expect((await s.get('a'))?.state).toBe('deleted');
  });
  it('reconcile loses to a concurrent deletion and reports the real state', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin({ operationId: 'op', format: 'reel', state: 'uncertain', knownIds: ['V'] });
    const t = transport({
      getGraph: vi.fn().mockImplementation(async () => { await attempts.update('op', { state: 'deleted' }); return { status: { video_status: 'ready', publishing_phase: { status: 'complete' } }, published: true }; }),
    });
    const r = await reconcileFacebookNativeAttempt('op', { transport: t, attempts, sleep });
    expect(r.state).toBe('deleted');
    expect((await attempts.get('op'))?.state).toBe('deleted');
  });
  it('reconcile does not overwrite a state settled concurrently by another worker', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin({ operationId: 'op', format: 'reel', state: 'uncertain', knownIds: ['V'] });
    const t = transport({
      getGraph: vi.fn().mockImplementation(async () => { await attempts.update('op', { state: 'rejected' }); return { status: { video_status: 'ready', publishing_phase: { status: 'complete' } }, published: true }; }),
    });
    const r = await reconcileFacebookNativeAttempt('op', { transport: t, attempts, sleep });
    expect(r.state).toBe('rejected');
  });
  it('Postgres store sends the expected states as a parameter and reports whether a row changed', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    let affected = 1;
    const db: FacebookSqlPort = { async query(sql, params) { calls.push({ sql, params }); return { rows: affected ? [{ operation_id: 'a' }] : [] }; } };
    const s = createPostgresAttemptStore(db);
    expect(await s.update('a', { state: 'confirmed' }, ['uncertain', 'started'])).toBe(true);
    expect(calls[0].sql).toMatch(/state <> 'deleted'/);
    expect(calls[0].sql).toMatch(/state = ANY\(\$5::text\[\]\)/);
    expect(calls[0].params[4]).toEqual(['uncertain', 'started']);
    affected = 0;
    expect(await s.update('a', { state: 'confirmed' })).toBe(false);
    expect(calls[1].params[4]).toBeNull();
    expect(calls[1].sql).not.toMatch(/\$\d+\s*,\s*\$\d+\s*,/); // values are never interpolated
  });
});

describe('rate limits and readback requirements', () => {
  it('throttle answers on comment and delete carry a bounded retry hint and never resend', async () => {
    const inner = await publishedVideo();
    const throttled = new FacebookApiError('slow down', 400, 32);
    const t = transport({ postGraph: vi.fn().mockRejectedValue(throttled), deleteGraph: vi.fn().mockRejectedValue(new FacebookApiError('slow', 429, 4)), getGraph: vi.fn().mockResolvedValue(READY) });
    const c = await postFacebookNativeFirstComment('pub', 'hi', { transport: t, attempts: inner, sleep });
    expect(c).toMatchObject({ throttle: { retryAfterSeconds: expect.any(Number) } });
    expect((c as { throttle: { retryAfterSeconds: number } }).throttle.retryAfterSeconds).toBeGreaterThan(0);
    const d = await deleteFacebookNativeRemote('pub', { transport: t, attempts: inner, sleep });
    expect(d).toMatchObject({ throttle: { retryAfterSeconds: expect.any(Number) } });
    expect(t.postGraph).toHaveBeenCalledTimes(1);
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
  });
  it('a Reel and a plain video require readback before a live claim', async () => {
    const t = transport({ postGraph: vi.fn().mockResolvedValueOnce({ video_id: 'V', upload_url: 'https://u' }).mockResolvedValueOnce({ success: true }) });
    const reel = await executeFacebookNative(planFacebookNative({ ...base, format: 'reel' }), 'r', { transport: t, attempts: createMemoryAttemptStore() });
    expect(reel).toMatchObject({ status: 'submitted', readbackRequired: true });
    const v = await executeFacebookNative(planFacebookNative({ ...base, format: 'post' }), 'v', { transport: transport({ postGraph: vi.fn().mockResolvedValue({ id: 'X' }) }), attempts: createMemoryAttemptStore() });
    expect(v).toMatchObject({ status: 'submitted', readbackRequired: true });
  });
});
