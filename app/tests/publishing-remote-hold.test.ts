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
  'publishing.maxMessageCharacters': 10000, 'publishing.maxTargetsPerPost': 20, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
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

import { holdScheduledPostAtProvider, publishPost } from '@/modules/publishing/server/lifecycle';
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
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.update.mockResolvedValue({});
  db.$executeRaw.mockResolvedValue(1);
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('platform-held scheduling decision comes only from the destination module declaration', () => {
  const lead = { scheduling: { application: true, native: true, nativeLeadSeconds: { min: 600, max: 6480000 } } };
  const now = new Date('2030-01-01T00:00:00Z');
  it('holds inside the module window, refuses outside it, and respects the Root margin', () => {
    expect(remoteHoldDecision(lead, new Date(now.getTime() + 3600_000), now, 60)).toEqual({ hold: true });
    expect(remoteHoldDecision(lead, new Date(now.getTime() + 630_000), now, 60)).toEqual({ hold: false, reason: 'too_soon' });
    expect(remoteHoldDecision(lead, new Date(now.getTime() + 700_000), now, 60)).toEqual({ hold: true });
    expect(remoteHoldDecision(lead, new Date(now.getTime() + 6480001_000), now, 60)).toEqual({ hold: false, reason: 'too_far' });
  });
  it('treats a format without a declaration as unsupported', () => {
    expect(remoteHoldDecision({ scheduling: { application: true, native: false } }, now, now, 0)).toEqual({ hold: false, reason: 'unsupported' });
    expect(remoteHoldDecision({ scheduling: { application: true, native: true } }, now, now, 0)).toEqual({ hold: false, reason: 'unsupported' });
    expect(remoteHoldDecision(undefined, now, now, 0)).toEqual({ hold: false, reason: 'unsupported' });
  });
  it('parses schedule modes strictly', () => {
    expect(parseScheduleMode(undefined)).toBeUndefined();
    expect(parseScheduleMode('remote')).toBe('remote');
    expect(() => parseScheduleMode('platform')).toThrow();
  });
});

describe('handing a scheduled post to the platform', () => {
  it('holds capable destinations with their instant and leaves the others for the application worker', async () => {
    const when = at(3 * 3600);
    db.post.findFirst.mockResolvedValue(scheduled(when));
    adapters.holding.publish.mockResolvedValue({ remoteId: 'r1', url: null, state: 'scheduled' });
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(adapters.holding.publish).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: when, formatId: 'post' }));
    expect(adapters.plain.publish).not.toHaveBeenCalled();
    expect(vi.mocked(publishDestinationInOperation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishDestinationInOperation).mock.calls[0]![1]).toMatchObject({ postTargetId: 'pt-a', nativeScheduledFor: when });
    expect(result.remoteHold).toEqual({ held: 1, deferred: 1, reasons: ['unsupported'] });
    // Held by the platform: no first comment yet, and the post stays scheduled for the destination still waiting.
    expect(attemptFirstComment).not.toHaveBeenCalled();
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }));
  });

  it('hands over only the destinations that chose the platform; the others stay with the application and the post stays scheduled', async () => {
    const when = at(3 * 3600);
    db.post.findFirst.mockResolvedValue(scheduled(when));
    adapters.holding.publish.mockResolvedValue({ remoteId: 'r1', url: null, state: 'scheduled' });
    db.$queryRaw.mockResolvedValue([{ id: 'pt-a', scheduleMode: 'remote' }, { id: 'pt-b', scheduleMode: 'application' }]);
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(adapters.holding.publish).toHaveBeenCalledTimes(1);
    expect(adapters.plain.publish).not.toHaveBeenCalled();
    // The destination that chose the application is not reported as a platform refusal.
    expect(result.remoteHold).toEqual({ held: 1, deferred: 0, reasons: [] });
  });

  it('keeps everything with the application when every destination chose it, without ever calling a platform or finishing the post', async () => {
    db.post.findFirst.mockResolvedValue(scheduled(at(3 * 3600)));
    db.$queryRaw.mockResolvedValue([{ id: 'pt-a', scheduleMode: 'application' }, { id: 'pt-b', scheduleMode: 'application' }]);
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(adapters.holding.publish).not.toHaveBeenCalled();
    expect(result.remoteHold).toEqual({ held: 0, deferred: 0, reasons: [] });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }));
  });

  it('treats a destination without a stored choice as following the post-level platform-held choice', async () => {
    db.post.findFirst.mockResolvedValue(scheduled(at(3 * 3600)));
    adapters.holding.publish.mockResolvedValue({ remoteId: 'r1', url: null, state: 'scheduled' });
    db.$queryRaw.mockResolvedValue([{ id: 'pt-a', scheduleMode: null }, { id: 'pt-b', scheduleMode: null }]);
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(result.remoteHold).toEqual({ held: 1, deferred: 1, reasons: ['unsupported'] });
  });

  it('keeps a post that is too close for the platform entirely with the application', async () => {
    db.post.findFirst.mockResolvedValue(scheduled(at(300)));
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(adapters.holding.publish).not.toHaveBeenCalled();
    expect(result.remoteHold).toEqual({ held: 0, deferred: 2, reasons: ['too_soon', 'unsupported'] });
  });

  it('does nothing for a post that did not choose platform holding', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ publishMode: 'worker' }]);
    expect(await holdScheduledPostAtProvider(actor, 'p1')).toBeNull();
    expect(adapters.holding.publish).not.toHaveBeenCalled();
  });

  it('reports an adapter refusal as a failed destination without touching the others', async () => {
    db.post.findFirst.mockResolvedValue(scheduled(at(3 * 3600)));
    adapters.holding.publish.mockRejectedValue(new Error('refused'));
    vi.mocked(publishDestinationInOperation).mockImplementationOnce(async () => 'failed');
    const result = await publishPost(actor, 'p1', undefined, { nativeSchedule: true, nativeFallback: true });
    expect(result).toMatchObject({ failed: 1, remoteHold: { held: 0, deferred: 1 } });
    expect(db.post.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });
});

