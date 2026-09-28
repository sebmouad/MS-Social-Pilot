'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { VIZ, niceTicks, seriesColor } from '@/lib/viz';

export interface CadenceColumn {
  /** Already formatted for display: "15 Jun". */
  label: string;
  posts: number;
}

const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 28 };

/**
 * Posts per week as columns, with the target as a dashed line.
 *
 * Columns rather than a line: a week is a bucket, not a point on a continuous
 * curve, and an empty week has to read as a gap — a line would draw straight
 * through it. An empty week still gets a short baseline tick, so a zero is
 * something on the chart rather than nothing.
 */
export function CadenceChart({
  weeks,
  target,
  perWeek,
}: {
  weeks: CadenceColumn[];
  target: number;
  perWeek: number;
}) {
  const t = useTranslations('pageAnalysis');
  const [active, setActive] = useState<number | null>(null);

  // Drawn at the card's real width rather than scaled from a fixed viewBox:
  // scaling a 600-wide drawing onto a phone shrank the axis text to five
  // pixels.
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(target, ...weeks.map((week) => week.posts));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] ?? max;

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / Math.max(1, weeks.length);
  const barWidth = Math.max(4, Math.min(36, slot - 4));
  const yAt = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;

  return (
    <ChartFrame
      title={t('cadence.title')}
      description={t('cadence.hint', { perWeek, target })}
      table={{
        head: [t('cadence.title'), t('formats.posts')],
        rows: weeks.map((week) => [t('cadence.week', { date: week.label }), week.posts]),
      }}
    >
      <div ref={boxRef} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block touch-pan-y"
          role="img"
          aria-label={t('cadence.hint', { perWeek, target })}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yAt(tick)} y2={yAt(tick)} stroke={VIZ.grid} strokeWidth={1} />
              <text x={PAD.left - 6} y={yAt(tick) + 3} textAnchor="end" fontSize={10} fill={VIZ.inkMuted}>
                {tick}
              </text>
            </g>
          ))}

          {weeks.map((week, index) => {
            const x = PAD.left + index * slot + (slot - barWidth) / 2;
            const y = yAt(week.posts);
            const height = Math.max(0, PAD.top + plotHeight - y);
            const dimmed = active !== null && active !== index;
            return (
              <g key={week.label} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)}>
                {/* The hit target is the whole slot, not the column: a one-post
                    week is a sliver nobody can land a pointer on. */}
                <rect x={PAD.left + index * slot} y={PAD.top} width={slot} height={plotHeight} fill="transparent" />
                {week.posts > 0 ? (
                  <path
                    // 4px rounded at the data end, square on the baseline.
                    d={`M${x},${y + height} V${y + Math.min(4, height)} Q${x},${y} ${x + Math.min(4, barWidth / 2)},${y} H${x + barWidth - Math.min(4, barWidth / 2)} Q${x + barWidth},${y} ${x + barWidth},${y + Math.min(4, height)} V${y + height} Z`}
                    fill={seriesColor(0)}
                    opacity={dimmed ? 0.45 : 1}
                  />
                ) : (
                  <rect x={x} y={PAD.top + plotHeight - 2} width={barWidth} height={2} fill={VIZ.muted} />
                )}
              </g>
            );
          })}

          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={yAt(target)}
            y2={yAt(target)}
            stroke={VIZ.inkSecondary}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={width - PAD.right} y={yAt(target) - 4} textAnchor="end" fontSize={10} fill={VIZ.inkSecondary}>
            {t('cadence.target')}
          </text>

          {weeks.length > 0 &&
            [0, weeks.length - 1].map((index) => (
              <text
                key={index}
                x={PAD.left + index * slot + slot / 2}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? 'start' : 'end'}
                fontSize={10}
                fill={VIZ.inkMuted}
              >
                {weeks[index]!.label}
              </text>
            ))}
        </svg>

        {active !== null && weeks[active] && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(70, Math.max(0, ((active + 0.5) / weeks.length) * 100 - 10))}%` }}
          >
            <p className="nums font-semibold text-slate-900">{t('cadence.posts', { count: weeks[active]!.posts })}</p>
            <p className="text-slate-500">{t('cadence.week', { date: weeks[active]!.label })}</p>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
