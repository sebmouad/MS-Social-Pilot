import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Root account deletion against the guarded `_preview` database. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 30_000 }));

import { deleteRootUser, rootUserDeletionConfirmation } from '../src/server/root/user-controls';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('Root account deletion on real PostgreSQL', () => {
  let db: PrismaClient;
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const root = `userdel_${tag}_root`; const owner = `userdel_${tag}_owner`; const member = `userdel_${tag}_member`; const ws = `userdel_${tag}_ws`;
  const email = (id: string) => `${id}@example.invalid`;
  const post = randomUUID(); const key = randomUUID();
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    await db.$executeRaw`INSERT INTO users (id, email, name, "passwordHash", "updatedAt", "isInstanceOwner") VALUES (${root}, ${email(root)}, 'Synthetic root', 'x', NOW(), true), (${owner}, ${email(owner)}, 'Synthetic owner', 'x', NOW(), false), (${member}, ${email(member)}, 'Synthetic member', 'x', NOW(), false)`;
    await db.workspace.create({ data: { id: ws, name: 'Synthetic user deletion', slug: `userdel-${tag}`, timezone: 'UTC', memberships: { create: [{ id: randomUUID(), userId: owner, role: 'owner' }, { id: randomUUID(), userId: member, role: 'editor' }] } } });
    await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, status, "createdAt", "updatedAt") VALUES (${post}, ${ws}, ${member}, 'Synthetic', 'draft', NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO mcp_api_keys (id, "workspaceId", "createdById", name, "tokenHash", "tokenPrefix", "readFeatures", "writeFeatures", "expiresAt", "createdAt") VALUES (${key}, ${ws}, ${member}, 'Synthetic key', ${'h' + tag}, 'mcp_x', ARRAY[]::text[], ARRAY[]::text[], NOW() + interval '1 day', NOW())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM mcp_api_keys WHERE id = ${key}`;
    await db.$executeRaw`DELETE FROM posts WHERE id = ${post}`;
    await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${root}`;
    await db.$executeRaw`DELETE FROM memberships WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${ws}`;
    await db.$executeRaw`DELETE FROM users WHERE id IN (${root}, ${owner}, ${member})`;
    await db.$disconnect();
  });

  it('refuses enabled accounts, sole owners, the Root account and wrong confirmations', async () => {
    await expect(deleteRootUser(root, member, rootUserDeletionConfirmation(email(member)))).rejects.toMatchObject({ code: 'conflict' });
    await db.$executeRaw`UPDATE users SET "disabledAt" = NOW() WHERE id IN (${member}, ${owner})`;
    await expect(deleteRootUser(root, owner, rootUserDeletionConfirmation(email(owner)))).rejects.toMatchObject({ code: 'conflict' });
    await expect(deleteRootUser(root, root, rootUserDeletionConfirmation(email(root)))).rejects.toMatchObject({ code: 'conflict' });
    await expect(deleteRootUser(root, member, 'DELETE')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteRootUser(owner, member, rootUserDeletionConfirmation(email(member)))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('deletes a disabled member, keeps their post with the workspace and revokes their keys', async () => {
    const result = await deleteRootUser(root, member, rootUserDeletionConfirmation(email(member)));
    expect(result).toMatchObject({ deleted: true, revokedApiKeys: 1 });
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${member}`).toHaveLength(0);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM memberships WHERE "userId" = ${member}`).toHaveLength(0);
    expect((await db.$queryRaw<Array<{ authorId: string }>>`SELECT "authorId" FROM posts WHERE id = ${post}`)[0]!.authorId).toBe(root);
    const k = (await db.$queryRaw<Array<{ revokedAt: Date | null; createdById: string }>>`SELECT "revokedAt", "createdById" FROM mcp_api_keys WHERE id = ${key}`)[0]!;
    expect(k.revokedAt).not.toBeNull(); expect(k.createdById).toBe(root);
  });
});
