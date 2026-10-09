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
  currency,
}: {
  title: string;
  description?: string;
  valueLabel: string;
  dateLabel: string;
  points: Array<{ date: string; value: number }>;
  colorIndex: number;
  /** Set for money: the table view writes each value in it. */
  currency?: string;
}) {
  // The app's language, not the browser's: the server renders this first, and
  // a label formatted two ways is a hydration mismatch.
  const locale = useLocale();

  // The dates are Facebook's calendar days for the ad account ("2026-08-01"),
  // not instants, so they are written in UTC — where the stored midnight
  // sits — rather than shifted a day by the reader's or workspace's zone.
  const short = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const long = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  // The table is what a screen reader, or anyone who cannot tell the series
  // colours apart, reads instead of the chart — so it gets the same
  // formatting as everywhere else, not raw ISO dates and bare floats.
  const format = new Intl.NumberFormat(
    locale,
    currency ? { style: 'currency', currency } : { maximumFractionDigits: 2 },
  );

  return (
    <ChartFrame
      title={title}
      description={description}
      table={{
        head: [dateLabel, valueLabel],
        rows: points.map((point) => [long(point.date), format.format(point.value)]),
      }}
    >
      <TimeSeries
        lines={[{ label: valueLabel, colorIndex, points: points.map((point) => ({ x: point.date, y: point.value })) }]}
        formatX={short}
      />
    </ChartFrame>
  );
}
