import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  membership: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
  passkey: { count: vi.fn() },
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  runtimeConfig: vi.fn(), loadEntitlements: vi.fn(), loadPermissions: vi.fn(), canUseFeature: vi.fn(), canAccessFeature: vi.fn(),
  withWorkspaceOperation: vi.fn(), mailReady: vi.fn(), publicMailOrigin: vi.fn(), sendTransactionalMail: vi.fn(),
  invite: null as any, actorRole: 'owner', inviterRole: 'owner', userExisting: null as any,
}));

vi.mock('../src/server/data', () => ({ prisma: { user: state.user, membership: state.membership, passkey: state.passkey, $queryRaw: state.query, $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.loadEntitlements, canUseFeature: state.canUseFeature }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.canAccessFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.loadPermissions }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.withWorkspaceOperation }));
vi.mock('../src/server/mail', () => ({ mailReady: state.mailReady, publicMailOrigin: state.publicMailOrigin, sendTransactionalMail: state.sendTransactionalMail }));
vi.mock('../src/server/account-settings', () => ({ accountPasswordPolicy: async () => ({ minLength: 8, maxBytes: 800 }), validateNewPassword: (value: unknown) => typeof value === 'string' && value.length >= 8 }));
vi.mock('../src/server/auth', () => ({ hashLegacyPassword: (value: string) => `hash:${value}` }));

import { OperationError } from '../src/lib/operation-error';
import { acceptTeamInvitation, inviteTeamConfirmation, inviteTeamMember, invitationAvailability, previewTeamInvitation, registerTeamInvitation, revokeTeamInvitation, revokeTeamInvitationConfirmation } from '../src/modules/settings/server/invitations';

const actor = { userId: 'owner-1', workspaceId: 'workspace-1' };
const now = new Date(Date.now() + 60 * 60_000);
const rawToken = Buffer.alloc(32, 9).toString('base64url');
const baseInvite = () => ({ id: 'invite-1', workspaceId: actor.workspaceId, email: 'member@example.com', role: 'editor', tokenHash: 'unused-hash', invitedById: actor.userId, expiresAt: now, acceptedAt: null, acceptedByUserId: null, createdAt: new Date(), workspaceName: 'Example Workspace' });
const config = (key: string) => ({
  'settings.invitationsEnabled': true, 'settings.invitationTtlHours': 168, 'settings.invitationMaxPending': 100,
  'settings.invitationPageLimit': 100, 'settings.invitationSessionMinutes': 30, 'settings.teamMaxMembers': 500,
  'settings.teamOperationTimeoutMs': 10000, 'settings.teamOperationMaxWaitMs': 1000, 'data.workspaceOperationTimeoutMs': 30000,
  'security.twoStep': 'admins',
} as Record<string, unknown>)[key];
const tx = { user: state.user, membership: state.membership, passkey: state.passkey, $queryRaw: state.query, $executeRaw: state.execute };

function queryResult(query: TemplateStringsArray) {
  const sql = query.join(' ');
  if (sql.includes('FROM invitations i JOIN workspaces')) return state.invite ? [{ ...state.invite, inviterRole: state.inviterRole, inviterDisabledAt: null }] : [];
  if (sql.includes('FROM invitations i JOIN workspaces w')) return state.invite ? [{ ...state.invite, inviterRole: state.inviterRole, inviterDisabledAt: null }] : [];
  if (sql.includes('FROM invitations i') && sql.includes('FOR UPDATE OF i')) return state.invite ? [state.invite] : [];
  if (sql.includes('FROM memberships m JOIN users u')) {
    if (sql.includes('m."userId" =')) return [{ role: state.actorRole, disabledAt: null }];
    return [{ role: state.inviterRole, disabledAt: null }];
  }
  if (sql.includes('SELECT id, email, "disabledAt"')) return [{ id: 'existing-user', email: 'member@example.com', disabledAt: null, isInstanceOwner: false, totpEnabledAt: null }];
  if (sql.includes('SELECT COUNT(*)')) return [{ count: BigInt(0) }];
  if (sql.includes('SELECT name FROM workspaces')) return [{ name: 'Example Workspace' }];
  if (sql.includes('SELECT id, "acceptedAt"')) return [];
  return [];
}

