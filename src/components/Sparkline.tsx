import { VIZ, seriesColor } from '@/lib/viz';

/**
 * A tiny inline trend chart.
 *
 * Plain SVG rather than a charting library: this draws one polyline, and a
 * charting dependency would add far more weight than it earns. Scales to the
 * series' own range, so a flat line means flat, not "no data".
 *
 * Deliberately one colour regardless of direction. Colouring the whole line
 * green or orange by whether it ended higher borrows the status palette to say
 * something the shape already says, and "up" is not good for every metric a
 * sparkline appears next to — unfollows and negative feedback among them. The
 * accompanying delta carries the judgement, with an arrow beside it.
 */
export function Sparkline({
  values,
  width = 96,
  height = 26,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series would divide by zero; give it a mid-height line instead.
  const range = max - min || 1;

  // Inset so the 2px stroke and the end dot are not clipped by the viewBox.
  const inset = 3;
  const step = (width - inset * 2) / (values.length - 1);

  const point = (value: number, index: number) => ({
    x: inset + index * step,
    y: inset + (height - inset * 2) - ((value - min) / range) * (height - inset * 2),
  });

  const path = values
    .map((value, index) => {
      const { x, y } = point(value, index);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const last = point(values[values.length - 1]!, values.length - 1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend from ${values[0]} to ${values[values.length - 1]}`}
    >
      <path
        d={path}
        fill="none"
        stroke={VIZ.muted}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* The current period in the accent, the rest as context. */}
      <circle cx={last.x} cy={last.y} r={2.5} fill={seriesColor(0)} />
    </svg>
  );
}
