import { describe, expect, it, vi } from 'vitest';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import {
  createMemoryAttemptStore, createPostgresAttemptStore, deleteFacebookNativeRemote, executeFacebookNative, planFacebookNative,
  postFacebookNativeFirstComment, readFacebookNativeStatus, reconcileFacebookNativeAttempt, mapFacebookVideoStatus,
  FacebookAttemptStoreUnavailableError, FACEBOOK_NATIVE_CONFIG, facebookNativePolicyFrom,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeMedia, FacebookNativeReadTransport, FacebookSqlPort, FacebookNativeValidationError } from '../src/platforms/facebook/formats';

const now = new Date('2026-01-01T00:00:00Z');
const vid: FacebookNativeMedia = { kind: 'video', url: 'https://cdn.example/v.mp4', sizeBytes: 1e6, durationSeconds: 30, width: 540, height: 960 };
const base = { targetId: 'P1', targetKind: 'page', media: [vid], now };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as FacebookNativeValidationError).code; } return null; };
const sleep = async () => {};

describe('limits from Root config', () => {
  it('rejects oversize, bad duration, bad aspect, missing metadata', () => {
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, sizeBytes: 2e9 }] }))).toBe('media_too_large');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, durationSeconds: 120 }] }))).toBe('media_duration_out_of_range');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, width: 1920, height: 1080 }] }))).toBe('media_aspect_out_of_range');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, durationSeconds: undefined }] }))).toBe('media_metadata_missing');
  });
  it('honours an overridden policy and rejects inconsistent ones', () => {
    const policy = facebookNativePolicyFrom({ 'facebook.native.reel.maxDurationSeconds': 200 });
    expect(planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, durationSeconds: 120 }], policy }).format).toBe('reel');
    expect(() => facebookNativePolicyFrom({ 'facebook.native.reel.minAspect': 0.9 })).toThrow();
    expect(() => facebookNativePolicyFrom({ 'facebook.native.poll.maxPolls': 0 })).toThrow();
    const short = facebookNativePolicyFrom({ 'facebook.native.scheduleMinSeconds': 60 });
    expect(planFacebookNative({ ...base, format: 'post', scheduledAt: new Date(now.getTime() + 120e3), policy: short })).toMatchObject({ format: 'video' });
    expect(FACEBOOK_NATIVE_CONFIG.every((c) => c.consumption === 'configured')).toBe(true);
  });
  it('group stays rejected', () => {
    expect(code(() => planFacebookNative({ ...base, format: 'post', targetKind: 'group' }))).toBe('target_kind_unsupported');
  });
});

describe('Postgres attempt store', () => {
  function fakeDb() {
    const rows = new Map<string, Record<string, unknown>>();
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const db: FacebookSqlPort = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.startsWith('INSERT')) {
          if (rows.has(params[0] as string)) return { rows: [] };
          rows.set(params[0] as string, { operation_id: params[0], format: params[1], state: params[2], known_ids: JSON.parse(params[3] as string), target_id: params[4], remote_id: null });
          return { rows: [{ operation_id: params[0] }] };
        }
        if (sql.startsWith('UPDATE')) {
          const r = rows.get(params[0] as string)!;
          if (params[1]) r.state = params[1]; if (params[2]) r.known_ids = JSON.parse(params[2] as string); if (params[3]) r.remote_id = params[3];
          return { rows: [] };
        }
        const r = rows.get(params[0] as string); return { rows: r ? [r] : [] };
      },
    };
    return { db, calls, rows };
  }
  it('is atomic, parameterized and round-trips', async () => {
    const { db, calls } = fakeDb(); const s = createPostgresAttemptStore(db);
    expect(await s.begin({ operationId: "o'1; DROP", format: 'reel', state: 'started', knownIds: [], targetId: 'P' })).toEqual({ created: true });
    const again = await s.begin({ operationId: "o'1; DROP", format: 'reel', state: 'started', knownIds: [] });
    expect(again).toMatchObject({ created: false, existing: { state: 'started', targetId: 'P' } });
    await s.update("o'1; DROP", { state: 'uncertain', knownIds: ['V'], remoteId: 'V' });
    expect(await s.get("o'1; DROP")).toMatchObject({ state: 'uncertain', knownIds: ['V'], remoteId: 'V' });
    expect(calls.every((c) => !c.sql.includes("DROP") && /\$1/.test(c.sql))).toBe(true);
  });
  it('fails closed: no Graph call when the store is down', async () => {
    const db: FacebookSqlPort = { query: async () => { throw new Error('down'); } };
    const post = vi.fn(); const t = { postGraph: post, upload: vi.fn() };
    await expect(executeFacebookNative(planFacebookNative({ ...base, format: 'reel' }), 'x', { transport: t, attempts: createPostgresAttemptStore(db) }))
      .rejects.toBeInstanceOf(FacebookAttemptStoreUnavailableError);
    expect(post).not.toHaveBeenCalled();
  });
});

