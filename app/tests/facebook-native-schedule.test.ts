import { describe, expect, it, vi } from 'vitest';
import {
  cancelFacebookNativeSchedule, createMemoryAttemptStore, reconcileFacebookNativeAttempt, rescheduleFacebookNativeSchedule,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeAttemptRecord, FacebookNativeReadTransport } from '../src/platforms/facebook/formats';
import { FacebookApiError } from '../src/platforms/facebook/publishing';

const scheduled = { status: { video_status: 'ready' }, published: false, scheduled_publish_time: 1_800_000_000 };
const live = { status: { video_status: 'ready' }, published: true };
const now = new Date('2026-10-20T10:00:00Z');
const inOneDay = new Date(now.getTime() + 86_400_000);

function transport(over: Partial<FacebookNativeReadTransport> = {}): FacebookNativeReadTransport {
  return { postGraph: vi.fn(async () => ({ success: true })), upload: vi.fn(), getGraph: vi.fn(async () => scheduled), deleteGraph: vi.fn(async () => ({ success: true })), ...over };
}
async function seeded(patch: Partial<FacebookNativeAttemptRecord> = {}) {
  const attempts = createMemoryAttemptStore();
  await attempts.begin({ operationId: 'pub', format: 'video', state: 'published', knownIds: ['VID'], remoteId: 'VID', targetId: 'PAGE', ...patch });
  return attempts;
}

describe('provider-held schedule cancel', () => {
  it('deletes a scheduled video once and settles both records', async () => {
    const attempts = await seeded();
    const t = transport();
    expect(await cancelFacebookNativeSchedule('pub', { attempts, transport: t })).toEqual({ status: 'cancelled' });
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
    expect(t.deleteGraph).toHaveBeenCalledWith('VID');
    expect((await attempts.get('pub'))?.state).toBe('deleted');
    expect((await attempts.get('pub:cancel'))?.state).toBe('deleted');
    expect(await cancelFacebookNativeSchedule('pub', { attempts, transport: t })).toMatchObject({ status: 'no_publication' });
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
  });

  it('never writes when Facebook does not report the object as scheduled', async () => {
    for (const answer of [live, { status: { video_status: 'processing' } }, {}]) {
      const attempts = await seeded();
      const t = transport({ getGraph: vi.fn(async () => answer) });
      expect(await cancelFacebookNativeSchedule('pub', { attempts, transport: t })).toMatchObject({ status: 'not_scheduled' });
      expect(t.deleteGraph).not.toHaveBeenCalled();
      expect(await attempts.get('pub:cancel')).toBeNull();
    }
  });

  it('refuses reels, stories, unpublished and unsafe identities before any request', async () => {
    for (const patch of [{ format: 'reel' as const }, { format: 'story_video' as const }, { state: 'uncertain' as const }, { remoteId: '../me' }, { remoteId: null }]) {
      const attempts = await seeded(patch);
      const t = transport();
      const result = await cancelFacebookNativeSchedule('pub', { attempts, transport: t });
      expect(['unsupported', 'no_publication']).toContain(result.status);
      expect(t.getGraph).not.toHaveBeenCalled();
      expect(t.deleteGraph).not.toHaveBeenCalled();
    }
  });

  it.each([{ success: 'true' }, { success: false }, {}])('treats %j as uncertain and never resends', async answer => {
    const attempts = await seeded();
    const t = transport({ deleteGraph: vi.fn(async () => answer) });
    const result = await cancelFacebookNativeSchedule('pub', { attempts, transport: t });
    expect(result).toMatchObject({ status: 'uncertain', stillScheduled: true });
    expect((await attempts.get('pub'))?.state).toBe('published');
    expect(await cancelFacebookNativeSchedule('pub', { attempts, transport: t })).toMatchObject({ status: 'already_attempted' });
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
  });

  it('records a definite Facebook refusal as rejected and an ambiguous failure as uncertain', async () => {
    const rejected = await seeded();
    const refuse = transport({ deleteGraph: vi.fn(async () => { throw new FacebookApiError('x', 400, 200); }) });
    expect(await cancelFacebookNativeSchedule('pub', { attempts: rejected, transport: refuse })).toMatchObject({ status: 'rejected' });
    expect((await rejected.get('pub:cancel'))?.state).toBe('rejected');
    const unclear = await seeded();
    const timeout = transport({ deleteGraph: vi.fn(async () => { throw new FacebookApiError('x', 0); }) });
    expect(await cancelFacebookNativeSchedule('pub', { attempts: unclear, transport: timeout })).toMatchObject({ status: 'uncertain' });
    expect((await unclear.get('pub:cancel'))?.state).toBe('uncertain');
  });

  it('fails closed when the attempt record cannot be written', async () => {
    const attempts = { ...(await seeded()), begin: vi.fn(async () => { throw new Error('db'); }) };
    const t = transport();
    await expect(cancelFacebookNativeSchedule('pub', { attempts, transport: t })).rejects.toThrow('nothing was sent');
    expect(t.deleteGraph).not.toHaveBeenCalled();
  });

  it('sends nothing when cancelled before the write', async () => {
    const attempts = await seeded();
    const controller = new AbortController();
    const t = transport({ getGraph: vi.fn(async () => { controller.abort(); return scheduled; }) });
    const result = await cancelFacebookNativeSchedule('pub', { attempts, transport: t, signal: controller.signal });
    expect(result.status).toBe('not_scheduled');
    expect(t.deleteGraph).not.toHaveBeenCalled();
  });
});

