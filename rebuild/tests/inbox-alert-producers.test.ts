vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), emit: vi.fn(), sentiment: vi.fn(), available: vi.fn(), access: vi.fn(), target: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { target: { findFirst: mocks.target }, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn().mockResolvedValue(20) }));
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: mocks.emit }));
vi.mock('@/modules/studio/server/sentiment', () => ({ classifyCommentSentiment: mocks.sentiment, sentimentAvailable: mocks.available }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: mocks.access }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxTargetWhere: vi.fn().mockResolvedValue({}) }));
import { notificationEnqueueSchema } from '@/modules/settings/notifications/contracts';
import { runInboxAlertProducers } from '@/modules/inbox/server/notification-events';
const tx = { $queryRaw: mocks.query, $executeRaw: mocks.execute };
const now = new Date('2026-10-20T12:00:00Z');
beforeEach(() => { vi.clearAllMocks(); mocks.sentiment.mockResolvedValue({ available: true, classified: 0 }); mocks.available.mockResolvedValue(true); mocks.target.mockResolvedValue({ id: 't' }); mocks.access.mockResolvedValue(undefined); mocks.transaction.mockImplementation(fn => fn(tx)); mocks.execute.mockResolvedValue(1); });
it('starts new digest cursors without sending history', async () => {
  mocks.query.mockResolvedValueOnce([{ id: 's', userId: 'u', workspaceId: 'w', inboxDigestAt: null }]).mockResolvedValueOnce([]);
  await expect(runInboxAlertProducers(now)).resolves.toEqual({ digests: 0, spikes: 0 });
  expect(mocks.emit).not.toHaveBeenCalled(); expect(mocks.execute).toHaveBeenCalledOnce();
});
it('queues personal channel digests and negative spikes transactionally', async () => {
  mocks.query.mockResolvedValueOnce([{ id: 's', userId: 'u', workspaceId: 'w', inboxDigestAt: new Date(now.getTime() - 3600000) }]).mockResolvedValueOnce([{ id: 't' }]).mockResolvedValueOnce([{ id: 't', workspaceId: 'w' }]);
  await expect(runInboxAlertProducers(now)).resolves.toEqual({ digests: 1, spikes: 1 });
  expect(mocks.emit).toHaveBeenNthCalledWith(1, tx, expect.objectContaining({ recipientId: 'u', targetId: 't', kind: 'inbox_digest' }));
  expect(mocks.emit).toHaveBeenNthCalledWith(2, tx, expect.objectContaining({ targetId: 't', kind: 'negative_spike' }));
  for (const [, event] of mocks.emit.mock.calls) { const { recipientId, ...input } = event; expect(notificationEnqueueSchema.safeParse({ ...input, userId: recipientId ?? 'u' }).success).toBe(true); }
  expect(mocks.emit.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]!);
});
it('leaves cursors unchanged when creating an intent fails', async () => {
  mocks.query.mockResolvedValueOnce([{ id: 's', userId: 'u', workspaceId: 'w', inboxDigestAt: new Date(now.getTime() - 3600000) }]).mockResolvedValueOnce([{ id: 't' }]);
  mocks.emit.mockRejectedValueOnce(new Error('insert failed'));
  await expect(runInboxAlertProducers(now)).rejects.toThrow('insert failed'); expect(mocks.execute).not.toHaveBeenCalled();
});
it('claims bounded due settings and spike targets with skip-locked locks', async () => {
  mocks.query.mockResolvedValue([]); await runInboxAlertProducers(now);
  const sql = mocks.query.mock.calls.map(call => call[0].join('?'));
  expect(sql[0]).toContain('FOR UPDATE OF s SKIP LOCKED'); expect(sql[0]).toContain('LIMIT');
  expect(sql[1]).toContain('FOR UPDATE OF t SKIP LOCKED'); expect(sql[1]).toContain("c.sentiment = 'negative'");
});

it('refuses oversized channel batches before advancing the digest cursor', async () => {
 mocks.query.mockResolvedValueOnce([{ id: 's', userId: 'u', workspaceId: 'w', inboxDigestAt: new Date(now.getTime()-3600000) }]).mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => ({ id: `t${i}` })));
 await expect(runInboxAlertProducers(now)).rejects.toMatchObject({ code: 'unavailable' }); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.emit).not.toHaveBeenCalled();
});

it('skips spike SQL and reports unknown when AI is unavailable', async () => {
  mocks.sentiment.mockResolvedValue({ available: false, classified: null }); mocks.query.mockResolvedValue([]);
  await expect(runInboxAlertProducers(now)).resolves.toEqual({ digests: 0, spikes: null });
  expect(mocks.query).toHaveBeenCalledOnce();
});
it('requires coverage and an observed baseline rather than treating unknown as zero', async () => {
  mocks.query.mockResolvedValue([]); await runInboxAlertProducers(now);
  const sql = mocks.query.mock.calls[1][0].join('?');
  expect(sql).toContain('AND NOT EXISTS'); expect(sql).toContain('AND EXISTS');
  expect(sql).toContain('"sentimentProvenance" IS NULL');
});
it('rechecks Root availability after classification', async () => {
  mocks.available.mockResolvedValue(false); mocks.query.mockResolvedValue([]);
  await expect(runInboxAlertProducers(now)).resolves.toMatchObject({ spikes: null });
  expect(mocks.query).toHaveBeenCalledOnce();
});
it('does not emit spikes after owner access is revoked or channel deselected', async () => {
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 't', workspaceId: 'w', provider: 'test' }]);
  mocks.access.mockRejectedValueOnce(new Error('denied'));
  await expect(runInboxAlertProducers(now)).resolves.toMatchObject({ spikes: 0 });
  expect(mocks.emit).not.toHaveBeenCalled();
});
