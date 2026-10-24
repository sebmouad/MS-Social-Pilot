import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  post: vi.fn(), targets: vi.fn(), credential: vi.fn(), image: vi.fn(), auth: vi.fn(), selected: vi.fn(),
  update: vi.fn(), sql: vi.fn(), comment: true, maximumDelay: 30,
}));
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingOperation: (actor: unknown, _options: unknown, work: (c: unknown) => unknown) => work({ actor, signal: new AbortController().signal }),
  withPublishingTransaction: (_signal: unknown, work: (tx: unknown) => unknown) => work({ post: { findFirst: h.post, update: h.update }, postTarget: { deleteMany: vi.fn() }, $executeRaw: h.sql, $queryRaw: async () => [] }),
}));
vi.mock('@/server/data', () => ({ prisma: { postTarget: { findMany: async () => [{ targetId: 'now' }] }, post: { findFirst: h.post }, target: { findMany: h.targets, findFirst: h.credential }, membership: { findUnique: async () => ({ role: 'editor' }) } } }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.auth }));
vi.mock('@/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: h.selected }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: (_target: unknown, _adapter: unknown, operation: string) => operation === 'firstComment' && !h.comment ? null : { accessToken: 'never-return-this', grantedScopes: [] } }));
vi.mock('@/modules/publishing/server/media/storage', () => ({ readWorkspaceImage: h.image }));
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn() }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000, 'publishing.maxFirstCommentDelayMinutes': h.maximumDelay,
  'publishing.maxTargetsPerPost': 20, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
  'publishing.collab.versionRetention': 50, 'publishing.collab.labelsPerPostLimit': 20,
})[key] }));
vi.mock('@/server/platforms/registry', () => ({ platformFor: async () => ({
  publish: vi.fn(), publishFirstComment: vi.fn(), supportsTargetKind: () => true,
  publishingMedia: { kinds: ['image'], maxImages: 1, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true },
  defaultPublishingFormatId: 'current', publishingFormats: [{ id: 'current', label: 'Current', firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false }, media: { kinds: ['image'], maxImages: 1, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true } }],
}) }));
import { OperationError } from '../src/lib/operation-error';
import { prepareVersionRestore } from '../src/modules/publishing/server/version-restore';
import { restorePostVersion } from '../src/modules/publishing/server/lifecycle';
import type { VersionSnapshot } from '../src/modules/publishing/collaboration/ports';
const actor = { userId: 'u1', workspaceId: 'w1', allowedTargetIds: ['now'] };
const snapshot: VersionSnapshot = { versionId: 'v1', message: 'Earlier', firstComment: 'Reply', firstCommentDelayMinutes: 90, link: null, media: [], format: 'old', destinationFormats: { removed: 'old' }, targetIds: ['removed'], labelIds: [], scheduledAt: null, timezone: 'UTC' };
beforeEach(() => {
  vi.clearAllMocks(); h.comment = true; h.maximumDelay = 30;
  h.auth.mockResolvedValue({ actor, role: 'editor', entitlements: {} });
  h.selected.mockResolvedValue(['now']);
  h.post.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', format: 'current', targets: [{ targetId: 'now', formatId: 'current', status: 'pending', remotePostId: null }] });
  h.targets.mockResolvedValue([{ id: 'now', type: 'neutral', accessToken: 'encrypted', socialAccount: { provider: 'fixture', invalidatedAt: null } }]);
  h.credential.mockResolvedValue({ accessToken: 'encrypted', socialAccount: { scopes: '', invalidatedAt: null, tokenExpiresAt: null } });
  h.sql.mockResolvedValue(1); h.update.mockResolvedValue({});
});
describe('shared version restore service', () => {
  it('reads only current authorized destinations, and omits invalid media/delay', async () => {
    const review = await prepareVersionRestore(actor, 'p1', { ...snapshot, media: [{ kind: 'video', url: 'https://cdn.test/a.mp4' }] });
    expect(review.content.media).toEqual([]);
    expect(review.content.firstCommentDelayMinutes).toBe(30);
    expect(h.targets.mock.calls[0][0].where).toMatchObject({ workspaceId: 'w1', id: { in: ['now'] } });
    expect(JSON.stringify(review)).not.toContain('never-return-this');
  });
  it('drops a missing local file but refuses unknown storage failures', async () => {
    const saved = { ...snapshot, media: [{ kind: 'image', url: 'media:11111111-1111-4111-8111-111111111111' }] };
    h.image.mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'ENOENT' }));
    expect((await prepareVersionRestore(actor, 'p1', saved)).issues.map(i => i.code)).toContain('media');
    h.image.mockRejectedValueOnce(new Error('storage offline'));
    await expect(prepareVersionRestore(actor, 'p1', saved)).rejects.toThrow('storage offline');
  });
  it('uses current first-comment grants', async () => {
    h.comment = false;
    expect((await prepareVersionRestore(actor, 'p1', snapshot)).content).toMatchObject({ firstComment: '', firstCommentDelayMinutes: 0 });
  });
  it('fails closed for revoked scope, unavailable destinations, foreign authors and final states', async () => {
    h.selected.mockResolvedValueOnce([]);
    await expect(prepareVersionRestore(actor, 'p1', snapshot)).rejects.toMatchObject({ code: 'forbidden' });
    h.targets.mockResolvedValueOnce([]);
    await expect(prepareVersionRestore(actor, 'p1', snapshot)).rejects.toMatchObject({ code: 'unavailable' });
    h.auth.mockResolvedValueOnce({ actor, role: 'contributor', entitlements: {} });
    h.post.mockResolvedValueOnce({ authorId: 'other', status: 'draft', targets: [] });
    await expect(prepareVersionRestore(actor, 'p1', snapshot)).rejects.toMatchObject({ code: 'not_found' });
    h.post.mockResolvedValueOnce({ authorId: 'u1', status: 'scheduled', targets: [] });
    await expect(prepareVersionRestore(actor, 'p1', snapshot)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('previews and refuses implicit lossy restores without mutating', async () => {
    expect(await restorePostVersion({ actor, postId: 'p1', snapshot, mode: 'preview' })).toMatchObject({ restored: false, status: 'review_required' });
    expect(await restorePostVersion({ actor, postId: 'p1', snapshot })).toMatchObject({ restored: false });
    expect(h.update).not.toHaveBeenCalled(); expect(h.sql).not.toHaveBeenCalled();
  });
  it('applies only an explicitly reviewed closest restore through the ordinary atomic save', async () => {
    const review = await prepareVersionRestore(actor, 'p1', snapshot);
    expect(await restorePostVersion({ actor, postId: 'p1', snapshot, mode: 'closest', reviewToken: review.token })).toMatchObject({ restored: true, approvalReset: true });
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: 'Earlier', firstCommentDelayMinutes: 30, targets: { create: [expect.objectContaining({ targetId: 'now', formatId: 'current' })] } }) }));
  });
  it('refuses stale consent and empty adaptation without mutation', async () => {
    const review = await prepareVersionRestore(actor, 'p1', snapshot);
    h.maximumDelay = 10;
    await expect(restorePostVersion({ actor, postId: 'p1', snapshot, mode: 'closest', reviewToken: review.token })).rejects.toMatchObject({ code: 'conflict' });
    const empty = { ...snapshot, message: '', firstComment: null, media: [{ kind: 'video', url: 'https://cdn.test/a.mp4' }] };
    const emptyReview = await prepareVersionRestore(actor, 'p1', empty);
    await expect(restorePostVersion({ actor, postId: 'p1', snapshot: empty, mode: 'closest', reviewToken: emptyReview.token })).rejects.toBeInstanceOf(OperationError);
    expect(h.update).not.toHaveBeenCalled();
  });
});
