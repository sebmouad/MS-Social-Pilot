'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

import { VIZ, compact, niceTicks, seriesColor } from '@/lib/viz';

export interface TimeSeriesPoint {
  /** ISO timestamp. */
  x: string;
  y: number;
}

export interface TimeSeriesLine {
  label: string;
  points: TimeSeriesPoint[];
  /** Position in the categorical order. Follows the entity, not its rank. */
  colorIndex: number;
  /** Drawn dashed: a reference such as the previous period. */
  dashed?: boolean;
}

/** A dated mark on the chart (NEXT_PHASES H13): "Campaign started". */
export interface TimeSeriesNote {
  /** yyyy-MM-dd, matched against the start of each point's `x`. */
  day: string;
  label: string;
  /** A plain colour for the mark. */
  color: string;
}

const HEIGHT = 220;
/** Room for the y ticks on the left and the end label on the right. */
const PAD = { top: 12, right: 56, bottom: 26, left: 44 };

/**
 * A line chart with a crosshair readout.
 *
 * Deliberately hand-drawn SVG rather than a charting library: this is one
 * polyline per series with a hairline grid, and every library that draws it
 * brings a bundle far larger than the chart.
 *
 * The reader aims at a *date*, never at a 2px line — the crosshair snaps to the
 * nearest x position and the tooltip then lists every series there, so no value
 * requires landing on a stroke. Keyboard focus shows the same readout, and the
 * frame's table view carries every number without any pointer at all.
 */
