import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  membership: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  target: { findMany: vi.fn() },
  transaction: vi.fn(), query: vi.fn(), execute: vi.fn(),
  runtimeConfig: vi.fn(), loadEntitlements: vi.fn(), loadPermissions: vi.fn(),
  canUseFeature: vi.fn(), canAccessFeature: vi.fn(), hasPlatformCapability: vi.fn(), entitledPlatformIds: vi.fn(), withWorkspaceOperation: vi.fn(),
  actorRole: 'owner',
  memberRole: 'editor',
  memberDisabled: false,
}));

vi.mock('../src/server/data', () => ({ prisma: { user: state.user, membership: state.membership, $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.loadEntitlements, canUseFeature: state.canUseFeature, hasPlatformCapability: state.hasPlatformCapability, entitledPlatformIds: state.entitledPlatformIds }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.canAccessFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.loadPermissions }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.withWorkspaceOperation }));

import { addTeamConfirmation, addTeamMember, getTeamDirectory, removeTeamConfirmation, removeTeamMember, updateTeamConfirmation, updateTeamMember } from '../src/modules/settings/server/team';

const actor = { userId: 'actor-1', workspaceId: 'workspace-1' };
const entitlements = { workspaceId: actor.workspaceId };
const permissions = {};
const tx = { user: state.user, membership: state.membership, target: state.target, $queryRaw: state.query, $executeRaw: state.execute };
const addInput = { email: 'member@example.com', role: 'editor', targetIds: ['channel-1'], allPages: false, confirmation: addTeamConfirmation('member@example.com') };
const updateInput = { membershipId: 'member-row', role: 'viewer', targetIds: [], allPages: true, confirmation: updateTeamConfirmation('member-row') };
const removeInput = { membershipId: 'member-row', confirmation: removeTeamConfirmation('member-row') };

function queryResult(query: TemplateStringsArray, values: unknown[] = []) {
  const sql = query.join(' ');
  if (sql.includes('SELECT m."userId"')) return [{ userId: actor.userId, role: state.actorRole, disabledAt: null }];
  if (sql.includes('SELECT id, "disabledAt"')) return [{ id: values[0] ?? 'actor-1', disabledAt: values[0] === 'member-1' && state.memberDisabled ? new Date() : null }];
  if (sql.includes('u.email')) return [{ id: 'member-row', userId: 'member-1', role: 'contributor', name: 'Member', email: 'member@example.com', allPages: false }];
  if (sql.includes('SELECT m.id, m."userId"')) return [{ id: 'member-row', userId: 'member-1', role: state.memberRole, disabledAt: state.memberDisabled ? new Date() : null }];
  if (sql.includes('WITH distinct_scope')) return [{ membershipId: 'member-row', targetId: 'channel-1', rowNumber: BigInt(1), rowCount: BigInt(1) }];
  if (sql.includes('SELECT "userId" FROM memberships')) return [{ userId: 'actor-1' }];
  if (sql.includes('SELECT COUNT(*)')) return [{ count: BigInt(1) }];
  if (sql.includes('SELECT role::text AS role')) return [{ role: state.memberRole }];
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.actorRole = 'owner';
  state.memberRole = 'editor';
  state.memberDisabled = false;
  state.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => where.id
    ? { disabledAt: null }
    : { id: 'member-1', name: 'Member', disabledAt: null });
  state.membership.findFirst.mockResolvedValue({ role: 'owner' });
  state.membership.findUnique.mockResolvedValue(null);
  state.membership.count.mockResolvedValue(1);
  state.membership.create.mockResolvedValue({ id: 'member-row' });
  state.membership.update.mockResolvedValue({});
  state.membership.delete.mockResolvedValue({});
  state.target.findMany.mockReset();
  state.target.findMany.mockResolvedValue([{ id: 'channel-1', socialAccount: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } }]);
  state.query.mockImplementation(async (query: TemplateStringsArray, ...values: unknown[]) => queryResult(query, values));
  state.execute.mockResolvedValue(1);
  state.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  state.runtimeConfig.mockImplementation(async (key: string) => ({
    'settings.teamMaxMembers': 50, 'settings.teamMaxChannels': 20,
    'settings.teamOperationTimeoutMs': 10000, 'settings.teamOperationMaxWaitMs': 2000, 'data.workspaceOperationTimeoutMs': 30000,
    'settings.teamDefaultRole': 'contributor', 'settings.teamDefaultAllChannels': false,
  }[key]));
  state.loadEntitlements.mockResolvedValue(entitlements);
  state.loadPermissions.mockResolvedValue(permissions);
  state.canUseFeature.mockReturnValue(true);
  state.canAccessFeature.mockReturnValue(true);
  state.hasPlatformCapability.mockReturnValue(true);
  state.entitledPlatformIds.mockReturnValue(['facebook']);
  state.withWorkspaceOperation.mockImplementation(async (_workspaceId: string, action: () => unknown) => action());
});

