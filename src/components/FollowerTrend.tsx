'use client';

import { useLocale } from 'next-intl';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { TimeSeries } from '@/components/charts/TimeSeries';

/**
 * Followers gained and lost each day: the "balance" every scheduling tool's
 * audience report leads with, because a total that went up can still hide a
 * week in which the Page lost more people than it found.
 *
 * Gains and losses share one axis on purpose — they are the same unit, and
 * reading one against the other is the point. A client component because the
 * axis formatter is a function.
 */
export function FollowerTrend({
  title,
  description,
  dateLabel,
  gainedLabel,
  lostLabel,
  netLabel,
  points,
}: {
  title: string;
  description: string;
  dateLabel: string;
  gainedLabel: string;
  lostLabel: string;
  netLabel: string;
  points: Array<{ date: string; gained: number; lost: number }>;
}) {
  const locale = useLocale();
  const short = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const long = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <ChartFrame
      title={title}
      description={description}
      table={{
        head: [dateLabel, gainedLabel, lostLabel, netLabel],
        rows: points.map((point) => [long(point.date), point.gained, point.lost, point.gained - point.lost]),
      }}
    >
      <TimeSeries
        lines={[
          { label: gainedLabel, colorIndex: 2, points: points.map((point) => ({ x: point.date, y: point.gained })) },
          { label: lostLabel, colorIndex: 7, points: points.map((point) => ({ x: point.date, y: point.lost })) },
        ]}
        formatX={short}
      />
    </ChartFrame>
  );
}
