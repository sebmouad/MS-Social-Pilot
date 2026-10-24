import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, appSetting: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.activityPageSize' ? 1 : 1024 }));
import { exportRootActivity, auditCsvCell } from '../src/server/root/audit-export';
import { runAuditRetention } from '../src/server/root/audit-retention';
import { saveAuditRetention } from '../src/server/root/audit-config';
const event = { id: 'event', action: '=FORMULA', createdAt: new Date('2026-01-01Z'), actorName: ' +SUM(1)', actorEmail: 'root@example.invalid', detail: { token: 'secret', password: 'secret', postCount: 3 } };
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  db.appSetting.findUnique.mockResolvedValue(null);
  db.$queryRaw.mockResolvedValue([event]);
  db.$executeRaw.mockResolvedValue(2);
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
});
describe('Root audit export', () => {
  it('exports all matching rows beyond page size using reader redaction', async () => {
    db.$queryRaw.mockResolvedValue([event, { ...event, id: 'second' }]);
    const result = await exportRootActivity('root', { q: 'a%_', workspaceId: 'ws', from: '2026-01-01', to: '2026-01-31' });
    expect(result.rowCount).toBe(2);
    expect(result.csv).toContain('3 posts');
    expect(result.csv).not.toContain('secret');
    expect(result.csv).toContain('"\'=FORMULA"');
    expect(result.csv).toContain('"\' +SUM(1)"');
    const query = db.$queryRaw.mock.calls[0]![0];
    expect(query.values).toContain('%a\\%\\_%');
    expect(query.values).toContain('ws');
    expect(query.values).toContain('2026-01-01');
    expect(query.values).toContain('2026-01-31');
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[0]![0].join('')).toContain('root.activity.exported');
  });
  it('refuses oversized results without auditing success', async () => {
    db.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => where.key === 'root.auditExportMaxRows' ? { value: 1, encrypted: false } : null);
    db.$queryRaw.mockResolvedValue([event, event]);
    await expect(exportRootActivity('root', {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it.each([{ cursor: 'abc' }, { limit: 1 }, { from: '2026-02-30' }, { from: '2026-02-02', to: '2026-01-01' }, { unknown: true }])('rejects invalid or paginated filters %j', async input => {
    await expect(exportRootActivity('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([null, { isInstanceOwner: false }, { isInstanceOwner: true, disabledAt: new Date() }])('denies unauthorized accounts', async actor => {
    db.user.findUnique.mockResolvedValue(actor);
    await expect(exportRootActivity('other', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('fails closed when export auditing fails', async () => {
    db.$executeRaw.mockRejectedValue(new Error('offline'));
    await expect(exportRootActivity('root', {})).rejects.toThrow('offline');
  });
  it('quotes CSV and guards control-prefixed formulas', () => {
    expect(auditCsvCell('a,"b\nc')).toBe('"a,""b\nc"');
    for (const value of ['=1', '+1', '-1', '@cmd', '\t=1', '\rfoo', ' \n=1']) expect(auditCsvCell(value)).toBe(`"'${value}"`);
  });
});
describe('Root audit retention', () => {
  it('defaults to forever and records one skipped-run summary without deleting', async () => {
    expect(await runAuditRetention()).toEqual({ enabled: false, rootDeleted: 0, workspaceDeleted: 0 });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[0]![0].join('')).toContain('root.audit.retention');
  });
  it('deletes bounded batches from both tables and records one summary atomically', async () => {
    db.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({ value: where.key === 'root.auditRetentionDays' ? 30 : where.key === 'root.auditRetentionBatchSize' ? 25 : 100, encrypted: false }));
    expect(await runAuditRetention(new Date('2026-02-01T00:00:00Z'))).toEqual({ enabled: true, rootDeleted: 2, workspaceDeleted: 2 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).toHaveBeenCalledTimes(3);
    for (const call of db.$executeRaw.mock.calls.slice(0, 2)) {
      expect(call[0].sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(call[0].values).toEqual(['2026-01-02T00:00:00.000Z', 25]);
    }
    expect(db.$executeRaw.mock.calls[0]![0].sql).toContain('root_activities');
    expect(db.$executeRaw.mock.calls[1]![0].sql).toContain('activity_logs');
    expect(db.$executeRaw.mock.calls[2]![0].join('')).toContain('root.audit.retention');
  });
  it('rejects invalid configuration before deletion', async () => {
    db.appSetting.findUnique.mockResolvedValue({ value: -1, encrypted: false });
    await expect(runAuditRetention()).rejects.toThrow();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('requires an active installation owner to change retention', async () => {
    db.user.findUnique.mockResolvedValue({ isInstanceOwner: false });
    await expect(saveAuditRetention('member', 30)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveAuditRetention('root', -1)).rejects.toThrow();
  });
});
