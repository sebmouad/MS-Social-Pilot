import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const user = { findUnique: vi.fn() };
  const tx = { user, appSetting: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }, $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  return { tx, prisma: { user, $queryRaw: vi.fn(), $transaction: vi.fn() }, config: vi.fn(), send: vi.fn(), ready: vi.fn(), origin: vi.fn(), guard: vi.fn(), actor: vi.fn() };
});
vi.mock('../src/server/data', () => ({ prisma: h.prisma }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: h.actor }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: h.config }));
vi.mock('../src/modules/root/server/admin/policy', () => ({
  rootTransaction: (fn: (tx: unknown) => unknown) => fn(h.tx), adminSetting: async (key: string) => key.includes('search') ? 40 : 2,
  rootResultLimit: (limit: number, cap?: number) => Math.min(limit, cap ?? limit),
}));
vi.mock('../src/server/mail', () => ({ mailReady: h.ready, publicMailOrigin: h.origin, sendTransactionalMail: h.send }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: h.guard }));
vi.mock('../src/server/account-settings', () => ({ accountPasswordPolicy: vi.fn(), validateNewPassword: vi.fn() }));
vi.mock('../src/server/auth', () => ({ hashStoredPassword: vi.fn() }));

import { controlRootRegistrationAccount, listRootRegistration, revokeRootRegistrationInvitation } from '../src/server/root/registration-admin';
import { unverifiedRegistrationWhere } from '../src/modules/settings/server/registration';
import { GET } from '../src/app/api/root/registration/route';
import { DELETE as revoke } from '../src/app/api/root/registration/invitations/[id]/route';
import { DELETE as remove, POST as resend } from '../src/app/api/root/registration/accounts/[id]/route';
const account = { id: 'new-user', email: 'synthetic@example.invalid', name: 'Synthetic', disabledAt: null };
let eligible: boolean;
let invite: null | { id: string; workspaceId: string; role: string; acceptedAt: Date | null };

beforeEach(() => {
  vi.clearAllMocks(); eligible = true;
  invite = { id: 'i1', workspaceId: 'w1', role: 'owner', acceptedAt: null };
  h.tx.user.findUnique.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  h.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
  h.tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(' ');
    if (sql.includes('FROM users u')) return eligible ? [account] : [];
    if (sql.includes('FROM invitations')) return invite && values.includes(invite.workspaceId) ? [invite] : [];
    return [];
  });
  h.tx.$executeRaw.mockResolvedValue(1);
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.tx));
  h.prisma.$queryRaw.mockResolvedValue([]);
  h.guard.mockImplementation(async (_id: string, fn: () => unknown) => fn());
  h.ready.mockResolvedValue(true); h.origin.mockResolvedValue('https://example.invalid'); h.send.mockResolvedValue({ status: 'sent' });
  h.config.mockImplementation(async (key: string) => ({
    'auth.openRegistration': true, 'auth.emailVerificationTtlMinutes': 60,
    'settings.invitationsEnabled': true, 'settings.invitationTtlHours': 168, 'settings.invitationMaxPending': 50,
    'settings.invitationPageLimit': 100, 'settings.invitationSessionMinutes': 30, 'settings.teamMaxMembers': 500,
    'settings.teamOperationTimeoutMs': 10000, 'settings.teamOperationMaxWaitMs': 1000, 'data.workspaceOperationTimeoutMs': 30000,
  } as Record<string, unknown>)[key]);
});

