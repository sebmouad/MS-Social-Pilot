'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { TimeSeries } from '@/components/charts/TimeSeries';
import { weeklyComplete } from '@/lib/analytics-summary';

const FIGURES = ['reach', 'interactions', 'posts'] as const;
type Figure = (typeof FIGURES)[number];

export type TrendSeries = Record<Figure, Array<number | null>>;

/**
 * One figure for the selection, day by day or week by week, with the
 * comparison window drawn dashed behind it on the same days-into-the-period
 * axis. Both series arrive as props from the server; switching figure or step
 * is local, so it costs no round trip.
 */
export function SummaryTrend({
  days,
  current,
  previous,
  previousLabel,
}: {
  /** yyyy-MM-dd for each day of the window. */
  days: string[];
  current: TrendSeries;
  previous: TrendSeries;
  /** "Previous 30 days" or "Same period last year". */
  previousLabel: string;
}) {
  const t = useTranslations('analyticsSummary');
  const locale = useLocale();
  const [figure, setFigure] = useState<Figure>('interactions');
  const [step, setStep] = useState<'day' | 'week'>('day');

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );

  const xs = step === 'day' ? days : days.filter((_, index) => index % 7 === 0);
  const now = step === 'day' ? current[figure] : weeklyComplete(current[figure]);
  const before = (step === 'day' ? previous[figure] : weeklyComplete(previous[figure])).slice(0, xs.length);

  if (days.length < 2) return null;

  const lines = [
    { label: t('trend.thisPeriod'), colorIndex: 0, points: xs.map((day, index) => ({ x: `${day}T12:00:00Z`, y: now[index] ?? null })) },
    {
      label: previousLabel,
      colorIndex: 1,
      dashed: true,
      points: xs.map((day, index) => ({ x: `${day}T12:00:00Z`, y: before[index] ?? null })),
    },
  ];

  const segmented = <T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    set: (next: T) => void,
    text: (option: T) => string,
  ) => (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={`segmented-item ${value === option ? 'segmented-item-active' : ''}`}
          onClick={() => set(option)}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );

  return (
    <ChartFrame
      title={t('trend.title')}
      description={t(step === 'day' ? 'trend.hintDay' : 'trend.hintWeek')}
      legend={[
        { label: t('trend.thisPeriod'), colorIndex: 0, mark: 'line' },
        { label: previousLabel, colorIndex: 1, mark: 'line' },
      ]}
      table={{
        head: [t(step === 'day' ? 'trend.day' : 'trend.week'), t('trend.thisPeriod'), previousLabel],
        rows: xs.map((day, index) => [dayFormat.format(new Date(`${day}T12:00:00Z`)), now[index] ?? '—', before[index] ?? '—']),
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {segmented(t('trend.figure'), FIGURES, figure, setFigure, (option) => t(`trend.figures.${option}`))}
        {segmented(t('trend.step'), ['day', 'week'] as const, step, setStep, (option) => t(`trend.steps.${option}`))}
      </div>
      <TimeSeries lines={lines} formatX={(iso) => dayFormat.format(new Date(iso))} />
      {figure === 'reach' && <p className="mt-2 text-xs text-slate-500">{t('trend.reachNote')}</p>}
    </ChartFrame>
  );
}
