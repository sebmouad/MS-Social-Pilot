// Operation-lock/authority behavior is exercised by publishing-guard and PostgreSQL suites.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn(), deleteMany: vi.fn() },
  post: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
const capabilities = vi.hoisted(() => ({ firstComment: true, defaultFormatId: 'post', media: null as null | { kinds: readonly ('image' | 'video')[]; maxImages: number | null; maxVideos: number | null; mixedKinds: boolean; linkWithMedia: boolean; imageAltText: boolean } }));
const provider = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000, 'publishing.maxFirstCommentDelayMinutes': 10080, 'publishing.maxImportRows': 100,
  'publishing.maxImportBytes': 256000, 'publishing.maxTargetsPerPost': 20,
  'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
  'publishing.collab.versionRetention': 50,
  'publishing.collab.labelsPerPostLimit': 20,
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({
  publish: provider.publish,
  ...(capabilities.firstComment ? { publishFirstComment: vi.fn() } : {}),
  ...(capabilities.media ? { publishingMedia: capabilities.media } : {}),
  publishingFormats: [...new Set(['post', capabilities.defaultFormatId])].map(id => ({ id, label: id, media: capabilities.media ?? { kinds: ['image', 'video'], maxImages: null, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true }, firstComment: capabilities.firstComment, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } })),
  defaultPublishingFormatId: capabilities.defaultFormatId, supportsTargetKind: () => true,
}) }));

