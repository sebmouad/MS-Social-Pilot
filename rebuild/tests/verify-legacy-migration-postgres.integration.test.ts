import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client';
import { guardedUrl, inspectDatabase, type Baseline } from '../scripts/verify-legacy-migration';

const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
describe.skipIf(!url)('migration verification on guarded real PostgreSQL', () => {
  it('reads exact catalog counts, reports count drift and leaves source counts unchanged', async () => {
    const safe = guardedUrl(url!); // Guard before opening any client.
    const root = await mkdtemp(path.join(tmpdir(), 'migration-pg-'));
    const db = new PrismaClient({ datasources: { db: { url: safe } }, log: [] });
    try {
      const before = await inspectDatabase(safe, { snapshot: true }) as Baseline;
      const count = (await db.$queryRaw<Array<{ n: string }>>`SELECT count(*)::text AS n FROM public.posts`)[0].n;
      expect(before.counts.posts).toBe(count);
      const changed = { ...before, counts: { ...before.counts, posts: (BigInt(count) + BigInt(1)).toString() } };
      const report = await inspectDatabase(safe, { baseline: changed, mediaRoot: root });
      expect('ok' in report && report.ok).toBe(false);
      expect('checks' in report && report.checks).toContainEqual({ table: 'posts', rule: 'source_row_count', failures: '1' });
      expect(await inspectDatabase(safe, { snapshot: true })).toEqual(before);
    } finally { await db.$disconnect(); await rm(root, { recursive: true, force: true }); }
  });
});
