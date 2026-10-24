import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), targets: vi.fn(), hooks: new Map<string, unknown>(), platform: vi.fn(), raw: vi.fn(), config: vi.fn(), access: true }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.auth }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ validateTargets: h.targets, limits: async () => ({ maxTargets: 10 }) }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => h.access }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => h.access }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: h.platform }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: h.config }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: h.raw } }));
import { getBestTimeSuggestions } from '@/modules/publishing/server/best-time';
const actor = { userId: 'u', workspaceId: 'w' };
const now = new Date('2026-10-20T00:00:00Z');
const config: Record<string, number> = { bestTimeLookbackDays: 90, bestTimeMaxPosts: 1000, bestTimeMinHistory: 10, bestTimeMinPostsPerSlot: 3, bestTimeMinLift: 1.15, bestTimeMaxSuggestions: 3, queueLookaheadDays: 21 };
// Ten measured posts with a strong Tuesday 08:00 cell (three posts at rank 3 against a median of 1).
const strong = [
  ...Array.from({ length: 7 }, (_, i) => ({ postId: `b${i}`, publishedAt: new Date(`2026-09-0${i + 1}T12:00:00Z`), rankValue: 1, measuredAt: now })),
  ...[7, 14, 21].map(d => ({ postId: `g${d}`, publishedAt: new Date(`2026-09-${String(d).padStart(2, '0')}T23:15:00Z`), rankValue: 3, measuredAt: now })),
];
const flat = Array.from({ length: 10 }, (_, i) => ({ postId: `f${i}`, publishedAt: new Date(`2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z`), rankValue: 1, measuredAt: now }));
beforeEach(() => {
  vi.clearAllMocks(); h.access = true; h.hooks.clear();
  h.auth.mockResolvedValue({ actor, entitlements: {}, permissions: {} });
  h.targets.mockResolvedValue([{ id: 'a', socialAccount: { provider: 'neutral' } }, { id: 'b', socialAccount: { provider: 'neutral' } }]);
  h.raw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('FROM targets') ? [{ id: 'a', name: 'Page A' }, { id: 'b', name: 'Page B' }] : [{ timezone: 'Asia/Tokyo', bestTimeMode: 'suggest' }]);
  h.platform.mockImplementation(async () => ({ postPerformance: async (input: { targetId: string }) => h.hooks.get(input.targetId) ?? [] }));
  h.config.mockImplementation(async (key: string) => config[key.split('.').at(-1)!]);
  h.hooks.set('a', strong); h.hooks.set('b', flat);
});
it('reports per-channel slots with basis and reasons while combined suggestions still need every channel', async () => {
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a', 'b'] }, now);
  expect(result.suggestions).toEqual([]);
  expect(result.perTarget).toHaveLength(2);
  expect(result.perTarget[0]).toMatchObject({ targetId: 'a', name: 'Page A', basis: 10, reason: 'ok' });
  expect(result.perTarget[0]!.slots).toHaveLength(1);
  expect(result.perTarget[0]!.slots[0]).toMatchObject({ dayOfWeek: 2, hour: 8, date: '2026-10-27', time: '08:00' });
  expect(result.perTarget[1]).toMatchObject({ targetId: 'b', name: 'Page B', basis: 10, reason: 'no_lift', slots: [] });
});
it('names insufficient history per channel instead of inventing times', async () => {
  h.hooks.set('b', strong.slice(0, 4));
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a', 'b'] }, now);
  expect(result.suggestions).toEqual([]);
  expect(result.perTarget[1]).toMatchObject({ targetId: 'b', basis: 4, reason: 'insufficient_history', slots: [] });
  expect(result.perTarget[0]).toMatchObject({ reason: 'ok' });
});
it('marks channels without a stored hook unsupported while still reporting the others', async () => {
  h.platform.mockImplementation(async () => null);
  h.targets.mockResolvedValue([{ id: 'a', socialAccount: { provider: 'neutral' } }]);
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a'] }, now);
  expect(result.suggestions).toEqual([]);
  expect(result.perTarget).toEqual([{ targetId: 'a', name: 'Page A', basis: 0, reason: 'unsupported', slots: [] }]);
});
it('marks every channel no-access without reading stored performance', async () => {
  h.access = false;
  const reads = vi.fn();
  h.platform.mockImplementation(async () => ({ postPerformance: reads }));
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a', 'b'] }, now);
  expect(result.suggestions).toEqual([]);
  expect(result.perTarget).toEqual([
    { targetId: 'a', name: 'Page A', basis: 0, reason: 'no_access', slots: [] },
    { targetId: 'b', name: 'Page B', basis: 0, reason: 'no_access', slots: [] },
  ]);
  expect(reads).not.toHaveBeenCalled();
});
