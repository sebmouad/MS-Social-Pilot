import { VIZ, compact } from '@/lib/viz';
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
  /** False when down is the good direction (unfollows, negative feedback). */
  upIsGood = true,
  trend,
  hero = false,
}: {
  label: string;
  value: number | string | null;
  /** Percentage change against a named period. */
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  trend?: number[];
  hero?: boolean;
}) {
  const display =
    value === null ? '—' : typeof value === 'number' ? compact(value) : value;

  const good = delta !== null && delta !== undefined ? (delta >= 0) === upIsGood : null;

  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>

      <p
        className={`mt-1 font-semibold text-slate-900 ${hero ? 'text-4xl sm:text-5xl' : 'text-xl sm:text-2xl'}`}
        title={typeof value === 'number' ? value.toLocaleString() : undefined}
      >
        {display}
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        {delta !== null && delta !== undefined ? (
          <p
            className="text-xs font-medium"
            style={{ color: good ? VIZ.goodText : VIZ.critical }}
          >
            {/* The arrow is the second channel: the direction never rests on
                colour alone. */}
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
            {deltaLabel && <span className="ml-1 font-normal text-slate-500">{deltaLabel}</span>}
          </p>
        ) : (
          <span />
        )}

        {trend && trend.length > 1 && <Sparkline values={trend} width={72} height={22} />}
      </div>
    </div>
  );
}
