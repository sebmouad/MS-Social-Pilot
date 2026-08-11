'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { VIZ, seriesColor } from '@/lib/viz';

export interface BarDatum {
  key: string;
  value: number;
}

/**
 * A horizontal bar list for a breakdown map.
 *
 * Horizontal because the categories are long-named — "male.25-34", country
 * codes, click types — and vertical columns would either clip those labels or
 * rotate them.
 *
 * One series, one colour. Shading each bar darker-where-bigger would double
 * encode length as hue: it spends the only free channel restating what the bar
 * already shows, and reads as an ordered scale on categories that have no order.
 *
 * Bars are scaled against the largest value, not against a total. The job is
 * comparing entries with each other, and a total is often meaningless anyway —
 * a person is in one country but several age bands across different metrics.
 */
export function BarList({
  data,
  limit = 8,
  colorIndex = 0,
  formatKey,
  formatValue,
}: {
  data: Record<string, number>;
  limit?: number;
  colorIndex?: number;
  formatKey?: (key: string) => string;
  formatValue?: (value: number) => string;
}) {
  const t = useTranslations('analytics');
  const [expanded, setExpanded] = useState(false);

  const rows: BarDatum[] = Object.entries(data)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{t('noBreakdown')}</p>;
  }

  const largest = rows[0]!.value;
  const shown = expanded ? rows : rows.slice(0, limit);
  const format = formatValue ?? ((value: number) => value.toLocaleString());

  return (
    <div>
      <ul className="space-y-2">
        {shown.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-slate-600" title={row.key}>
              {formatKey ? formatKey(row.key) : row.key}
            </span>

            {/* The track is the surface, not a filled block: the bar is the
                only thing carrying data weight. 4px rounded at the data end,
                square where it meets the baseline. */}
            <span className="h-2.5 w-full overflow-hidden rounded-sm" style={{ background: VIZ.grid }}>
              <span
                className="block h-full"
                style={{
                  width: `${Math.max(1.5, (row.value / largest) * 100)}%`,
                  background: seriesColor(colorIndex),
                  borderTopRightRadius: 4,
                  borderBottomRightRadius: 4,
                }}
              />
            </span>

            {/* The value rides every bar rather than living only in a tooltip:
                this palette's lighter hues need a readable number beside them,
                and a bar list is short enough that labelling all of it is
                still calm. */}
            <span className="nums w-16 text-right text-xs font-medium text-slate-700">
              {format(row.value)}
            </span>
          </li>
        ))}
      </ul>

      {rows.length > limit && (
        <button
          type="button"
          className="btn-ghost mt-2 text-xs"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('showLess') : t('andMore', { count: rows.length - limit })}
        </button>
      )}
    </div>
  );
}