describe('team domain authorization and persistence', () => {
  it('rechecks active identity, workspace entitlement, feature permissions, and actor role before writes', async () => {
    state.user.findUnique.mockResolvedValueOnce({ disabledAt: new Date() });
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(state.transaction).not.toHaveBeenCalled();

    state.user.findUnique.mockResolvedValue({ disabledAt: null });
    state.canUseFeature.mockReturnValueOnce(false);
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.transaction).not.toHaveBeenCalled();

    state.canUseFeature.mockReturnValue(true);
    state.membership.findFirst.mockResolvedValueOnce({ role: 'viewer' });
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.membership.create).not.toHaveBeenCalled();
  });

  it('requires exact action confirmation and full scope for owner/admin roles', async () => {
    await expect(addTeamMember(actor, { ...addInput, confirmation: 'ADD MEMBER someone-else@example.com' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(addTeamMember(actor, { ...addInput, role: 'admin' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateTeamMember(actor, { ...updateInput, confirmation: 'UPDATE MEMBER another-row' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(removeTeamMember(actor, { ...removeInput, confirmation: 'REMOVE MEMBER another-row' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it('allows an active workspace admin to grant an admin role only with complete destination scope', async () => {
    state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    state.actorRole = 'admin';
    const elevated = {
      email: 'member@example.com', role: 'admin', targetIds: [], allPages: true,
      confirmation: addTeamConfirmation('member@example.com'),
    };
    const result = await addTeamMember(actor, elevated);
    expect(result).toEqual({ id: expect.any(String), added: true });
    expect(state.membership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: 'admin', workspaceId: actor.workspaceId }) });
    expect(state.execute.mock.calls.some(call => call[0].join(' ').includes('UPDATE memberships') && call.includes(true))).toBe(true);
  });

  it('only grants selected enabled channels from the same workspace and available platform set', async () => {
    state.target.findMany.mockResolvedValueOnce([]);
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.membership.create).not.toHaveBeenCalled();

    state.target.findMany.mockResolvedValueOnce([{ id: 'channel-1', socialAccount: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } }]);
    state.hasPlatformCapability.mockReturnValueOnce(false);
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.membership.create).not.toHaveBeenCalled();

    state.target.findMany.mockResolvedValueOnce([{ id: 'channel-1', socialAccount: { workspaceId: 'another-workspace', provider: 'facebook', invalidatedAt: null } }]);
    await expect(addTeamMember(actor, addInput)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.membership.create).not.toHaveBeenCalled();
  });

  it('keeps member create, channel scope, and content-free audit inside the workspace transaction', async () => {
    const receipt = await addTeamMember(actor, addInput);
    expect(receipt).toEqual({ id: expect.any(String), added: true });
    expect(state.withWorkspaceOperation).toHaveBeenCalledWith(actor.workspaceId, expect.any(Function));
    expect(state.transaction).toHaveBeenCalledTimes(1);
    expect(state.query).toHaveBeenCalled();
    expect(state.membership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'member-1', workspaceId: actor.workspaceId, role: 'editor' }) });
    expect(state.execute).toHaveBeenCalledTimes(3);
    const audit = state.execute.mock.calls[2];
    expect(audit[0].join(' ')).toContain('INSERT INTO activity_logs');
    expect(JSON.stringify(audit)).not.toContain('member@example.com');
  });

  it('bounds the team directory and keeps member and channel grants tenant-qualified', async () => {
    state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    state.actorRole = 'admin';
    state.membership.count.mockResolvedValue(1);
    state.target.findMany.mockResolvedValue([{ id: 'channel-1', name: 'Current workspace channel', type: 'page' }]);
    const directory = await getTeamDirectory(actor, { maxMembers: 1 });
    expect(directory.defaults).toEqual({ role: 'contributor', allPages: false });
    expect(directory.members).toEqual([{ id: 'member-row', userId: 'member-1', role: 'contributor', name: 'Member', email: 'member@example.com', allPages: false, targetIds: ['channel-1'] }]);
    expect(directory.targets).toEqual([{ id: 'channel-1', name: 'Current workspace channel', type: 'page' }]);
    const directorySql = state.query.mock.calls.map(call => call[0].join(' '));
    expect(directorySql.some(sql => sql.includes('m."workspaceId"') && sql.includes('m."workspaceId" ='))).toBe(true);
    const scopeSql = directorySql.find(sql => sql.includes('WITH distinct_scope'));
    expect(scopeSql).toContain('m."workspaceId" =');
    expect(scopeSql).toContain('t."workspaceId" =');
    expect(state.target.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: actor.workspaceId }), take: 21 }));
  });

  it('prevents admins from changing owners and protects the final owner and self access', async () => {
    state.membership.findFirst.mockResolvedValue({ role: 'admin' });
    state.actorRole = 'admin';
    state.memberRole = 'owner';
    state.query.mockImplementation(async (query: TemplateStringsArray) => {
      const sql = query.join(' ');
      if (sql.includes('SELECT m."userId"')) return [{ userId: actor.userId, role: state.actorRole, disabledAt: null }];
      if (sql.includes('SELECT m.id, m."userId"')) return [{ id: 'member-row', userId: 'member-1', role: 'owner', disabledAt: null }];
      if (sql.includes('SELECT id, "disabledAt"')) return [{ id: 'active-user', disabledAt: null }];
      return [];
    });
    await expect(updateTeamMember(actor, updateInput)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(removeTeamMember(actor, removeInput)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.membership.update).not.toHaveBeenCalled();
    expect(state.membership.delete).not.toHaveBeenCalled();

    state.membership.findFirst.mockResolvedValue({ role: 'owner' });
    state.actorRole = 'owner';
    state.query.mockImplementation(async (query: TemplateStringsArray) => {
      const sql = query.join(' ');
      if (sql.includes('SELECT m."userId"')) return [{ userId: actor.userId, role: state.actorRole, disabledAt: null }];
      if (sql.includes('SELECT id, "disabledAt"')) return [{ id: 'active-user', disabledAt: null }];
      if (sql.includes('SELECT m.id, m."userId"')) return [{ id: 'member-row', userId: 'member-1', role: 'owner', disabledAt: null }];
      if (sql.includes('SELECT "userId" FROM memberships')) return [{ userId: 'owner-a' }, { userId: 'owner-b' }];
      if (sql.includes('SELECT COUNT(*)')) return [{ count: BigInt(1) }];
      if (sql.includes('SELECT role::text AS role')) return [{ role: 'owner' }];
      return [];
    });
    state.membership.count.mockResolvedValue(1);
    await expect(updateTeamMember(actor, { ...updateInput, role: 'viewer' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(removeTeamMember(actor, removeInput)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.membership.update).not.toHaveBeenCalled();
    expect(state.membership.delete).not.toHaveBeenCalled();
  });

  it('allows removing a disabled account while refusing changes to its role or scope', async () => {
    state.memberRole = 'viewer';
    state.memberDisabled = true;
    state.query.mockImplementation(async (query: TemplateStringsArray, ...values: unknown[]) => queryResult(query, values));
    const receipt = await removeTeamMember(actor, removeInput);
    expect(receipt).toEqual({ id: 'member-row', removed: true });
    expect(state.membership.delete).toHaveBeenCalledWith({ where: { id: 'member-row' } });
    expect(state.execute).toHaveBeenCalled();
  });
});
