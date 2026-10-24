import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), allowed: vi.fn(), config: vi.fn(), user: { findUnique: vi.fn(), updateMany: vi.fn() }, sessions: { findMany: vi.fn(), deleteMany: vi.fn() }, tx: vi.fn(), audit: vi.fn(), verify: vi.fn(), hash: vi.fn() }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { user: m.user, session: m.sessions, $transaction: m.tx } }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.allowed }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: () => true }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/account-settings', () => ({ accountPasswordPolicy: async () => ({ minLength: 12, maxBytes: 100 }), validateNewPassword: (v: string) => v.length >= 12, auditAccountMutation: m.audit }));
vi.mock('@/server/auth', async original => ({ ...await original<typeof import('@/server/auth')>(), verifyPassword: m.verify, hashStoredPassword: m.hash }));
import { readAccount, updateAccountProfile, changeAccountPassword, listAccountSessions, revokeAccountSession } from '@/modules/settings/server/account';
const actor = { userId: 'user', workspaceId: 'workspace', sessionTokenHash: 'current-hash' };
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ userId: 'user', user: { id: 'user', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
  m.permissions.mockResolvedValue({}); m.entitlements.mockResolvedValue({ workspaceId: 'workspace' }); m.allowed.mockReturnValue(true);
  m.config.mockImplementation(async key => key === 'settings.accountSessionPageSize' ? 2 : 8);
  m.user.findUnique.mockResolvedValue({ name: 'Sample', email: 'sample@example.test', passwordHash: 'old-hash', disabledAt: null });
  m.user.updateMany.mockResolvedValue({ count: 1 }); m.sessions.deleteMany.mockResolvedValue({ count: 1 });
  m.tx.mockImplementation(async run => run({ user: m.user, session: m.sessions }));
  m.verify.mockReturnValue(true); m.hash.mockReturnValue('new-hash');
});
describe('shared account service', () => {
  it.each([{ apiKeyId: 'key' }, { sessionTokenHash: '' }])('refuses non-session authority before reading secrets: %j', async bad => {
    await expect(readAccount({ ...actor, ...bad })).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ pending: 'two-step' }, { expiresAt: new Date('2000-01-01') }, { userId: 'other', user: { id: 'other', disabledAt: null } }, { user: { id: 'user', disabledAt: new Date() } }])('rejects stale or wrong session %j', async patch => {
    m.session.mockResolvedValue({ userId: 'user', user: { id: 'user', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01'), ...patch });
    await expect(readAccount(actor)).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('uses current feature write authority at the service boundary', async () => {
    m.allowed.mockImplementation((_p, _f, action) => action === 'read');
    await expect(updateAccountProfile(actor, { name: 'Ada', confirmation: 'UPDATE ACCOUNT PROFILE' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.tx).not.toHaveBeenCalled();
  });
  it('requires exact confirmation and the current Root name bound', async () => {
    await expect(updateAccountProfile(actor, { name: 'Ada' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateAccountProfile(actor, { name: 'Name too long', confirmation: 'UPDATE ACCOUNT PROFILE' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.tx).not.toHaveBeenCalled();
    await expect(updateAccountProfile(actor, { name: ' Ada ', confirmation: 'UPDATE ACCOUNT PROFILE' })).resolves.toEqual({ name: 'Ada' });
    expect(m.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user', disabledAt: null }, data: { name: 'Ada' } });
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'user', 'account.profile_updated', { fields: ['name'] });
  });
  it('keeps the current session, compares the old password hash and audits no passwords', async () => {
    await changeAccountPassword(actor, { currentPassword: 'old password', newPassword: 'new password long', confirmation: 'CHANGE ACCOUNT PASSWORD' });
    expect(m.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user', disabledAt: null, passwordHash: 'old-hash' }, data: { passwordHash: 'new-hash' } });
    expect(m.sessions.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user', tokenHash: { not: 'current-hash' } } });
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('password long');
  });
  it('refuses wrong current passwords and concurrent password changes', async () => {
    const input = { currentPassword: 'old password', newPassword: 'new password long', confirmation: 'CHANGE ACCOUNT PASSWORD' };
    m.verify.mockReturnValue(false);
    await expect(changeAccountPassword(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.tx).not.toHaveBeenCalled();
    m.verify.mockReturnValue(true); m.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(changeAccountPassword(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(m.sessions.deleteMany).not.toHaveBeenCalled();
  });
  it('pages sessions and never returns token hashes', async () => {
    m.sessions.findMany.mockResolvedValue(['current-hash', 'other-hash', 'third-hash'].map((tokenHash, i) => ({ id: String(i), expiresAt: new Date('2099-01-01'), tokenHash })));
    const result = await listAccountSessions(actor, { offset: 2 });
    expect(result.nextOffset).toBe(4); expect(result.sessions.map(s => s.current)).toEqual([true, false]);
    expect(JSON.stringify(result)).not.toContain('hash');
    expect(m.sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user', pending: null }), skip: 2, take: 3 }));
  });
  it('only deletes another active session owned by this person', async () => {
    await expect(revokeAccountSession(actor, { id: 'other', confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.sessions.deleteMany).not.toHaveBeenCalled();
    await revokeAccountSession(actor, { id: 'other', confirmation: 'REVOKE ACCOUNT SESSION other' });
    expect(m.sessions.deleteMany).toHaveBeenCalledWith({ where: { id: 'other', userId: 'user', pending: null, expiresAt: expect.anything(), tokenHash: { not: 'current-hash' } } });
    m.sessions.deleteMany.mockResolvedValue({ count: 0 });
    await expect(revokeAccountSession(actor, { id: 'foreign', confirmation: 'REVOKE ACCOUNT SESSION foreign' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