beforeEach(() => {
  vi.clearAllMocks(); state.invite = baseInvite(); state.actorRole = 'owner'; state.inviterRole = 'owner'; state.userExisting = null;
  state.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => where.id ? { disabledAt: null } : state.userExisting);
  state.user.create.mockResolvedValue({ id: 'new-user' });
  state.membership.findFirst.mockResolvedValue({ role: 'owner' }); state.membership.findUnique.mockResolvedValue(null); state.membership.count.mockResolvedValue(0); state.membership.create.mockResolvedValue({ id: 'membership-1' });
  state.passkey.count.mockResolvedValue(0); state.query.mockImplementation(async (query: TemplateStringsArray) => queryResult(query)); state.execute.mockResolvedValue(1);
  state.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  state.runtimeConfig.mockImplementation(async (key: string) => config(key)); state.loadEntitlements.mockResolvedValue({ workspaceId: actor.workspaceId }); state.loadPermissions.mockResolvedValue({});
  state.canUseFeature.mockReturnValue(true); state.canAccessFeature.mockReturnValue(true); state.withWorkspaceOperation.mockImplementation(async (_workspaceId: string, operation: () => unknown) => operation());
  state.mailReady.mockResolvedValue(true); state.publicMailOrigin.mockResolvedValue('https://app.example.com'); state.sendTransactionalMail.mockResolvedValue({ status: 'sent' });
});

