export type DatedValues = ReadonlyArray<{ date: string; value: number }>;

/**
 * Dashed previous-period line for a TimeSeriesChart. Aligned from the end so the latest day lines up
 * with the latest day; undefined when either side is empty, so no misleading line is drawn.
 */
export function previousSeries(current: DatedValues, previous: DatedValues | undefined, unit: string) {
  if (!previous?.length || !current.length) return undefined;
  return previous.slice(-current.length).map(point => ({ t: point.date, v: Number.isFinite(point.value) ? (unit === 'percent' ? point.value / 100 : point.value) : null }));
}
