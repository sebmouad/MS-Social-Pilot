import { appLocale } from './time';

/**
 * Chart palette and number formatting, in one place.
 *
 * Charts reference these roles rather than hex, so the whole system moves
 * together and the light/dark values swap in `globals.css` alone.
 */

/**
 * The categorical order.
 *
 * Assigned in order, never cycled. The *ordering* is the colour-vision-safety
 * mechanism, not a preference: it was validated against the white card surface
 * (worst adjacent CVD ΔE 9.1, worst adjacent normal-vision ΔE 19.6). Reordering
 * it, or generating a ninth hue, breaks that guarantee — past eight series, fold
 * the tail into "Other" or split into small multiples instead.
 */
export const SERIES_COLORS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
  'var(--viz-7)',
  'var(--viz-8)',
] as const;

/** How many series a chart may colour before folding the rest into "Other". */
export const SERIES_LIMIT = SERIES_COLORS.length;

export const VIZ = {
  surface: 'var(--viz-surface)',
  ink: 'var(--viz-ink)',
  inkSecondary: 'var(--viz-ink-secondary)',
  inkMuted: 'var(--viz-ink-muted)',
  grid: 'var(--viz-grid)',
  axis: 'var(--viz-axis)',
  /** Context marks and unfilled tracks — never an identity. */
  muted: 'var(--viz-muted-mark)',
  good: 'var(--viz-good)',
  goodText: 'var(--viz-good-text)',
  critical: 'var(--viz-critical)',
} as const;

/**
 * Colour for series `index`.
 *
 * Follows the entity, never its current rank: a filter that removes a series
 * must not repaint the survivors, or a reader who learned "this page is blue"
 * is now being misled.
 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/**
 * Compact a number for a stat tile or an axis tick.
 *
 * Facebook returns impressions in the millions and negative feedback in single
 * digits, often in the same row, so a fixed precision is wrong either way.
 */
export function compact(value: number, locale?: string): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (magnitude >= 10_000) return `${trim(value / 1_000)}K`;
  return Math.round(value).toLocaleString(locale ?? appLocale());
}

function trim(value: number): string {
  // 1.2M, but 12M rather than 12.0M.
  return (Math.round(value * 10) / 10).toString();
}

/** Milliseconds of watch time, which Graph reports and nobody can read raw. */
export function duration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Axis ticks at round numbers.
 *
 * Ticks carry the values that are not directly labelled, so they have to be
 * numbers a reader can hold in their head: 0 / 2,000 / 4,000, never
 * 0 / 1,873 / 3,746.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;

  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  // Run past the maximum, not up to it: the last tick is the top of the plot,
  // so stopping below `max` would draw the peak outside the plot area.
  const ticks: number[] = [];
  for (let value = 0; value < max - step * 0.001; value += step) ticks.push(value);
  ticks.push(ticks.length * step);
  return ticks;
}
