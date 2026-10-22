import { fill, type CaptionTestsCopy } from './copy';

/**
 * Caption A/B tests, pure part. The same content goes out with two to four captions; after `hours` the
 * engagement per view of each caption is compared, and a winner is named only when every caption had
 * enough views. Missing figures are unknown, never zero.
 */
export const LABELS = ['A', 'B', 'C', 'D'] as const;
const DAY_MINUTES = 24 * 60;

export type CaptionResult = { label: string; views: number | null; engagements: number | null; /** Engagements per view, 0–1; null without views. */ rate: number | null };
export type Verdict = { status: 'decided' | 'inconclusive'; reason: 'not_enough_views' | 'no_insights' | 'tie' | 'not_published' | null; winnerLabel: string | null; lift: number | null };

/** Which captions go to which channels, and how many days after the first each goes out. */
export function planCaptions(targetIds: string[], captions: number): Array<{ targetIds: string[]; dayOffset: number }> {
  if (targetIds.length >= captions) return Array.from({ length: captions }, (_, index) => ({ targetIds: targetIds.filter((_, position) => position % captions === index), dayOffset: 0 }));
  return Array.from({ length: captions }, (_, index) => ({ targetIds, dayOffset: index }));
}

/** One measured post of a caption. Null measures were not stored for that post. */
export type PostFigures = { label: string; views: number | null; engagements: number | null };

/** Figures per caption, summed over its posts. A caption with no measured post has unknown figures. */
export function tally(posts: readonly PostFigures[]): CaptionResult[] {
  const byLabel = new Map<string, { views: number | null; engagements: number | null }>();
  for (const post of posts) {
    const entry = byLabel.get(post.label) ?? { views: null, engagements: null };
    if (post.views !== null) entry.views = (entry.views ?? 0) + post.views;
    if (post.engagements !== null) entry.engagements = (entry.engagements ?? 0) + post.engagements;
    byLabel.set(post.label, entry);
  }
  return [...byLabel].map(([label, v]) => ({ label, views: v.views, engagements: v.engagements, rate: v.views && v.views > 0 ? (v.engagements ?? 0) / v.views : null })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The verdict on finished figures: a winner only when every caption had enough views. */
export function decide(results: readonly CaptionResult[], minViews: number): Verdict {
  if (results.length < 2 || results.every(r => r.views === null)) return { status: 'inconclusive', reason: 'no_insights', winnerLabel: null, lift: null };
  if (results.some(r => r.views === null || r.views < minViews)) return { status: 'inconclusive', reason: 'not_enough_views', winnerLabel: null, lift: null };
  const ranked = [...results].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const [best, next] = ranked as [CaptionResult, CaptionResult];
  if ((best.rate ?? 0) === (next.rate ?? 0)) return { status: 'inconclusive', reason: 'tie', winnerLabel: null, lift: null };
  return { status: 'decided', reason: null, winnerLabel: best.label, lift: next.rate ? ((best.rate! - next.rate) / next.rate) * 100 : null };
}

/** Sum of the first stored measure of `keys` a post has (views), or of every stored measure of `keys` (engagements); null when none is stored. */
export function firstMeasure(measures: ReadonlyArray<{ key: string; value: number | null }>, keys: readonly string[]): number | null {
  for (const key of keys) { const found = measures.find(m => m.key === key && m.value !== null); if (found) return found.value; }
  return null;
}
export function sumMeasures(measures: ReadonlyArray<{ key: string; value: number | null }>, keys: readonly string[]): number | null {
  let total: number | null = null;
  for (const key of keys) { const found = measures.find(m => m.key === key && m.value !== null); if (found) total = (total ?? 0) + found.value!; }
  return total;
}

/** The sentence added to the workspace voice, so the AI writes more like what worked. */
export function learningLine(copy: Pick<CaptionTestsCopy, 'learnLine' | 'learnLineLift'>, winner: string, loser: string, lift: number | null, clip: number): string {
  const short = (text: string) => (text.length > clip ? `${text.slice(0, clip - 1)}…` : text).replace(/\s+/g, ' ');
  return lift !== null ? fill(copy.learnLineLift, { winner: short(winner), loser: short(loser), lift: Math.round(lift) }) : fill(copy.learnLine, { winner: short(winner), loser: short(loser) });
}

export { DAY_MINUTES };
