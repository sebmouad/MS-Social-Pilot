import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Async workspace export jobs on the guarded `_preview` database; config defaults and authority are stubbed. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, mediaRoot: '' }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'storage.mediaRoot') return shared.mediaRoot;
  const { CONFIG_REGISTRY } = await import('../src/lib/config/registry');
  return (CONFIG_REGISTRY as ReadonlyArray<{ key: string; defaultValue: unknown }>).find(item => item.key === key)?.defaultValue;
} }));
vi.mock('@/server/entitlements', async original => ({ ...(await original() as object), loadEntitlements: async (_u: string, w: string) => ({ workspaceId: w }), canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] }, deny: [] }) }));
vi.mock('@/server/permissions', async original => ({ ...(await original() as object), canAccessFeature: () => true }));

import { downloadWorkspaceExport, requestWorkspaceExport, runWorkspaceExports } from '../src/modules/settings/server/exports';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('async workspace export on real PostgreSQL', () => {
  let db: PrismaClient;
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const owner = `export_${tag}_owner`; const ws = `export_${tag}_ws`;
  const actor = { userId: owner, workspaceId: ws };
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    shared.mediaRoot = await mkdtemp(join(tmpdir(), 'export-'));
    await db.$executeRaw`INSERT INTO users (id, email, name, "passwordHash", "updatedAt") VALUES (${owner}, ${owner + '@example.invalid'}, 'Synthetic exporter', 'x', NOW())`;
    await db.workspace.create({ data: { id: ws, name: 'Synthetic export workspace', slug: `export-${tag}`, timezone: 'UTC', memberships: { create: { id: randomUUID(), userId: owner, role: 'owner' } } } });
    await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${ws}, ${owner}, 'Synthetic export post', 'draft', NOW(), NOW())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM rebuild_workspace_exports WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM rebuild_export_file_cleanups WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${owner}`;
    await db.$executeRaw`DELETE FROM posts WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM memberships WHERE "workspaceId" = ${ws}`;
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${ws}`;
    await db.$executeRaw`DELETE FROM users WHERE id = ${owner}`;
    await rm(shared.mediaRoot, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('requests once, builds a ready ZIP through the worker, downloads it and expires it', async () => {
    const confirmation = `REQUEST WORKSPACE EXPORT ${ws}`;
    const first = await requestWorkspaceExport(actor, confirmation) as { id: string; status: string };
    expect(first.status).toBe('requested');
    expect((await requestWorkspaceExport(actor, confirmation) as { id: string }).id).toBe(first.id); // pending job reused
    await runWorkspaceExports();
    const row = (await db.$queryRaw<Array<{ status: string; bytes: number | null }>>`SELECT status, bytes FROM rebuild_workspace_exports WHERE id = ${first.id}`)[0]!;
    expect(row.status).toBe('ready'); expect(row.bytes).toBeGreaterThan(0);
    const download = await downloadWorkspaceExport(actor, first.id);
    expect(download.content.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(download.content.length).toBe(row.bytes);
    await db.$executeRaw`UPDATE rebuild_workspace_exports SET "expiresAt" = NOW() - interval '1 minute' WHERE id = ${first.id}`;
    await runWorkspaceExports();
    expect((await db.$queryRaw<Array<{ status: string }>>`SELECT status FROM rebuild_workspace_exports WHERE id = ${first.id}`)[0]!.status).toBe('expired');
    expect(await readdir(join(shared.mediaRoot, 'exports', ws))).toEqual([]);
    await expect(downloadWorkspaceExport(actor, first.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
