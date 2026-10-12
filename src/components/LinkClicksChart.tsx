'use client';

import { useLocale } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { TimeSeries } from '@/components/charts/TimeSeries';

/** Short-link clicks per day (G14). A client component because the axis formatter is a function. */
export function LinkClicksChart({
  title,
  dateLabel,
  clicksLabel,
  points,
}: {
  title: string;
  dateLabel: string;
  clicksLabel: string;
  points: Array<{ day: string; clicks: number }>;
}) {
  const locale = useLocale();
  const format = (iso: string, year: boolean) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });

  return (
    <ChartFrame
      title={title}
      table={{ head: [dateLabel, clicksLabel], rows: points.map((point) => [format(point.day, true), point.clicks]) }}
    >
      <TimeSeries
        lines={[{ label: clicksLabel, colorIndex: 0, points: points.map((point) => ({ x: point.day, y: point.clicks })) }]}
        formatX={(iso) => format(iso, false)}
      />
    </ChartFrame>
  );
}
