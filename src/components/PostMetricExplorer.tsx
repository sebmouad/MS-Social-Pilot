'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface PostMetricView {
  metric: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  value: number | Record<string, number>;
  breakdown: boolean;
  deprecatedFrom: string | null;
}

/**
 * Every metric Graph returned for one post.
 *
 * The post table shows seven numbers because a table can only show seven. This
 * is the rest — grouped by category, filterable, with breakdown maps expanded
 * rather than rendered as `[object Object]`.
 */
export function PostMetricExplorer({
  postTargetId,
  external,
  metrics,
}: {
  postTargetId: string;
  external: boolean;
  metrics: PostMetricView[];
}) {
  const t = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const buckets = new Map<string, PostMetricView[]>();

    for (const metric of metrics) {
      if (
        needle &&
        !metric.metric.toLowerCase().includes(needle) &&
        !metric.label.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const bucket = buckets.get(metric.categoryLabel) ?? [];
      bucket.push(metric);
      buckets.set(metric.categoryLabel, bucket);
    }

    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [metrics, filter]);

  const shown = grouped.reduce((sum, [, rows]) => sum + rows.length, 0);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/analytics/post/${postTargetId}${external ? '?external=true' : ''}`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? tCommon('genericError'));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="input max-w-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('filterPlaceholder')}
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{t('metricsShown', { count: shown })}</span>
          <button type="button" className="btn-secondary" onClick={refresh} disabled={busy}>
            {busy ? tCommon('working') : t('syncNow')}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {metrics.length === 0 && (
        <p className="card p-6 text-center text-sm text-slate-600">{t('noData')}</p>
      )}

      {grouped.map(([category, rows]) => (
        <section key={category} className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">{category}</h2>

          <ul className="mt-3 divide-y divide-slate-100">
            {rows.map((metric) => (
              <li key={metric.metric} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{metric.label}</p>
                    <p className="text-xs text-slate-500">{metric.description}</p>
                    <p className="font-mono text-[10px] text-slate-400">{metric.metric}</p>
                  </div>

                  {metric.breakdown ? (
                    <span className="text-xs text-slate-400">{t('breakdownBelow')}</span>
                  ) : (
                    <span className="text-lg font-semibold text-slate-900">
                      {(metric.value as number).toLocaleString()}
                    </span>
                  )}
                </div>

                {metric.deprecatedFrom && (
                  <p className="mt-1 text-[10px] text-amber-700">
                    {t('deprecatedFrom', { version: metric.deprecatedFrom })}
                  </p>
                )}

                {metric.breakdown && (
                  <ul className="mt-2 space-y-1">
                    {Object.entries(metric.value as Record<string, number>)
                      .filter(([, value]) => typeof value === 'number')
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 12)
                      .map(([key, value]) => (
                        <li key={key} className="flex justify-between gap-3 text-xs">
                          <span className="truncate text-slate-600">{key}</span>
                          <span className="font-medium text-slate-700">
                            {value.toLocaleString()}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
