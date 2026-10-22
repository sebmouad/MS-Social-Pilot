import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { estimateCostUsd, estimateTokens, resolvePrice, utcMonthKey, utcMonthStart, type AiUsage, type TokenPrice } from '../ai';
import { priceOverridesSchema } from '../config';

/** Price and budget inputs resolved from Root; `budgetUsd` 0 means no budget. */
export type Metering = { model: string; budgetUsd: number; prices: Record<string, TokenPrice>; fallback: TokenPrice; charactersPerToken: number };
export const METERING_KEYS = ['ai.monthlyBudgetUsd', 'ai.priceOverrides', 'ai.fallbackInputPricePerMillionUsd', 'ai.fallbackOutputPricePerMillionUsd', 'ai.charactersPerToken'] as const;

/** Validate the metering settings; null when any is unreadable so callers keep AI unavailable rather than guessing. */
export function meteringFrom(c: Record<string, unknown>, model: string): Metering | null {
  const prices = priceOverridesSchema.safeParse(c['ai.priceOverrides']);
  const budget = c['ai.monthlyBudgetUsd']; const input = c['ai.fallbackInputPricePerMillionUsd']; const output = c['ai.fallbackOutputPricePerMillionUsd']; const cpt = c['ai.charactersPerToken'];
  if (!prices.success || typeof budget !== 'number' || !(budget >= 0) || typeof input !== 'number' || !(input >= 0) || typeof output !== 'number' || !(output >= 0) || typeof cpt !== 'number' || !(cpt >= 1)) return null;
  return { model, budgetUsd: budget, prices: prices.data, fallback: { inputPerMillionUsd: input, outputPerMillionUsd: output }, charactersPerToken: cpt };
}

type Totals = { requests: bigint | number; spent: number | string | null; unpriced: bigint | number };
/** Recorded estimated usage for the workspace's current UTC month. */
export async function monthlyUsage(workspaceId: string, budgetUsd: number, now: Date, db: Pick<typeof prisma, '$queryRaw'> = prisma): Promise<AiUsage> {
  const rows = await db.$queryRaw<Totals[]>`SELECT COUNT(*)::bigint AS requests, COALESCE(SUM((detail->>'costUsd')::numeric), 0)::float8 AS spent, COUNT(*) FILTER (WHERE detail->>'costUsd' IS NULL)::bigint AS unpriced FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'ai.completed' AND "createdAt" >= ${utcMonthStart(now)}`;
  const row = rows[0];
  const spentUsd = Math.round(Number(row?.spent ?? 0) * 1e6) / 1e6;
  const budgeted = budgetUsd > 0;
  return { month: utcMonthKey(now), requests: Number(row?.requests ?? 0), spentUsd, unpricedRequests: Number(row?.unpriced ?? 0), budgetUsd: budgeted ? budgetUsd : null, remainingUsd: budgeted ? Math.max(0, Math.round((budgetUsd - spentUsd) * 1e6) / 1e6) : null };
}

/**
 * Record one finished provider answer with its estimated tokens and cost (no cost = unpriced model).
 * Only lengths and the model are stored, never text. Best effort: the answer already exists, so a
 * failed write must not discard it.
 */
export async function recordUsage(m: Metering, who: { workspaceId: string; userId?: string }, kind: string, inputCharacters: number, outputCharacters: number, now: Date, db: Pick<typeof prisma, '$executeRaw'> = prisma): Promise<void> {
  const inputTokens = estimateTokens(inputCharacters, m.charactersPerToken); const outputTokens = estimateTokens(outputCharacters, m.charactersPerToken);
  const costUsd = estimateCostUsd(inputTokens, outputTokens, resolvePrice(m.model, m.prices, m.fallback));
  const detail = JSON.stringify({ kind, model: m.model, inputTokens, outputTokens, ...(costUsd === null ? {} : { costUsd }) });
  try {
    await db.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${who.workspaceId}, ${who.userId ?? null}, 'ai.completed', ${detail}::jsonb, ${now})`;
  } catch { /* usage stays unrecorded; the answer is still returned */ }
}
