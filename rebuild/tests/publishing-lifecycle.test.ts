// Operation-lock/authority behavior is exercised by publishing-guard and PostgreSQL suites.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
const capabilities = vi.hoisted(() => ({ firstComment: true, media: null as null | { kinds: readonly ('image' | 'video')[]; maxImages: number | null; maxVideos: number | null; mixedKinds: boolean; linkWithMedia: boolean; imageAltText: boolean } }));
const provider = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000, 'publishing.maxImportRows': 100,
  'publishing.maxImportBytes': 256000, 'publishing.maxTargetsPerPost': 20,
  'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({ publish: provider.publish, ...(capabilities.firstComment ? { publishFirstComment: vi.fn() } : {}), ...(capabilities.media ? { publishingMedia: capabilities.media } : {}), supportsTargetKind: () => true }) }));

import { cancelScheduledPost, createPost, publishPost, reviewPost, schedulePost, submitPostForApproval } from '../src/server/publishing/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  capabilities.firstComment = true;
  provider.publish.mockReset();
  capabilities.media = { kinds: ['image', 'video'], maxImages: null, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true };
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', targets: [{ status: 'pending' }] });
  db.post.update.mockResolvedValue({});
  db.post.create.mockResolvedValue({});
  db.target.findMany.mockResolvedValue([{ id: 'target-1', type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', invalidatedAt: null } }]);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('publishing lifecycle transitions', () => {
  it('rejects a first comment when a chosen adapter does not implement it', async () => {
    capabilities.firstComment = false;
    await expect(createPost(actor, { message: 'Update', firstComment: 'Details', targetIds: ['target-1'] })).rejects.toThrow(/cannot add a first comment/);
    expect(db.post.create).not.toHaveBeenCalled();
  });

  it('rejects a Facebook media combination before saving a draft or schedule', async () => {
    await expect(createPost(actor, {
      message: 'Unsupported album', firstComment: '', targetIds: ['target-1'],
      media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }, { kind: 'video', url: 'https://cdn.test/a.mp4' }],
      scheduledAt: new Date(Date.now() + 3_600_000),
    })).rejects.toThrow(/cannot combine/i);
    expect(db.post.create).not.toHaveBeenCalled();
  });

  it('fails closed for media when an adapter omits its publishing media declaration', async () => {
    capabilities.media = null;
    await expect(createPost(actor, { message: 'Undeclared media', firstComment: '', targetIds: ['target-1'], media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.post.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported media before creating a durable publication attempt', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', message: 'Unsupported media', firstComment: null,
      link: null, media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }, { kind: 'video', url: 'https://cdn.test/a.mp4' }],
      status: 'draft', scheduledAt: null,
      targets: [{ id: 'pt1', status: 'pending', remotePostId: null, target: { id: 'target-1', type: 'page', providerId: 'provider-1',
        canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } } }],
    });
    await expect(publishPost(actor, 'p1')).rejects.toThrow(/cannot combine/i);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
  });

  it('uses a neutral adapter declaration to allow supported mixed media and link combinations', async () => {
    capabilities.media = { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: true, linkWithMedia: true, imageAltText: true };
    const media = [{ kind: 'image' as const, url: 'https://cdn.test/a.jpg' }, { kind: 'video' as const, url: 'https://cdn.test/a.mp4' }];
    await createPost(actor, { message: 'Cross-platform format', firstComment: '', targetIds: ['target-1'], media, link: 'https://example.test' });
    expect(db.post.create.mock.calls[0]?.[0].data).toMatchObject({ link: 'https://example.test/', media });
  });

  it('creates a scheduled post atomically and rejects a schedule without destinations', async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    await createPost(actor, { message: 'Planned update', firstComment: 'More details', targetIds: ['target-1'], scheduledAt });
    expect(db.post.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'scheduled', scheduledAt, targets: { create: [expect.objectContaining({ targetId: 'target-1', status: 'pending' })] } }) });
    db.post.create.mockClear();
    await expect(createPost(actor, { message: 'No destination', firstComment: '', targetIds: [], scheduledAt })).rejects.toThrow(/destination/);
    expect(db.post.create).not.toHaveBeenCalled();
  });
  it('submits an authored draft with destinations for approval', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    await submitPostForApproval(actor, 'p1');
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'pending_approval' }) });
  });

  it('rejects approval submission by a contributor for another author', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u2', status: 'draft', targets: [{ status: 'pending' }] });
    await expect(submitPostForApproval(actor, 'p1')).rejects.toThrow(/cannot be submitted/);
  });

  it('allows a client reviewer to approve a different author’s post back to draft', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'client' });
    db.post.findFirst.mockResolvedValueOnce({ authorId: 'u2' }).mockResolvedValueOnce({ id: 'p1', status: 'pending_approval' });
    await reviewPost(actor, 'p1', 'approve');
    expect(db.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'w1', status: 'pending_approval' }, data: expect.objectContaining({ status: 'draft' }) });
  });

  it('schedules only future posts with pending destinations', async () => {
    await schedulePost(actor, 'p1', new Date(Date.now() + 60_000));
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'scheduled' }) });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() - 60_000))).rejects.toThrow(/future/);
  });

  it('rechecks selected-module media support before scheduling an existing draft', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', link: 'https://example.test',
      media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }],
      targets: [{ status: 'pending', target: { type: 'page', socialAccount: { provider: 'facebook' } } }],
    });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() + 60_000))).rejects.toThrow(/cannot combine/i);
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it('cancels a local queued item and preserves remote scheduled posts', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', targets: [{ status: 'pending', remotePostId: null }] });
    await cancelScheduledPost(actor, 'p1');
    expect(db.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'w1', status: 'scheduled' }, data: expect.objectContaining({ status: 'draft', scheduledAt: null }) });

    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', targets: [{ status: 'scheduled_remote', remotePostId: 'remote-1' }] });
    await expect(cancelScheduledPost(actor, 'p1')).rejects.toThrow(/no longer be cancelled locally/);
  });

  it('blocks mutations outside a member’s channel scope', async () => {
    db.postTarget.findMany.mockResolvedValue([{ targetId: 'restricted-target' }]);
    await expect(submitPostForApproval({ ...actor, allowedTargetIds: ['allowed-target'] }, 'p1')).rejects.toThrow(/channel scope/);
    expect(db.post.update).not.toHaveBeenCalled();
  });
});