import { cancelScheduledPost, createPost, publishPost, reschedulePost, restorePostVersion, reviewPost, schedulePost, submitPostForApproval, updatePost } from '@/modules/publishing/server/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  capabilities.firstComment = true;
  capabilities.defaultFormatId = 'post';
  provider.publish.mockReset();
  capabilities.media = { kinds: ['image', 'video'], maxImages: null, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true };
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', format: 'post', status: 'draft', message: 'Existing post', firstComment: null, link: null, media: [], targets: [{ status: 'pending', target: { type: 'page', socialAccount: { provider: 'facebook' } } }] });
  db.post.update.mockResolvedValue({});
  db.post.create.mockResolvedValue({});
  db.target.findMany.mockResolvedValue([{ id: 'target-1', type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', invalidatedAt: null } }]);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('FROM labels') ? [{ id: 'label-1' }] : []);
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
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', format: 'post', message: 'Unsupported media', firstComment: null,
      link: null, media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }, { kind: 'video', url: 'https://cdn.test/a.mp4' }],
      status: 'draft', scheduledAt: null,
      targets: [{ id: 'pt1', status: 'pending', remotePostId: null, target: { id: 'target-1', type: 'page', providerId: 'provider-1',
        canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } } }],
    });
    await expect(publishPost(actor, 'p1')).rejects.toThrow(/cannot combine/i);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
  });

  it('rejects missing or unsupported stored formats before journal intent or provider dispatch', async () => {
    const target = { id: 'pt1', status: 'pending', remotePostId: null, target: { id: 'target-1', type: 'page', providerId: 'provider-1',
      canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } } };
    for (const post of [
      { id: 'p1', authorId: 'u1', message: 'Existing post', firstComment: null, link: null, media: [], status: 'draft', scheduledAt: null, targets: [target] },
      { id: 'p1', authorId: 'u1', format: 'unregistered-format', message: 'Existing post', firstComment: null, link: null, media: [], status: 'draft', scheduledAt: null, targets: [target] },
    ]) {
      db.post.findFirst.mockResolvedValueOnce(post);
      await expect(publishPost(actor, 'p1')).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
  });

  it('rejects a stale explicit destination format before persistence or dispatch', async () => {
    await expect(createPost(actor, { message: 'Stale format', firstComment: '', targetIds: ['target-1'], destinationFormats: { 'old-target': 'post' } })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.post.create).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('uses a neutral adapter declaration to allow supported mixed media and link combinations', async () => {
    capabilities.media = { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: true, linkWithMedia: true, imageAltText: true };
    const media = [{ kind: 'image' as const, url: 'https://cdn.test/a.jpg' }, { kind: 'video' as const, url: 'https://cdn.test/a.mp4' }];
    await createPost(actor, { message: 'Cross-platform format', firstComment: '', targetIds: ['target-1'], media, link: 'https://example.test' });
    expect(db.post.create.mock.calls[0]?.[0].data).toMatchObject({ link: 'https://example.test/', media });
  });

  it('allows link-only and media-only content but rejects an empty post or first-comment-only post', async () => {
    await createPost(actor, { message: '  ', firstComment: '', targetIds: ['target-1'], link: 'https://example.test/story' });
    expect(db.post.create.mock.calls.at(-1)?.[0].data).toMatchObject({ message: '', link: 'https://example.test/story' });
    await createPost(actor, { message: '', firstComment: '', targetIds: ['target-1'], media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] });
    expect(db.post.create.mock.calls.at(-1)?.[0].data.message).toBe('');
    await expect(createPost(actor, { message: '  ', firstComment: '', targetIds: ['target-1'] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createPost(actor, { message: '', firstComment: 'Details only', targetIds: ['target-1'] })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('applies the same attachment-only rule to edits', async () => {
    await updatePost(actor, { postId: 'p1', message: ' ', firstComment: '', targetIds: ['target-1'], media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: '', media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] }) }));
    await expect(updatePost(actor, { postId: 'p1', message: ' ', firstComment: 'Details only', targetIds: ['target-1'] })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('invalidates review after an editor changes an approved post’s content or destinations', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'contributor-1', status: 'draft', publishedAt: null, approvalStatus: 'approved', targets: [{ id: 'pt1', status: 'pending', remotePostId: null }] });
    await updatePost(actor, { postId: 'p1', message: 'Changed after review', firstComment: '', targetIds: ['target-1'] });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: 'Changed after review', targets: { create: [expect.objectContaining({ targetId: 'target-1' })] } }) }));
    const reviewReset = db.$executeRaw.mock.calls.map(call => call[0]?.join('')).find(sql => sql?.includes('"approvalStatus" = \'pending\''));
    expect(reviewReset).toContain('"reviewedById" = NULL');
  });

  it('keeps the manager publishing bypass after an edited approval is cleared', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'contributor-1', message: 'Changed after review', firstComment: null, link: null, media: [], status: 'draft', scheduledAt: null,
      targets: [{ id: 'pt1', status: 'published', remotePostId: 'remote-1', target: { id: 'target-1' } }],
    });
    await expect(publishPost(actor, 'p1')).resolves.toMatchObject({ published: 1, failed: 0, skipped: false });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
  });

  it('creates a scheduled post atomically and rejects a schedule without destinations', async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    await createPost(actor, { message: 'Planned update', firstComment: 'More details', targetIds: ['target-1'], scheduledAt });
    expect(db.post.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'scheduled', scheduledAt, targets: { create: [expect.objectContaining({ targetId: 'target-1', status: 'pending' })] } }) });
    db.post.create.mockClear();
    await expect(createPost(actor, { message: 'No destination', firstComment: '', targetIds: [], scheduledAt })).rejects.toThrow(/destination/);
    expect(db.post.create).not.toHaveBeenCalled();
  });

  it('persists the selected default format on each destination row', async () => {
    await createPost(actor, { message: 'Format-bound post', firstComment: '', targetIds: ['target-1'] });
    expect(db.post.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      targets: { create: [expect.objectContaining({ targetId: 'target-1', formatId: 'post' })] },
    }) });
  });

  it('preserves a legacy format for an existing destination and uses the module default for a new one', async () => {
    capabilities.defaultFormatId = 'module-default';
    db.target.findMany.mockResolvedValueOnce([
      { id: 'target-1', type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', invalidatedAt: null } },
      { id: 'target-2', type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', invalidatedAt: null } },
    ]);
    db.post.findFirst.mockResolvedValueOnce({ id: 'p1', authorId: 'u1', format: 'post', status: 'draft', publishedAt: null,
      targets: [{ id: 'pt1', targetId: 'target-1', formatId: null, status: 'pending', remotePostId: null }],
    });
    await updatePost(actor, { postId: 'p1', message: 'Updated', firstComment: '', targetIds: ['target-1', 'target-2'] });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      targets: { create: [
        expect.objectContaining({ targetId: 'target-1', formatId: 'post' }),
        expect.objectContaining({ targetId: 'target-2', formatId: 'module-default' }),
      ] },
    }) }));
  });

  it('records the created state in the same transaction using the Root retention bound', async () => {
    await createPost(actor, { message: 'Version one', firstComment: '', targetIds: ['target-1'] });
    const snapshot = db.$executeRaw.mock.calls.map(call => call[0]?.join('')).find(sql => sql?.includes('INSERT INTO post_versions'));
    expect(snapshot).toBeDefined();
    expect(snapshot).toContain('INSERT INTO post_versions');
    expect(snapshot).toContain('FROM posts p WHERE p.id');
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('restores an earlier snapshot through the ordinary save path and changes labels atomically', async () => {
    const result = await restorePostVersion({ actor, postId: 'p1', snapshot: {
      message: 'Earlier text', firstComment: 'First reply', link: null,
      media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }], targetIds: ['target-1'], labelIds: ['label-1'],
    } });
    expect(result).toEqual({ postId: 'p1', status: 'draft', approvalReset: true });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' }, data: expect.objectContaining({ message: 'Earlier text', firstComment: 'First reply', link: null, media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] }),
    }));
    expect(db.$executeRaw.mock.calls.map(call => call[0]?.join('')).some(sql => sql?.includes('DELETE FROM post_labels'))).toBe(true);
    expect(db.$executeRaw.mock.calls.map(call => call[0]?.join('')).some(sql => sql?.includes('INSERT INTO post_versions'))).toBe(true);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('does not restore scheduled or in-flight posts', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', scheduledAt: new Date(Date.now() + 60_000), targets: [{ id: 'pt1', status: 'pending', remotePostId: null }] });
    await expect(restorePostVersion({ actor, postId: 'p1', snapshot: { message: 'Earlier', firstComment: null, link: null, media: [], targetIds: ['target-1'], labelIds: [] } })).rejects.toMatchObject({ code: 'conflict' });
    expect(db.post.update).not.toHaveBeenCalled();
    expect(db.$executeRaw.mock.calls.some(call => call[0]?.join('').includes('INSERT INTO post_labels'))).toBe(false);
  });

  it('refuses a historical label set that exceeds the current Root bound', async () => {
    await expect(restorePostVersion({ actor, postId: 'p1', snapshot: {
      message: 'Earlier', firstComment: null, link: null, media: [], targetIds: ['target-1'],
      labelIds: Array.from({ length: 21 }, (_, index) => `label-${index}`),
    } })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.post.update).not.toHaveBeenCalled();
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
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', format: 'post', status: 'draft', message: 'Existing post', firstComment: null, link: null, media: [], targets: [{ status: 'pending', target: { type: 'page', socialAccount: { provider: 'facebook' } } }] });
    await schedulePost(actor, 'p1', new Date(Date.now() + 60_000));
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'scheduled' }) });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() - 60_000))).rejects.toThrow(/future/);
  });

  it('rechecks selected-module media support before scheduling an existing draft', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', format: 'post', status: 'draft', message: 'Existing post', firstComment: null, link: 'https://example.test',
      media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }],
      targets: [{ status: 'pending', target: { type: 'page', socialAccount: { provider: 'facebook' } } }],
    });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() + 60_000))).rejects.toThrow(/cannot combine/i);
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it('validates stored post content before scheduling and rescheduling', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', message: ' ', firstComment: 'Only comment', link: null, media: [], targets: [{ status: 'pending' }] });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() + 60_000))).rejects.toMatchObject({ code: 'invalid_request' });
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', scheduledAt: new Date(Date.now() + 60_000), message: ' ', firstComment: null, link: null, media: [], targets: [{ status: 'pending', remotePostId: null }] });
    await expect(reschedulePost(actor, { postId: 'p1', date: '2099-01-01', time: '12:00', timeZone: 'UTC' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects truly empty stored content before creating publication intent', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', message: ' ', firstComment: 'Only comment', link: null, media: [], status: 'draft', scheduledAt: null,
      targets: [{ id: 'pt1', status: 'pending', remotePostId: null, target: { id: 'target-1', type: 'page', providerId: 'provider-1', canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } } }],
    });
    await expect(publishPost(actor, 'p1')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
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
