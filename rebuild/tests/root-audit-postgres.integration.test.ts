import { describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const value = shared.client[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value; } }) }));
vi.mock('@/server/root/audit-config', () => ({ readAuditConfig: async () => ({ retentionDays: 30, batchSize: 2, exportMaxRows: 10 }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 1024 }));
import { runAuditRetention } from '../src/server/root/audit-retention';
import { exportRootActivity } from '../src/server/root/audit-export';

describe.skipIf(!url)('Root audit real PostgreSQL (temporary tables only)', () => {
  it('exports redacted UTC-filtered CSV and prunes exact bounded batches atomically', async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
    const db = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
    try {
      await db.$transaction(async tx => {
        // Shadow real tables on this connection; no installed audit history is touched.
        await tx.$executeRaw`CREATE TEMP TABLE root_activities (id text PRIMARY KEY, "actorId" text, action text, detail jsonb, "createdAt" timestamp(3)) ON COMMIT DROP`;
        await tx.$executeRaw`CREATE TEMP TABLE activity_logs (id text PRIMARY KEY, "createdAt" timestamp(3)) ON COMMIT DROP`;
        await tx.$executeRaw`CREATE TEMP TABLE users (id text PRIMARY KEY, "isInstanceOwner" boolean, "disabledAt" timestamp, name text, email text) ON COMMIT DROP`;
        // Prisma model queries schema-qualify "public"."users" and bypass the temp shadow, so serve the actor lookup from it.
        const user = { findUnique: async ({ where }: { where: { id: string } }) => (await tx.$queryRaw<{ isInstanceOwner: boolean; disabledAt: Date | null }[]>`SELECT "isInstanceOwner", "disabledAt" FROM pg_temp.users WHERE id = ${where.id}`)[0] ?? null };
        shared.client = new Proxy(tx as unknown as Record<string, unknown>, { get: (target, key) => key === '$transaction' ? (fn: (client: typeof tx) => unknown) => fn(tx) : key === 'user' ? user : Reflect.get(target, key) });
        await tx.$executeRaw`INSERT INTO users VALUES ('root', true, NULL, '=Synthetic', 'root@example.invalid')`;
        await tx.$executeRaw`INSERT INTO root_activities SELECT 'old' || n, 'root', 'synthetic.old', '{"token":"secret"}'::jsonb, '2025-01-01'::timestamp FROM generate_series(1, 3) n`;
        await tx.$executeRaw`INSERT INTO activity_logs SELECT 'old' || n, '2025-01-01'::timestamp FROM generate_series(1, 3) n`;
        await tx.$executeRaw`INSERT INTO root_activities VALUES ('boundary', 'root', 'synthetic.boundary', '{"workspaceId":"ws","token":"secret","postCount":3}', '2026-01-02'::timestamp)`;
        const csv = await exportRootActivity('root', { workspaceId: 'ws', from: '2026-01-02', to: '2026-01-02' });
        expect(csv.rowCount).toBe(1); expect(csv.csv).toContain("'=Synthetic"); expect(csv.csv).not.toContain('secret'); expect(csv.csv).toContain('3 posts');
        expect(await runAuditRetention(new Date('2026-02-01Z'))).toEqual({ enabled: true, rootDeleted: 2, workspaceDeleted: 2 });
        expect(await tx.$queryRaw`SELECT id FROM root_activities WHERE id = 'boundary'`).toHaveLength(1);
        expect(await tx.$queryRaw`SELECT id FROM activity_logs`).toHaveLength(1);
        expect(await tx.$queryRaw`SELECT id FROM root_activities WHERE action = 'root.audit.retention'`).toHaveLength(1);
      });
    } finally { await db.$disconnect(); }
  });
});
