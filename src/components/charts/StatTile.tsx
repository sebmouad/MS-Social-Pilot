import { useLocale } from 'next-intl';

import { VIZ, compact } from '@/lib/viz';
import { InfoTip } from '@/components/InfoTip';
import { Sparkline } from '@/components/Sparkline';

/**
 * Label, value, optional delta, optional trend.
 *
 * A single current number is a stat tile, not a one-bar bar chart. The value
 * uses the font's default proportional figures — `tabular-nums` gives every
 * digit the width of a zero, which makes a number like 121 look loose at this
 * size. Tabular figures belong in columns that align vertically, not here.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  /**
   * False when down is the good direction (unfollows, negative feedback); null
   * when neither is, as for ad spend — the change is shown, uncoloured.
   */
  upIsGood = true,
  trend,
  hero = false,
  definition,
}: {
  /** What the figure counts, behind an ⓘ. */
  definition?: string;
  label: string;
  value: number | string | null;
  /** Percentage change against a named period. */
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean | null;
  trend?: number[];
  hero?: boolean;
}) {
  // Rendered both from server components and inside client ones; useLocale
  // answers the same in both, where the request's language slot does not.
  const locale = useLocale();
  const display =
    value === null ? '—' : typeof value === 'number' ? compact(value, locale) : value;

  const good =
    delta !== null && delta !== undefined && upIsGood !== null ? (delta >= 0) === upIsGood : null;

  return (
    <div className="card relative p-4">
      <p className="flex items-center text-[13px] font-semibold text-slate-600">
        {label}
        {definition && <InfoTip text={definition} />}
      </p>

      <p
        className={`mt-1 font-semibold text-slate-900 ${hero ? 'text-4xl sm:text-5xl' : 'text-xl sm:text-2xl'}`}
        title={typeof value === 'number' ? value.toLocaleString(locale) : undefined}
      >
        {display}
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        {delta !== null && delta !== undefined ? (
          <p
            className="text-xs font-medium"
            style={{ color: good === null ? VIZ.inkSecondary : good ? VIZ.goodText : VIZ.critical }}
          >
            {/* The arrow is the second channel: the direction never rests on
                colour alone. */}
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
            {deltaLabel && <span className="ms-1 font-normal text-slate-500">{deltaLabel}</span>}
          </p>
        ) : (
          <span />
        )}

        {trend && trend.length > 1 && <Sparkline values={trend} width={72} height={22} />}
      </div>
    </div>
  );
}
