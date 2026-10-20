import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Inbox export coverage and erasure against the guarded `_preview` database; config is stubbed, SQL is real. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, mediaRoot: '' }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'data.deleteTransactionTimeoutMs': 60_000, 'data.maxArchiveBytes': 50_000_000, 'storage.mediaRoot': shared.mediaRoot } as Record<string, unknown>)[key] }));

import { deleteWorkspaceData, exportWorkspaceData } from '../src/server/data-control';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('Inbox export and erasure on real PostgreSQL', () => {
  let db: PrismaClient;
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const owner = `inboxdel_${tag}_owner`; const ws = `inboxdel_${tag}_ws`; const other = `inboxdel_${tag}_other`;
  const actor = { userId: owner, workspaceId: ws };
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    shared.mediaRoot = await mkdtemp(join(tmpdir(), 'inboxdel-'));
    await db.$executeRaw`INSERT INTO users (id, email, name, "passwordHash", "updatedAt") VALUES (${owner}, ${owner + '@example.invalid'}, 'Synthetic owner', 'x', NOW())`;
    await db.workspace.create({ data: { id: ws, name: 'Synthetic inbox workspace', slug: `inboxdel-${tag}`, timezone: 'UTC', memberships: { create: { id: randomUUID(), userId: owner, role: 'owner' } } } });
    await db.workspace.create({ data: { id: other, name: 'Synthetic neighbour workspace', slug: `inboxdel-${tag}-b`, timezone: 'UTC' } });
    for (const workspaceId of [ws, other]) {
      const rule = randomUUID();
      await db.$executeRaw`INSERT INTO moderation_rules (id, "workspaceId", name, match, action, "updatedAt") VALUES (${rule}, ${workspaceId}, 'Synthetic rule', 'links', 'hide', NOW())`;
      await db.$executeRaw`INSERT INTO moderation_actions (id, "workspaceId", "ruleId", "ruleName", "targetId", "remoteCommentId", message, action) VALUES (${randomUUID()}, ${workspaceId}, ${rule}, 'Synthetic rule', 'synthetic-target', ${'c_' + rule}, 'Synthetic comment', 'hide')`;
      await db.$executeRaw`INSERT INTO inbox_notes (id, "workspaceId", kind, "itemId", body) VALUES (${randomUUID()}, ${workspaceId}, 'comment', 'c1', 'Synthetic note')`;
      await db.$executeRaw`INSERT INTO saved_replies (id, "workspaceId", name, body, "updatedAt") VALUES (${randomUUID()}, ${workspaceId}, 'Hello', 'Hi there', NOW())`;
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${owner}`;
    for (const id of [ws, other]) {
      await db.$executeRaw`DELETE FROM moderation_actions WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM moderation_rules WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM inbox_notes WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM saved_replies WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM memberships WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${id}`;
      await db.$executeRaw`DELETE FROM workspaces WHERE id = ${id}`;
    }
    await db.$executeRaw`DELETE FROM users WHERE id = ${owner}`;
    await rm(shared.mediaRoot, { recursive: true, force: true });
    await db.$disconnect();
  });

  it("exports only this workspace's moderation, notes and saved replies and reports them in coverage", async () => {
    const data = await exportWorkspaceData(actor);
    const tables = data.legacyTables as Record<string, Array<{ workspaceId: string }>>;
    for (const table of ['moderation_rules', 'moderation_actions', 'inbox_notes', 'saved_replies']) {
      expect(tables[table], table).toHaveLength(1);
      expect(tables[table][0].workspaceId).toBe(ws);
    }
    expect(data.coverage.inbox.missing).toEqual([]);
    expect(data.coverage.inbox.included.map((entry: { table: string }) => entry.table)).toEqual(expect.arrayContaining(['moderation_rules', 'moderation_actions']));
  });

  it('erases them in dependency order and leaves another workspace untouched', async () => {
    await deleteWorkspaceData(actor, 'DELETE');
    for (const table of ['moderation_actions', 'moderation_rules', 'inbox_notes', 'saved_replies']) {
      expect(await db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${table} WHERE "workspaceId" = $1`, ws), table).toHaveLength(0);
      expect(await db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${table} WHERE "workspaceId" = $1`, other), table).toHaveLength(1);
    }
  });
});
