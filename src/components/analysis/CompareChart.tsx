'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { TimeSeries } from '@/components/charts/TimeSeries';
import { topSeries } from '@/lib/aggregate';
import { seriesColor } from '@/lib/viz';

const METRICS = ['interactions', 'posts', 'reach'] as const;
type Metric = (typeof METRICS)[number];

/** More lines than this can't be told apart; the rest become one "others" line. */
const MAX_LINES = 8;

export interface CompareChartProfile {
  id: string;
  name: string;
  daily: Record<Metric, number[]>;
}

/**
 * One line per profile for the chosen metric. The legend hides or shows a
 * line on this chart only; it never changes the app-wide selection.
 */
export function CompareChart({ days, profiles }: { days: string[]; profiles: CompareChartProfile[] }) {
  const t = useTranslations('compareChart');
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>('interactions');
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );

  const lines = topSeries(
    profiles.map((profile) => ({ id: profile.id, label: profile.name, values: profile.daily[metric] })),
    MAX_LINES,
    t('others'),
  );
  // Colour follows the line's place in the legend, which does not move when one is hidden.
  const shown = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !hidden.has(line.id))
    .map(({ line, index }) => ({
      label: line.label,
      colorIndex: index,
      points: days.map((day, position) => ({ x: `${day}T12:00:00Z`, y: line.values[position] ?? 0 })),
    }));

  const toggle = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (days.length < 2) return null;

  return (
    <section className="card-viz" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {profiles.length > MAX_LINES ? t('hintTop', { count: MAX_LINES }) : t('hint')}
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t('metric')}>
          {METRICS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={metric === key}
              className={`segmented-item ${metric === key ? 'segmented-item-active' : ''}`}
              onClick={() => setMetric(key)}
            >
              {t(`metrics.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('legend')}>
        {lines.map((line, index) => {
          const on = !hidden.has(line.id);
          return (
            <li key={line.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(line.id)}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-surface ${
                  on ? 'bg-white text-slate-800' : 'bg-slate-100 text-slate-400 line-through'
                }`}
              >
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: on ? seriesColor(index) : '#cbd5e1' }} />
                {line.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        {shown.length > 0 ? (
          <TimeSeries lines={shown} formatX={(iso) => dayFormat.format(new Date(iso))} />
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">{t('allHidden')}</p>
        )}
      </div>
      {metric === 'reach' && <p className="mt-2 text-xs text-slate-500">{t('reachNote')}</p>}
    </section>
  );
}
