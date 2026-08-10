'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Sparkline } from './Sparkline';

export interface SeriesView {
  metric: string;
  period: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  breakdown: boolean;
  points: Array<{ endTime: string; value: number | Record<string, number> }>;
  total: number | null;
  latest: number | Record<string, number> | null;
  trend: number | null;
}

export interface AvailabilityView {
  metric: string;
  label: string;
  period: string;
  available: boolean;
  reason: string | null;
  description: string;
}

interface Props {
  targetId: string;
  targetName: string;
  series: SeriesView[];
  availability: AvailabilityView[];
  profile: {
    fanCount: number | null;
    followersCount: number | null;
    talkingAboutCount: number | null;
    syncedLabel: string | null;
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

/** Turn a breakdown map into a sorted list, longest bar first. */
function breakdownRows(value: number | Record<string, number> | null): Array<[string, number]> {
  if (!value || typeof value === 'number') return [];
  return Object.entries(value)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => b[1] - a[1]);
}

export function AnalyticsClient({ targetId, targetName, series, availability, profile }: Props) {
  const t = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [filter, setFilter] = useState('');

  const categories = useMemo(() => {
    const grouped = new Map<string, SeriesView[]>();
    const needle = filter.trim().toLowerCase();

    for (const entry of series) {
      if (needle && !entry.label.toLowerCase().includes(needle) && !entry.metric.includes(needle)) {
        continue;
      }
      const bucket = grouped.get(entry.categoryLabel) ?? [];
      bucket.push(entry);
      grouped.set(entry.categoryLabel, bucket);
    }
    return [...grouped.entries()];
  }, [series, filter]);

  const unavailable = availability.filter((entry) => !entry.available);

  async function sync() {
    setSyncing(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/analytics/${targetId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync' }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      stored?: number;
      metrics?: number;
      error?: string;
    };

    if (!response.ok || body.error) {
      setError(body.error ?? t('syncFailed'));
    } else {
      setMessage(t('synced', { stored: body.stored ?? 0, metrics: body.metrics ?? 0 }));
      router.refresh();
    }
    setSyncing(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-56"
            placeholder={t('filterPlaceholder')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="text-xs text-slate-500">
            {t('metricsShown', { count: series.length })}
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={sync} disabled={syncing}>
          {syncing ? tCommon('working') : t('syncNow')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {/* Profile counters: no insights permission needed, so these survive when
          everything else is restricted. */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: t('fans'), value: profile.fanCount },
          { label: t('followers'), value: profile.followersCount },
          { label: t('talkingAbout'), value: profile.talkingAboutCount },
        ].map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {card.value === null ? '—' : formatNumber(card.value)}
            </p>
          </div>
        ))}
      </section>

      {series.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">{t('noData')}</p>
          <button type="button" className="btn-primary mt-4" onClick={sync} disabled={syncing}>
            {syncing ? tCommon('working') : t('syncNow')}
          </button>
        </div>
      ) : (
        categories.map(([category, metrics]) => (
          <section key={category} className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">{category}</h2>

            <div className="space-y-4">
              {metrics.map((entry) => {
                const numeric = entry.points
                  .map((point) => point.value)
                  .filter((value): value is number => typeof value === 'number');
                const rows = breakdownRows(entry.latest);
                const largest = rows[0]?.[1] ?? 1;

                return (
                  <div key={`${entry.metric}-${entry.period}`} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{entry.label}</p>
                        <p className="text-xs text-slate-500">{entry.description}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {entry.metric} · {entry.period}
                        </p>
                      </div>

                      {!entry.breakdown && (
                        <div className="flex items-center gap-3">
                          <Sparkline values={numeric} />
                          <div className="text-right">
                            <p className="text-lg font-semibold text-slate-900">
                              {entry.total !== null ? formatNumber(entry.total) : '—'}
                            </p>
                            {entry.trend !== null && (
                              <p
                                className={`text-xs ${
                                  entry.trend >= 0 ? 'text-emerald-600' : 'text-orange-600'
                                }`}
                              >
                                {entry.trend >= 0 ? '+' : ''}
                                {entry.trend}%
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {entry.breakdown && rows.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {rows.slice(0, 10).map(([key, value]) => (
                          <li key={key} className="flex items-center gap-2 text-xs">
                            <span className="w-32 shrink-0 truncate text-slate-600">{key}</span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <span
                                className="block h-full rounded-full bg-brand-400"
                                style={{ width: `${Math.round((value / largest) * 100)}%` }}
                              />
                            </span>
                            <span className="w-16 shrink-0 text-right font-medium text-slate-700">
                              {formatNumber(value)}
                            </span>
                          </li>
                        ))}
                        {rows.length > 10 && (
                          <li className="text-[10px] text-slate-400">
                            {t('andMore', { count: rows.length - 10 })}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Meta removes metrics between versions. Saying so is more useful than
          silently omitting them. */}
      {unavailable.length > 0 && (
        <section className="card p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowUnavailable((value) => !value)}
          >
            <span className="text-sm font-semibold text-slate-900">
              {t('unavailableTitle', { count: unavailable.length })}
            </span>
            <span className="text-xs text-slate-500">{showUnavailable ? '−' : '+'}</span>
          </button>

          {showUnavailable && (
            <>
              <p className="mt-2 text-xs text-slate-500">{t('unavailableHint')}</p>
              <ul className="mt-3 space-y-1.5">
                {unavailable.map((entry) => (
                  <li key={`${entry.metric}-${entry.period}`} className="text-xs">
                    <span className="font-mono text-slate-700">{entry.metric}</span>
                    <span className="text-slate-400"> · {entry.period} · </span>
                    <span className="text-amber-700">{entry.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <p className="text-xs text-slate-500">{t('footnote', { name: targetName })}</p>
    </div>
  );
}
