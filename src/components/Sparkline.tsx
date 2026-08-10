/**
 * A tiny inline trend chart.
 *
 * Plain SVG rather than a charting library: this draws one polyline, and a
 * charting dependency would add far more weight than it earns. Scales to the
 * series' own range, so a flat line means flat, not "no data".
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
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

  const step = width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = values[values.length - 1]! >= values[0]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Trend from ${values[0]} to ${values[values.length - 1]}`}
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={rising ? 'stroke-emerald-500' : 'stroke-orange-500'}
      />
    </svg>
  );
}
