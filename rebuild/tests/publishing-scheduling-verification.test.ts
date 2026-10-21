vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn().mockResolvedValue(undefined), enqueueEmptyQueueNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
vi.mock('@/modules/publishing/server/publication', async importOriginal => ({
  ...(await importOriginal<object>()),
  publishDestinationInOperation: vi.fn(async (_context: unknown, input: { dispatch(operationId: string): Promise<unknown> }) => { await input.dispatch('op-1'); return 'published'; }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  post: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
const adapters = vi.hoisted(() => ({ holding: { publish: vi.fn(), getRemoteStatus: vi.fn(), deleteRemote: vi.fn(), rescheduleRemote: vi.fn() }, plain: { publish: vi.fn() } }));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.collab.versionRetention': 50, 'publishing.maxMessageCharacters': 10000, 'publishing.maxTargetsPerPost': 20, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
  'publishing.remoteScheduling.leadMarginSeconds': 60, 'publishing.remoteScheduling.offered': true, 'publishing.remoteScheduling.defaultMode': 'application',
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
const media = { kinds: ['image', 'video'], maxImages: null, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true };
const format = (scheduling: object) => [{ id: 'post', label: 'Post', media, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling }];
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async (provider: string) => provider === 'holding'
  ? { ...adapters.holding, publishFirstComment: vi.fn(), publishingMedia: media, publishingFormats: format({ application: true, native: true, nativeLeadSeconds: { min: 600, max: 6480000 } }), defaultPublishingFormatId: 'post', supportsTargetKind: () => true }
  : { ...adapters.plain, publishFirstComment: vi.fn(), publishingMedia: media, publishingFormats: format({ application: true, native: false }), defaultPublishingFormatId: 'post', supportsTargetKind: () => true } }));
vi.mock('@/modules/settings/server/workspace-operations', () => ({ loadWorkspaceOperations: async () => ({ utmSource: '', utmMedium: '', utmCampaignTemplate: '' }) }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: () => ({ accessToken: 'tok', grantedScopes: [] }) }));
const attemptFirstComment = vi.hoisted(() => vi.fn());
vi.mock('@/modules/publishing/server/first-comment', () => ({ attemptFirstCommentInOperation: attemptFirstComment }));

import { holdScheduledPostAtProvider, publishPost, schedulePost, cancelScheduledPost, reschedulePostToInstant } from '@/modules/publishing/server/lifecycle';
import { cancelHeldDestinations, rescheduleHeldDestinations } from '@/modules/publishing/server/remote-hold';
import { parseScheduleMode, remoteHoldDecision } from '@/modules/publishing/remote-scheduling';
import { publishDestinationInOperation } from '@/modules/publishing/server/publication';

const actor = { userId: 'u1', workspaceId: 'w1' };
const target = (id: string, provider: string) => ({ id, name: `Page ${id}`, type: 'page', providerId: `page-${id}`, canPublish: true, enabled: true, accessToken: 'token', socialAccount: { provider, invalidatedAt: null, tokenExpiresAt: null, scopes: 'publish' } });
const row = (id: string, provider: string) => ({ id: `pt-${id}`, formatId: 'post', status: 'pending', remotePostId: null, target: target(id, provider) });
const at = (seconds: number) => new Date(Date.now() + seconds * 1000);
const scheduled = (when: Date) => ({ id: 'p1', authorId: 'u1', format: 'post', message: 'Hello', firstComment: 'First', link: null, media: [], status: 'scheduled', scheduledAt: when, targets: [row('a', 'holding'), row('b', 'plain')] });

