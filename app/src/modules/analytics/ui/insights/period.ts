import type { InsightsPolicy } from './insights-config';

type Locale = 'en' | 'fr';
type Search = Record<string, string | string[] | undefined>;

export type ResolvedPeriod = {
  /** Preset id, or `custom` for dates typed in the picker. */
  preset: string;
  start: string;
  end: string;
  compare: 'none' | 'previous' | 'year';
};

const day = (date: Date) => date.toISOString().slice(0, 10);
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Inclusive UTC dates of one preset on `now`. */
export function presetRange(preset: InsightsPolicy['rangePresets'][number], now: Date): { start: string; end: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset.days) return { start: day(new Date(today.getTime() - (preset.days - 1) * 86_400_000)), end: day(today) };
  if (preset.span === 'lastMonth') return { start: day(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))), end: day(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))) };
  return { start: day(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), end: day(today) };
}

/**
 * The period of an Insights page: `period=<preset>` (Root policy), else typed `start`/`end`, else the default preset.
 * The compare switch is `compare=previous`; any other value means no comparison.
 */
export function resolvePeriod(params: Search, policy: InsightsPolicy, now = new Date()): ResolvedPeriod {
  const compare = first(params.compare) === 'previous' ? 'previous' : first(params.compare) === 'year' ? 'year' : 'none';
  const requested = policy.rangePresets.find(item => item.id === first(params.period));
  if (requested) return { preset: requested.id, compare, ...presetRange(requested, now) };
  const start = first(params.start);
  const end = first(params.end);
  if (isDay(start) && isDay(end) && start <= end) return { preset: 'custom', start, end, compare };
  const fallback = policy.rangePresets.find(item => item.id === policy.defaultPreset) ?? policy.rangePresets[0]!;
  return { preset: fallback.id, compare, ...presetRange(fallback, now) };
}

export function formatDay(value: string, locale: Locale, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00.000Z`));
}
