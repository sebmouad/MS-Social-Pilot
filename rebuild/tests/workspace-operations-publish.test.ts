vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn().mockResolvedValue(undefined) }));
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
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'publishing.maxMessageCharacters': 10000, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500 })[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: () => ({ token: 'synthetic' }) }));
vi.mock('@/modules/publishing/server/publication', () => ({ publishDestinationInOperation: async (_c: unknown, input: { dispatch(id: string): Promise<unknown> }) => { await input.dispatch('op-1'); return 'needs_review'; } }));
vi.mock('@/modules/settings/server/workspace-operations', () => ({ loadWorkspaceOperations: async () => ({ utmSource: 'msp', utmMedium: 'social', utmCampaignTemplate: '{target}' }) }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({
  publish: provider.publish, publishingMedia: { kinds: ['image'], maxImages: 4, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true },
  publishingFormats: [{ id: 'post', label: 'post', media: { kinds: ['image'], maxImages: 4, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true }, firstComment: false, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
  defaultPublishingFormatId: 'post', supportsTargetKind: () => true,
}) }));
import { publishPost } from '@/modules/publishing/server/lifecycle';

describe('publish-time link preparation', () => {
  it('tags caption and link URLs with workspace UTM settings before provider dispatch, without changing stored content', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'owner' });
    db.$queryRaw.mockResolvedValue([]); db.$executeRaw.mockResolvedValue(1); db.post.update.mockResolvedValue({}); db.post.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', format: 'post', status: 'draft', message: 'See https://example.com/a?x=1 now', firstComment: null, link: 'https://example.com/b', media: [], scheduledAt: null,
      targets: [{ id: 'pt1', formatId: 'post', status: 'pending', remotePostId: null, target: { id: 't1', name: 'Synthetic Café', type: 'page', providerId: 'remote-t1', canPublish: true, enabled: true, accessToken: 'enc', socialAccount: { provider: 'example', invalidatedAt: null, tokenExpiresAt: null, scopes: [] } } }] });
    provider.publish.mockResolvedValue({ remoteId: 'r1' });
    await publishPost({ userId: 'u1', workspaceId: 'w1' }, 'p1').catch(() => undefined);
    expect(provider.publish).toHaveBeenCalledTimes(1);
    const sent = provider.publish.mock.calls[0][0];
    expect(sent.text).toBe('See https://example.com/a?x=1&utm_source=msp&utm_medium=social&utm_campaign=synthetic-caf now');
    expect(sent.link).toBe('https://example.com/b?utm_source=msp&utm_medium=social&utm_campaign=synthetic-caf');
    expect(db.post.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: expect.anything() }) }));
  });
});
