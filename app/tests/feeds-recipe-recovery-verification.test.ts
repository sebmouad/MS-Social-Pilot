import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), post: { findFirst: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
import { defaultPlannerPorts, type PlannerPorts } from '../src/modules/feeds/server/wordpress-planner';
import { cancelPlannedPosts, retryRecipeSlots } from '../src/modules/feeds/server/wordpress-recovery';
import { prismaRecipeStore, type LedgerRow, type SourceRow, type RecipeStore } from '../src/modules/feeds/server/wordpress-store';
import type { WordpressSettings } from '../src/modules/feeds/server/wordpress-settings';
import type { FeedAuthorization } from '../src/modules/feeds/server/access';

const now = new Date('2026-10-21T09:30:00Z');
const slotAt = new Date('2026-10-22T10:00:00Z');
const auth = { actor: { userId: 'owner', workspaceId: 'w1' } } as FeedAuthorization;
const source = { id: 'source', workspaceId: 'w1' } as SourceRow;
// No case enters candidate planning: only recovery settings and ledger fields are consumed.
const settings = { claimLeaseSeconds: 300, runBudget: 10, pauseCancel: { batchSize: 2 } } as WordpressSettings;
const row = (n: number, patch: Partial<LedgerRow> = {}): LedgerRow => ({ id: `plan${n}`, sourceId: 'source', targetId: 'channel', wpPostId: `${n}`, slotAt, state: 'planned', postId: `post${n}`, title: 'Recipe', permalink: null, reason: null, skipped: [], claimedAt: new Date('2026-10-21T08:00:00Z'), ...patch });
function recovery(rows: LedgerRow[]) {
  const attempted: string[] = [];
  const store: RecipeStore = {
    enabledSources: async () => [], pages: async () => [], ledgerSince: async () => rows,
    claim: async () => { throw new Error('Unexpected planning'); },
    settle: async () => { throw new Error('Unexpected planning'); }, recordRun: async () => undefined,
    expireStale: async () => 0,
    unresolved: async () => rows.filter(r => r.state === 'uncertain'),
    plannedUpcoming: async (_source: string, _from: Date, limit: number) => rows.filter(r => r.state === 'planned').sort((a, b) => Number(attempted.includes(a.id)) - Number(attempted.includes(b.id))).slice(0, limit),
    deferCancellation: async (_workspace: string, id: string) => { attempted.push(id); },
    settleIf: async (_workspace: string, id: string, expected: string, s: { state: LedgerRow['state']; postId?: string | null; reason?: string | null; expectedPostId?: string | null }) => {
      const r = rows.find(r => r.id === id)!;
      if (r.state !== expected || r.postId !== (s.expectedPostId ?? null)) return false;
      attempted.push(id); Object.assign(r, { state: s.state, postId: s.postId ?? null, reason: s.reason ?? null }); return true;
    },
  };
  const ports = { store, postForSlot: defaultPlannerPorts().postForSlot, cancelPost: vi.fn(async (_actor: unknown, id: string) => { if (id !== 'post3') throw new Error('Cannot cancel'); }), createPost: vi.fn() } as unknown as PlannerPorts;
  return { ports, attempted };
}
beforeEach(() => { vi.resetAllMocks(); db.$executeRaw.mockResolvedValue(1); });

describe('recipe cancellation progression', () => {
  it('keeps later work visible after an entirely refused batch, and reaches it on repeat', async () => {
    const rows = [row(1), row(2), row(3)]; const h = recovery(rows);
    const first = await cancelPlannedPosts({ settings, ports: h.ports, now }, source, auth);
    expect(first).toEqual({ cancelled: 0, notCancelled: 2, remaining: true });
    expect(rows[0]).toMatchObject({ state: 'planned', postId: 'post1' });
    const second = await cancelPlannedPosts({ settings, ports: h.ports, now }, source, auth);
    expect(second.cancelled).toBe(1);
    expect(rows[2]).toMatchObject({ state: 'failed', postId: null, reason: 'cancelled' });
  });
  it('orders the cancellation query by attempt age before slot time, within the source', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    await prismaRecipeStore.plannedUpcoming('source', now, 3);
    const [sql, ...values] = db.$queryRawUnsafe.mock.calls[0]!;
    expect(sql).toMatch(/ORDER BY "updatedAt" ASC, "slotAt" ASC, id ASC/);
    expect(values).toEqual(['source', now, 3]);
  });
});

