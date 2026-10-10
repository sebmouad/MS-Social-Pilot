'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { TimeSeries } from '@/components/charts/TimeSeries';
import { compact, seriesColor } from '@/lib/viz';

export interface KpiCard {
  key: string;
  label: string;
  /** Already formatted, or a number to compact. */
  value: number | string | null;
  /** Percentage change against the previous period. */
  change: number | null;
  /** Null when neither direction is good news. */
  upIsGood: boolean | null;
  /** One value per day of the window, or null when there is no daily figure. */
  series: number[] | null;
  /** Shown under the chart: where the daily figure comes from. */
  note?: string;
}

/**
 * The period's headline figures as cards that drive one chart.
 *
 * Each card carries its value, the change against the period before, and the
 * shape of the period in a line under them. Picking a card draws its days in
 * full below — one metric at a time, on its own scale. Several on one axis is
 * what turns a chart of posts and impressions into a line of impressions and
 * a flat line at nought, which says nothing about posts at all.
 */
export function KpiExplorer({ cards, days, vsLabel }: { cards: KpiCard[]; days: string[]; vsLabel: string }) {
  const t = useTranslations('pageAnalysis');
  const locale = useLocale();
  const plottable = cards.filter((card) => card.series && card.series.length > 1);
  const [selected, setSelected] = useState<string | null>(plottable[0]?.key ?? null);
  const active = cards.find((card) => card.key === selected) ?? null;
  const activeIndex = cards.findIndex((card) => card.key === selected);

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );

  return (
    <section aria-label={t('kpiTitle')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card, index) => {
          const pressable = Boolean(card.series && card.series.length > 1);
          const on = card.key === selected;
          const good =
            card.change !== null && card.upIsGood !== null ? (card.change >= 0) === card.upIsGood : null;
          const display =
            card.value === null ? '—' : typeof card.value === 'number' ? compact(card.value, locale) : card.value;
          const body = (
            <>
              <span className="block text-[13px] font-semibold text-slate-600">{card.label}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xl font-bold text-slate-900 sm:text-2xl">{display}</span>
                {card.change !== null && (
                  <span
                    className={`nums inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      good === null
                        ? 'bg-slate-100 text-slate-700'
                        : good
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                    }`}
                    title={vsLabel}
                  >
                    {card.change >= 0 ? '↑' : '↓'} {Math.abs(card.change)}%
                  </span>
                )}
              </span>
              <span className="mt-2 block h-8">
                {card.series && card.series.length > 1 ? (
                  <MiniLine values={card.series} color={seriesColor(index)} />
                ) : (
                  <span className="block pt-3 text-[11px] text-slate-400">{t('noDaily')}</span>
                )}
              </span>
            </>
          );
          return pressable ? (
            <button
              key={card.key}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected(card.key)}
              className={`card block p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                on ? 'ring-2 ring-brand-500' : ''
              }`}
            >
              {body}
            </button>
          ) : (
            <div key={card.key} className="card p-4">
              {body}
            </div>
          );
        })}
      </div>

      {active && active.series && (
        <div className="card-viz">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{t('perDay', { metric: active.label })}</h3>
            <span className="text-xs text-slate-500">{t('pickCard')}</span>
          </div>
          <div className="mt-3">
            <TimeSeries
              lines={[
                {
                  label: active.label,
                  colorIndex: activeIndex,
                  points: days.map((day, index) => ({ x: `${day}T12:00:00Z`, y: active.series![index] ?? 0 })),
                },
              ]}
              formatX={(iso) => dayFormat.format(new Date(iso))}
            />
          </div>
          {active.note && <p className="mt-2 text-xs text-slate-500">{active.note}</p>}
        </div>
      )}
    </section>
  );
}

/** A card's trend line: the period's shape, filled faintly underneath. */
function MiniLine({ values, color }: { values: number[]; color: string }) {
  const width = 160;
  const height = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => [index * step, height - 3 - ((value - min) / span) * (height - 6)] as const);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