function reader(gets: Array<Record<string, unknown> | Error>, extra: Partial<FacebookNativeReadTransport> = {}) {
  const getGraph = vi.fn(async (..._a: unknown[]) => { const r = gets.length > 1 ? gets.shift()! : gets[0]!; if (r instanceof Error) throw r; return r; });
  const t: FacebookNativeReadTransport = { postGraph: vi.fn(async () => ({})), upload: vi.fn(), getGraph, deleteGraph: vi.fn(async () => ({ success: true })), ...extra };
  return { t, getGraph };
}
const processing = { status: { video_status: 'processing' } };
const ready = { status: { video_status: 'ready' }, published: true };

describe('status readback and polling', () => {
  it('maps statuses neutrally', () => {
    expect(mapFacebookVideoStatus('video', ready).status).toBe('published');
    expect(mapFacebookVideoStatus('video', { ...ready, published: false, scheduled_publish_time: 1767225600 }).status).toBe('scheduled');
    expect(mapFacebookVideoStatus('video', { status: { video_status: 'error' } }).status).toBe('failed');
    expect(mapFacebookVideoStatus('video', {}).status).toBe('unknown');
    expect(mapFacebookVideoStatus('reel', { status: { video_status: 'ready', publishing_phase: { status: 'in_progress' } } }).status).toBe('processing');
    expect(mapFacebookVideoStatus('reel', { status: { video_status: 'ready', publishing_phase: { status: 'complete' } }, published: true }).status).toBe('published');
  });
  it('polls a bounded number of times', async () => {
    const { t, getGraph } = reader([processing, processing, ready]);
    expect(await readFacebookNativeStatus({ format: 'video', remoteId: 'V', knownIds: [] }, { transport: t, sleep })).toMatchObject({ status: 'published', polls: 3 });
    const never = reader([processing]);
    const r = await readFacebookNativeStatus({ format: 'video', remoteId: 'V', knownIds: [] }, { transport: never.t, sleep });
    expect(r).toMatchObject({ status: 'processing', polls: 6 });
    expect(getGraph).toHaveBeenCalledTimes(3);
  });
  it('keeps Graph missing errors unknown, reports unreadable and unsupported honestly', async () => {
    const m = reader([new FacebookApiError('gone', 400, 100, 33)]);
    expect((await readFacebookNativeStatus({ format: 'video', remoteId: 'V', knownIds: [] }, { transport: m.t, sleep })).status).toBe('unknown');
    const f = reader([new FacebookApiError('x', 500)]);
    expect(await readFacebookNativeStatus({ format: 'video', remoteId: 'V', knownIds: [] }, { transport: f.t, sleep })).toMatchObject({ status: 'unknown', detail: 'read_failed', polls: 6 });
    expect((await readFacebookNativeStatus({ format: 'story_photo', remoteId: 'S', knownIds: [] }, { transport: f.t, sleep })).detail).toBe('readback_unsupported');
    expect((await readFacebookNativeStatus({ format: 'reel', remoteId: null, knownIds: [] }, { transport: f.t, sleep })).detail).toBe('no_remote_id');
  });
});

describe('reconciliation', () => {
  async function uncertainReel() {
    const attempts = createMemoryAttemptStore();
    const post = vi.fn().mockResolvedValueOnce({ video_id: 'V9', upload_url: 'https://up/y' }).mockRejectedValueOnce(new FacebookApiError('timeout', 0));
    const w = { postGraph: post, upload: vi.fn() };
    const o = await executeFacebookNative(planFacebookNative({ ...base, format: 'reel' }), 'op', { transport: w, attempts });
    expect(o.status).toBe('uncertain');
    return { attempts, post };
  }
  it('confirms from readback without resending', async () => {
    const { attempts, post } = await uncertainReel();
    const { t } = reader([{ status: { video_status: 'ready', publishing_phase: { status: 'complete' } }, published: true }]);
    const r = await reconcileFacebookNativeAttempt('op', { transport: t, attempts, sleep });
    expect(r.state).toBe('confirmed');
    expect(post).toHaveBeenCalledTimes(2);
    expect(await attempts.get('op')).toMatchObject({ state: 'confirmed' });
  });
  it('stays uncertain when unreadable, and handles missing records', async () => {
    const { attempts } = await uncertainReel();
    const { t } = reader([new FacebookApiError('x', 500)]);
    expect((await reconcileFacebookNativeAttempt('op', { transport: t, attempts, sleep })).state).toBe('uncertain');
    expect((await reconcileFacebookNativeAttempt('nope', { transport: t, attempts, sleep })).state).toBe('not_found');
  });
});

