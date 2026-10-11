import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The root section: what root can do to the installation, and that nobody
 * else can reach it — not even by name.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let auth: typeof import('../src/lib/auth');
let root: typeof import('../src/lib/root');
let crypto: typeof import('../src/lib/crypto');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('root');
  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
  root = await import('../src/lib/root');
  crypto = await import('../src/lib/crypto');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  cookieJar.clear();
  await prisma.rootActivity.deleteMany();
  await prisma.session.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let counter = 0;
async function person(options: { root?: boolean; role?: WorkspaceRole } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `person-${counter}@example.test`,
      name: `Person ${counter}`,
      passwordHash: crypto.hashPassword('a-long-enough-password'),
      isInstanceOwner: options.root ?? false,
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: `Client ${counter}`,
      slug: `client-${counter}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: options.role ?? WorkspaceRole.owner } },
    },
  });
  return { user, workspace, token: await auth.createSession(user.id) };
}

describe('who reaches the root section', () => {
  it('root does; a workspace owner gets a 404, as does someone signed out', async () => {
    const config = await import('../src/app/api/root/config/route');
    const owner = await person();
    const theRoot = await person({ root: true });

    expect((await config.GET()).status).toBe(404);
    cookieJar.set('msp_session', owner.token);
    expect((await config.GET()).status).toBe(404);
    cookieJar.set('msp_session', theRoot.token);
    expect((await config.GET()).status).toBe(200);
  });
});

describe('disabling an account', () => {
  it('signs it out everywhere and refuses its password until enabled again', async () => {
    const theRoot = await person({ root: true });
    const target = await person();

    await root.setUserDisabled(theRoot.user.id, target.user.id, true);
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0);
    await expect(auth.authenticate(target.user.email, 'a-long-enough-password')).rejects.toMatchObject({
      key: 'errors.accountDisabled',
    });

    await root.setUserDisabled(theRoot.user.id, target.user.id, false);
    await expect(auth.authenticate(target.user.email, 'a-long-enough-password')).resolves.toMatchObject({ next: null });
    expect((await root.listRootActivity()).map((entry) => entry.action)).toEqual(['user.enabled', 'user.disabled']);
  });

  it('a session made before the account was disabled no longer signs anybody in', async () => {
    const theRoot = await person({ root: true });
    const target = await person();
    await prisma.user.update({ where: { id: target.user.id }, data: { disabledAt: new Date() } });

    cookieJar.set('msp_session', target.token);
    expect(await auth.getAuthContext()).toBeNull();
    expect(theRoot.user.isInstanceOwner).toBe(true);
  });

  it('root cannot disable itself', async () => {
    const theRoot = await person({ root: true });
    await expect(root.setUserDisabled(theRoot.user.id, theRoot.user.id, true)).rejects.toMatchObject({
      key: 'errors.rootCannotBeDisabled',
    });
  });
});

describe('handing root over', () => {
  it('needs root’s own password, and then moves root to exactly one other account', async () => {
    const theRoot = await person({ root: true });
    const next = await person();

    await expect(
      root.transferRoot({ actorId: theRoot.user.id, toUserId: next.user.id, password: 'wrong' }),
    ).rejects.toMatchObject({ key: 'errors.currentPasswordWrong' });

    await root.transferRoot({ actorId: theRoot.user.id, toUserId: next.user.id, password: 'a-long-enough-password' });
    const roots = await prisma.user.findMany({ where: { isInstanceOwner: true }, select: { id: true } });
    expect(roots).toEqual([{ id: next.user.id }]);
  });
});

describe('workspaces and invitations', () => {
  it('renames a workspace and revokes any workspace’s invitation, logging both', async () => {
    const theRoot = await person({ root: true });
    const other = await person();
    const invitation = await prisma.invitation.create({
      data: {
        workspaceId: other.workspace.id,
        email: 'guest@example.test',
        tokenHash: 'hash-guest',
        invitedById: other.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await root.renameWorkspace(theRoot.user.id, other.workspace.id, 'Client renamed');
    await root.revokeInvitation(theRoot.user.id, invitation.id);

    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: other.workspace.id } })).name).toBe('Client renamed');
    expect(await prisma.invitation.count()).toBe(0);
    expect((await root.listRootActivity()).map((entry) => entry.action)).toEqual(['invitation.revoked', 'workspace.renamed']);
  });
});

describe('the privileges table', () => {
  it('is what the permission checks read', async () => {
    const constants = await import('../src/lib/constants');
    const checks: Record<string, (role: WorkspaceRole) => boolean> = {
      manageAccounts: constants.canManageAccounts,
      manageTeam: constants.canManageTeam,
      manageSettings: constants.canManageSettings,
      approve: constants.canApprove,
      deleteComments: constants.canDeleteComments,
      moderateComments: constants.canModerateComments,
      publishWithoutApproval: constants.canPublishWithoutApproval,
      manageOthersPosts: constants.canManageOthersPosts,
      deleteMedia: constants.canDeleteMedia,
      compose: () => constants.canCompose(),
    };
    expect(Object.keys(checks).sort()).toEqual(Object.keys(constants.CAPABILITIES).sort());
    for (const [capability, check] of Object.entries(checks)) {
      for (const role of constants.ROLES_BY_RANK) {
        expect(check(role), `${capability} for ${role}`).toBe(
          constants.atLeast(role, constants.CAPABILITIES[capability as keyof typeof constants.CAPABILITIES]),
        );
      }
    }
  });

  it('shows Page access as "all" for owners and admins', async () => {
    const admin = await person({ role: WorkspaceRole.admin });
    await prisma.membership.updateMany({ where: { userId: admin.user.id }, data: { allPages: false } });
    const [row] = await root.privilegesByMember({ userId: admin.user.id });
    expect(row?.pages).toBeNull();
  });
});
