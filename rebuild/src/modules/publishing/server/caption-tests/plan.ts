import type { CaptionTestPolicy } from './config';

export type CaptionResult = { label: string; views: number; engagements: number; /** Engagements per view, 0–1; null without views. */ rate: number | null };
export type CaptionOutcome = { status: 'decided' | 'inconclusive'; reason: string | null; winnerLabel?: string | null; lift?: number | null; results?: CaptionResult[] };
export type EvaluationRow = { captionLabel: string | null; postStatus: string; targetStatus: string | null; publishedAt: Date | string | null; insights: unknown; insightsSyncedAt: Date | string | null };

/** Which captions go to which channels, and how many spacing steps after the first each goes out. */
export function planCaptions(targetIds: string[], captions: number): Array<{ targetIds: string[]; dayOffset: number }> {
  if (targetIds.length >= captions) return Array.from({ length: captions }, (_, index) => ({ targetIds: targetIds.filter((_, position) => position % captions === index), dayOffset: 0 }));
  return Array.from({ length: captions }, (_, index) => ({ targetIds, dayOffset: index }));
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Figures per caption, summed over its channels. Missing figures add nothing: unknown is never counted as a view. */
export function tally(rows: EvaluationRow[], policy: Pick<CaptionTestPolicy, 'viewsMetric' | 'engagementMetrics'>): CaptionResult[] {
  const byLabel = new Map<string, CaptionResult>();
  for (const row of rows) {
    const label = row.captionLabel ?? '?';
    const entry = byLabel.get(label) ?? { label, views: 0, engagements: 0, rate: null };
    const insights = object(row.insights);
    if (insights) { entry.views += num(insights[policy.viewsMetric]); entry.engagements += policy.engagementMetrics.reduce((sum, key) => sum + num(insights[key]), 0); }
    byLabel.set(label, entry);
  }
  return [...byLabel.values()].map(entry => ({ ...entry, rate: entry.views > 0 ? entry.engagements / entry.views : null })).sort((a, b) => a.label.localeCompare(b.label));
}

/** A winner only when every caption had enough views and the rates differ. */
export function decide(results: CaptionResult[], minViews: number): CaptionOutcome {
  if (results.length < 2 || results.some(result => result.views < minViews)) return { status: 'inconclusive', reason: 'not_enough_views' };
  const [best, next] = [...results].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)) as [CaptionResult, CaptionResult];
  if ((best.rate ?? 0) === (next.rate ?? 0)) return { status: 'inconclusive', reason: 'tie' };
  return { status: 'decided', reason: null, winnerLabel: best.label, lift: next.rate ? ((best.rate! - next.rate) / next.rate) * 100 : null };
}

const time = (value: Date | string | null) => value === null ? null : new Date(value).getTime();
/**
 * Read one running test. Null means keep waiting. Broken tests (fewer than two captions, a failed,
 * cancelled, rejected or skipped part) end as not published; otherwise results are read only after
 * the wait following the last publication, once every channel's figures were synced after that point.
 */
export function evaluateTest(test: { hours: number; minViews: number }, rows: EvaluationRow[], now: Date, policy: CaptionTestPolicy): CaptionOutcome | null {
  const labels = new Set(rows.map(row => row.captionLabel).filter(Boolean));
  const targets = rows.filter(row => row.targetStatus !== null);
  const broken = labels.size < 2 || rows.some(row => ['failed', 'cancelled', 'rejected'].includes(row.postStatus)) || targets.some(row => ['failed', 'cancelled', 'skipped'].includes(row.targetStatus!));
  if (broken) return { status: 'inconclusive', reason: 'not_published' };
  if (!targets.length || !targets.every(row => row.targetStatus === 'published' && row.publishedAt)) return null;
  const due = Math.max(...targets.map(row => time(row.publishedAt)!)) + test.hours * 3_600_000;
  if (now.getTime() < due) return null;
  if (targets.every(row => (time(row.insightsSyncedAt) ?? -1) >= due)) { const results = tally(targets, policy); return { ...decide(results, test.minViews), results }; }
  if (now.getTime() > due + policy.insightsGraceMs) return { status: 'inconclusive', reason: 'no_insights', results: tally(targets, policy) };
  return null;
}

/** The winning caption as one line for channel voices, so AI writing sounds more like what worked. */
export function learningLine(template: string, winner: string, loser: string, lift: number | null): string {
  return template.replace('{winner}', winner).replace('{loser}', loser).replace('{lift}', String(Math.round(lift ?? 0)));
}
export const clipLine = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text).replace(/\s+/g, ' ');
