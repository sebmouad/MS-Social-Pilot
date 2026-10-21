import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: vi.fn(), exec: [] as Array<{ sql: string; values: unknown[] }>, spent: 0, requests: 0, unpriced: 0, overrides: {} as Record<string, unknown> }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/ai/config');
  const defaults = { ...Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue])), 'ai.enabled': true, 'ai.model': 'test-model' };
  return { runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, state.overrides[key] ?? (defaults as Record<string, unknown>)[key]])), runtimeSecret: async () => 'sk-test' };
});
vi.mock('@/modules/ai/server/access', () => ({ authorizeAi: state.auth }));

import { aiStatus, runAssist } from '../src/modules/ai/server/ai';
import { estimateCostUsd, estimateTokens, resolvePrice, utcMonthKey } from '../src/modules/ai/ai';
import { AI_CONFIG, priceOverridesSchema } from '../src/modules/ai/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const port = () => ({ complete: vi.fn(async () => 'x'.repeat(400)) });
const now = () => new Date('2026-10-21T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks(); state.exec = []; state.spent = 0; state.requests = 0; state.unpriced = 0; state.overrides = {};
  state.auth.mockResolvedValue({ role: 'editor' });
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray) => {
    const q = s.join('?');
    if (q.includes('"aiEnabled"')) return [{ aiEnabled: true, aiTone: null, aiBrandVoice: null, aiAvoidWords: null }];
    if (q.includes('memberships m JOIN users')) return [{ role: 'editor', disabledAt: null, suspendedAt: null }];
    if (q.includes("'ai.completed'")) return [{ requests: BigInt(state.requests), spent: state.spent, unpriced: BigInt(state.unpriced) }];
    if (q.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.exec.push({ sql: s.join('?'), values: v }); return 1; });
});

describe('pricing helpers', () => {
  it('estimates tokens, resolves the model price then the fallback and reports unpriced as null', () => {
    expect(estimateTokens(401, 4)).toBe(101);
    const table = { m1: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } };
    expect(resolvePrice('m1', table, { inputPerMillionUsd: 0, outputPerMillionUsd: 0 })).toEqual(table.m1);
    expect(resolvePrice('other', table, { inputPerMillionUsd: 1, outputPerMillionUsd: 2 })).toEqual({ inputPerMillionUsd: 1, outputPerMillionUsd: 2 });
    expect(resolvePrice('other', table, { inputPerMillionUsd: 0, outputPerMillionUsd: 0 })).toBeNull();
    expect(resolvePrice('constructor', {}, { inputPerMillionUsd: 0, outputPerMillionUsd: 0 })).toBeNull();
    expect(estimateCostUsd(1_000_000, 1_000_000, table.m1)).toBe(18);
    expect(estimateCostUsd(10, 10, null)).toBeNull();
    expect(utcMonthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
  it('validates the Root price table strictly and registers the keys as active', () => {
    expect(priceOverridesSchema.safeParse({ 'gpt-6-luna': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } }).success).toBe(true);
    expect(priceOverridesSchema.safeParse({ m: { inputPerMillionUsd: -1, outputPerMillionUsd: 2 } }).success).toBe(false);
    expect(priceOverridesSchema.safeParse({ m: { inputPerMillionUsd: 1, outputPerMillionUsd: 2, extra: 1 } }).success).toBe(false);
    expect(priceOverridesSchema.safeParse({ 'bad model!': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } }).success).toBe(false);
    for (const key of ['ai.monthlyBudgetUsd', 'ai.priceOverrides', 'ai.fallbackInputPricePerMillionUsd', 'ai.fallbackOutputPricePerMillionUsd', 'ai.charactersPerToken'])
      expect(AI_CONFIG.find(e => e.key === key)?.consumption).toBe('active');
  });
});

describe('metering and budget', () => {
  it('records estimated tokens and cost (never text) after each answer', async () => {
    state.overrides['ai.priceOverrides'] = { 'test-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } };
    await runAssist(actor, { kind: 'caption', text: 'Spring sale' }, { port: port(), now });
    const row = state.exec.find(e => e.sql.includes("'ai.completed'"));
    expect(row).toBeTruthy();
    const detail = JSON.parse(String(row!.values.find(v => typeof v === 'string' && v.startsWith('{'))));
    expect(detail).toMatchObject({ kind: 'caption', model: 'test-model', outputTokens: 100 });
    expect(detail.costUsd).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain('Spring sale');
  });
  it('records unpriced usage without a cost instead of zero', async () => {
    await runAssist(actor, { kind: 'caption', text: 'Hello' }, { port: port(), now });
    const row = state.exec.find(e => e.sql.includes("'ai.completed'"));
    expect(JSON.parse(String(row!.values.find(v => typeof v === 'string' && v.startsWith('{')))).costUsd).toBeUndefined();
  });
  it('refuses at the claim, before calling the provider, once the monthly budget is spent', async () => {
    state.overrides['ai.monthlyBudgetUsd'] = 5; state.spent = 5; const p = port();
    await expect(runAssist(actor, { kind: 'caption', text: 'x' }, { port: p, now })).rejects.toMatchObject({ code: 'conflict' });
    expect(p.complete).not.toHaveBeenCalled();
    expect(state.exec.some(e => e.sql.includes("'ai.requested'"))).toBe(false);
  });
  it('allows requests while budget remains and ignores the budget when it is 0', async () => {
    state.overrides['ai.monthlyBudgetUsd'] = 5; state.spent = 4.99;
    await expect(runAssist(actor, { kind: 'caption', text: 'x' }, { port: port(), now })).resolves.toMatchObject({ kind: 'caption' });
    state.overrides['ai.monthlyBudgetUsd'] = 0; state.spent = 999;
    await expect(runAssist(actor, { kind: 'caption', text: 'x' }, { port: port(), now })).resolves.toMatchObject({ kind: 'caption' });
  });
  it('is unavailable (not guessing) when the price table is unreadable', async () => {
    state.overrides['ai.priceOverrides'] = { m: { inputPerMillionUsd: 'a' } };
    expect((await aiStatus(actor, { port: port(), now })).available).toBe(false);
  });
  it('exposes usage with unknown costs kept apart from spend through the shared status (UI, REST and MCP)', async () => {
    state.overrides['ai.monthlyBudgetUsd'] = 10; state.spent = 2.5; state.requests = 7; state.unpriced = 2;
    expect(await aiStatus(actor, { port: port(), now })).toMatchObject({ available: true, usage: { month: '2026-10', requests: 7, spentUsd: 2.5, unpricedRequests: 2, budgetUsd: 10, remainingUsd: 7.5 } });
    state.overrides['ai.monthlyBudgetUsd'] = 0;
    expect((await aiStatus(actor, { port: port(), now })).usage).toMatchObject({ budgetUsd: null, remainingUsd: null });
  });
});
