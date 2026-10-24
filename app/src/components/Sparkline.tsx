'use client';
import { useId } from 'react';

export interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  label?: string;
}

/**
 * Compact SVG sparkline chart with smooth bezier path and subtle area fill.
 * Ideal for inline KPI tables, Top Posts, and Ads drilldowns.
 */
export function Sparkline({
  data,
  width = 56,
  height = 20,
  color = 'var(--accent)',
  className = '',
  label,
}: SparklineProps) {
  const gradientId = useId();
  if (!data || data.length < 2) {
    return <span className={`ui-sparkline ui-sparkline--empty ${className}`} style={{ width, height, display: 'inline-block' }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * innerWidth;
    const y = padding + innerHeight - ((val - min) / range) * innerHeight;
    return { x, y };
  });

  // Construct SVG path
  const pathD = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const prev = points[i - 1]!;
    const cx1 = (prev.x + point.x) / 2;
    const cy1 = prev.y;
    const cx2 = (prev.x + point.x) / 2;
    const cy2 = point.y;
    return `${acc} C ${cx1.toFixed(1)},${cy1.toFixed(1)} ${cx2.toFixed(1)},${cy2.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, '');

  const firstX = points[0]!.x.toFixed(1);
  const lastX = points[points.length - 1]!.x.toFixed(1);
  const baselineY = (height - padding).toFixed(1);
  const areaD = `${pathD} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;

  return (
    <svg
      className={`ui-sparkline ${className}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `Trend: ${data.join(', ')}`}
      style={{ color }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path className="ui-sparkline__fill" d={areaD} fill={`url(#${gradientId})`} />
      <path className="ui-sparkline__path" d={pathD} stroke="currentColor" />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1]!.x.toFixed(1)}
          cy={points[points.length - 1]!.y.toFixed(1)}
          r="2"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
