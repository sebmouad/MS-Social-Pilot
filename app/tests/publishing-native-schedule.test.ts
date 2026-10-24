vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn().mockResolvedValue(undefined), enqueueEmptyQueueNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
// The shared claim/journal is exercised by PostgreSQL suites; here only the dispatch contract matters.
vi.mock('@/modules/publishing/server/publication', async importOriginal => ({
  ...(await importOriginal<object>()),
  publishDestinationInOperation: vi.fn(async (_context: unknown, input: { dispatch(operationId: string): Promise<unknown> }) => { await input.dispatch('op-1'); return 'needs_review'; }),
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
const adapter = vi.hoisted(() => ({ nativeVideo: true, publish: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000, 'publishing.maxTargetsPerPost': 20, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
const video = { kinds: ['video'], maxImages: 0, maxVideos: 1, mixedKinds: false, linkWithMedia: true, imageAltText: false };
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({
  publish: adapter.publish, publishFirstComment: vi.fn(), publishingMedia: video,
  publishingFormats: [{ id: 'video', label: 'Video', media: video, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: adapter.nativeVideo } }],
  defaultPublishingFormatId: 'video', supportsTargetKind: () => true,
}) }));
vi.mock('@/modules/settings/server/workspace-operations', () => ({ loadWorkspaceOperations: async () => ({ utmSource: '', utmMedium: '', utmCampaignTemplate: '' }) }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: () => ({ accessToken: 'tok', grantedScopes: [] }) }));

import { publishPost } from '@/modules/publishing/server/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };
const future = new Date(Date.now() + 3 * 3600_000);
const scheduled = () => ({ id: 'p1', authorId: 'u1', format: 'video', message: 'Clip', firstComment: null, link: null,
  media: [{ kind: 'video', url: 'https://cdn.test/clip.mp4' }], status: 'scheduled', scheduledAt: future,
  targets: [{ id: 'pt1', formatId: 'video', status: 'pending', remotePostId: null, target: { id: 'target-1', name: 'Page', type: 'page', providerId: 'page-1',
    canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } } }] });

beforeEach(() => {
  vi.clearAllMocks();
  adapter.nativeVideo = true;
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.findFirst.mockImplementation(async () => scheduled());
  db.post.update.mockResolvedValue({});
  db.$executeRaw.mockResolvedValue(1);
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('provider-held (native) scheduling through the canonical publish service', () => {
  it('still refuses a future scheduled post unless native scheduling is requested', async () => {
    await expect(publishPost(actor, 'p1')).rejects.toMatchObject({ code: 'conflict' });
    expect(adapter.publish).not.toHaveBeenCalled();
  });

  it('refuses before dispatch when a destination format does not declare native scheduling', async () => {
    adapter.nativeVideo = false;
    await expect(publishPost(actor, 'p1', undefined, { nativeSchedule: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(adapter.publish).not.toHaveBeenCalled();
  });

  it('dispatches with the schedule instant and the local publication identities, and holds the destination as pending', async () => {
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true });
    expect(adapter.publish).toHaveBeenCalledWith(expect.objectContaining({
      formatId: 'video', operationId: 'op-1', scheduledAt: future,
      publication: { workspaceId: 'w1', postId: 'p1', postTargetId: 'pt1', targetId: 'target-1', actorId: 'u1' },
    }));
    expect(result).toMatchObject({ published: 0, needsReconciliation: 1, skipped: false });
  });

  it('does not pass a schedule for an ordinary due publish', async () => {
    db.post.findFirst.mockImplementation(async () => ({ ...scheduled(), scheduledAt: new Date(Date.now() - 1000) }));
    await publishPost(actor, 'p1', undefined, { nativeSchedule: true });
    expect(adapter.publish.mock.calls[0]![0]).not.toHaveProperty('scheduledAt');
  });
});