describe('workspace invitations', () => {
  it('reports availability only when invitation policy and transactional mail are both ready', async () => {
    expect(await invitationAvailability()).toBe(true);
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'settings.invitationsEnabled' ? false : config(key));
    expect(await invitationAvailability()).toBe(false);
    state.runtimeConfig.mockImplementation(async (key: string) => config(key)); state.mailReady.mockResolvedValue(false);
    expect(await invitationAvailability()).toBe(false);
  });

  it('rejects malformed, expired, replayed, and wrong-recipient tokens without granting membership', async () => {
    await expect(previewTeamInvitation('bad-token')).rejects.toMatchObject({ code: 'conflict' });
    state.invite.expiresAt = new Date(Date.now() - 1);
    await expect(previewTeamInvitation(rawToken)).rejects.toMatchObject({ code: 'conflict' });
    state.invite = baseInvite();
    state.invite.acceptedAt = new Date();
    await expect(acceptTeamInvitation(rawToken, 'user-1', 'ACCEPT INVITATION invite-1')).rejects.toMatchObject({ code: 'conflict' });
    state.invite = baseInvite(); state.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'someone-else@example.com', disabledAt: null });
    state.query.mockImplementation(async (query: TemplateStringsArray) => query.join(' ').includes('SELECT id, email, "disabledAt"') ? [{ id: 'user-1', email: 'someone-else@example.com', disabledAt: null }] : queryResult(query));
    await expect(acceptTeamInvitation(rawToken, 'user-1', 'ACCEPT INVITATION invite-1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.membership.create).not.toHaveBeenCalled();
  });

  it('requires current owner authority for owner invitations and rejects disabled inviters', async () => {
    await expect(inviteTeamMember(actor, { email: 'member@example.com', role: 'owner', confirmation: inviteTeamConfirmation('member@example.com') })).resolves.toMatchObject({ delivery: 'sent' });
    state.actorRole = 'admin'; state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    await expect(inviteTeamMember(actor, { email: 'other@example.com', role: 'owner', confirmation: inviteTeamConfirmation('other@example.com') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.sendTransactionalMail).toHaveBeenCalledTimes(1);
  });

  it('does not create invitations without usable mail and preserves uncertainty if the delivery receipt audit fails', async () => {
    state.mailReady.mockResolvedValue(false);
    await expect(inviteTeamMember(actor, { email: 'member@example.com', role: 'editor', confirmation: inviteTeamConfirmation('member@example.com') })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.execute).not.toHaveBeenCalled();
    state.mailReady.mockResolvedValue(true);
    let auditWrites = 0;
    state.execute.mockImplementation(async (query: TemplateStringsArray) => {
      if (query.join('').includes('INSERT INTO activity_logs') && ++auditWrites === 2) throw new Error('audit receipt unavailable');
      return 1;
    });
    await expect(inviteTeamMember(actor, { email: 'member@example.com', role: 'editor', confirmation: inviteTeamConfirmation('member@example.com') })).resolves.toMatchObject({ delivery: 'uncertain' });
    expect(state.sendTransactionalMail).toHaveBeenCalledTimes(1);
  });

  it('allows existing accounts to accept but never overwrites them during registration', async () => {
    state.userExisting = { id: 'existing-user', disabledAt: null };
    await expect(previewTeamInvitation(rawToken)).resolves.toMatchObject({ existingAccount: true, workspaceId: actor.workspaceId });
    await expect(registerTeamInvitation({ token: rawToken, name: 'Member', password: 'long-safe-password', confirmation: 'CREATE ACCOUNT AND JOIN invite-1' })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.user.create).not.toHaveBeenCalled();
  });

  it('accepts only the invited account and commits a selected-role membership with no channel grants', async () => {
    await expect(acceptTeamInvitation(rawToken, 'existing-user', 'ACCEPT INVITATION invite-1')).resolves.toEqual({ workspaceId: actor.workspaceId, joined: true });
    expect(state.membership.create).toHaveBeenCalledWith({ data: { id: expect.any(String), userId: 'existing-user', workspaceId: actor.workspaceId, role: 'editor' } });
    expect(state.execute.mock.calls.some(([query, allPages]) => (query as TemplateStringsArray).join('').includes('UPDATE memberships SET "allPages"') && allPages === false)).toBe(true);
    expect(state.execute.mock.calls.some(([query, ...values]) => (query as TemplateStringsArray).join('').includes('INSERT INTO activity_logs') && values.includes('team.invitation_accepted'))).toBe(true);
  });

  it('registers a new account, marks invitation-recipient email verified, and applies role scope atomically', async () => {
    await expect(registerTeamInvitation({ token: rawToken, name: 'New Member', password: 'long-safe-password', confirmation: 'CREATE ACCOUNT AND JOIN invite-1' })).resolves.toEqual({ created: true, workspaceId: actor.workspaceId });
    expect(state.user.create).toHaveBeenCalledWith({ data: { id: expect.any(String), email: 'member@example.com', name: 'New Member', passwordHash: 'hash:long-safe-password' } });
    expect(state.execute.mock.calls.some(([query]) => (query as TemplateStringsArray).join('').includes('UPDATE users SET "emailVerifiedAt"'))).toBe(true);
    expect(state.execute.mock.calls.some(([query, allPages]) => (query as TemplateStringsArray).join('').includes('UPDATE memberships SET "allPages"') && allPages === false)).toBe(true);
    expect(state.membership.create).toHaveBeenCalledWith({ data: { id: expect.any(String), userId: expect.any(String), workspaceId: actor.workspaceId, role: 'editor' } });
  });

  it('rejects cross-workspace revocation and accepted invitation revocation', async () => {
    state.invite.acceptedAt = new Date();
    state.query.mockImplementation(async (query: TemplateStringsArray) => query.join(' ').includes('WHERE id =') ? [{ ...state.invite }] : queryResult(query));
    await expect(revokeTeamInvitation(actor, { id: 'invite-1', confirmation: revokeTeamInvitationConfirmation('invite-1') })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.execute).not.toHaveBeenCalled();
  });
});

describe('invitation owner-role boundaries', () => {
  it('lets admins revoke admin invitations while protecting owner invitations', async () => {
    state.actorRole = 'admin';
    state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    state.invite.role = 'owner';
    state.query.mockImplementation(async (query: TemplateStringsArray) => query.join(' ').includes('FROM invitations WHERE id =') ? [state.invite] : queryResult(query));
    await expect(revokeTeamInvitation(actor, { id: state.invite.id, confirmation: revokeTeamInvitationConfirmation(state.invite.id) })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.execute).not.toHaveBeenCalled();
    state.invite.role = 'admin';
    await expect(revokeTeamInvitation(actor, { id: state.invite.id, confirmation: revokeTeamInvitationConfirmation(state.invite.id) })).resolves.toMatchObject({ revoked: true });
  });
  it('prevents an admin from reissuing an owner invitation as a lower role', async () => {
    state.actorRole = 'admin';
    state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    state.query.mockImplementation(async (query: TemplateStringsArray) => query.join(' ').includes('SELECT id, role::text AS role') ? [{ id: 'old-owner-invite', role: 'owner', acceptedAt: null, expiresAt: now }] : queryResult(query));
    await expect(inviteTeamMember(actor, { email: 'member@example.com', role: 'viewer', confirmation: inviteTeamConfirmation('member@example.com') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.sendTransactionalMail).not.toHaveBeenCalled();
  });
});
