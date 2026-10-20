import { describe, expect, it } from 'vitest';
import type { PostPerformance } from '@/server/platforms/host';
import { suggestBestTimes } from '@/modules/publishing/server/best-time-ranking';
const policy = { minHistory: 10, minPostsPerSlot: 3, minLift: 1.15, maxSuggestions: 3 };
function post(id: string, at: string, rankValue: number | null): PostPerformance {
  return { postId: id, text: '', publishedAt: new Date(at), measuredAt: new Date('2026-10-20'), rankValue, rankLabel: 'Interactions', measures: [], url: null };
}
function history(scale = 1) {
  return [...Array.from({ length: 7 }, (_, i) => post(`base${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z`, scale)),
    ...[7, 14, 21].map(d => post(`good${d}`, `2026-09-${String(d).padStart(2, '0')}T23:15:00Z`, 3 * scale))];
}
describe('neutral best-time ranking', () => {
  it('groups weekday/hour on the workspace clock and normalizes each channel against its median', () => {
    expect(suggestBestTimes([history(), history(1000)], 'Asia/Tokyo', policy)).toEqual([{ dayOfWeek: 2, hour: 8, minute: 0, posts: 6, lift: 3 }]);
  });
  it('does not turn missing, invalid, unmeasured or zero-only history into suggestions', () => {
    for (const rows of [[], history().slice(0, 9), history().map(p => ({ ...p, rankValue: null })), history(0), history().map(p => ({ ...p, measuredAt: null })), history().map(p => ({ ...p, publishedAt: new Date('invalid') }))]) {
      expect(suggestBestTimes([rows], 'UTC', policy)).toEqual([]);
    }
    expect(suggestBestTimes([], 'UTC', policy)).toEqual([]);
  });
  it('requires repeated above-typical evidence for every selected channel', () => {
    expect(suggestBestTimes([history(), []], 'UTC', policy)).toEqual([]);
    expect(suggestBestTimes([history(), history().map(p => ({ ...p, rankValue: 1 }))], 'UTC', policy)).toEqual([]);
    expect(suggestBestTimes([history().concat(history())], 'UTC', { ...policy, minHistory: 11 })).toEqual([]);
    expect(suggestBestTimes([history()], 'UTC', { ...policy, minPostsPerSlot: 4 })).toEqual([]);
  });
  it('ignores negative, nonfinite and missing scores instead of supplying zero', () => {
    const rows = history().map((p, i) => i < 3 ? { ...p, rankValue: [NaN, Infinity, -1][i]! } : p);
    expect(suggestBestTimes([rows], 'UTC', policy)).toEqual([]);
  });
});
