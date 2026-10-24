import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { fsMediaStore, type MediaStore } from './store';
import { attributeAssets } from './library';
import { mediaRetentionPolicySchema } from '../config';

export type MediaRetentionResult = { examined: number; removed: number; kept: number; failed: number; bytes: number };
type Candidate = { id: string; url: string; storageKey: string | null; size: number; kind: string };

/**
 * Leased worker job: remove library assets no post references once they are older than the Root
 * retention period. Off by default. Each workspace is locked and processed independently; an asset
 * with any referencing post (or an inconclusive scan) is always kept.
 */
export async function runMediaRetention(now: Date = new Date(), store: MediaStore = fsMediaStore): Promise<MediaRetentionResult> {
  const policy = mediaRetentionPolicySchema.parse(await runtimeConfig('media.retentionPolicy'));
  const total: MediaRetentionResult = { examined: 0, removed: 0, kept: 0, failed: 0, bytes: 0 };
  if (!policy.enabled) return total;
  const [scan, excerpt, transactionTimeout, transactionWait] = (await Promise.all([runtimeConfig('media.holderScanLimit'), runtimeConfig('media.holderExcerptCharacters'), runtimeConfig('media.transactionTimeoutMs'), runtimeConfig('media.transactionMaxWaitMs')])).map(Number);
  const cutoff = new Date(now.getTime() - policy.unusedDays * 86_400_000);
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  for (const workspace of workspaces) {
    try {
      const outcome = await withWorkspaceOperation(workspace.id, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))::text`;
        const rows = await tx.$queryRaw<Candidate[]>`SELECT id, url, "storageKey", size, kind::text AS kind FROM media WHERE "workspaceId" = ${workspace.id} AND "createdAt" < ${cutoff} AND NOT (kind::text = 'image' AND "storageKey" IS NULL AND url = 'media:' || id) ORDER BY "createdAt", id LIMIT ${policy.batchLimit} FOR UPDATE`;
        const result = { examined: rows.length, removed: 0, kept: 0, bytes: 0, files: [] as string[] };
        for (const row of rows) {
          const { byAsset, truncated } = await attributeAssets(tx, workspace.id, [{ id: row.id, source: 'library', url: row.url, storageKey: row.storageKey }], scan, excerpt);
          if (truncated || (byAsset.get(row.id)?.length ?? 0) > 0) { result.kept++; continue; }
          const deleted = await tx.$executeRaw`DELETE FROM media WHERE id = ${row.id} AND "workspaceId" = ${workspace.id}`;
          if (deleted !== 1) { result.kept++; continue; }
          await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspace.id}, ${null}, ${'media.retention.deleted'}, ${JSON.stringify({ assetId: row.id, kind: row.kind, unusedDays: policy.unusedDays })}::jsonb, NOW())`;
          result.removed++; result.bytes += Number(row.size);
          if (row.storageKey) result.files.push(row.storageKey);
        }
        return result;
      }, { timeout: transactionTimeout, maxWait: transactionWait }));
      total.examined += outcome.examined; total.removed += outcome.removed; total.kept += outcome.kept; total.bytes += outcome.bytes;
      // Files go after the row commit; a leftover file is harmless and never re-attached to a record.
      for (const key of outcome.files) { try { await store.removeStored(workspace.id, key); } catch { total.failed++; } }
    } catch { total.failed++; }
  }
  return total;
}

export const formatMediaRetentionSummary = (result: MediaRetentionResult) => `examined=${result.examined} removed=${result.removed} kept=${result.kept} bytes=${result.bytes} failed=${result.failed}`;