async function published(format: 'post' | 'reel' = 'post') {
  const attempts = createMemoryAttemptStore();
  const w = { postGraph: vi.fn().mockResolvedValue(format === 'post' ? { id: 'VID' } : {}), upload: vi.fn() };
  if (format === 'reel') w.postGraph.mockResolvedValueOnce({ video_id: 'VID', upload_url: 'https://u' });
  await executeFacebookNative(planFacebookNative({ ...base, format }), 'pub', { transport: w, attempts });
  return attempts;
}

describe('first comment', () => {
  it('waits while processing, then comments exactly once', async () => {
    const attempts = await published();
    const proc = reader([processing]);
    expect((await postFacebookNativeFirstComment('pub', 'hi', { transport: proc.t, attempts, sleep })).status).toBe('not_ready');
    expect(proc.t.postGraph).not.toHaveBeenCalled();
    const ok = reader([ready], { postGraph: vi.fn(async () => ({ id: 'C1' })) });
    expect(await postFacebookNativeFirstComment('pub', 'hi', { transport: ok.t, attempts, sleep })).toEqual({ status: 'commented', commentId: 'C1' });
    expect((await postFacebookNativeFirstComment('pub', 'hi', { transport: ok.t, attempts, sleep })).status).toBe('already_attempted');
    expect(ok.t.postGraph).toHaveBeenCalledTimes(1);
  });
  it('timeout is uncertain and not resent; unknown publication is refused', async () => {
    const attempts = await published();
    const bad = reader([ready], { postGraph: vi.fn(async () => { throw new FacebookApiError('t', 0); }) });
    expect((await postFacebookNativeFirstComment('pub', 'x', { transport: bad.t, attempts, sleep })).status).toBe('uncertain');
    expect((await postFacebookNativeFirstComment('pub', 'x', { transport: bad.t, attempts, sleep })).status).toBe('already_attempted');
    expect(bad.t.postGraph).toHaveBeenCalledTimes(1);
    expect((await postFacebookNativeFirstComment('zzz', 'x', { transport: bad.t, attempts, sleep })).status).toBe('no_publication');
  });
});

describe('remote deletion', () => {
  it('deletes once and marks the publication', async () => {
    const attempts = await published();
    const d = reader([ready]);
    expect(await deleteFacebookNativeRemote('pub', { transport: d.t, attempts, sleep })).toEqual({ status: 'deleted', alreadyAbsent: false });
    expect(d.t.deleteGraph).toHaveBeenCalledWith('VID');
    expect((await attempts.get('pub'))?.state).toBe('deleted');
    expect((await deleteFacebookNativeRemote('pub', { transport: d.t, attempts, sleep })).status).toBe('already_attempted');
    expect(d.t.deleteGraph).toHaveBeenCalledTimes(1);
  });
  it('maps rejection and keeps ambiguous absence uncertain', async () => {
    let a = await published();
    expect((await deleteFacebookNativeRemote('pub', { transport: reader([ready], { deleteGraph: vi.fn(async () => { throw new FacebookApiError('p', 403, 200); }) }).t, attempts: a, sleep })).status).toBe('rejected');
    a = await published();
    expect(await deleteFacebookNativeRemote('pub', { transport: reader([ready], { deleteGraph: vi.fn(async () => { throw new FacebookApiError('g', 400, 100, 33); }) }).t, attempts: a, sleep })).toMatchObject({ status: 'uncertain' });
    a = await published();
    const timeout = vi.fn(async () => { throw new FacebookApiError('t', 0); });
    expect((await deleteFacebookNativeRemote('pub', { transport: reader([new FacebookApiError('gone', 400, 100, 33)], { deleteGraph: timeout }).t, attempts: a, sleep })).status).toBe('uncertain');
    a = await published();
    const u = reader([ready], { deleteGraph: timeout });
    expect(await deleteFacebookNativeRemote('pub', { transport: u.t, attempts: a, sleep })).toMatchObject({ status: 'uncertain', stillPresent: true });
    expect(timeout).toHaveBeenCalledTimes(2);
  });
  it('stories are unsupported; unpublished refused', async () => {
    const attempts = createMemoryAttemptStore();
    await attempts.begin({ operationId: 's', format: 'story_photo', state: 'published', knownIds: ['S'], remoteId: 'S' });
    expect((await deleteFacebookNativeRemote('s', { transport: reader([ready]).t, attempts, sleep })).status).toBe('unsupported');
    expect((await deleteFacebookNativeRemote('none', { transport: reader([ready]).t, attempts, sleep })).status).toBe('no_publication');
  });
});
