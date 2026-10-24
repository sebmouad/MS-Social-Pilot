import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;

describe.skipIf(!databaseUrl)('post deletion journal SQL constraints on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let workspaceId: string;
  let workspaceCreated = false;
  const prefix = `post_deletion_constraints_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Post-deletion constraint tests require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    workspaceId = `${prefix}_workspace`;
    await client.workspace.create({ data: { id: workspaceId, name: 'Synthetic deletion constraint fixture', slug: workspaceId, timezone: 'UTC' } });
    workspaceCreated = true;
  });

  afterAll(async () => {
    if (workspaceCreated) await client.$executeRaw`DELETE FROM rebuild_post_deletions WHERE "workspaceId" = ${workspaceId}`;
    if (workspaceCreated) await client.workspace.deleteMany({ where: { id: workspaceId } });
    await client?.$disconnect();
  });

  async function insert(state: string, reason: string | null, timestamps: { remote?: Date | null; completed?: Date | null } = {}) {
    const remote = timestamps.remote ?? null;
    const completed = timestamps.completed ?? null;
    await client.$executeRaw`INSERT INTO rebuild_post_deletions
      (id, "workspaceId", "targetId", provider, "remoteId", "actorId", state, reason, "remoteConfirmedAt", "completedAt")
      VALUES (${`${prefix}_${randomUUID()}`}, ${workspaceId}, ${`${prefix}_target`}, 'fixture', ${`${prefix}_${randomUUID()}`}, ${`${prefix}_actor`}, ${state}, ${reason}, ${remote}, ${completed})`;
  }

  it('accepts started and completed rows with their intended NULL reasons', async () => {
    await expect(insert('started', null)).resolves.toBeUndefined();
    const confirmed = new Date();
    await expect(insert('completed', null, { remote: confirmed, completed: confirmed })).resolves.toBeUndefined();
  });

  it.each([
    ['uncertain', null, {}],
    ['remote_confirmed', null, { remote: new Date() }],
    ['rejected', null, {}],
  ] as const)('rejects %s rows whose required reason is NULL', async (state, reason, timestamps) => {
    await expect(insert(state, reason, timestamps)).rejects.toThrow();
  });
});
