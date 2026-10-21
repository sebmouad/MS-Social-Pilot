import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';

/** Persistence of recipe sources and the plan ledger. Every statement is scoped by workspace. */
export type PlanState = 'claimed' | 'planned' | 'uncertain' | 'failed';
export type SourceRow = {
  id: string; workspaceId: string; name: string; siteUrl: string; enabled: boolean; allTargets: boolean; targetIds: string[]; config: unknown;
  lastRunAt: Date | null; lastError: string | null; lastSummary: unknown; createdAt: Date; updatedAt: Date;
};
export type LedgerRow = {
  id: string; sourceId: string; targetId: string; wpPostId: string; slotAt: Date; state: PlanState; postId: string | null; title: string; permalink: string | null;
  reason: string | null; skipped: string[]; claimedAt: Date; targetName?: string;
};
export type ClaimInput = { workspaceId: string; sourceId: string; targetId: string; wpPostId: string; slotAt: Date; title: string; permalink: string | null; skipped: string[] };
export type Settlement = { state: PlanState; postId?: string | null; reason?: string | null; skipped?: string[] };
export type RunRecord = { at: Date; error: string | null; summary: Record<string, unknown> };

export interface RecipeStore {
  enabledSources(limit: number): Promise<SourceRow[]>;
  pages(source: SourceRow, types: readonly string[], limit: number): Promise<Array<{ id: string; name: string }>>;
  ledgerSince(sourceId: string, from: Date): Promise<LedgerRow[]>;
  expireStale(sourceId: string, before: Date): Promise<number>;
  claim(input: ClaimInput): Promise<string | null>;
  settle(workspaceId: string, id: string, settlement: Settlement): Promise<void>;
  recordRun(workspaceId: string, sourceId: string, run: RunRecord): Promise<void>;
  /** Failed and uncertain slots at or after `from`, soonest first. */
  unresolved(sourceId: string, from: Date, limit: number): Promise<LedgerRow[]>;
  /** Scheduled slots after `from` that hold a post, soonest first. */
  plannedUpcoming(sourceId: string, from: Date, limit: number): Promise<LedgerRow[]>;
  /** Settle a slot only while it is still in `expected`; false when another actor already changed it. */
  settleIf(workspaceId: string, id: string, expected: PlanState, settlement: Settlement & { expectedPostId?: string | null }): Promise<boolean>;
}

const SOURCE_COLUMNS = `id, "workspaceId", name, "siteUrl", enabled, "allTargets", "targetIds", config, "lastRunAt", "lastError", "lastSummary", "createdAt", "updatedAt"`;
const LEDGER_COLUMNS = `id, "sourceId", "targetId", "wpPostId", "slotAt", state, "postId", title, permalink, reason, skipped, "claimedAt"`;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
type RawSource = Omit<SourceRow, 'targetIds'> & { targetIds: unknown };
type RawLedger = Omit<LedgerRow, 'skipped'> & { skipped: unknown };
export const toSource = (row: RawSource): SourceRow => ({ ...row, targetIds: strings(row.targetIds) });
export const toLedger = (row: RawLedger): LedgerRow => ({ ...row, skipped: strings(row.skipped) });

export async function selectSource(workspaceId: string): Promise<SourceRow | null> {
  const rows = await prisma.$queryRawUnsafe<RawSource[]>(`SELECT ${SOURCE_COLUMNS} FROM wordpress_recipe_sources WHERE "workspaceId" = $1 LIMIT 1`, workspaceId);
  return rows[0] ? toSource(rows[0]) : null;
}
export async function selectPlans(workspaceId: string, sourceId: string, offset: number, limit: number): Promise<LedgerRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<RawLedger & { targetName: string | null }>>(
    `SELECT p.id, p."sourceId", p."targetId", p."wpPostId", p."slotAt", p.state, p."postId", p.title, p.permalink, p.reason, p.skipped, p."claimedAt", t.name AS "targetName"
     FROM wordpress_recipe_plans p LEFT JOIN targets t ON t.id = p."targetId" AND t."workspaceId" = p."workspaceId"
     WHERE p."workspaceId" = $1 AND p."sourceId" = $2 ORDER BY p."slotAt" DESC, p.id ASC OFFSET $3 LIMIT $4`, workspaceId, sourceId, offset, limit);
  return rows.map(row => ({ ...toLedger(row), targetName: row.targetName ?? '' }));
}
export async function countPlans(workspaceId: string, sourceId: string): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ state: string; count: bigint }>>`SELECT state, COUNT(*)::bigint AS count FROM wordpress_recipe_plans WHERE "workspaceId" = ${workspaceId} AND "sourceId" = ${sourceId} GROUP BY state`;
  return Object.fromEntries(rows.map(r => [r.state, Number(r.count)]));
}