export function TimeSeries({
  lines,
  /** One series is often context for another; grey it rather than colour it. */
  emphasis,
  formatX,
  notes = [],
}: {
  lines: TimeSeriesLine[];
  emphasis?: number;
  formatX: (iso: string) => string;
  notes?: TimeSeriesNote[];
}) {
  const [active, setActive] = useState<number | null>(null);
  // The app's language on the server and in the browser alike, so the axis
  // renders the same number both times rather than failing hydration.
  const locale = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * The plot is drawn at the container's real width.
   *
   * A viewBox scaled with `w-full` would either letterbox the plot inside its
   * own card or, with `preserveAspectRatio="none"`, stretch the strokes and
   * labels with it. Measuring instead keeps 2px meaning 2px at every width.
   */
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Every series shares one x scale, keyed by position rather than by date, so
  // a gap in one series does not shift the others.
  const length = Math.max(...lines.map((line) => line.points.length), 0);

  const [max, whole] = useMemo(() => {
    const values = lines.flatMap((line) => line.points.map((point) => point.y));
    return [values.length > 0 ? Math.max(...values) : 0, values.every((value) => Number.isInteger(value))] as const;
  }, [lines]);

  if (length < 2) {
    return <div className="py-8 text-center text-xs text-slate-500">—</div>;
  }

  const ticks = niceTicks(max, 4, whole);
  const top = ticks[ticks.length - 1] || 1;

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const xAt = (index: number) => PAD.left + (index / (length - 1)) * plotWidth;
  const yAt = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;

  /** Snap the pointer to the nearest data position. */
  function track(event: React.PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;

    const ratio = ((event.clientX - box.left) / box.width) * width;
    const index = Math.round(((ratio - PAD.left) / plotWidth) * (length - 1));
    setActive(Math.min(length - 1, Math.max(0, index)));
  }

  const reference = lines[0]!;
  const activePoint = active !== null ? reference.points[active] : undefined;
  // Each note at the position of its day; one outside the window is not drawn.
  const placed = notes.flatMap((note) => {
    const index = reference.points.findIndex((point) => point.x.startsWith(note.day));
    return index === -1 ? [] : [{ ...note, index }];
  });
  const activeNotes = placed.filter((note) => note.index === active);

  return (
    <div ref={boxRef} className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        // Until the box is measured the width is a guess; on a phone the guess
        // is wider than the screen. Scaled down to fit meanwhile, and a no-op
        // once the real width is in.
        className="h-auto max-w-full touch-pan-y"
        role="img"
        aria-label={lines.map((line) => line.label).join(', ')}
        tabIndex={0}
        onPointerMove={track}
        onPointerLeave={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') setActive((value) => Math.min(length - 1, (value ?? -1) + 1));
          if (event.key === 'ArrowLeft') setActive((value) => Math.max(0, (value ?? length) - 1));
          if (event.key === 'Escape') setActive(null);
        }}
      >
        {/* Gridlines: solid hairlines one step off the surface. Dashes would
            read as a threshold when this is only a grid. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke={tick === 0 ? VIZ.axis : VIZ.grid}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yAt(tick) + 4}
              textAnchor="end"
              fontSize={10}
              fill={VIZ.inkMuted}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {compact(tick, locale)}
            </text>
          </g>
        ))}

        {/* First and last x only: a tick under every point is unreadable on a
            phone and the crosshair already names the date being read. */}
        {[0, length - 1].map((index) => (
          <text
            key={index}
            x={xAt(index)}
            y={HEIGHT - 8}
            textAnchor={index === 0 ? 'start' : 'end'}
            fontSize={10}
            fill={VIZ.inkMuted}
          >
            {formatX(reference.points[index]?.x ?? '')}
          </text>
        ))}

        {/* Notes: a thin coloured rule with a flag at the top. Dashed, so it
            reads as a marker and never as data. */}
        {placed.map((note, position) => (
          <g key={`${note.day}-${position}`} aria-hidden>
            <line
              x1={xAt(note.index)}
              x2={xAt(note.index)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              stroke={note.color}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <circle cx={xAt(note.index)} cy={PAD.top} r={4} fill={note.color} stroke={VIZ.surface} strokeWidth={1.5} />
          </g>
        ))}

        {active !== null && (
          <line
            x1={xAt(active)}
            x2={xAt(active)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
            stroke={VIZ.axis}
            strokeWidth={1}
          />
        )}

        {lines.map((line, index) => {
          const dimmed = emphasis !== undefined && emphasis !== index;
          const stroke = dimmed ? VIZ.muted : seriesColor(line.colorIndex);

          const path = line.points
            .map((point, position) => `${position === 0 ? 'M' : 'L'}${xAt(position)},${yAt(point.y)}`)
            .join(' ');

          const last = line.points[line.points.length - 1];

          return (
            <g key={line.label}>
              {/* A single series gets a wash under it; several would muddy. */}
              {lines.length === 1 && (
                <path
                  d={`${path} L${xAt(line.points.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`}
                  fill={stroke}
                  opacity={0.1}
                />
              )}

              <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={line.dashed ? '5 4' : undefined} />

              {last && !dimmed && (
                <>
                  {/* The end dot carries a surface ring so it stays legible
                      where two series cross. */}
                  <circle
                    cx={xAt(line.points.length - 1)}
                    cy={yAt(last.y)}
                    r={4}
                    fill={stroke}
                    stroke={VIZ.surface}
                    strokeWidth={2}
                  />
                  {/* Label the end only. A number on every point goes unread. */}
                  <text
                    x={xAt(line.points.length - 1) + 8}
                    y={yAt(last.y) + 4}
                    fontSize={11}
                    fontWeight={600}
                    fill={VIZ.ink}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {compact(last.y, locale)}
                  </text>
                </>
              )}

              {active !== null && line.points[active] && (
                <circle
                  cx={xAt(active)}
                  cy={yAt(line.points[active]!.y)}
                  r={4}
                  fill={stroke}
                  stroke={VIZ.surface}
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* The readout: value first, series name second — the reader already has
          the series and wants the number. */}
      {active !== null && activePoint && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${Math.min(72, (active / (length - 1)) * 100)}%`,
          }}
        >
          <p className="font-medium text-slate-500">{formatX(activePoint.x)}</p>
          <ul className="mt-1 space-y-0.5">
            {lines.map((line) => (
              <li key={line.label} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: seriesColor(line.colorIndex) }}
                />
                <span className="nums font-semibold text-slate-900">
                  {(line.points[active]?.y ?? 0).toLocaleString(locale)}
                </span>
                <span className="text-slate-500">{line.label}</span>
              </li>
            ))}
          </ul>
          {activeNotes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
              {activeNotes.map((note, position) => (
                <li key={position} className="flex items-center gap-2 text-slate-700">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: note.color }} />
                  {note.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