describe('installation registration directory', () => {
  it.each([null, { isInstanceOwner: false }, { isInstanceOwner: true, disabledAt: new Date() }])('rejects unavailable/non-Root actors before querying invitations: %s', async actor => {
    h.tx.user.findUnique.mockResolvedValue(actor);
    await expect(listRootRegistration('actor')).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('uses bounded bound-parameter queries, literal search, scope/status and independent pages', async () => {
    const row = { ...invite, email: account.email };
    h.prisma.$queryRaw.mockResolvedValueOnce([row, row, row]).mockResolvedValueOnce([account]);
    const data = await listRootRegistration('root', { q: '%_', status: 'expired', workspaceId: 'w1', page: '2', accountsPage: '3' });
    expect(data).toMatchObject({ openRegistration: true, moreInvitations: true, moreAccounts: false, limit: 2, page: 2, accountsPage: 3 });
    expect(data.invitations).toHaveLength(2);
    const query = h.prisma.$queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(['%\\%\\_%', 'expired', 'w1', 3, 2]));
    expect(query.text).not.toMatch(/tokenHash|passwordHash/);
    expect(query.text).toContain('acceptedAt');
    expect(h.prisma.$queryRaw.mock.calls[1][0].values).toContain(4);
    expect(unverifiedRegistrationWhere.text).toMatch(/NOT EXISTS[\s\S]*memberships/);
    expect(unverifiedRegistrationWhere.text).toContain('open_registration');
    expect(unverifiedRegistrationWhere.text).toContain('"isInstanceOwner" = false');
    expect(unverifiedRegistrationWhere.text).toContain('"emailVerifiedAt" IS NULL');
  });
  it.each([{ q: 'x'.repeat(41) }, { status: 'revoked' }, { page: 0 }, { accountsPage: 'a' }, { unknown: true }])('rejects invalid filters %s', async input => {
    await expect(listRootRegistration('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not turn unavailable configuration into closed/zero', async () => {
    h.config.mockResolvedValue(undefined);
    await expect(listRootRegistration('root')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('registration mutations share existing domain services', () => {
  it('revokes a pending or expired owner invitation with current Root authority, workspace guard and atomic audit', async () => {
    const result = await revokeRootRegistrationInvitation('root', 'w1', 'i1', { confirmation: 'REVOKE INVITATION i1' });
    expect(result).toMatchObject({ revoked: true, workspaceId: 'w1' });
    expect(h.guard).toHaveBeenCalledWith('w1', expect.any(Function));
    expect(h.tx.$executeRaw.mock.calls.map(([sql]) => sql.join(' '))).toEqual(expect.arrayContaining([expect.stringContaining('DELETE FROM invitations'), expect.stringContaining('INSERT INTO root_activities')]));
  });
  it('refuses wrong scope, accepted invitations and wrong confirmations', async () => {
    await expect(revokeRootRegistrationInvitation('root', 'w2', 'i1', { confirmation: 'REVOKE INVITATION i1' })).rejects.toMatchObject({ code: 'not_found' });
    invite!.acceptedAt = new Date();
    await expect(revokeRootRegistrationInvitation('root', 'w1', 'i1', { confirmation: 'REVOKE INVITATION i1' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(revokeRootRegistrationInvitation('root', 'w1', 'i1', { confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('honors suspended/purging workspace guards', async () => {
    h.guard.mockRejectedValue(new Error('guard denied'));
    await expect(revokeRootRegistrationInvitation('root', 'w1', 'i1', { confirmation: 'REVOKE INVITATION i1' })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
  });
  it.each(['resend', 'delete'] as const)('requires exact confirmation for %s before locking/mutating', async action => {
    await expect(controlRootRegistrationAccount('root', 'new-user', action, { confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.tx.$queryRaw).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it('rechecks Root after locks and refuses a changed target', async () => {
    h.tx.user.findUnique.mockResolvedValueOnce({ isInstanceOwner: true }).mockResolvedValueOnce({ isInstanceOwner: true }).mockResolvedValueOnce({ isInstanceOwner: false });
    await expect(controlRootRegistrationAccount('root', 'new-user', 'delete', { confirmation: 'DELETE UNVERIFIED ACCOUNT new-user' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
    h.tx.user.findUnique.mockResolvedValue({ isInstanceOwner: true }); eligible = false;
    await expect(controlRootRegistrationAccount('root', 'new-user', 'resend', { confirmation: 'RESEND VERIFICATION new-user' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.send).not.toHaveBeenCalled();
  });
  it('deletes eligible accounts and records a value-free audit in the same transaction', async () => {
    await expect(controlRootRegistrationAccount('root', 'new-user', 'delete', { confirmation: 'DELETE UNVERIFIED ACCOUNT new-user' })).resolves.toMatchObject({ deleted: true });
    const calls = h.tx.$executeRaw.mock.calls;
    expect(calls[0][0].join('')).toContain('DELETE FROM "OAuthCode"');
    expect(h.tx.appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'settings.appearance.user.new-user.mode' } });
    expect(calls[1][0].join('')).toContain('DELETE FROM users');
    expect(calls[2]).toContain('root.unverified_registration_deleted');
    expect(JSON.stringify(calls)).not.toContain(account.email);
  });
  it('replaces verification tokens using existing mail/TTL policy and audits actual delivery', async () => {
    const result = await controlRootRegistrationAccount('root', 'new-user', 'resend', { confirmation: 'RESEND VERIFICATION new-user' });
    expect(result).toEqual({ delivery: 'sent', userId: 'new-user' });
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: account.email, template: 'account.verifyEmail', text: expect.stringContaining('/verify-email#token=') }));
    const serializedAudit = JSON.stringify(h.tx.$executeRaw.mock.calls.at(-1));
    expect(serializedAudit).toContain('sent'); expect(serializedAudit).not.toContain('token=');
    expect(h.tx.$executeRaw.mock.calls[0][0].join('')).toContain('DELETE FROM email_tokens');
  });
  it('does not send when registration/mail is closed, and reports uncertain delivery honestly', async () => {
    h.ready.mockResolvedValue(false);
    await expect(controlRootRegistrationAccount('root', 'new-user', 'resend', { confirmation: 'RESEND VERIFICATION new-user' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(h.send).not.toHaveBeenCalled();
    h.ready.mockResolvedValue(true); h.send.mockRejectedValue(new Error('private smtp failure'));
    await expect(controlRootRegistrationAccount('root', 'new-user', 'resend', { confirmation: 'RESEND VERIFICATION new-user' })).resolves.toEqual({ delivery: 'uncertain', userId: 'new-user' });
  });
  it('does not report delete success if audit insertion fails', async () => {
    h.tx.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(controlRootRegistrationAccount('root', 'new-user', 'delete', { confirmation: 'DELETE UNVERIFIED ACCOUNT new-user' })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('private HTTP transport', () => {
  const url = 'https://example.invalid/api/root/registration';
  const ctx = { params: Promise.resolve({ id: 'new-user' }) };
  it('denies anonymous, workspace-only actors, repeated filters and cross-origin writes', async () => {
    h.actor.mockResolvedValue(null); expect((await GET(new Request(url), undefined)).status).toBe(401);
    h.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false }); expect((await GET(new Request(url), undefined)).status).toBe(404);
    h.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
    expect((await GET(new Request(`${url}?status=pending&status=accepted`), undefined)).status).toBe(400);
    expect((await remove(new Request(`${url}/accounts/new-user`, { method: 'DELETE' }), ctx)).status).toBe(403);
  });
  it('returns private no-store reads and masks unexpected failures', async () => {
    const result = await GET(new Request(url), undefined);
    expect(result.headers.get('cache-control')).toContain('no-store');
    h.prisma.$queryRaw.mockRejectedValue(new Error('database secret'));
    const failed = await GET(new Request(url), undefined);
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('database secret');
  });
  it('routes account POST/DELETE and invitation DELETE with strict scoped bodies', async () => {
    const request = (path: string, method: string, body: object) => new Request(`${url}/${path}`, { method, headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await resend(request('accounts/new-user', 'POST', { confirmation: 'RESEND VERIFICATION new-user' }), ctx)).status).toBe(200);
    expect((await remove(request('accounts/new-user', 'DELETE', { confirmation: 'DELETE UNVERIFIED ACCOUNT new-user' }), ctx)).status).toBe(200);
    const invitationCtx = { params: Promise.resolve({ id: 'i1' }) };
    expect((await revoke(request('invitations/i1', 'DELETE', { workspaceId: 'w1', confirmation: 'REVOKE INVITATION i1' }), invitationCtx)).status).toBe(200);
    expect((await revoke(request('invitations/i1', 'DELETE', { confirmation: 'REVOKE INVITATION i1' }), invitationCtx)).status).toBe(400);
  });
});
