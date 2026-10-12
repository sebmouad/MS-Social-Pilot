'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';

export interface HeatCell {
  weekday: number;
  hour: number;
  posts: number;
  avgInteractions: number | null;
  lift: number | null;
}

/**
 * The sequential ramp, lightest to darkest, and the lift each step starts at.
 *
 * Fixed thresholds against the Page's own typical post rather than quantiles of
 * whatever is on screen: "darker is better than usual" has to mean the same
 * thing on every Page and every range, or two Pages side by side would each
 * have a darkest cell whatever their numbers.
 */
const STEPS: Array<{ from: number; color: string; ink: string }> = [
  { from: 0, color: 'var(--viz-seq-100)', ink: 'var(--viz-ink)' },
  { from: 0.6, color: 'var(--viz-seq-250)', ink: 'var(--viz-ink)' },
  { from: 0.9, color: 'var(--viz-seq-400)', ink: '#ffffff' },
  { from: 1.1, color: 'var(--viz-seq-550)', ink: '#ffffff' },
  { from: 1.5, color: 'var(--viz-seq-700)', ink: '#ffffff' },
];

function stepFor(lift: number) {
  return [...STEPS].reverse().find((step) => lift >= step.from) ?? STEPS[0]!;
}

const pad = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/**
 * Day of week against time of day, shaded by how posts there did.
 *
 * A heatmap because the question is two-dimensional — Tuesday evening, not
 * Tuesday or evening — and a grid is the one form that shows both at once.
 * One hue, light to dark, since it is magnitude, not identity. A cell resting
 * on a single post is faded: it is a hint, not a finding, and the tooltip says
 * how many posts are behind each one. The strongest cells carry their figure.
 */
export function TimeHeatmap({
  cells,
  best,
  weekdays,
  blockHours,
  minPosts,
  timeZone,
}: {
  cells: HeatCell[];
  best: HeatCell[];
  /** Localised names, indexed 0 = Sunday. */
  weekdays: string[];
  blockHours: number;
  minPosts: number;
  timeZone: string;
}) {
  const t = useTranslations('pageAnalysis');
  const locale = useLocale();
  const [active, setActive] = useState<HeatCell | null>(null);

  // Monday first: the working week reads left to right, top to bottom.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const hours = [...new Set(cells.map((cell) => cell.hour))].sort((a, b) => a - b);
  const at = (weekday: number, hour: number) =>
    cells.find((cell) => cell.weekday === weekday && cell.hour === hour);
  const isBest = (cell: HeatCell) => best.some((entry) => entry.weekday === cell.weekday && entry.hour === cell.hour);
  const label = (cell: HeatCell) =>
    t('times.cell', { weekday: weekdays[cell.weekday] ?? '', start: pad(cell.hour), end: pad((cell.hour + blockHours) % 24) });

  const hasData = cells.some((cell) => cell.posts > 0);

  return (
    <ChartFrame
      title={t('times.title')}
      description={t('times.hint', { timezone: timeZone })}
      table={{
        head: [t('times.day'), ...hours.map((hour) => pad(hour))],
        rows: order.map((weekday) => [
          weekdays[weekday] ?? '',
          ...hours.map((hour) => {
            const cell = at(weekday, hour);
            return cell && cell.avgInteractions !== null ? `${cell.avgInteractions} (${cell.posts})` : '—';
          }),
        ]),
      }}
    >
      {!hasData ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('times.none')}</p>
      ) : (
        <div className="relative">
          <div className="scroll-x">
            <div
              // Fits a phone without scrolling: eight three-hour columns are
              // thirty-odd pixels each at 390px, which is still a target.
              className="grid min-w-[300px] gap-[2px]"
              style={{ gridTemplateColumns: `2.75rem repeat(${hours.length}, minmax(0, 1fr))` }}
              onPointerLeave={() => setActive(null)}
            >
              <span />
              {hours.map((hour) => (
                <span key={hour} className="nums pb-1 text-center text-[10px] text-slate-500">
                  {String(hour).padStart(2, '0')}
                </span>
              ))}

              {order.map((weekday) => (
                <div key={weekday} className="contents">
                  <span className="truncate pe-2 text-xs leading-8 text-slate-600">{weekdays[weekday]}</span>
                  {hours.map((hour) => {
                    const cell = at(weekday, hour)!;
                    const empty = cell.posts === 0 || cell.lift === null;
                    const step = empty ? null : stepFor(cell.lift!);
                    const strong = !empty && isBest(cell);
                    return (
                      <div
                        key={hour}
                        className="flex h-8 items-center justify-center rounded-[4px] text-[10px] font-semibold"
                        style={{
                          background: step ? step.color : 'var(--viz-plane)',
                          color: step?.ink,
                          opacity: !empty && cell.posts < minPosts ? 0.45 : 1,
                          // The best blocks carry a ring as well as their figure,
                          // so they stand out without depending on the shade.
                          boxShadow: strong ? 'inset 0 0 0 2px var(--viz-ink)' : undefined,
                        }}
                        onPointerEnter={() => setActive(cell)}
                        aria-hidden
                      >
                        {strong ? `${cell.lift}×` : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {active && (
            <div className="pointer-events-none absolute end-0 top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
              <p className="font-medium text-slate-500">{label(active)}</p>
              <p className="nums font-semibold text-slate-900">{t('times.cellDetail', { posts: active.posts })}</p>
              {active.avgInteractions !== null && active.lift !== null && (
                <p className="nums text-slate-600">
                  {t('times.cellLift', { avg: active.avgInteractions.toLocaleString(locale), lift: active.lift })}
                </p>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              {t('times.low')}
              {STEPS.map((step) => (
                <span key={step.from} aria-hidden className="h-3 w-5 rounded-[3px]" style={{ background: step.color }} />
              ))}
              {t('times.high')}
            </span>
            <span className="text-slate-500">{t('times.faded')}</span>
          </div>

          {best.length > 0 && (
            <p className="mt-2 text-xs text-slate-700">
              <span className="font-semibold">{t('times.best')}:</span>{' '}
              {best.map((cell) => `${label(cell)} (${cell.lift}×)`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </ChartFrame>
  );
}
