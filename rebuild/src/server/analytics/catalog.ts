export type AnalyticsMetric = {
  key: string;
  label: string;
  source: 'page' | 'instagram' | 'ads';
  kind: 'stock' | 'flow' | 'ratio' | 'breakdown';
  unit: 'count' | 'currency' | 'percent' | 'multiple';
};

export function genericMetricLabel(key: string): string {
  return key.replace(/^page_/, '').replace(/[:_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function aggregateValues(values: number[], kind: AnalyticsMetric['kind']): number | null {
  if (!values.length) return null;
  if (kind === 'stock' || kind === 'ratio') return values[values.length - 1] ?? null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