describe('uncertain recipe identity', () => {
  it('never adopts a manual post at the same channel and time without a durable recipe identity', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'manual-post' });
    db.$queryRaw.mockResolvedValue([{ postId: null }]);
    const uncertain = row(1, { state: 'uncertain', postId: null }); const h = recovery([uncertain]);
    const result = await retryRecipeSlots({ settings, ports: h.ports, now, db: {} as never }, source, auth);
    expect(result).toMatchObject({ unconfirmed: 1, released: 0, reconciled: 0, planned: 0 });
    expect(uncertain).toMatchObject({ state: 'uncertain', postId: null });
    expect(h.ports.createPost).not.toHaveBeenCalled();
  });
  it('reconciles a known recipe post even after cancellation cleared its time', async () => {
    db.$queryRaw.mockResolvedValue([{ postId: 'recipe-draft' }]);
    db.post.findFirst.mockImplementation(async ({ where }: { where: { id?: string; scheduledAt?: Date } }) => where.id === 'recipe-draft' && where.scheduledAt === undefined ? { id: 'recipe-draft' } : null);
    const uncertain = row(1, { state: 'uncertain', postId: 'recipe-draft' }); const h = recovery([uncertain]);
    const result = await retryRecipeSlots({ settings, ports: h.ports, now, db: {} as never }, source, auth);
    expect(result).toMatchObject({ reconciled: 1, released: 0, planned: 0 });
    expect(uncertain).toMatchObject({ state: 'planned', postId: 'recipe-draft' });
    expect(db.post.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'recipe-draft', workspaceId: 'w1' } }));
  });
  it('keeps a claim uncertain when identity storage cannot be read', async () => {
    db.$queryRaw.mockRejectedValue(new Error('Unavailable'));
    db.post.findFirst.mockResolvedValue({ id: 'manual-post' });
    const uncertain = row(1, { state: 'uncertain', postId: null }); const h = recovery([uncertain]);
    const result = await retryRecipeSlots({ settings, ports: h.ports, now, db: {} as never }, source, auth);
    expect(result).toMatchObject({ unconfirmed: 1, reconciled: 0, released: 0 });
    expect(uncertain.state).toBe('uncertain');
  });
});

it('does not treat a missing local record as proof that the platform has no held copy', async () => {
  db.$queryRaw.mockResolvedValue([{ postId: 'missing-recipe' }]);
  db.post.findFirst.mockResolvedValue(null);
  await expect(defaultPlannerPorts().postForSlot('w1', 'channel', slotAt)).rejects.toThrow();
});

it('never looks up or releases a claim within its lease', async () => {
  const uncertain = row(1, { state: 'uncertain', postId: null, claimedAt: new Date('2026-10-21T09:29:00Z') }); const h = recovery([uncertain]);
  const result = await retryRecipeSlots({ settings, ports: h.ports, now, db: {} as never }, source, auth);
  expect(result).toMatchObject({ unconfirmed: 1, released: 0, reconciled: 0 });
  expect(db.$queryRaw).not.toHaveBeenCalled();
});

it('does not overwrite a concurrent settlement after resolving identity', async () => {
  const uncertain = row(1, { state: 'uncertain', postId: null }); const h = recovery([uncertain]);
  h.ports.postForSlot = async () => { uncertain.state = 'planned'; uncertain.postId = 'concurrent'; return { id: 'stale' }; };
  const result = await retryRecipeSlots({ settings, ports: h.ports, now, db: {} as never }, source, auth);
  expect(result).toMatchObject({ reconciled: 0, released: 0, planned: 0 });
  expect(uncertain).toMatchObject({ state: 'planned', postId: 'concurrent' });
});

it('rotates a refused cancellation with a guarded timestamp-only write', async () => {
  await prismaRecipeStore.deferCancellation!('w1', 'plan1', 'post1');
  const [parts, ...values] = db.$executeRaw.mock.calls[0]!;
  const sql = (parts as TemplateStringsArray).join('?');
  expect(sql).toMatch(/SET "updatedAt" = NOW\(\)/);
  expect(sql).toMatch(/WHERE "workspaceId" = \? AND id = \? AND state = 'planned' AND "postId" = \?/);
  expect(sql).not.toMatch(/SET (?:state|"postId"|reason)/);
  expect(values).toEqual(['w1', 'plan1', 'post1']);
});
