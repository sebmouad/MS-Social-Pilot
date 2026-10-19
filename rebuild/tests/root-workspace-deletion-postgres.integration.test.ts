import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Root workspace deletion against the guarded `_preview` database; config is stubbed, SQL and erasure are real. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, mediaRoot: '' }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'data.deleteTransactionTimeoutMs': 60_000, 'data.workspaceOperationTimeoutMs': 30_000, 'data.workspaceOperationLockWaitMs': 10_000, 'storage.mediaRoot': shared.mediaRoot } as Record<string, unknown>)[key] }));

import { deleteRootWorkspace, rootWorkspaceDeletionConfirmation } from '../src/server/root/workspace-access';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('Root workspace deletion on real PostgreSQL', () => {
  let db: PrismaClient;
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const root = `rootdel_${tag}_root`; const owner = `rootdel_${tag}_owner`; const ws = `rootdel_${tag}_ws`;
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    shared.mediaRoot = await mkdtemp(join(tmpdir(), 'rootdel-'));
    await db.$executeRaw`INSERT INTO users (id, email, name, "passwordHash", "updatedAt", "isInstanceOwner") VALUES (${root}, ${root + '@example.invalid'}, 'Synthetic root', 'x', NOW(), true), (${owner}, ${owner + '@example.invalid'}, 'Synthetic owner', 'x', NOW(), false)`;
    await db.workspace.create({ data: { id: ws, name: 'Synthetic deletion workspace', slug: `rootdel-${tag}`, timezone: 'UTC', memberships: { create: { id: randomUUID(), userId: owner, role: 'owner' } } } });
    await db.$executeRaw`UPDATE users SET "lastActiveWorkspaceId" = ${ws} WHERE id = ${owner}`;
    await db.$executeRaw`INSERT INTO saved_views (id, "workspaceId", "userId", name, screen, query) VALUES (${randomUUID()}, ${ws}, ${owner}, 'v', 'posts', '')`;
    await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${ws}, ${owner}, 'Synthetic', 'draft', NOW(), NOW())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" IN (${root}, ${owner})`;
    await db.$executeRaw`DELETE FROM memberships WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${ws}`;
    await db.$executeRaw`DELETE FROM users WHERE id IN (${root}, ${owner})`;
    await rm(shared.mediaRoot, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('refuses a non-Root actor, a wrong confirmation and an active workspace', async () => {
    await expect(deleteRootWorkspace(owner, ws, rootWorkspaceDeletionConfirmation(ws))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteRootWorkspace(root, ws, 'DELETE')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteRootWorkspace(root, ws, rootWorkspaceDeletionConfirmation(ws))).rejects.toMatchObject({ code: 'conflict' });
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM posts WHERE "workspaceId" = ${ws}`).toHaveLength(1);
  });

  it('deletes a suspended workspace and every workspace row, keeping the owner account', async () => {
    await db.$executeRaw`UPDATE workspaces SET "suspendedAt" = NOW() WHERE id = ${ws}`;
    const result = await deleteRootWorkspace(root, ws, rootWorkspaceDeletionConfirmation(ws));
    expect(result.deleted).toBe(true);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM workspaces WHERE id = ${ws}`).toHaveLength(0);
    for (const table of ['posts', 'saved_views', 'memberships', 'workspace_data_purges']) {
      expect(await db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${table} WHERE "workspaceId" = $1`, ws)).toHaveLength(0);
    }
    const kept = await db.$queryRaw<Array<{ last: string | null }>>`SELECT "lastActiveWorkspaceId" AS last FROM users WHERE id = ${owner}`;
    expect(kept[0]).toEqual({ last: null });
    const audit = await db.$queryRaw<unknown[]>`SELECT id FROM root_activities WHERE "actorId" = ${root} AND action = 'root.workspace_deleted'`;
    expect(audit).toHaveLength(1);
  });
});
