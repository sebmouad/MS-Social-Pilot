import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), execute: vi.fn(), audit: vi.fn(), config: vi.fn(), enqueue: vi.fn(), mail: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/mail', () => ({ sendTransactionalMail: m.mail }));
vi.mock('@/modules/root/server/admin/authz', () => ({ assertRootActor: m.auth, lockRootActor: m.auth }));
vi.mock('@/modules/root/server/admin/audit', () => ({ writeRootAudit: m.audit }));
vi.mock('@/modules/root/server/admin/policy', () => ({ rootTransaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.query, $executeRaw: m.execute }) }));
vi.mock('@/modules/notifications/chat-channels/server/delivery', () => ({ enqueueOperatorIncident: m.enqueue }));
import { testRootOperatorMonitoring } from '@/modules/root/server/operator-monitoring';
import { ROOT_MONITORING_CONFIG } from '@/modules/root/config';
beforeEach(() => {
  vi.clearAllMocks(); m.auth.mockResolvedValue(undefined); m.query.mockResolvedValue([]); m.execute.mockResolvedValue(1); m.enqueue.mockResolvedValue(0);
  m.config.mockImplementation(async key => ROOT_MONITORING_CONFIG.find(item => item.key === key)?.defaultValue);
});
it('rejects workspace owner/member/viewer and cross-workspace actors before test intent', async () => {
  for (const actor of ['owner', 'member', 'viewer', 'other-workspace']) {
    m.auth.mockRejectedValueOnce(new Error('forbidden'));
    await expect(testRootOperatorMonitoring(actor, 'TEST ROOT MONITORING')).rejects.toThrow('forbidden');
  }
  expect(m.execute).not.toHaveBeenCalled(); expect(m.enqueue).not.toHaveBeenCalled();
});
it('requires exact test confirmation before persistence or delivery', async () => {
  await expect(testRootOperatorMonitoring('root', 'yes')).rejects.toMatchObject({ code: 'invalid_request' });
  expect(m.execute).not.toHaveBeenCalled(); expect(m.mail).not.toHaveBeenCalled();
});
it('persists and audits test intent in the same transaction as chat enqueue before email claiming', async () => {
  const receipt = await testRootOperatorMonitoring('root', 'TEST ROOT MONITORING');
  expect(receipt).toMatchObject({ queued: true, id: expect.any(String) });
  const intent = m.execute.mock.calls.find(call => call[0].join('').includes('INSERT INTO rebuild_monitoring_deliveries'));
  expect(intent?.slice(1)).toContain('monitoring.test');
  expect(m.enqueue).toHaveBeenCalledWith(expect.anything(), { eventId: receipt.id, state: 'test', workspaceId: '' });
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'root', 'root.monitoring_test_queued', { id: receipt.id });
  expect(m.auth).toHaveBeenCalledTimes(2);
  expect(m.mail).not.toHaveBeenCalled();
});