export const prismaRecipeStore: RecipeStore = {
  async enabledSources(limit) {
    const rows = await prisma.$queryRawUnsafe<RawSource[]>(`SELECT ${SOURCE_COLUMNS} FROM wordpress_recipe_sources WHERE enabled = true ORDER BY "lastRunAt" ASC NULLS FIRST, id ASC LIMIT $1`, limit);
    return rows.map(toSource);
  },
  async pages(source, types, limit) {
    const ids = source.allTargets ? null : source.targetIds;
    if (ids && !ids.length) return [];
    return prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM targets WHERE "workspaceId" = ${source.workspaceId} AND enabled = true AND "canPublish" = true AND type::text = ANY(${[...types]}::text[]) AND (${ids === null} OR id = ANY(${ids ?? []}::text[])) ORDER BY name ASC, id ASC LIMIT ${limit}`;
  },
  async ledgerSince(sourceId, from) {
    const rows = await prisma.$queryRawUnsafe<RawLedger[]>(`SELECT ${LEDGER_COLUMNS} FROM wordpress_recipe_plans WHERE "sourceId" = $1 AND "slotAt" >= $2`, sourceId, from);
    return rows.map(toLedger);
  },
  async expireStale(sourceId, before) {
    return prisma.$executeRaw`UPDATE wordpress_recipe_plans SET state = 'uncertain', reason = 'claim_expired', "updatedAt" = NOW() WHERE "sourceId" = ${sourceId} AND state = 'claimed' AND "claimedAt" < ${before}`;
  },
  /** The unique slot key is the exactly-once claim; a failed slot may be claimed again, any other state may not. */
  async claim(input) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`INSERT INTO wordpress_recipe_plans (id, "workspaceId", "sourceId", "targetId", "wpPostId", "slotAt", state, title, permalink, skipped, "claimedAt", "createdAt", "updatedAt")
      VALUES (${`wrp_${randomUUID()}`}, ${input.workspaceId}, ${input.sourceId}, ${input.targetId}, ${input.wpPostId}, ${input.slotAt}, 'claimed', ${input.title}, ${input.permalink}, ${JSON.stringify(input.skipped)}::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT ("sourceId", "targetId", "slotAt") DO UPDATE SET "wpPostId" = EXCLUDED."wpPostId", state = 'claimed', "postId" = NULL, title = EXCLUDED.title, permalink = EXCLUDED.permalink, reason = NULL, skipped = EXCLUDED.skipped, "claimedAt" = NOW(), "updatedAt" = NOW()
      WHERE wordpress_recipe_plans.state = 'failed' RETURNING id`;
    return rows[0]?.id ?? null;
  },
  async settle(workspaceId, id, s) {
    await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET state = ${s.state}, "postId" = ${s.postId ?? null}, reason = ${s.reason ?? null}, skipped = COALESCE(${s.skipped === undefined ? null : JSON.stringify(s.skipped)}::jsonb, skipped), "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${workspaceId}`;
  },
  async unresolved(sourceId, from, limit) {
    const rows = await prisma.$queryRawUnsafe<RawLedger[]>(`SELECT ${LEDGER_COLUMNS} FROM wordpress_recipe_plans WHERE "sourceId" = $1 AND "slotAt" >= $2 AND state IN ('failed', 'uncertain') ORDER BY "slotAt" ASC, id ASC LIMIT $3`, sourceId, from, limit);
    return rows.map(toLedger);
  },
  async plannedUpcoming(sourceId, from, limit) {
    const rows = await prisma.$queryRawUnsafe<RawLedger[]>(`SELECT ${LEDGER_COLUMNS} FROM wordpress_recipe_plans WHERE "sourceId" = $1 AND "slotAt" > $2 AND state = 'planned' AND "postId" IS NOT NULL ORDER BY "slotAt" ASC, id ASC LIMIT $3`, sourceId, from, limit);
    return rows.map(toLedger);
  },
  async settleIf(workspaceId, id, expected, s) {
    const changed = await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET state = ${s.state}, "postId" = ${s.postId ?? null}, reason = ${s.reason ?? null}, "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${workspaceId} AND state = ${expected} AND ("postId" IS NOT DISTINCT FROM ${s.expectedPostId ?? null}::text)`;
    return changed === 1;
  },
  async recordRun(workspaceId, sourceId, run) {
    await prisma.$executeRaw`UPDATE wordpress_recipe_sources SET "lastRunAt" = ${run.at}, "lastError" = ${run.error}, "lastSummary" = ${JSON.stringify(run.summary)}::jsonb WHERE id = ${sourceId} AND "workspaceId" = ${workspaceId}`;
  },
};
