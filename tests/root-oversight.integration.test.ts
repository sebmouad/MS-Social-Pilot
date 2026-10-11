import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
let requestPath = '/dashboard';
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ 'x-msp-pathname': requestPath }),
}));

import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Root runs every client: switches modules off per workspace and per member,
 * suspends a workspace, manages members, and opens any workspace as its owner.
 * Clients only get what root left on.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let auth: typeof import('../src/lib/auth');
let root: typeof import('../src/lib/root');
let crypto: typeof import('../src/lib/crypto');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('root_oversight');
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
  requestPath = '/dashboard';
  await prisma.rootActivity.deleteMany();
  await prisma.session.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let counter = 0;
async function person(options: { root?: boolean; role?: WorkspaceRole; workspaceId?: string } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `person-${counter}@example.test`,
      name: `Person ${counter}`,
      passwordHash: crypto.hashPassword('a-long-enough-password'),
      isInstanceOwner: options.root ?? false,
    },
  });
  const workspace = options.workspaceId
    ? await prisma.workspace.findUniqueOrThrow({ where: { id: options.workspaceId } })
    : await prisma.workspace.create({ data: { name: `Client ${counter}`, slug: `client-${counter}`, timezone: 'UTC' } });
  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: options.role ?? WorkspaceRole.owner },
  });
  return { user, workspace, membership, token: await auth.createSession(user.id) };
}

function signIn(token: string) {
  cookieJar.set('msp_session', token);
}

async function refusal(path: string): Promise<number | null> {
  requestPath = path;
  try {
    await auth.requireAuth();
    return null;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('modules root switches off', () => {
  it('disappear for the whole workspace, screens and API alike', async () => {
    const theRoot = await person({ root: true });
    const client = await person();
    await root.setWorkspaceModules(theRoot.user.id, client.workspace.id, ['ads']);

    signIn(client.token);
    expect((await auth.getAuthContext())!.modules).toEqual(['analytics', 'schedule']);
    expect(await refusal('/api/ads/accounts')).toBe(403);
    expect(await refusal('/api/posts')).toBeNull();
    expect(await refusal('/api/settings/workspace')).toBeNull();
  });

  it('can be switched off for one member only', async () => {
    const theRoot = await person({ root: true });
    const owner = await person();
    const editor = await person({ role: WorkspaceRole.editor, workspaceId: owner.workspace.id });
    await root.setMemberModules(theRoot.user.id, editor.membership.id, ['schedule']);

    signIn(editor.token);
    expect(await refusal('/api/posts/abc')).toBe(403);
    expect(await refusal('/api/analytics/pages')).toBeNull();
    signIn(owner.token);
    expect(await refusal('/api/posts/abc')).toBeNull();
    expect(await prisma.rootActivity.count({ where: { action: 'member.modulesChanged' } })).toBe(1);
  });
});

describe('a suspended workspace', () => {
  it('refuses its members until resumed', async () => {
    const theRoot = await person({ root: true });
    const client = await person();
    await root.setWorkspaceSuspended(theRoot.user.id, client.workspace.id, true);

    signIn(client.token);
    expect(await refusal('/api/settings/workspace')).toBe(403);
    await root.setWorkspaceSuspended(theRoot.user.id, client.workspace.id, false);
    expect(await refusal('/api/settings/workspace')).toBeNull();
  });
});

describe('root opening a workspace', () => {
  it('acts as its owner without joining it, logged, until leaving', async () => {
    const visit = await import('../src/app/api/root/workspaces/[id]/visit/route');
    const leave = await import('../src/app/api/root/visit/route');
    const theRoot = await person({ root: true });
    const client = await person();
    const params = { params: Promise.resolve({ id: client.workspace.id }) };

    signIn(client.token);
    expect((await visit.POST(new Request('http://test/'), params)).status).toBe(404);

    signIn(theRoot.token);
    expect((await visit.POST(new Request('http://test/'), params)).status).toBe(200);
    const context = (await auth.getAuthContext())!;
    expect(context.workspace.id).toBe(client.workspace.id);
    expect(context.role).toBe('owner');
    expect(context.rootVisit).toBe(true);
    expect(await prisma.membership.count({ where: { workspaceId: client.workspace.id } })).toBe(1);
    expect(await prisma.rootActivity.count({ where: { action: 'workspace.visited' } })).toBe(1);

    expect((await leave.DELETE()).status).toBe(200);
    expect((await auth.getAuthContext())!.workspace.id).toBe(theRoot.workspace.id);
  });

  it('is not possible through the cookie alone for anyone but root', async () => {
    const client = await person();
    const other = await person();
    signIn(other.token);
    cookieJar.set('msp_root_visit', client.workspace.id);
    expect((await auth.getAuthContext())!.workspace.id).toBe(other.workspace.id);
  });
});

describe('root managing members', () => {
  it('adds an existing account, changes its role, and removes it', async () => {
    const theRoot = await person({ root: true });
    const client = await person();
    const outsider = await person();

    await root.addMember(theRoot.user.id, client.workspace.id, outsider.user.email, WorkspaceRole.editor);
    const added = await prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: outsider.user.id, workspaceId: client.workspace.id } },
    });
    await root.changeMemberRole(theRoot.user.id, added.id, WorkspaceRole.admin);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: added.id } })).role).toBe('admin');
    await root.removeMemberAsRoot(theRoot.user.id, added.id);
    expect(await prisma.membership.findUnique({ where: { id: added.id } })).toBeNull();
  });

  it('refuses unknown emails, duplicates, and leaving a workspace without an owner', async () => {
    const theRoot = await person({ root: true });
    const client = await person();
    await expect(root.addMember(theRoot.user.id, client.workspace.id, 'nobody@example.test', WorkspaceRole.editor)).rejects.toMatchObject({ status: 404 });
    await expect(root.addMember(theRoot.user.id, client.workspace.id, client.user.email, WorkspaceRole.editor)).rejects.toMatchObject({ status: 409 });
    await expect(root.changeMemberRole(theRoot.user.id, client.membership.id, WorkspaceRole.admin)).rejects.toMatchObject({ status: 422 });
    await expect(root.removeMemberAsRoot(theRoot.user.id, client.membership.id)).rejects.toMatchObject({ status: 422 });
  });

  it('answers 404 on the member routes for anyone but root', async () => {
    const members = await import('../src/app/api/root/members/[id]/route');
    const client = await person();
    signIn(client.token);
    const response = await members.DELETE(new Request('http://test/', { method: 'DELETE' }), {
      params: Promise.resolve({ id: client.membership.id }),
    });
    expect(response.status).toBe(404);
  });
});