describe('provider-held schedule change', () => {
  it('posts the new unix time once for a scheduled video', async () => {
    const attempts = await seeded();
    const t = transport();
    expect(await rescheduleFacebookNativeSchedule('pub', inOneDay, { attempts, transport: t, now })).toEqual({ status: 'rescheduled' });
    expect(t.postGraph).toHaveBeenCalledWith('VID', { published: 'false', scheduled_publish_time: String(Math.floor(inOneDay.getTime() / 1000)) });
    expect(await rescheduleFacebookNativeSchedule('pub', inOneDay, { attempts, transport: t, now })).toMatchObject({ status: 'already_attempted' });
    expect(t.postGraph).toHaveBeenCalledTimes(1);
    expect((await attempts.get('pub'))?.state).toBe('published');
  });

  it('allows a different instant as a separate operation', async () => {
    const attempts = await seeded();
    const t = transport();
    await rescheduleFacebookNativeSchedule('pub', inOneDay, { attempts, transport: t, now });
    const later = new Date(inOneDay.getTime() + 3_600_000);
    expect(await rescheduleFacebookNativeSchedule('pub', later, { attempts, transport: t, now })).toEqual({ status: 'rescheduled' });
    expect(t.postGraph).toHaveBeenCalledTimes(2);
  });

  it('rejects instants outside the Root window or invalid dates before any request', async () => {
    const attempts = await seeded();
    const t = transport();
    for (const when of [new Date(now.getTime() + 60_000), new Date(now.getTime() + 400 * 86_400_000), new Date('nope')]) {
      expect(await rescheduleFacebookNativeSchedule('pub', when, { attempts, transport: t, now })).toMatchObject({ status: 'invalid_schedule' });
    }
    expect(t.getGraph).not.toHaveBeenCalled();
    expect(t.postGraph).not.toHaveBeenCalled();
  });

  it('does not reschedule a video that already went live', async () => {
    const attempts = await seeded();
    const t = transport({ getGraph: vi.fn(async () => live) });
    expect(await rescheduleFacebookNativeSchedule('pub', inOneDay, { attempts, transport: t, now })).toMatchObject({ status: 'not_scheduled' });
    expect(t.postGraph).not.toHaveBeenCalled();
  });

  it('holds an unconfirmed write as uncertain without resending', async () => {
    const attempts = await seeded();
    const t = transport({ postGraph: vi.fn(async () => ({ id: 'VID' })) });
    expect(await rescheduleFacebookNativeSchedule('pub', inOneDay, { attempts, transport: t, now })).toMatchObject({ status: 'uncertain' });
    expect(t.postGraph).toHaveBeenCalledTimes(1);
  });
});

describe('schedule child records are not reconciled as publications', () => {
  it('leaves cancel and reschedule operation rows untouched', async () => {
    const attempts = createMemoryAttemptStore();
    for (const operationId of ['pub:cancel', 'pub:reschedule:1800000000']) {
      await attempts.begin({ operationId, format: 'video', state: 'uncertain', knownIds: ['VID'] });
      const t = transport();
      expect(await reconcileFacebookNativeAttempt(operationId, { attempts, transport: t })).toEqual({ state: 'uncertain', readback: null });
      expect(t.getGraph).not.toHaveBeenCalled();
    }
  });
});
