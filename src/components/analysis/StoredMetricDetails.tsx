/** One consistent, accessible disclosure for provider metrics stored as a bag. */
export function StoredMetricDetails({
  metrics, summary, locale,
}: {
  metrics: Record<string, number | Record<string, number>>;
  summary: string;
  locale: string;
}) {
  const entries = Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  const format = (value: number | Record<string, number>) => typeof value === 'number'
    ? value.toLocaleString(locale)
    : Object.entries(value).map(([key, count]) => `${key.replaceAll('_', ' ')}: ${count.toLocaleString(locale)}`).join(' · ');
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-brand-700">{summary}</summary>
      <dl className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
        {entries.map(([metric, value]) => (
          <div key={metric} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
            <dt className="text-slate-600" title={metric}>{metric.replaceAll('_', ' ')}</dt>
            <dd className="max-w-full break-words font-medium tabular-nums text-slate-900">{format(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