beforeEach(() => {
  vi.clearAllMocks();
  attemptFirstComment.mockResolvedValue({ state: 'sent' });
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.update.mockResolvedValue({});
  db.$executeRaw.mockResolvedValue(1);
  db.$queryRaw.mockResolvedValue([]);
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

const heldRow = () => ({ id: 'pt-a', targetId: 'a', formatId: 'post', remotePostId: 'remote-a', post: { format: 'post' }, target: target('a', 'holding') });
const mixed = (when: Date) => ({ ...scheduled(when), targets: [
  { ...row('a', 'holding'), status: 'scheduled_remote', remotePostId: 'remote-a' }, row('b', 'plain'),
] });

describe('mixed application and platform scheduling recovery', () => {
  it('does not resend held destinations on repeated handoff', async () => {
    db.post.findFirst.mockResolvedValue(mixed(at(10800)));
    db.$queryRaw.mockResolvedValue([{ id: 'pt-a', scheduleMode: 'remote' }, { id: 'pt-b', scheduleMode: 'application' }]);
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(result).toMatchObject({ published: 0, remoteHold: { held: 0, deferred: 0 } });
    expect(publishDestinationInOperation).not.toHaveBeenCalled();
    expect(attemptFirstComment).not.toHaveBeenCalled();
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }));
  });
  it('publishes only the application destination when due, and starts only its comment', async () => {
    const when = at(-60); db.post.findFirst.mockResolvedValue(mixed(when));
    const result = await publishPost(actor, 'p1', when);
    expect(result).toMatchObject({ published: 1, needsReconciliation: 0 });
    expect(adapters.holding.publish).not.toHaveBeenCalled();
    expect(adapters.plain.publish).toHaveBeenCalledTimes(1);
    expect(adapters.plain.publish.mock.calls[0]![0]).not.toHaveProperty('scheduledAt');
    expect(attemptFirstComment).toHaveBeenCalledWith(expect.objectContaining({ automatic: true }), { postId: 'p1', postTargetId: 'pt-b' });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }));
  });
  it('skips a stale due-worker claim after the post was moved', async () => {
    db.post.findFirst.mockResolvedValue(mixed(at(10800)));
    expect(await publishPost(actor, 'p1', at(-60))).toMatchObject({ skipped: true });
    expect(publishDestinationInOperation).not.toHaveBeenCalled();
    expect(db.post.update).not.toHaveBeenCalled();
  });
  it('preserves confirmed publication if its first comment fails', async () => {
    const when = at(-60); db.post.findFirst.mockResolvedValue({ ...scheduled(when), targets: [row('b', 'plain')] });
    attemptFirstComment.mockRejectedValueOnce(new Error('Comment outcome unknown'));
    const result = await publishPost(actor, 'p1', when);
    expect(result).toMatchObject({ published: 1, failed: 0, firstCommentsNeedingReview: 1 });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
  });
  it.each(['pending', 'rejected'])('never hands a contributor post to a provider with %s approval', async approvalStatus => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    db.post.findFirst.mockResolvedValue(scheduled(at(10800)));
    db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('requiresApproval') ? [{ requiresApproval: true }] : [{ approvalStatus }]);
    await expect(publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true })).rejects.toMatchObject({ code: 'conflict' });
    expect(publishDestinationInOperation).not.toHaveBeenCalled();
    expect(attemptFirstComment).not.toHaveBeenCalled();
  });
  it('saves contributor scheduling for approval without platform handoff', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    db.post.findFirst.mockResolvedValue({ ...scheduled(at(10800)), status: 'draft', targets: [{ ...row('a', 'holding'), targetId: 'a' }] });
    db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('requiresApproval') ? [{ requiresApproval: true }] : []);
    const result = await schedulePost(actor, 'p1', at(10800), { scheduleMode: 'remote' });
    expect(result.remoteHold.held).toBe(0);
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending_approval' }) }));
    expect(publishDestinationInOperation).not.toHaveBeenCalled();
  });
  it('returns a mixed post to draft only after removing its scheduled platform copy', async () => {
    const before = mixed(at(10800));
    db.post.findFirst.mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, targets: [row('a', 'holding'), row('b', 'plain')] });
    db.postTarget.findMany.mockResolvedValue([heldRow()]);
    adapters.holding.getRemoteStatus.mockResolvedValue({ state: 'scheduled' });
    await cancelScheduledPost(actor, 'p1');
    expect(adapters.holding.deleteRemote).toHaveBeenCalledTimes(1);
    expect(db.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'draft', scheduledAt: null }) }));
    expect(adapters.holding.deleteRemote.mock.invocationCallOrder[0]).toBeLessThan(db.post.updateMany.mock.invocationCallOrder[0]!);
  });
  it.each(['published', 'unknown'])('keeps the local schedule when the held destination reports %s', async state => {
    db.post.findFirst.mockResolvedValue(mixed(at(10800)));
    db.postTarget.findMany.mockResolvedValue([heldRow()]);
    adapters.holding.getRemoteStatus.mockResolvedValue({ state });
    await expect(cancelScheduledPost(actor, 'p1')).rejects.toMatchObject({ code: 'conflict' });
    expect(adapters.holding.deleteRemote).not.toHaveBeenCalled();
    expect(db.post.updateMany).not.toHaveBeenCalled();
  });
  it('moves the held copy before updating the shared instant for mixed destinations', async () => {
    db.post.findFirst.mockResolvedValue(mixed(at(10800)));
    db.postTarget.findMany.mockResolvedValue([heldRow()]);
    const when = at(18000); await reschedulePostToInstant(actor, 'p1', when);
    expect(adapters.holding.rescheduleRemote).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: when }));
    expect(db.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduledAt: when }) }));
    expect(adapters.holding.rescheduleRemote.mock.invocationCallOrder[0]).toBeLessThan(db.post.updateMany.mock.invocationCallOrder[0]!);
  });
  it('does not move the local schedule when the remote reschedule times out', async () => {
    db.post.findFirst.mockResolvedValue(mixed(at(10800)));
    db.postTarget.findMany.mockResolvedValue([heldRow()]);
    adapters.holding.rescheduleRemote.mockRejectedValueOnce(new Error('Timeout'));
    await expect(reschedulePostToInstant(actor, 'p1', at(18000))).rejects.toMatchObject({ code: 'conflict' });
    expect(db.post.updateMany).not.toHaveBeenCalled();
    expect(attemptFirstComment).not.toHaveBeenCalled();
  });
});
