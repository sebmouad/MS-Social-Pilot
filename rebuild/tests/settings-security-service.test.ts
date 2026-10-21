import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ authorize: vi.fn(), config: vi.fn(), user: { findUnique: vi.fn(), update: vi.fn() }, session: { findUnique: vi.fn(), deleteMany: vi.fn() }, membership: { findMany: vi.fn() }, passkey: { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn() }, recoveryCode: { createMany: vi.fn(), deleteMany: vi.fn() }, query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), audit: vi.fn(), verify: vi.fn(), match: vi.fn(), rate: vi.fn() }));
vi.mock('@/modules/settings/server/account', () => ({ authorizeAccountSession: m.authorize }));
vi.mock('@/server/data', () => ({ prisma: { user: m.user, passkey: m.passkey, membership: m.membership, $transaction: m.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/auth', () => ({ verifyLegacyPassword: m.verify }));
vi.mock('@/server/auth-flow', () => ({ authRateLimit: async () => ({ limit: 3, windowMs: 1000 }) }));
vi.mock('@/server/rate-limit', () => ({ hit: m.rate }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (v: string) => `encrypted:${v}`, decryptSecret: (v: string) => v.replace('encrypted:', '') }));
vi.mock('@/server/totp', () => ({ matchTotp: m.match, newTotpSecret: () => 'PRIVATESETUP', otpauthUri: ({ issuer }: { issuer: string }) => `otpauth:${issuer}` }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit, accountPasswordPolicy: async () => ({ maxBytes: 100 }) }));
import { changeAccountSecurity, readAccountSecurity, securityConfirmations as c } from '@/modules/settings/server/account-security';
const actor = { userId: 'person', workspaceId: 'workspace', sessionTokenHash: 'current-hash' };
const user = { id: 'person', email: 'synthetic@example.test', passwordHash: 'hash', disabledAt: null, isInstanceOwner: false, totpEnabledAt: null, totpSecret: null, totpPendingSecret: 'encrypted:PRIVATESETUP', totpLastStep: null };
const input = (action: 'begin' | 'enable' | 'disable' | 'remove', patch = {}) => ({ currentPassword: 'private-password', code: '123456', ...(action === 'remove' ? { id: 'credential' } : {}), confirmation: action === 'remove' ? c.remove('credential') : c[action], ...patch });
beforeEach(() => {
  vi.clearAllMocks(); m.authorize.mockResolvedValue(undefined); m.rate.mockReturnValue({ allowed: true }); m.verify.mockReturnValue(true); m.match.mockReturnValue(42);
  m.config.mockImplementation(async key => ({ 'settings.accountPasskeyLimit': 2, 'settings.accountAuthenticatorIssuer': 'Root issuer', 'security.twoStep': 'off', 'auth.recoveryCodeCount': 3 })[key as string]);
  m.user.findUnique.mockResolvedValue(user); m.passkey.count.mockResolvedValue(0); m.passkey.findMany.mockResolvedValue([]); m.membership.findMany.mockResolvedValue([{ role: 'viewer' }]); m.passkey.deleteMany.mockResolvedValue({ count: 1 });
  m.session.findUnique.mockResolvedValue({ userId: 'person', pending: null, expiresAt: new Date('2099-01-01') });
  m.transaction.mockImplementation(async run => run({ ...m, $queryRaw: m.query, $executeRaw: m.execute }));
});
it('reads only public credential metadata for the current person and refuses partial lists', async () => {
  expect(await readAccountSecurity(actor)).toEqual({ twoStepEnabled: false, required: false, passkeys: [] });
  expect(m.authorize).toHaveBeenCalledWith(actor);
  expect(m.passkey.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'person' }, take: 3, select: { id: true, name: true, createdAt: true, lastUsedAt: true } });
  m.passkey.findMany.mockResolvedValue([{}, {}, {}]); await expect(readAccountSecurity(actor)).rejects.toMatchObject({ code: 'conflict' });
});
it.each(['begin', 'enable', 'disable', 'remove'] as const)('checks shared authorization and exact confirmation before %s', async action => {
  await expect(changeAccountSecurity(actor, action, input(action, { confirmation: 'wrong' }))).rejects.toMatchObject({ code: 'invalid_request' });
  expect(m.authorize).toHaveBeenCalledWith(actor, true); expect(m.transaction).not.toHaveBeenCalled();
  m.authorize.mockRejectedValueOnce(new Error('forbidden'));
  await expect(changeAccountSecurity(actor, action, input(action))).rejects.toThrow('forbidden');
});
it('limits password attempts, rechecks the session inside the lock, and rejects wrong passwords', async () => {
  m.rate.mockReturnValueOnce({ allowed: false }); await expect(changeAccountSecurity(actor, 'begin', input('begin'))).rejects.toMatchObject({ code: 'forbidden' }); expect(m.transaction).not.toHaveBeenCalled();
  m.verify.mockReturnValueOnce(false); await expect(changeAccountSecurity(actor, 'begin', input('begin'))).rejects.toMatchObject({ code: 'invalid_request' });
  m.session.findUnique.mockResolvedValueOnce({ userId: 'other', pending: null, expiresAt: new Date('2099-01-01') }); await expect(changeAccountSecurity(actor, 'begin', input('begin'))).rejects.toMatchObject({ code: 'unauthorized' }); expect(m.user.update).not.toHaveBeenCalled();
});
it('starts encrypted enrollment using the Root issuer and audits no credential material', async () => {
  expect(await changeAccountSecurity(actor, 'begin', input('begin'))).toEqual({ ok: true, secret: 'PRIVATESETUP', uri: 'otpauth:Root issuer' });
  expect(m.query.mock.calls[0][0].join('')).toContain('FOR UPDATE');
  expect(m.user.update).toHaveBeenCalledWith({ where: { id: 'person' }, data: { totpPendingSecret: 'encrypted:PRIVATESETUP' } });
  expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/PRIVATESETUP|private-password/);
});
it('enables only a verified pending secret and returns recovery codes once while persisting hashes', async () => {
  const result = await changeAccountSecurity(actor, 'enable', input('enable'));
  expect('recoveryCodes' in result && result.recoveryCodes).toHaveLength(3);
  const rows = m.recoveryCode.createMany.mock.calls[0][0].data;
  expect(rows).toHaveLength(3); expect(rows.every((r: { codeHash: string }) => /^[a-f0-9]{64}$/.test(r.codeHash))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('recoveryCodes' in result ? result.recoveryCodes![0] : 'unreachable');
  expect(m.user.update.mock.calls[0][0].data).toMatchObject({ totpSecret: 'encrypted:PRIVATESETUP', totpPendingSecret: null, totpLastStep: 42 });
  expect(m.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'person', tokenHash: { not: 'current-hash' } } });
  m.match.mockReturnValueOnce(null); await expect(changeAccountSecurity(actor, 'enable', input('enable'))).rejects.toMatchObject({ code: 'invalid_request' });
});
it.each(['everyone', 'admins'])('prevents removing the last required verification method under %s policy across all memberships', async policy => {
  m.config.mockImplementation(async key => key === 'security.twoStep' ? policy : key === 'auth.recoveryCodeCount' ? 3 : 'Root issuer');
  m.membership.findMany.mockResolvedValue([{ role: 'admin' }]); m.passkey.count.mockResolvedValue(1);
  await expect(changeAccountSecurity(actor, 'remove', input('remove'))).rejects.toMatchObject({ code: 'forbidden' }); expect(m.passkey.deleteMany).not.toHaveBeenCalled();
  m.user.findUnique.mockResolvedValue({ ...user, totpEnabledAt: new Date(), totpSecret: 'encrypted:PRIVATE' }); m.passkey.count.mockResolvedValue(0);
  await expect(changeAccountSecurity(actor, 'disable', input('disable'))).rejects.toMatchObject({ code: 'forbidden' }); expect(m.user.update).not.toHaveBeenCalled();
});
it('removes only an owned passkey, forgets trusted devices and revokes other sessions', async () => {
  await changeAccountSecurity(actor, 'remove', input('remove'));
  expect(m.passkey.deleteMany).toHaveBeenCalledWith({ where: { userId: 'person', id: 'credential' } });
  expect(m.execute.mock.calls[0].slice(1)).toEqual(['person']); expect(m.execute.mock.calls[0][0].join('')).toContain('DELETE FROM trusted_devices');
  expect(m.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'person', tokenHash: { not: 'current-hash' } } });
  m.passkey.deleteMany.mockResolvedValueOnce({ count: 0 }); await expect(changeAccountSecurity(actor, 'remove', input('remove'))).rejects.toMatchObject({ code: 'not_found' });
});
it('refuses replayed codes, disables the authenticator and removes recovery codes', async () => {
  m.user.findUnique.mockResolvedValue({ ...user, totpEnabledAt: new Date(), totpSecret: 'encrypted:PRIVATE', totpLastStep: 42 });
  await expect(changeAccountSecurity(actor, 'disable', input('disable'))).rejects.toMatchObject({ code: 'invalid_request' });
  m.match.mockReturnValue(43); await changeAccountSecurity(actor, 'disable', input('disable'));
  expect(m.user.update.mock.calls[0][0].data).toMatchObject({ totpEnabledAt: null, totpSecret: null }); expect(m.recoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'person' } });
});