describe('changing a post the platform is holding', () => {
  const held = (id = 'a') => ({ id: `pt-${id}`, targetId: id, formatId: 'post', remotePostId: `remote-${id}`, post: { format: 'post' }, target: target(id, 'holding') });
  const signal = new AbortController().signal;

  it('moves it on the platform first and records the new instant', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    const when = at(5 * 3600);
    await rescheduleHeldDestinations(actor, signal, 'p1', when);
    expect(adapters.holding.rescheduleRemote).toHaveBeenCalledWith(expect.objectContaining({ remoteId: 'remote-a', scheduledAt: when }));
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses a time the platform cannot hold without sending anything', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    await expect(rescheduleHeldDestinations(actor, signal, 'p1', at(120))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(adapters.holding.rescheduleRemote).not.toHaveBeenCalled();
  });

  it('does not record a new time the platform did not confirm', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    adapters.holding.rescheduleRemote.mockRejectedValueOnce(new Error('timeout'));
    await expect(rescheduleHeldDestinations(actor, signal, 'p1', at(5 * 3600))).rejects.toMatchObject({ code: 'conflict' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('cancels by removing the platform copy only while it is still scheduled, then releases the destination', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    adapters.holding.getRemoteStatus.mockResolvedValue({ state: 'scheduled', remoteId: 'remote-a', targetId: 'page-a' });
    const result = await cancelHeldDestinations(actor, signal, 'p1');
    expect(adapters.holding.deleteRemote).toHaveBeenCalledWith(expect.objectContaining({ remoteId: 'remote-a' }));
    expect(db.postTarget.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.postTarget.create).toHaveBeenCalledWith({ data: expect.objectContaining({ postId: 'p1', targetId: 'a', formatId: 'post', status: 'pending' }) });
    expect(result).toEqual({ released: 1 });
  });

  it('never deletes a post that has already gone live, or one the platform does not confirm', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    adapters.holding.getRemoteStatus.mockResolvedValueOnce({ state: 'published', remoteId: 'remote-a', targetId: 'page-a' });
    await expect(cancelHeldDestinations(actor, signal, 'p1')).rejects.toThrow(/already published/);
    adapters.holding.getRemoteStatus.mockResolvedValueOnce({ state: 'unknown' });
    await expect(cancelHeldDestinations(actor, signal, 'p1')).rejects.toMatchObject({ code: 'conflict' });
    adapters.holding.getRemoteStatus.mockRejectedValueOnce(new Error('network'));
    await expect(cancelHeldDestinations(actor, signal, 'p1')).rejects.toMatchObject({ code: 'conflict' });
    expect(adapters.holding.deleteRemote).not.toHaveBeenCalled();
    expect(db.postTarget.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the destination held when the platform does not confirm the removal', async () => {
    db.postTarget.findMany.mockResolvedValue([held()]);
    adapters.holding.getRemoteStatus.mockResolvedValue({ state: 'scheduled', remoteId: 'remote-a', targetId: 'page-a' });
    adapters.holding.deleteRemote.mockRejectedValueOnce(new Error('timeout'));
    await expect(cancelHeldDestinations(actor, signal, 'p1')).rejects.toMatchObject({ code: 'conflict' });
    expect(db.postTarget.deleteMany).not.toHaveBeenCalled();
  });
});
