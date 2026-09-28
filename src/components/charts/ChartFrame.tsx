'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { seriesColor } from '@/lib/viz';

export interface LegendEntry {
  label: string;
  /** Index into the categorical order — the entity's colour, not its rank. */
  colorIndex: number;
  /** Lines get a stroke key, fills get a swatch, so the key mirrors the mark. */
  mark?: 'line' | 'fill';
}

/**
 * The frame every chart sits in: title, legend, and a table view.
 *
 * The table view is not a nicety. Three of the eight categorical hues sit below
 * 3:1 against white, which is allowed only with relief — a WCAG-clean way to
 * read every value that does not depend on telling colours apart or on hovering.
 * That is this table. It is also what keeps a tooltip enhancing rather than
 * gating: nothing is reachable by hover alone.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  action,
  children,
}: {
  title: string;
  description?: string;
  /** Present for two or more series; a single series is named by the title. */
  legend?: LegendEntry[];
  /** Header row plus body rows, already formatted for display. */
  table?: { head: string[]; rows: Array<Array<string | number>> };
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="card-viz">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {table && (
            <button
              type="button"
              className="btn-ghost text-xs"
              aria-expanded={showTable}
              aria-controls={tableId}
              onClick={() => setShowTable((value) => !value)}
            >
              {showTable ? t('showChart') : t('showTable')}
            </button>
          )}
        </div>
      </div>

      {legend && legend.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                aria-hidden
                className="shrink-0 rounded-full"
                style={{
                  background: seriesColor(entry.colorIndex),
                  width: entry.mark === 'line' ? 14 : 10,
                  height: entry.mark === 'line' ? 2 : 10,
                }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {showTable && table ? (
          <div id={tableId} className="scroll-x">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {table.head.map((heading, index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`pb-2 ${index === 0 ? '' : 'text-right'}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={`py-1.5 ${
                          cellIndex === 0 ? 'text-slate-700' : 'nums text-right text-slate-600'
                        }`}
                      >
                        {typeof cell === 'number' ? cell.toLocaleString(locale) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
