import { getTranslations } from 'next-intl/server';

/**
 * A labelled bar list for a breakdown map.
 *
 * Bars are scaled against the largest value in the set, not against a total —
 * the point is comparing entries with each other, and a total is often
 * meaningless anyway (a person can be in one country but several age bands
 * across different metrics).
 */
export async function BreakdownBars({
  title,
  description,
  data,
  limit = 10,
  formatKey,
}: {
  title: string;
  description?: string;
  data: Record<string, number>;
  limit?: number;
  formatKey?: (key: string) => string;
}) {
  const t = await getTranslations('analytics');

  const rows = Object.entries(data)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort((a, b) => b[1] - a[1]);

  if (rows.length === 0) {
    return (
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{t('noBreakdown')}</p>
      </section>
    );
  }

  const largest = rows[0]![1];
  const shown = rows.slice(0, limit);

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}

      <ul className="mt-4 space-y-1.5">
        {shown.map(([key, value]) => (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span className="w-36 shrink-0 truncate text-slate-600" title={key}>
              {formatKey ? formatKey(key) : key}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-brand-400"
                style={{ width: `${Math.max(2, Math.round((value / largest) * 100))}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right font-medium text-slate-700">
              {value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      {rows.length > limit && (
        <p className="mt-2 text-[10px] text-slate-400">
          {t('andMore', { count: rows.length - limit })}
        </p>
      )}
    </section>
  );
}
