import { describe, expect, it, vi } from 'vitest';
import { planFacebookNative } from '../src/platforms/facebook/formats/plan';
import { createMemoryAttemptStore, executeFacebookNative } from '../src/platforms/facebook/formats/execute';
import type { FacebookNativeAttemptStore, FacebookNativePlan } from '../src/platforms/facebook/formats/types';

const reel: FacebookNativePlan = { format: 'reel', targetId: 'page', description: '', media: { kind: 'video', url: 'https://example.invalid/video.mp4' } };

describe('native phase durability', () => {
  it('commits phase intent before dispatch and upload identity before transfer or finish', async () => {
    const attempts = createMemoryAttemptStore();
    const postGraph = vi.fn(async (_path: string, body: Record<string, string>) => {
      const row = await attempts.get('op');
      expect(row?.steps?.at(-1)).toMatchObject({ dispatched: true, confirmed: false });
      if (body.upload_phase === 'start') return { video_id: 'video', upload_url: 'https://example.invalid/upload' };
      expect(row?.knownIds).toEqual(['video']);
      expect(row?.steps?.find(s => s.phase === 'upload_transfer')?.confirmed).toBe(true);
      return { success: true };
    });
    const upload = vi.fn(async () => {
      const row = await attempts.get('op');
      expect(row?.knownIds).toEqual(['video']);
      expect(row?.steps?.at(-1)).toEqual({ phase: 'upload_transfer', dispatched: true, confirmed: false });
    });
    expect((await executeFacebookNative(reel, 'op', { attempts, transport: { postGraph, upload } })).status).toBe('submitted');
    expect((await attempts.get('op'))?.steps?.every(s => s.confirmed)).toBe(true);
  });

  it('stops before transfer if saving the upload receipt fails; duplicate never resends', async () => {
    const base = createMemoryAttemptStore();
    const attempts: FacebookNativeAttemptStore = { ...base, async update(id, patch, expected) {
      if (patch.knownIds?.length && patch.state === undefined) throw new Error('database unavailable');
      return base.update(id, patch, expected);
    } };
    const transport = { postGraph: vi.fn(async () => ({ video_id: 'video', upload_url: 'https://example.invalid/upload' })), upload: vi.fn() };
    expect(await executeFacebookNative(reel, 'op', { attempts, transport })).toMatchObject({ status: 'uncertain', knownIds: ['video'] });
    expect(transport.upload).not.toHaveBeenCalled();
    expect((await executeFacebookNative(reel, 'op', { attempts, transport })).status).toBe('already_attempted');
    expect(transport.postGraph).toHaveBeenCalledTimes(1);
  });

  it('retains the returned identity even when the upload address is malformed', async () => {
    const attempts = createMemoryAttemptStore();
    const transport = { postGraph: vi.fn(async () => ({ video_id: 'video' })), upload: vi.fn() };
    expect(await executeFacebookNative(reel, 'op', { attempts, transport })).toMatchObject({ status: 'uncertain', knownIds: ['video'] });
    expect((await attempts.get('op'))?.knownIds).toEqual(['video']);
    expect(transport.upload).not.toHaveBeenCalled();
  });

  it('does not claim success from malformed finish replies or use a staged photo as a Story receipt', async () => {
    const attempts = createMemoryAttemptStore();
    const transport = { postGraph: vi.fn().mockResolvedValueOnce({ video_id: 'video', upload_url: 'https://example.invalid/u' }).mockResolvedValueOnce({}), upload: vi.fn() };
    expect((await executeFacebookNative(reel, 'reel', { attempts, transport })).status).toBe('uncertain');
    const photo: FacebookNativePlan = { format: 'story_photo', targetId: 'page', media: { kind: 'image', url: 'https://example.invalid/i.jpg' } };
    const postGraph = vi.fn().mockResolvedValueOnce({ id: 'photo' }).mockResolvedValueOnce({ success: true });
    expect(await executeFacebookNative(photo, 'photo', { attempts, transport: { postGraph, upload: vi.fn() } })).toMatchObject({ status: 'uncertain', knownIds: ['photo'] });
  });

  it('refuses unsupported direct byte paths before making a remote request', async () => {
    const attempts = createMemoryAttemptStore();
    const transport = { postGraph: vi.fn(), upload: vi.fn() };
    const plan: FacebookNativePlan = { format: 'video', targetId: 'page', media: { kind: 'video', bytes: new Uint8Array([1]) }, description: '', scheduledUnix: null };
    await expect(executeFacebookNative(plan, 'bytes', { attempts, transport })).rejects.toThrow('requires an HTTPS media URL');
    expect(await attempts.get('bytes')).toBeNull();
    expect(transport.postGraph).not.toHaveBeenCalled();
  });
});

 describe('native media numeric validation', () => {
  it.each([NaN, Infinity, -1, 0])('rejects invalid probed size %s', sizeBytes => {
    expect(() => planFacebookNative({targetId:'page', targetKind:'page', format:'post', media:[{kind:'video', url:'https://example.invalid/v', sizeBytes, durationSeconds:30,width:540,height:960}]})).toThrow('file size');
  });
  it('rejects invalid dates rather than emitting a NaN provider timestamp', () => {
    expect(() => planFacebookNative({targetId:'page',targetKind:'page',format:'post', scheduledAt:new Date(NaN),media:[{kind:'video',url:'https://example.invalid/v',sizeBytes:100,durationSeconds:30,width:540,height:960}]})).toThrow('valid publishing date');
  });
});
