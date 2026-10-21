import type { MetricView } from './aggregate';

/** One previous-period day mapped onto the current period: `date` is the current-period day at the same relative index. */
export type PreviousPoint = { date: string; value: number | null; previousDate: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (value: string) => Date.parse(`${value}T00:00:00.000Z`);

/**
 * Aligns previous-period points to the current period by relative day index (day 0 of the previous
 * range sits under day 0 of the current range). A previous day with no stored value is null, never zero.
 * The series is cut to the shorter of the two ranges so a clamped year comparison cannot overrun.
 */
export function alignPreviousPoints(previous: ReadonlyArray<{ date: string; value: number }>, current: { start: string; end: string }, comparison: { start: string; end: string }): PreviousPoint[] {
  const length = Math.min(Math.round((dayStart(current.end) - dayStart(current.start)) / DAY_MS), Math.round((dayStart(comparison.end) - dayStart(comparison.start)) / DAY_MS)) + 1;
  if (!Number.isFinite(length) || length < 1 || !previous.length) return [];
  const byDate = new Map(previous.map(point => [point.date, point.value]));
  const aligned: PreviousPoint[] = [];
  for (let index = 0; index < length; index += 1) {
    const previousDate = day(dayStart(comparison.start) + index * DAY_MS);
    const value = byDate.get(previousDate);
    aligned.push({ date: day(dayStart(current.start) + index * DAY_MS), value: value !== undefined && Number.isFinite(value) ? value : null, previousDate });
  }
  return aligned.some(point => point.value !== null) ? aligned : [];
}

/** Previous points per current metric key, only for metrics whose comparison is genuinely comparable. */
export function buildPreviousPoints(
  current: MetricView[], previous: MetricView[], identity: (metric: MetricView) => string,
  comparisons: Record<string, { status: string }>, period: { start: string; end: string }, comparison: { start: string; end: string } | null,
): Record<string, PreviousPoint[]> {
  const result: Record<string, PreviousPoint[]> = Object.create(null);
  if (!comparison) return result;
  const previousByIdentity = new Map(previous.map(metric => [identity(metric), metric]));
  for (const metric of current) {
    if (comparisons[metric.key]?.status !== 'comparable') continue;
    const match = previousByIdentity.get(identity(metric));
    const points = match ? alignPreviousPoints(match.points, period, comparison) : [];
    if (points.length) result[metric.key] = points;
  }
  return result;
}
