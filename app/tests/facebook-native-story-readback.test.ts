import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryAttemptStore, executeFacebookNative, planFacebookNative, reconcileFacebookNativeAttempt, readFacebookNativeStatus,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeAttemptRecord, FacebookNativeReadTransport } from '../src/platforms/facebook/formats';
import { FacebookApiError } from '../src/platforms/facebook/publishing';

const listed = (...entries: Array<Record<string, unknown>>) => ({ data: entries });
function transport(answer: unknown | (() => Promise<unknown>)): FacebookNativeReadTransport {
  return { postGraph: vi.fn(), upload: vi.fn(), deleteGraph: vi.fn(),
    getGraph: vi.fn(typeof answer === 'function' ? answer as () => Promise<Record<string, unknown>> : async () => answer as Record<string, unknown>) };
}
const story = (patch: Partial<FacebookNativeAttemptRecord> = {}): FacebookNativeAttemptRecord => ({
  operationId: 'op', format: 'story_photo', state: 'uncertain', knownIds: ['photo-1', 'story-1'], remoteId: 'story-1', targetId: 'PAGE', ...patch,
});

describe('Story readback through the shared status helper', () => {
  it.each(['story_photo', 'story_video'] as const)('reads %s once from the Page Stories edge by exact final id', async format => {
    const t = transport(listed({ post_id: 'story-1', status: 'PUBLISHED' }));
    expect(await readFacebookNativeStatus(story({ format }), { transport: t })).toEqual({ status: 'published', detail: null, polls: 1 });
    expect(t.getGraph).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.getGraph).mock.calls[0]![0]).toBe('PAGE/stories');
  });

  it('never infers absence: not listed, ambiguous, archived and malformed answers are unknown', async () => {
    const cases: Array<[unknown, string]> = [
      [listed(), 'story_not_listed'], [listed({ post_id: 'other', status: 'PUBLISHED' }), 'story_not_listed'],
      [listed({ post_id: 'story-1', status: 'PUBLISHED' }, { post_id: 'story-1', status: 'PUBLISHED' }), 'story_ambiguous'],
      [listed({ post_id: 'story-1', status: 'ARCHIVED' }), 'status_unrecognized'], [{}, 'status_shape_invalid'],
    ];
    for (const [answer, detail] of cases) {
      expect(await readFacebookNativeStatus(story(), { transport: transport(answer) })).toEqual({ status: 'unknown', detail, polls: 1 });
    }
  });

  it('treats Graph100/sub33 and transport failures as unknown, without retrying', async () => {
    const t = transport(async () => { throw new FacebookApiError('gone', 400, 100, 33); });
    expect(await readFacebookNativeStatus(story(), { transport: t })).toEqual({ status: 'unknown', detail: 'read_failed', polls: 1 });
    expect(t.getGraph).toHaveBeenCalledTimes(1);
  });

  it('reads nothing without a safe Page id or final Story id', async () => {
    for (const patch of [{ targetId: undefined }, { targetId: '../me' }, { remoteId: null }, { remoteId: 'a/b' }]) {
      const t = transport(listed({ post_id: 'story-1', status: 'PUBLISHED' }));
      expect((await readFacebookNativeStatus(story(patch as Partial<FacebookNativeAttemptRecord>), { transport: t })).status).toBe('unknown');
      expect(t.getGraph).not.toHaveBeenCalled();
    }
  });

  it('honours cancellation before and after the read', async () => {
    const before = new AbortController(); before.abort();
    const t = transport(listed({ post_id: 'story-1', status: 'PUBLISHED' }));
    expect(await readFacebookNativeStatus(story(), { transport: t, signal: before.signal })).toMatchObject({ detail: 'aborted', polls: 0 });
    expect(t.getGraph).not.toHaveBeenCalled();
    const during = new AbortController();
    const t2 = transport(async () => { during.abort(); return listed({ post_id: 'story-1', status: 'PUBLISHED' }); });
    expect(await readFacebookNativeStatus(story(), { transport: t2, signal: during.signal })).toMatchObject({ status: 'unknown', detail: 'aborted' });
  });
});

describe('Story reconciliation of an executed attempt', () => {
  it('reads a really executed photo Story back but a read alone never confirms or changes state', async () => {
    const attempts = createMemoryAttemptStore();
    const plan = planFacebookNative({ targetId: 'PAGE', targetKind: 'page', format: 'story', media: [{ kind: 'image', url: 'https://cdn.example.com/a.jpg', sizeBytes: 1000, width: 1080, height: 1920 }], now: new Date('2026-10-20T10:00:00Z') });
    const write = { postGraph: vi.fn(async (path: string) => path.endsWith('/photos') ? { id: 'photo-1' } : { post_id: 'story-1' }), upload: vi.fn() };
    // Interrupt after the writes: leave the attempt uncertain as a lost process would.
    const outcome = await executeFacebookNative(plan, 'op', { transport: write, attempts });
    expect(outcome).toMatchObject({ status: 'submitted', remoteId: 'story-1' });
    await attempts.update('op', { state: 'uncertain' });
    const t = transport(listed({ post_id: 'story-1', status: 'PUBLISHED' }));
    const result = await reconcileFacebookNativeAttempt('op', { attempts, transport: t });
    expect(result).toMatchObject({ state: 'uncertain', readback: { status: 'published' } });
    expect((await attempts.get('op'))?.state).toBe('uncertain');
    expect(write.postGraph).toHaveBeenCalledTimes(2); // no resend
    expect(vi.mocked(t.getGraph).mock.calls[0]![0]).toBe('PAGE/stories');
  });
});
