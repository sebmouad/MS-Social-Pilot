import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_COPY, ALERT_POLICY } from '../alerts-config';
import { CHAT_POLICY } from '../config';
const mocks = vi.hoisted(() => ({ root: vi.fn(), operations: vi.fn(), query: vi.fn(), txQuery: vi.fn(), execute: vi.fn(), transaction: vi.fn(), count: vi.fn(), config: vi.fn(), secret: vi.fn(), mail: vi.fn(), deliver: vi.fn(), disk: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.query, $transaction: mocks.transaction, postTarget: { count: mocks.count } } }));
vi.mock('@/server/root/operations', () => ({ requireActiveRoot: mocks.root, loadRootOperations: mocks.operations }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config, runtimeSecret: mocks.secret }));
vi.mock('@/server/mail', () => ({ sendTransactionalMail: mocks.mail }));
vi.mock('../server/transport', () => ({ deliverChat: mocks.deliver }));
vi.mock('node:fs/promises', () => ({ statfs: mocks.disk }));
import { ALERT_CONFIRMATION, checkSystemAlerts, listSystemAlerts, testSystemAlert } from '../server/alerts';
import { executeSystemAlertTool } from '../alerts-mcp';
import { OperationError } from '@/lib/operation-error';

const sql = (strings: TemplateStringsArray) => strings.join('?');
beforeEach(() => {
  vi.resetAllMocks(); mocks.root.mockResolvedValue(undefined);
  mocks.operations.mockResolvedValue({ worker: { state: 'fresh' } });
  mocks.config.mockImplementation(async key => key === 'notifications.systemAlertPolicy' ? ALERT_POLICY : key === 'notifications.systemAlertCopy' ? ALERT_COPY : CHAT_POLICY);
  mocks.secret.mockResolvedValue(null); mocks.count.mockResolvedValue(0); mocks.disk.mockResolvedValue({ blocks: 100, bavail: 50 });
  mocks.mail.mockResolvedValue({ status: 'sent' }); mocks.deliver.mockResolvedValue('accepted');
  mocks.query.mockImplementation(async strings => sql(strings).includes('FROM users') ? [{ email: 'owner@example.test', locale: 'fr' }] : []);
  mocks.txQuery.mockImplementation(async strings => sql(strings).includes('FROM users') ? [{ isInstanceOwner: true, disabledAt: null }] : []);
  mocks.execute.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async run => run({ $queryRaw: mocks.txQuery, $executeRaw: mocks.execute }));
});
describe('installation incidents and test delivery', () => {
  it.each(['owner', 'member', 'viewer'])('does not equate workspace %s with installation owner', async () => {
    mocks.root.mockRejectedValue(new OperationError('forbidden', 'Installation-owner access is required.'));
    await expect(listSystemAlerts('workspace-user')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(checkSystemAlerts('workspace-user', ALERT_CONFIRMATION.check)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(testSystemAlert('workspace-user', ALERT_CONFIRMATION.test)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.mail).not.toHaveBeenCalled();
  });
  it('refuses workspace MCP keys even when the user is Root', async () => {
    await expect(executeSystemAlertTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'workspace-key' }, 'test_root_system_alert', { confirmation: ALERT_CONFIRMATION.test })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.mail).not.toHaveBeenCalled();
  });
  it('refuses wrong confirmations before database checks or sends', async () => {
    await expect(testSystemAlert('root', '')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(checkSystemAlerts('root', '')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.mail).not.toHaveBeenCalled();
  });
  it('records one incident opening and never clears unknown worker/backup/disk checks', async () => {
    mocks.count.mockResolvedValue(ALERT_POLICY.publishFailureThreshold);
    mocks.operations.mockResolvedValue({ worker: { state: 'never' } }); mocks.disk.mockRejectedValue(new Error('unsupported'));
    const result = await checkSystemAlerts('root', ALERT_CONFIRMATION.check);
    expect(result).toMatchObject({ opened: ['publish.failures'], resolved: [], skipped: ['worker.down', 'backup.failed', 'disk.full'] });
    expect(mocks.execute.mock.calls.filter(call => sql(call[0]).includes('INSERT INTO system_alerts'))).toHaveLength(1);
    expect(mocks.txQuery.mock.calls.some(call => sql(call[0]).includes('pg_advisory_xact_lock'))).toBe(true);
  });
  it('keeps an open incident deduplicated and resolves known recoveries only', async () => {
    mocks.count.mockResolvedValue(ALERT_POLICY.publishFailureThreshold);
    mocks.txQuery.mockImplementation(async strings => sql(strings).includes('FROM users') ? [{ isInstanceOwner: true, disabledAt: null }] : sql(strings).includes('FROM system_alerts') ? [{ id: 'existing' }] : []);
    const result = await checkSystemAlerts('root', ALERT_CONFIRMATION.check);
    expect(result.opened).toEqual([]); expect(result.resolved).toEqual(['worker.down', 'disk.full']);
  });
  it('rechecks installation ownership inside the incident transaction', async () => {
    mocks.txQuery.mockResolvedValue([{ isInstanceOwner: false, disabledAt: null }]);
    await expect(checkSystemAlerts('former-root', ALERT_CONFIRMATION.check)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('records intent before test delivery and uses French Root copy', async () => {
    const order: string[] = [];
    mocks.execute.mockImplementation(async () => { order.push('audit'); return 1; });
    mocks.mail.mockImplementation(async () => { order.push('send'); return { status: 'sent' }; });
    const result = await testSystemAlert('root', ALERT_CONFIRMATION.test);
    expect(order).toEqual(['audit', 'send', 'audit']);
    expect(mocks.mail.mock.calls[0]?.[0]).toMatchObject({ subject: ALERT_COPY.fr.testTitle, text: ALERT_COPY.fr.testBody });
    expect(result).toMatchObject({ email: 'sent', telegram: 'unavailable', auditRecorded: true });
  });
  it('returns a completed send receipt when secondary audit is unavailable', async () => {
    mocks.execute.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('database unavailable'));
    const result = await testSystemAlert('root', ALERT_CONFIRMATION.test);
    expect(result).toMatchObject({ email: 'sent', auditRecorded: false }); expect(mocks.mail).toHaveBeenCalledTimes(1);
  });
});
