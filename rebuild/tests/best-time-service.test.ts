import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), targets: vi.fn(), hook: vi.fn(), platform: vi.fn(), raw: vi.fn(), config: vi.fn(), access: true }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.auth }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ validateTargets: h.targets, limits: async () => ({ maxTargets: 10 }) }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => h.access }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => h.access }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: h.platform }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: h.config }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: h.raw } }));
import { getBestTimeSuggestions } from '@/modules/publishing/server/best-time';
const actor = { userId: 'u', workspaceId: 'w', allowedTargetIds: ['a'] };
const now = new Date('2026-10-20T00:00:00Z');
const config: Record<string, number> = { bestTimeLookbackDays: 90, bestTimeMaxPosts: 1000, bestTimeMinHistory: 10, bestTimeMinPostsPerSlot: 3, bestTimeMinLift: 1.15, bestTimeMaxSuggestions: 3, queueLookaheadDays: 21 };
beforeEach(() => {
  vi.clearAllMocks(); h.access = true;
  h.auth.mockResolvedValue({ actor, entitlements: {}, permissions: {} });
  h.targets.mockResolvedValue([{ id: 'a', socialAccount: { provider: 'neutral' } }]);
  h.raw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('FROM targets') ? [{ id: 'a', name: 'Page A' }] : [{ timezone: 'Asia/Tokyo', bestTimeMode: 'apply' }]);
  h.platform.mockResolvedValue({ postPerformance: h.hook });
  h.config.mockImplementation(async (key: string) => config[key.split('.').at(-1)!]);
  h.hook.mockResolvedValue([
    ...Array.from({ length: 7 }, (_, i) => ({ postId: `b${i}`, publishedAt: new Date(`2026-09-0${i + 1}T12:00:00Z`), rankValue: 1, measuredAt: now })),
    ...[7, 14, 21].map(d => ({ postId: `g${d}`, publishedAt: new Date(`2026-09-${String(d).padStart(2, '0')}T23:15:00Z`), rankValue: 3, measuredAt: now })),
  ]);
});
it('returns bounded stored-only suggestions with a next workspace-local occurrence', async () => {
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a'] }, now);
  expect(result).toEqual({ mode: 'apply', timeZone: 'Asia/Tokyo', windowDays: 90, suggestions: [{ dayOfWeek: 2, hour: 8, minute: 0, posts: 3, lift: 3, nextAt: '2026-10-26T23:00:00.000Z', date: '2026-10-27', time: '08:00' }], perTarget: [{ targetId: 'a', name: 'Page A', basis: 10, reason: 'ok', slots: [{ dayOfWeek: 2, hour: 8, minute: 0, posts: 3, lift: 3, nextAt: '2026-10-26T23:00:00.000Z', date: '2026-10-27', time: '08:00' }] }] });
  expect(h.auth).toHaveBeenCalledWith(actor, 'publishing/posts', 'read');
  expect(h.targets).toHaveBeenCalledWith(actor, ['a'], 10);
  expect(h.hook).toHaveBeenCalledWith({ workspaceId: 'w', targetId: 'a', from: new Date(now.getTime() - 90 * 86400000), to: now, limit: 1000, sort: 'publishedAt', direction: 'desc' });
});
it('checks current scope and strict input before reading measures', async () => {
  await expect(getBestTimeSuggestions(actor, { targetIds: ['other'] }, now)).rejects.toThrow();
  for (const input of [{ targetIds: [] }, { targetIds: ['a', 'a'] }, { targetIds: ['a'], workspaceId: 'other' }]) await expect(getBestTimeSuggestions(actor, input, now)).rejects.toThrow();
  expect(h.hook).not.toHaveBeenCalled();
});
it('does not read analytics when that current entitlement or permission is unavailable', async () => {
  h.access = false;
  expect((await getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).suggestions).toEqual([]);
  expect(h.hook).not.toHaveBeenCalled();
});
it('returns no suggestion for unsupported or unknown data and ignores posts outside the window', async () => {
  h.platform.mockResolvedValueOnce(null);
  expect((await getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).suggestions).toEqual([]);
  h.hook.mockResolvedValueOnce([{ postId: 'future', publishedAt: new Date('2030-01-01'), rankValue: 30, measuredAt: now }]);
  expect((await getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).suggestions).toEqual([]);
});
it('fails closed on revoked authority, targets and invalid workspace settings', async () => {
  h.auth.mockRejectedValueOnce(new Error('revoked'));
  await expect(getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).rejects.toThrow('revoked');
  h.targets.mockRejectedValueOnce(new Error('unselected'));
  await expect(getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).rejects.toThrow('unselected');
  h.raw.mockResolvedValueOnce([{ timezone: 'invalid', bestTimeMode: 'apply' }]);
  await expect(getBestTimeSuggestions(actor, { targetIds: ['a'] }, now)).rejects.toThrow(/settings/);
  expect(h.hook).not.toHaveBeenCalled();
});

it('skips a nonexistent DST wall hour instead of suggesting a shifted time', async () => {
  const beforeGap = new Date('2026-03-07T12:00:00Z');
  h.raw.mockResolvedValue([{ timezone: 'America/New_York', bestTimeMode: 'suggest' }]);
  h.hook.mockResolvedValue([
    ...Array.from({ length: 7 }, (_, i) => ({ postId: `b${i}`, publishedAt: new Date(`2026-02-0${i + 1}T12:00:00Z`), rankValue: 1, measuredAt: beforeGap })),
    ...[8, 15, 22].map(d => ({ postId: `g${d}`, publishedAt: new Date(`2026-02-${String(d).padStart(2, '0')}T07:00:00Z`), rankValue: 3, measuredAt: beforeGap })),
  ]);
  const result = await getBestTimeSuggestions(actor, { targetIds: ['a'] }, beforeGap);
  expect(result.suggestions[0]?.nextAt).toBe('2026-03-15T06:00:00.000Z');
  expect(result.suggestions[0]?.time).toBe('02:00');
});
