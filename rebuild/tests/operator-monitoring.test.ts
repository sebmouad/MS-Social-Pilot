import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/modules/notifications/chat-channels/server/delivery', () => ({ enqueueOperatorIncident: vi.fn() }));
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), auth: vi.fn(), audit: vi.fn(), config: vi.fn(), disk: vi.fn(), mail: vi.fn(), runAllowed: true }));
vi.mock('@/server/jobs/runtime', () => ({ createWorkerDependencies: () => ({}) }));
vi.mock('@/server/jobs/worker', () => ({ createWorker: (deps: { execute: (name: string) => Promise<unknown> }) => ({ runNow: async (name: string) => { if (!m.runAllowed) return false; await deps.execute(name); return true; } }) }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute } }));
vi.mock('@/server/mail', () => ({ sendTransactionalMail: m.mail }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/root/legacy/authz', () => ({ assertRootActor: m.auth, lockRootActor: m.auth }));
vi.mock('@/server/root/legacy/audit', () => ({ writeRootAudit: m.audit }));
vi.mock('@/server/root/legacy/policy', () => ({ rootTransaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.query, $executeRaw: m.execute }), rootResultLimit: (n: number, cap?: number) => Math.min(n, cap ?? n) }));
vi.mock('node:fs/promises', () => ({ statfs: m.disk }));
import { runOperatorMonitoring, runRootOperatorMonitoring, readRootOperatorMonitoring } from '@/modules/root/server/operator-monitoring';
const now = new Date('2026-10-22T12:10:00Z');
const policy = { deliveryBatchSize: 20, deliveryLeaseSeconds: 300, workerStaleSeconds: 120, publishFailureWindowSeconds: 3600, publishFailureThreshold: 2, tokenExpiryWarningDays: 3, diskPath: '/test', diskUsedPercent: 70, healthUrl: 'http://localhost/api/health', healthTimeoutMs: 1000, historyDays: 7, alertLimit: 3 };
beforeEach(() => {
  vi.clearAllMocks(); m.runAllowed = true; m.mail.mockResolvedValue({ status: 'sent' }); m.auth.mockResolvedValue(undefined); m.config.mockImplementation(async key => key === 'root.monitoringPolicy' ? policy : key === 'root.monitoringMailCopy' ? { en: { open: 'Opened', resolved: 'Resolved', body: 'Signal {key}' }, fr: { open: 'Ouverte', resolved: 'Résolue', body: 'Signal {key}' } } : 48); m.execute.mockResolvedValue(1); m.disk.mockResolvedValue({ blocks: 100, bavail: 20 });
  m.query.mockImplementation(async (strings: TemplateStringsArray) => { const sql = strings.join(''); if (sql.includes('worker_heartbeats')) return [{ seenAt: now }]; if (sql.includes('post_targets')) return [{ count: 2 }]; if (sql.includes('social_accounts')) return [{ disconnected: 1, expiring: 0 }]; return []; });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }));
});
describe('installation monitoring', () => {
  it('uses runtime thresholds and idempotent observed minutes', async () => { const r = await runOperatorMonitoring(now); expect(r.opened).toEqual(['publish.failures', 'accounts.disconnected', 'disk.full']); expect(r.uptime).toEqual({ app: true, worker: true }); expect(m.disk).toHaveBeenCalledWith('/test'); const claims = m.execute.mock.calls.filter(c => c[0].join('').includes('WITH claimed')); expect(claims).toHaveLength(2); expect(claims[0][0].join('')).toContain('ON CONFLICT DO NOTHING'); });
  it('failed app probe and unknown disk measurement do not imply availability', async () => { vi.mocked(fetch).mockRejectedValue(new Error('offline')); m.disk.mockRejectedValue(new Error('unsupported')); const r = await runOperatorMonitoring(now); expect(r.uptime.app).toBe(false); expect(r.checks.some(c => c.key === 'disk.full')).toBe(false); });
  it('rejects non-Root and cross-workspace actors before installation reads', async () => { for (const actor of ['owner', 'member', 'viewer', 'other-workspace']) { m.auth.mockRejectedValueOnce(new Error('forbidden')); await expect(readRootOperatorMonitoring(actor)).rejects.toThrow('forbidden'); } expect(m.query).not.toHaveBeenCalled(); });
  it('rejects future heartbeat observations and queries only rebuild identities', async () => {
    const base = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => strings.join('').includes('worker_heartbeats') ? [{ seenAt: new Date(now.getTime() + 60000) }] : base(strings, ...values));
    const result = await runOperatorMonitoring(now);
    expect(result.uptime.worker).toBe(false);
    expect(result.opened).toContain('worker.down');
    const heartbeat = m.query.mock.calls.find(c => c[0].join('').includes('worker_heartbeats'))!;
    expect(heartbeat[0].join('')).toContain('LEFT("workerId",');
    expect(heartbeat).toContain('rebuild-');
  });
  it('does not duplicate open incidents and resolves recovered incidents', async () => {
    const base = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => strings.join('').includes('FROM system_alerts') ? [{ id: 'existing' }] : base(strings, ...values));
    const result = await runOperatorMonitoring(now);
    expect(result.opened).toEqual([]);
    expect(result.resolved).toEqual(['worker.down', 'accounts.expiring', 'backup.failed']);
  });
  it('claims delivery before mail, preserves uncertain outcomes without replay', async () => {
    const base = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { const sql = strings.join(''); if (sql.includes('WITH candidates')) return [{ id: 'delivery', key: 'disk.full', state: 'open' }]; if (sql.includes('SELECT email')) return [{ email: 'root@example.test', locale: 'fr' }]; return base(strings, ...values); });
    m.mail.mockResolvedValue({ status: 'uncertain' });
    await runOperatorMonitoring(now);
    expect(m.mail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Ouverte', text: 'Signal disk.full' }));
    const finish = m.execute.mock.calls.find(c => c[0].join('').includes('SET status =') && c[1] === 'uncertain');
    expect(finish).toBeTruthy();
    const expiration = m.execute.mock.calls.find(c => c[0].join('').includes("SET status = 'uncertain'"));
    expect(expiration?.[0].join('')).toContain("status = 'sending'");
    const claim = m.query.mock.calls.find(c => c[0].join('').includes('WITH candidates'))!;
    expect(claim[0].join('')).toContain("status = 'pending'");
  });
  it('requires exact confirmation before measuring', async () => { await expect(runRootOperatorMonitoring('root', 'yes')).rejects.toThrow('confirmation'); expect(m.query).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });
  it('refuses a manual run while the shared monitoring lease is occupied', async () => { m.runAllowed = false; await expect(runRootOperatorMonitoring('root', 'EVALUATE ROOT MONITORING')).rejects.toMatchObject({ code: 'conflict' }); expect(fetch).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); });
  it('audits confirmed evaluation atomically', async () => { await runRootOperatorMonitoring('root', 'EVALUATE ROOT MONITORING'); expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'root', 'root.monitoring_evaluated', expect.anything()); });
});

it('retains bounded resolved incident history without exposing stored raw detail', async () => {
  m.query.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('"resolvedAt" FROM system_alerts') ? [{ id: 'history', key: 'worker.down', openedAt: now, resolvedAt: now }] : []);
  const result = await readRootOperatorMonitoring('root', 2);
  expect(result.incidentHistory).toEqual([{ id: 'history', key: 'worker.down', openedAt: now.toISOString(), resolvedAt: now.toISOString() }]);
  const history = m.query.mock.calls.find(c => c[0].join('').includes('"resolvedAt" FROM system_alerts'))!;
  expect(history.at(-1)).toBe(2);
  expect(history[0].join('')).not.toContain('detail');
});
