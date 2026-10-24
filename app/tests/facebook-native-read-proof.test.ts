import { describe, expect, it, vi } from 'vitest';
import { readFacebookNativeProof, type FacebookNativeReadProofBinding } from '../src/platforms/facebook/formats/read-proof';
import type { FacebookNativeReadTransport } from '../src/platforms/facebook/formats/types';

const binding = (): FacebookNativeReadProofBinding => ({
  workspaceId: 'workspace-1', operationId: 'operation-1', postId: 'post-1', postTargetId: 'post-target-1',
  targetId: 'target-1', actorId: 'actor-1', remoteTargetId: 'page-1', sourceFormatId: 'format-1',
  format: 'video', payloadHash: 'a'.repeat(64), remoteId: 'video-1', revision: 2,
});
const response = (extra: Record<string, unknown> = {}) => ({
  id: 'video-1', from: { id: 'page-1' }, status: { video_status: 'ready' }, published: true, ...extra,
});
const transport = (getGraph: FacebookNativeReadTransport['getGraph']): FacebookNativeReadTransport => ({
  getGraph, postGraph: vi.fn(async () => ({})), upload: vi.fn(), deleteGraph: vi.fn(async () => ({})),
});

describe('canonical Facebook native read proof', () => {
  it('reads once with the explicit final ID and exact fields, then freezes a positive identity-bound proof', async () => {
    const getGraph = vi.fn(async () => response());
    const result = await readFacebookNativeProof(binding(), transport(getGraph));
    expect(getGraph).toHaveBeenCalledTimes(1);
    expect(getGraph).toHaveBeenCalledWith('video-1', ['id', 'from', 'status', 'published', 'scheduled_publish_time'], undefined);
    expect(result).toMatchObject({ workspaceId: 'workspace-1', remoteId: 'video-1', outcome: 'published', detail: null });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observedAt)).toBe(true);
  });

  it.each([
    ['mismatched final ID', response({ id: 'other-video' }), 'response_identity_mismatch'],
    ['mismatched Page', response({ from: { id: 'other-page' } }), 'response_target_mismatch'],
    ['missing Page identity', response({ from: undefined }), 'response_target_mismatch'],
    ['inherited response identity', Object.assign(Object.create({ id: 'video-1' }), { from: { id: 'page-1' }, status: { video_status: 'ready' }, published: true }), 'response_identity_mismatch'],
    ['inherited status fields', { id: 'video-1', from: { id: 'page-1' }, published: true, status: Object.assign(Object.create({ video_status: 'ready' }), {}) }, 'status_shape_invalid'],
    ['malformed response shape', null, 'response_identity_mismatch'],
  ] as const)('keeps %s unknown', async (_name, body, detail) => {
    const getGraph = vi.fn(async () => body as never);
    const result = await readFacebookNativeProof(binding(), transport(getGraph));
    expect(result).toMatchObject({ outcome: 'unknown', detail });
  });

  it('reads a Story from the Page Stories edge by its final id and never infers absence', async () => {
    const story = { ...binding(), format: 'story_video' as const, remoteId: 'story-1' };
    const getGraph = vi.fn(async () => ({ data: [{ post_id: 'other', status: 'PUBLISHED' }, { post_id: 'story-1', status: 'PUBLISHED' }] }));
    expect(await readFacebookNativeProof(story, transport(getGraph))).toMatchObject({ outcome: 'published', detail: null });
    expect(getGraph).toHaveBeenCalledWith(`${story.remoteTargetId}/stories`, ['post_id', 'status', 'creation_time'], undefined);
    expect(await readFacebookNativeProof(story, transport(async () => ({ data: [] })))).toMatchObject({ outcome: 'unknown', detail: 'story_not_listed' });
    expect(await readFacebookNativeProof(story, transport(async () => ({ data: [{ post_id: 'story-1', status: 'ARCHIVED' }] })))).toMatchObject({ outcome: 'unknown', detail: 'status_unrecognized' });
  });

  it('keeps Reel publication phase and scheduled evidence distinct', async () => {
    const reel = { ...binding(), format: 'reel' as const };
    const pending = await readFacebookNativeProof(reel, transport(async () => response({ status: { video_status: 'ready', publishing_phase: { status: 'in_progress' } } })));
    expect(pending.outcome).toBe('processing');
    const scheduled = await readFacebookNativeProof(binding(), transport(async () => response({ published: false, scheduled_publish_time: 1_900_000_000 })));
    expect(scheduled.outcome).toBe('scheduled');
  });

  it('snapshots every binding field before waiting on the transport', async () => {
    const mutable = binding();
    let resolve!: (value: Record<string, unknown>) => void;
    const request = readFacebookNativeProof(mutable, transport(() => new Promise((r) => { resolve = r; })));
    mutable.workspaceId = 'changed'; mutable.remoteId = 'changed-id'; mutable.revision = 9;
    resolve(response());
    const result = await request;
    expect(result).toMatchObject({ workspaceId: 'workspace-1', remoteId: 'video-1', revision: 2, outcome: 'published' });
  });

  it('avoids starting a read after cancellation and treats cancellation during a read as unknown', async () => {
    const already = new AbortController(); already.abort();
    const never = vi.fn(async () => response());
    expect(await readFacebookNativeProof(binding(), transport(never), already.signal)).toMatchObject({ outcome: 'unknown', detail: 'aborted' });
    expect(never).not.toHaveBeenCalled();

    const controller = new AbortController();
    let resolve!: (value: Record<string, unknown>) => void;
    const inFlight = readFacebookNativeProof(binding(), transport(() => new Promise((r) => { resolve = r; })), controller.signal);
    controller.abort(); resolve(response());
    expect(await inFlight).toMatchObject({ outcome: 'unknown', detail: 'aborted' });
  });

  it('maps transport and Graph errors to a safe unknown result without treating inaccessible as absent', async () => {
    const result = await readFacebookNativeProof(binding(), transport(async () => { throw new Error('private Graph body'); }));
    expect(result).toMatchObject({ outcome: 'unknown', detail: 'read_failed' });
    expect(JSON.stringify(result)).not.toContain('private Graph body');
  });

  it('rejects invalid hash, revision, and noncanonical IDs before I/O', async () => {
    const getGraph = vi.fn(async () => response());
    for (const bad of [
      { ...binding(), remoteId: ' video-1' },
      { ...binding(), payloadHash: 'x'.repeat(64) },
      { ...binding(), revision: -1 },
    ]) await expect(readFacebookNativeProof(bad, transport(getGraph))).rejects.toThrow('Invalid Facebook native read proof binding.');
    expect(getGraph).not.toHaveBeenCalled();
  });

  it('performs no POST or DELETE', async () => {
    const postGraph = vi.fn(async () => ({})); const deleteGraph = vi.fn(async () => ({}));
    const t = { ...transport(async () => response()), postGraph, deleteGraph };
    await readFacebookNativeProof(binding(), t);
    expect(postGraph).not.toHaveBeenCalled(); expect(deleteGraph).not.toHaveBeenCalled();
  });
});
