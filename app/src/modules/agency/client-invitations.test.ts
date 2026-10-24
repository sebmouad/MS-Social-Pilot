import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientInvitationDefaults, clientInvitationCopy } from './invitation-policy';
const mocks = vi.hoisted(() => ({ root: true, disabled: false, query: vi.fn(), execute: vi.fn(), user: vi.fn(), send: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => {
  const tx = { user: { findUnique: mocks.user }, $queryRaw: mocks.query, $executeRaw: mocks.execute };
  return { prisma: { ...tx, $transaction: async (run: (db: typeof tx) => unknown) => run(tx) } };
});
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/mail', () => ({ sendTransactionalMail: mocks.send }));
import { issueClientInvitation, listClientInvitations, revokeClientInvitation, clientInviteConfirmation, clientRevokeConfirmation } from './server/client-invitations';

beforeEach(() => {
  vi.clearAllMocks(); mocks.root = true; mocks.disabled = false;
  mocks.user.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => where.id ? { isInstanceOwner: mocks.root, disabledAt: mocks.disabled ? new Date() : null } : null);
  mocks.config.mockImplementation(async (key: string) => key === 'agency.clientInvitationPolicy' ? { ...clientInvitationDefaults, enabled: true } : key === 'agency.clientInvitationCopy' ? clientInvitationCopy : key === 'app.publicOrigin' ? 'https://pilot.example.test' : undefined);
  mocks.query.mockImplementation(async (parts: TemplateStringsArray) => /FROM client_invitations/.test(parts.join('')) ? [{ id: 'invite-a', email: 'client@example.test', workspaceName: 'Lumière', expiresAt: new Date('2026-11-05'), acceptedAt: null, createdAt: new Date('2026-10-22') }] : []);
  mocks.execute.mockResolvedValue(1); mocks.send.mockResolvedValue({ status: 'sent' });
});

describe('Root client invitations', () => {
  it.each(['owner', 'admin', 'member', 'viewer', 'cross-workspace owner'])('refuses %s without installation authority before reading invitations', async () => {
    mocks.root = false;
    await expect(listClientInvitations('person-a')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(issueClientInvitation('person-a', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(revokeClientInvitation('person-a', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it('requires confirmation bound to normalized email and suggested workspace', async () => {
    await expect(issueClientInvitation('root-a', { email: 'client@example.test', workspaceName: 'Lumière', confirmation: clientInviteConfirmation('client@example.test', 'Other') })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it('hashes the one-use token, replaces pending invites and audits without the secret', async () => {
    const result = await issueClientInvitation('root-a', { email: ' Client@Example.Test ', workspaceName: ' Lumière ', locale: 'fr', confirmation: clientInviteConfirmation('client@example.test', 'Lumière') });
    expect(result).toMatchObject({ created: true, delivery: 'sent' });
    const token = new URL(result.url).hash.split('client=')[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const statements = mocks.execute.mock.calls.map(([parts, ...values]) => ({ sql: parts.join(''), values }));
    expect(statements.find(statement => statement.sql.includes('DELETE FROM client_invitations'))?.values).toContain('client@example.test');
    expect(statements.find(statement => statement.sql.includes('INSERT INTO client_invitations'))?.values).not.toContain(token);
    expect(JSON.stringify(statements)).not.toContain(token);
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({ to: 'client@example.test', template: 'client.invitation', subject: clientInvitationCopy.fr.mailSubject });
  });

  it('preserves uncertain mail outcomes and returns the created link without sending twice', async () => {
    mocks.send.mockRejectedValueOnce(new Error('private SMTP detail'));
    const result = await issueClientInvitation('root-a', { email: 'client@example.test', confirmation: clientInviteConfirmation('client@example.test', null) });
    expect(result.delivery).toBe('uncertain'); expect(result.url).toContain('#client=');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('does not expose token hashes in the safe legacy directory', async () => {
    const result = await listClientInvitations('root-a');
    expect(result.invitations[0]).toMatchObject({ id: 'invite-a', email: 'client@example.test' });
    expect(mocks.query.mock.calls[0]?.[0].join('')).not.toMatch(/tokenHash|SELECT \*/);
    expect(result.policy.enabled).toBe(true);
  });

  it('rechecks Root authority under lock and refuses accepted invitations', async () => {
    mocks.user.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: null }).mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: null }).mockResolvedValueOnce({ isInstanceOwner: false, disabledAt: null });
    await expect(revokeClientInvitation('root-a', { id: 'invite-a', confirmation: clientRevokeConfirmation('invite-a') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
    mocks.query.mockImplementation(async (parts: TemplateStringsArray) => parts.join('').includes('FROM client_invitations') ? [{ id: 'invite-a', acceptedAt: new Date() }] : []);
    await expect(revokeClientInvitation('root-a', { id: 'invite-a', confirmation: clientRevokeConfirmation('invite-a') })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows legacy invitation revocation when new invitations are disabled', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'agency.clientInvitationPolicy' ? clientInvitationDefaults : clientInvitationCopy);
    await expect(issueClientInvitation('root-a', { email: 'client@example.test', confirmation: clientInviteConfirmation('client@example.test', null) })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(revokeClientInvitation('root-a', { id: 'invite-a', confirmation: clientRevokeConfirmation('invite-a') })).resolves.toEqual({ revoked: true, id: 'invite-a' });
  });

  it('refuses disabled installation owners and does not send after a failed audit', async () => {
    mocks.disabled = true;
    await expect(listClientInvitations('root-a')).rejects.toMatchObject({ code: 'forbidden' });
    mocks.disabled = false;
    mocks.execute.mockImplementation(async (parts: TemplateStringsArray) => parts.join('').includes('root_activities') ? 0 : 1);
    await expect(issueClientInvitation('root-a', { email: 'client@example.test', confirmation: clientInviteConfirmation('client@example.test', null) })).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
