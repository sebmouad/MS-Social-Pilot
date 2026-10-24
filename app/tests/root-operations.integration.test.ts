import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.operationalTimezone' ? 'UTC' : key === 'jobs.enabled' ? true : key === 'root.workerStaleSeconds' ? 180 : 25 }));
import { loadRootOperations } from '../src/server/root/operations';

describe.skipIf(!databaseUrl)('Root operations against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Integration writes require isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });
  it('isolates rebuild heartbeats, filters jobs and withholds stored provider failures', async () => {
    const id = `preview_operations_${randomUUID()}`;
    const workerId = `rebuild-${id}`;
    const legacyId = `legacy-${id}`;
    const rollback = new Error('Rollback operations probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = tx as unknown as PrismaClient;
        await tx.user.create({ data: { id, email: `${id}@example.test`, name: 'Operation rollback probe', passwordHash: 'unusable', isInstanceOwner: true } });
        const at = new Date();
        const legacyAt = new Date(at.getTime() + 60000);
        await tx.$executeRaw`INSERT INTO worker_heartbeats ("workerId", "seenAt", jobs) VALUES (${workerId}, ${at}, ARRAY['inbox']), (${legacyId}, ${legacyAt}, ARRAY['posts'])`;
        await tx.$executeRaw`INSERT INTO rebuild_sync_runs (id, job, owner, "startedAt", "finishedAt", outcome, attempts, summary, error) VALUES (${id}, 'inbox', ${workerId}, ${at}, ${new Date(at.getTime() + 100)}, 'failed', 1, 'token=secret', 'raw-provider-secret')`;
        const result = await loadRootOperations(id, 'inbox', 1);
        expect(result.worker).toEqual({ state: 'fresh', seenAt: at.toISOString() });
        expect(result.runs).toMatchObject([{ id, job: 'inbox', outcome: 'failed', hasError: true, durationMs: 100 }]);
        expect(JSON.stringify(result)).not.toMatch(/raw-provider-secret|token=secret|rebuild-preview_operations|legacy-preview_operations/);
        const publishing = await loadRootOperations(id, 'publishing', 1);
        expect(publishing.runs.some(run => run.id === id)).toBe(false);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.user.findUnique({ where: { id } })).toBeNull();
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM rebuild_sync_runs WHERE id = ${id}`;
    expect(Number(rows[0].count)).toBe(0);
  });
});
