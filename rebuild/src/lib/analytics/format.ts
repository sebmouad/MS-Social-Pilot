import type { Change, ValueFormat } from './types';

/** A fixed locale keeps server-rendered and hydrated text identical. */
const LOCALE = 'en-US';

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
const wholeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

export function formatNumber(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 10_000) return compactFormat.format(value);
  return Math.abs(value) >= 1000 ? wholeFormat.format(value) : numberFormat.format(value);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

function formatMoney(value: number, currency: string | null, compact: boolean): string {
  if (!currency) return Math.abs(value) >= 1000 ? wholeFormat.format(value) : new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  try {
    const big = compact && Math.abs(value) >= 10_000;
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, ...(big ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }) }).format(value);
  } catch {
    return `${currency} ${numberFormat.format(value)}`;
  }
}

/** Writes a value for its unit: counts and people with separators, rates with %, money with its currency. */
export function formatValue(value: number | null | undefined, format: ValueFormat, options: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const compact = options.compact ?? false;
  switch (format.unit) {
    case 'currency': return formatMoney(value, format.currency, compact);
    case 'rate':
      if (format.style === 'multiple') return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(value)}×`;
      return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(value)}%`;
    case 'duration': return formatDuration(value);
    default: return formatNumber(value, compact);
  }
}

/** The "up to" wording for totals that count distinct people. */
export function formatTotal(value: number | null, format: ValueFormat, upTo: boolean, options: { compact?: boolean } = {}): string {
  const text = formatValue(value, format, options);
  return value !== null && upTo ? `Up to ${text}` : text;
}

export function formatDay(day: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(LOCALE, { timeZone: 'UTC', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Percentage and arrow text; the words are what assistive technology reads, the arrow is decoration. */
export function describeChange(change: Change | null): { arrow: string; text: string; words: string } {
  if (!change) return { arrow: '', text: 'No earlier data', words: 'No data for the previous period' };
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '▬';
  if (change.percent === null) {
    return change.direction === 'flat'
      ? { arrow, text: 'No change', words: 'No change from the previous period' }
      : { arrow, text: 'New activity', words: 'Up from zero in the previous period' };
  }
  const magnitude = `${Math.abs(change.percent).toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`;
  if (change.direction === 'flat') return { arrow, text: '0%', words: 'No change from the previous period' };
  return { arrow, text: `${change.direction === 'up' ? '+' : '−'}${magnitude}`, words: `${change.direction === 'up' ? 'Up' : 'Down'} ${magnitude} from the previous period` };
}
