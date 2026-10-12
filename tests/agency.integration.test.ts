import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let agency: typeof import('../src/lib/agency-access');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('agency');
  ({ prisma } = await import('../src/lib/prisma'));
  agency = await import('../src/lib/agency-access');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let counter = 0;
const user = () => {
  counter += 1;
  return prisma.user.create({ data: { email: `a-${counter}@example.test`, name: `Person ${counter}`, passwordHash: 'x' } });
};
const workspace = (name: string) => prisma.workspace.create({ data: { name, slug: `${name.toLowerCase().replace(/ /g, '-')}-${counter}` } });
const join = (userId: string, workspaceId: string, role: WorkspaceRole) => prisma.membership.create({ data: { userId, workspaceId, role } });
const roleOf = async (userId: string, workspaceId: string) =>
  (await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }))?.role ?? null;

describe('agency access', () => {
  it('grants, changes and removes a team member in another client', async () => {
    const [owner, member] = [await user(), await user()];
    const [a, b] = [await workspace('Client A'), await workspace('Client B')];
    await join(owner.id, a.id, 'owner');
    await join(owner.id, b.id, 'owner');
    await join(member.id, a.id, 'editor');

    await agency.setClientAccess({ ownerId: owner.id, workspaceId: b.id, userId: member.id, role: 'viewer' });
    expect(await roleOf(member.id, b.id)).toBe('viewer');
    await agency.setClientAccess({ ownerId: owner.id, workspaceId: b.id, userId: member.id, role: 'editor' });
    expect(await roleOf(member.id, b.id)).toBe('editor');

    const overview = await agency.agencyOverview(owner.id);
    expect(overview.clients.map((c) => c.name)).toEqual(['Client A', 'Client B']);
    expect(overview.people).toHaveLength(1);
    expect(overview.people[0].roles).toEqual({ [a.id]: 'editor', [b.id]: 'editor' });

    await agency.setClientAccess({ ownerId: owner.id, workspaceId: b.id, userId: member.id, role: null });
    expect(await roleOf(member.id, b.id)).toBeNull();
  });

  it('refuses a non-owner, a stranger and a client', async () => {
    const [owner, admin, stranger, client] = [await user(), await user(), await user(), await user()];
    const [a, b] = [await workspace('Client A'), await workspace('Client B')];
    await join(owner.id, a.id, 'owner');
    await join(owner.id, b.id, 'owner');
    await join(admin.id, a.id, 'admin');
    await join(client.id, a.id, 'client');

    await expect(agency.setClientAccess({ ownerId: admin.id, workspaceId: b.id, userId: admin.id, role: 'admin' })).rejects.toThrow();
    await expect(agency.setClientAccess({ ownerId: owner.id, workspaceId: b.id, userId: stranger.id, role: 'viewer' })).rejects.toThrow();
    await expect(agency.setClientAccess({ ownerId: owner.id, workspaceId: b.id, userId: client.id, role: 'viewer' })).rejects.toThrow();
    expect(await roleOf(admin.id, b.id)).toBeNull();
  });
});
