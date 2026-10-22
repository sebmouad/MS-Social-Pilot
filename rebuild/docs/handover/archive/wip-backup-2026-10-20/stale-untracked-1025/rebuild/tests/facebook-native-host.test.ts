import { describe, expect, it, vi } from 'vitest';
import type { PublishRequest } from '../src/platforms/types';
import { createFacebookNativeVideoPublisher, type NativeHostBinding } from '../src/platforms/facebook/formats/host';
import type { FacebookNativePolicy, FacebookNativeTransport } from '../src/platforms/facebook/formats/types';

const policy: FacebookNativePolicy = {
  scheduleMinSeconds: 600, scheduleMaxSeconds: 2592000,
  video: { maxBytes: 1000, minDurationSeconds: 1, maxDurationSeconds: 100, minAspect: 0.4, maxAspect: 2.5 },
  reel: { maxBytes: 1000, minDurationSeconds: 3, maxDurationSeconds: 90, minAspect: 0.5, maxAspect: 0.6 },
  storyVideo: { maxBytes: 1000, minDurationSeconds: 3, maxDurationSeconds: 60, minAspect: 0.5, maxAspect: 0.6 },
  storyPhoto: { maxBytes: 1000, minDurationSeconds: 0, maxDurationSeconds: 0, minAspect: 0.5, maxAspect: 0.6 },
  poll: { maxPolls: 3, intervalMs: 100 },
};

function binding(overrides: Partial<NativeHostBinding> = {}): NativeHostBinding {
  return {
    workspaceId: 'workspace-1', operationId: 'operation-1', postId: 'post-1', postTargetId: 'post-target-1',
    targetId: 'local-target-1', actorId: 'actor-1', remoteTargetId: 'remote-page-1', sourceFormatId: 'post',
    claimState: 'started', authorityFingerprint: 'authority-epoch-1', formatId: 'post',
    credential: { accessToken: 'secret-token', grantedScopes: ['pages_manage_posts'] }, ...overrides,
  };
}

function request(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    credential: { accessToken: 'secret-token', grantedScopes: ['pages_manage_posts'] },
    target: { id: 'remote-page-1', name: 'Page', kind: 'page' },
    operationId: 'operation-1', formatId: 'post', text: 'Original caption', link: null,
    media: [{ kind: 'video', url: 'https://media.example/video.mp4', altText: 'caller data' }],
    ...overrides,
  };
}

function inspected(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
  return { bytes, mimeType: 'video/mp4', sizeBytes: bytes.byteLength, width: 640, height: 360, durationSeconds: 5 };
}

function submitted() {
  return { status: 'submitted' as const, remoteId: 'remote-video-1', url: null, scheduled: false, steps: [], readbackRequired: true as const };
}

function setup(input: {
  first?: NativeHostBinding; second?: NativeHostBinding; execute?: ReturnType<typeof vi.fn>;
  resolve?: ReturnType<typeof vi.fn>;
  request?: PublishRequest;
}) {
  const transport: FacebookNativeTransport = { postGraph: vi.fn(), upload: vi.fn() };
  const createTransport = vi.fn(() => transport);
  const loadBinding = vi.fn<(...args: [PublishRequest]) => Promise<NativeHostBinding>>()
    .mockResolvedValueOnce(input.first ?? binding())
    .mockResolvedValueOnce(input.second ?? input.first ?? binding());
  const resolveMedia = input.resolve ?? vi.fn(async () => inspected());
  const execute = input.execute ?? vi.fn(async () => submitted());
  const publish = createFacebookNativeVideoPublisher({
    loadBinding,
    resolveMedia,
    loadPolicy: vi.fn(async () => ({ policy, authorityFingerprint: (input.first ?? binding()).authorityFingerprint })),
    transport: createTransport,
    execute: execute as never,
  });
  return { publish, loadBinding, resolveMedia, execute, transport, createTransport, request: input.request ?? request() };
}

describe('Facebook native feed video host', () => {
  it('publishes the exact inspected bytes with only trusted metadata and returns a submitted receipt', async () => {
    const bytes = new Uint8Array([7, 8, 9, 10]);
    const state = setup({ resolve: vi.fn(async () => inspected(bytes)) });
    await expect(state.publish(state.request)).resolves.toEqual({ remoteId: 'remote-video-1', url: null, state: 'submitted' });
    expect(state.execute).toHaveBeenCalledTimes(1);
    const [, plan] = state.execute.mock.calls[0]! as unknown as [NativeHostBinding, { format: string; targetId: string; description: string; media: { bytes: Uint8Array; url?: string; fileName?: string; mimeType?: string; altText?: string } }];
    expect(plan).toMatchObject({ format: 'video', targetId: 'remote-page-1', description: 'Original caption' });
    expect(plan.media.url).toBeUndefined();
    expect(plan.media.fileName).toBe('video.mp4');
    expect(plan.media.mimeType).toBe('video/mp4');
    expect([...plan.media.bytes]).toEqual([7, 8, 9, 10]);
    expect('altText' in plan.media).toBe(false);
  });

  it('snapshots the request before the first await', async () => {
    const mutable = request();
    const resolveMedia = vi.fn(async () => {
      mutable.text = 'Mutated caption';
      mutable.target.id = 'attacker-page';
      mutable.credential.accessToken = 'attacker-token';
      mutable.media![0]!.url = 'https://attacker.example/other.mp4';
      return inspected();
    });
    const state = setup({ request: mutable, resolve: resolveMedia });
    await state.publish(mutable);
    expect(state.resolveMedia).toHaveBeenCalledWith('https://media.example/video.mp4', 'video', undefined);
    const [, plan] = state.execute.mock.calls[0]! as unknown as [NativeHostBinding, { targetId: string; description: string }];
    expect(plan).toMatchObject({ targetId: 'remote-page-1', description: 'Original caption' });
  });

  it('refuses authority revoked while media is inspected before provider dispatch', async () => {
    const state = setup({ first: binding(), second: binding({ authorityFingerprint: 'new-epoch' }) });
    await expect(state.publish(state.request)).rejects.toThrow();
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.transport.postGraph).not.toHaveBeenCalled();
  });

  it('rejects a binding for a different remote Page before resolving media', async () => {
    const state = setup({ first: binding({ remoteTargetId: 'other-page' }) });
    await expect(state.publish(state.request)).rejects.toThrow();
    expect(state.resolveMedia).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['link', { link: 'https://example.com' }],
    ['local file', { media: [{ kind: 'video' as const, url: 'https://media.example/video.mp4', localFile: { bytes: new Uint8Array([1]), mimeType: 'video/mp4', fileName: 'video.mp4' } }] }],
    ['non-video format', { formatId: 'reel' }],
  ])('refuses %s at the host boundary', async (_name, overrides) => {
    const state = setup({ request: request(overrides) });
    await expect(state.publish(state.request)).rejects.toThrow();
    expect(state.loadBinding).not.toHaveBeenCalled();
    expect(state.resolveMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['uncertain', { status: 'uncertain', phase: 'video_create', knownIds: [], message: 'held', steps: [] }],
    ['already attempted', { status: 'already_attempted', previous: { operationId: 'operation-1', format: 'video', state: 'uncertain', knownIds: [] } }],
  ])('holds %s outcomes and never replays them', async (_label, outcome) => {
    const execute = vi.fn(async () => outcome as never);
    const state = setup({ execute });
    await expect(state.publish(state.request)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
