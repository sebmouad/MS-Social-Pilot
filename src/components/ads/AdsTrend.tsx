'use client';

import { useLocale } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { TimeSeries } from '@/components/charts/TimeSeries';

/**
 * One daily figure over the period, in its own frame.
 *
 * Spend and clicks are drawn as two charts, never one with two scales: a
 * second y-axis lets whoever drew it make the lines cross wherever they like,
 * and the reader cannot tell which axis a point belongs to.
 *
 * A client component because the axis formatter is a function, and a function
 * cannot be handed across from a server component.
 */
export function AdsTrend({
  title,
  description,
  valueLabel,
  dateLabel,
  points,
  colorIndex,
}: {
  title: string;
  description?: string;
  valueLabel: string;
  dateLabel: string;
  points: Array<{ date: string; value: number }>;
  colorIndex: number;
}) {
  // The app's language, not the browser's: the server renders this first, and
  // a label formatted two ways is a hydration mismatch.
  const locale = useLocale();
  const short = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <ChartFrame
      title={title}
      description={description}
      table={{ head: [dateLabel, valueLabel], rows: points.map((point) => [point.date, point.value]) }}
    >
      <TimeSeries
        lines={[{ label: valueLabel, colorIndex, points: points.map((point) => ({ x: point.date, y: point.value })) }]}
        formatX={short}
      />
    </ChartFrame>
  );
}
