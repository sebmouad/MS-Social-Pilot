import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.operationalTimezone' ? 'UTC' : key === 'diagnostics.enabled' ? true : key === 'diagnostics.runTimeoutMs' ? 1000 : key === 'diagnostics.incompleteRunStaleSeconds' ? 10 : key === 'diagnostics.databaseTimeoutMs' ? 30000 : key === 'diagnostics.minimumIntervalSeconds' ? 30 : 10 }));
vi.mock('../src/server/diagnostics/checks', () => ({ diagnosticChecks: async () => [{ id: 'synthetic', label: 'Synthetic check', run: async () => ({ status: 'pass', code: 'synthetic_ok', message: 'Rollback-only probe.' }) }] }));
import { listRootDiagnostics, runRootDiagnostics } from '../src/server/root/diagnostics';

describe.skipIf(!databaseUrl)('Root diagnostics against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Integration writes require isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });
  it('records started/completed receipts, enforces cross-actor cooldown, and rolls back all probe rows', async () => {
    const actorId = `preview_diagnostics_${randomUUID()}`;
    const otherId = `${actorId}_other`;
    const rollback = new Error('Rollback diagnostic probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = new Proxy(tx, { get(target, key) { if (key === '$transaction') return async (run: (value: typeof tx) => unknown) => run(tx); const value = target[key as keyof typeof tx]; return typeof value === 'function' ? value.bind(target) : value; } }) as unknown as PrismaClient;
        for (const id of [actorId, otherId]) await tx.user.create({ data: { id, email: `${id}@example.test`, name: 'Diagnostic rollback probe', passwordHash: 'unusable', isInstanceOwner: true } });
        // A no-job product scope avoids ordinary shared/provider diagnostic traffic.
        const input = { scope: 'product:home', confirmation: 'RUN DIAGNOSTICS product:home' };
        const result = await runRootDiagnostics(actorId, input);
        expect(result.auditRecorded).toBe(true); expect(result.checks[0].code).toBe('synthetic_ok');
        const snapshot = await listRootDiagnostics(actorId, input.scope);
        expect(snapshot.history.find(item => item.id === result.id)?.result).toMatchObject({ id: result.id, checks: [{ status: 'pass' }] });
        await expect(runRootDiagnostics(otherId, input)).rejects.toMatchObject({ code: 'conflict' });
        const rows = await tx.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE "actorId" = ${actorId} ORDER BY action`;
        expect(rows.map(row => row.action)).toEqual(['diagnostics.completed', 'diagnostics.started']);
        // A run keeps its original longer recovery even after Root shortens current settings.
        const pendingId = `${actorId}_pending`;
        const pendingDetail = JSON.stringify({ runId: pendingId, scope: 'product:ads', recoverySeconds: 120 });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${pendingId}, ${actorId}, 'diagnostics.started', ${pendingDetail}::jsonb, (NOW() AT TIME ZONE 'UTC') - INTERVAL '90 seconds')`;
        const adsInput = { scope: 'product:ads', confirmation: 'RUN DIAGNOSTICS product:ads' };
        await expect(runRootDiagnostics(otherId, adsInput)).rejects.toMatchObject({ code: 'conflict' });
        await tx.$executeRaw`UPDATE root_activities SET "createdAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '121 seconds' WHERE id = ${pendingId}`;
        expect((await runRootDiagnostics(otherId, adsInput)).auditRecorded).toBe(true);
        await tx.user.update({ where: { id: actorId }, data: { disabledAt: new Date() } });
        await expect(listRootDiagnostics(actorId, input.scope)).rejects.toMatchObject({ code: 'forbidden' });
        throw rollback;
      }, { timeout: 30000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.user.count({ where: { id: { in: [actorId, otherId] } } })).toBe(0);
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${actorId}`;
    expect(Number(rows[0].count)).toBe(0);
  });
});
