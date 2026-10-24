export type DatedValues = ReadonlyArray<{ date: string; value: number | null }>;

const scaled = (value: number | null, unit: string) => value !== null && Number.isFinite(value) ? (unit === 'percent' ? value / 100 : value) : null;

/**
 * Dashed previous-period line for a TimeSeriesChart. Server-aligned points (`previousPoints`) carry the
 * current-period date of the same relative day, so each current point picks its own counterpart and a
 * previous day without data stays a gap. Points that match no current date fall back to end alignment.
 * Undefined when either side is empty, so no misleading line is drawn.
 */
export function previousSeries(current: DatedValues, previous: DatedValues | undefined, unit: string) {
  if (!previous?.length || !current.length) return undefined;
  const byDate = new Map(previous.map(point => [point.date, point.value]));
  if (current.some(point => byDate.has(point.date))) return current.map(point => ({ t: point.date, v: scaled(byDate.get(point.date) ?? null, unit) }));
  return previous.slice(-current.length).map(point => ({ t: point.date, v: scaled(point.value, unit) }));
}
