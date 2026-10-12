import type { Prisma } from '@prisma/client';

import { prisma } from '../prisma';
import { budgetSnapshot, restoreBudget, type BudgetSnapshot } from './budget';

/** The one row the worker keeps its view of the Meta call allowance in. */
const KEY = 'worker';

/** Save what this process knows about the allowance. Never fatal. */
export async function saveBudget(now: number = Date.now()): Promise<void> {
  const snapshot = budgetSnapshot(now) as unknown as Prisma.InputJsonValue;
  await prisma.graphUsage
    .upsert({
      where: { key: KEY },
      create: { key: KEY, snapshot, savedAt: new Date(now) },
      update: { snapshot, savedAt: new Date(now) },
    })
    .catch(() => undefined);
}

/** The worker's last saved view, for a restart or for root to read. */
export async function loadBudget(): Promise<{ snapshot: BudgetSnapshot; savedAt: Date } | null> {
  const row = await prisma.graphUsage.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!row) return null;
  return { snapshot: row.snapshot as unknown as BudgetSnapshot, savedAt: row.savedAt };
}

/** Take the saved view back into this process, so a restart is not optimistic. */
export async function restoreSavedBudget(now: number = Date.now()): Promise<void> {
  const saved = await loadBudget();
  if (saved) restoreBudget(saved.snapshot, now);
}
