import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ emit: vi.fn(), find: vi.fn(), raw: vi.fn(), upsert: vi.fn(), saved: vi.fn() }));
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: h.emit }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key.endsWith('WarningDays') ? 7 : 2) }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
  $queryRaw: h.raw, appSetting: { findUnique: h.saved, upsert: h.upsert }, socialAccount: { findMany: h.find },
}) } }));
import { scanConnectionAlerts } from '@/modules/settings/notifications/connection-alerts';
const now = new Date('2026-10-20T12:00:00Z');
beforeEach(() => { vi.clearAllMocks(); h.saved.mockResolvedValue(null); h.find.mockResolvedValue([{ id: 'account', workspaceId: 'workspace' }]); h.raw.mockResolvedValueOnce([{ acquired: true }]); });
describe('connection alert clock producer', () => {
  it.each([
    ['connection_expired', null, new Date('2026-10-20T11:00:00Z')],
    ['connection_expired', new Date('2026-10-19'), null],
    ['token_expiring', null, new Date('2026-10-23')],
  ])('enqueues %s using credential incident identity', async (kind, invalidatedAt, tokenExpiresAt) => {
    h.raw.mockResolvedValueOnce([{ id: 'account', invalidatedAt, tokenExpiresAt }]);
    expect(await scanConnectionAlerts(now)).toBe(1);
    expect(h.emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind, accountId: 'account', workspaceId: 'workspace', eventId: expect.stringMatching(/^connection_/) }));
    expect(h.emit.mock.calls[0][1].eventId.length).toBeLessThan(200);
    expect(h.upsert).toHaveBeenCalled();
  });
  it.each([null, { id: 'account', invalidatedAt: null, tokenExpiresAt: null }, { id: 'account', invalidatedAt: null, tokenExpiresAt: new Date('2027-01-01') }])('skips unavailable or healthy current bindings', async account => {
    h.raw.mockResolvedValueOnce(account ? [account] : []);
    expect(await scanConnectionAlerts(now)).toBe(0);
    expect(h.emit).not.toHaveBeenCalled();
  });
  it('reuses the same event identity for repeated scans and changes it after credential renewal', async () => {
    h.raw.mockResolvedValueOnce([{ id: 'account', invalidatedAt: null, tokenExpiresAt: new Date('2026-10-23') }]);
    await scanConnectionAlerts(now);
    const first = h.emit.mock.calls[0][1].eventId;
    h.raw.mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ id: 'account', invalidatedAt: null, tokenExpiresAt: new Date('2026-10-23') }]);
    await scanConnectionAlerts(now);
    expect(h.emit.mock.calls[1][1].eventId).toBe(first);
    h.raw.mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ id: 'account', invalidatedAt: null, tokenExpiresAt: new Date('2026-10-24') }]);
    await scanConnectionAlerts(now);
    expect(h.emit.mock.calls[2][1].eventId).not.toBe(first);
  });
  it('rotates and wraps bounded account discovery', async () => {
    h.saved.mockResolvedValue({ value: 'cursor' });
    h.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await scanConnectionAlerts(now);
    expect(h.find).toHaveBeenCalledTimes(2);
    expect(h.find.mock.calls[0][0]).toMatchObject({ where: { id: { gt: 'cursor' } }, take: 2 });
    expect(h.find.mock.calls[1][0]).toMatchObject({ where: { id: { lte: 'cursor' } }, take: 2 });
  });
});
