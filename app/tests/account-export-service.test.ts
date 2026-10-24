import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ authorize: vi.fn(), query: vi.fn(), profile: vi.fn(), hook: vi.fn(), audit: vi.fn(), config: vi.fn(), transaction: vi.fn() }));
vi.mock('@/modules/settings/server/account', () => ({ authorizeAccountSession: m.authorize }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/data-control/account', () => ({ exportAccountSupplementaryData: m.hook }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit }));
import { exportAccountData } from '@/modules/settings/server/account-export';
const actor = { userId: 'user.a%_', workspaceId: 'w1', sessionTokenHash: 'private-session-hash' };
const tx = { $queryRaw: m.query, user: { findUnique: m.profile } };
beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue(undefined);
  m.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('FOR SHARE') ? [{ id: actor.userId }] : [await m.profile()]);
  m.profile.mockResolvedValue({ id: actor.userId, name: 'Émilie', email: 'synthetic@example.test' });
  m.hook.mockResolvedValue({ appearance: { theme: 'warm', mode: 'dark' }, personCredentials: [{ id: 'safe-metadata' }], oauthGrants: [] });
  m.config.mockImplementation(async key => key === 'data.maxArchiveBytes' ? 100000 : 30000);
  m.transaction.mockImplementation(async run => run(tx));
});
describe('authorized account export', () => {
  it('authorizes before opening a transaction, locks current session, uses own ID and audits only size/coverage', async () => {
    const receipt = await exportAccountData(actor);
    expect(m.authorize).toHaveBeenCalledWith(actor);
    expect(m.authorize.mock.invocationCallOrder[0]).toBeLessThan(m.transaction.mock.invocationCallOrder[0]);
    expect(m.hook).toHaveBeenCalledWith(tx, actor.userId);
    const [sql, ...values] = m.query.mock.calls[0];
    expect(sql.join('')).toContain('FOR SHARE OF u, s');
    expect(sql.join('')).toContain('s.pending IS NULL');
    expect(sql.join('')).toContain('s."expiresAt" > NOW()');
    expect(values).toEqual([actor.userId, actor.sessionTokenHash]);
    const [projection, ...profileScope] = m.query.mock.calls[1];
    expect(profileScope).toEqual([actor.userId]);
    expect(projection.join('')).not.toMatch(/passwordHash|totpSecret|knownDevices|SELECT \*/);
    expect(JSON.parse(receipt.content)).toMatchObject({ profile: { id: actor.userId }, appearance: { mode: 'dark' }, coverage: { complete: false, excluded: expect.arrayContaining(['workspaceContent', 'media', 'credentialSecrets']) } });
    expect(receipt.bytes).toBe(Buffer.byteLength(receipt.content, 'utf8'));
    expect(receipt.bytes).toBeGreaterThan(receipt.content.length);
    expect(m.audit).toHaveBeenCalledWith(tx, actor.userId, 'account.data_exported', { bytes: receipt.bytes, complete: false });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('synthetic@example.test');
    expect(receipt.content).not.toContain(actor.sessionTokenHash);
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 30000 });
  });
  it('propagates session/tenant/entitlement denials before reading personal records', async () => {
    m.authorize.mockRejectedValue({ code: 'forbidden' });
    await expect(exportAccountData(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each([{ userId: 'other' }, { workspaceId: 'other' }, { confirmation: 'anything' }, null])('refuses caller-controlled export scope: %j', async args => {
    await expect(exportAccountData(actor, args)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('refuses revoked/expired/pending/disabled sessions rechecked inside the transaction', async () => {
    m.query.mockResolvedValue([]);
    await expect(exportAccountData(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(m.hook).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it('refuses missing users, oversize exports and audit failures without a partial receipt', async () => {
    m.profile.mockResolvedValueOnce(null);
    await expect(exportAccountData(actor)).rejects.toMatchObject({ code: 'not_found' });
    m.config.mockResolvedValue(1);
    await expect(exportAccountData(actor)).rejects.toMatchObject({ code: 'unavailable' });
    expect(m.audit).not.toHaveBeenCalled();
    m.config.mockResolvedValue(100000);
    m.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(exportAccountData(actor)).rejects.toThrow('audit unavailable');
  });
});
