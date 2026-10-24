'use client';
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from '@tabler/icons-react';

export interface DeltaBadgeProps {
  value: number;
  suffix?: string;
  precision?: number;
  showIcon?: boolean;
  invert?: boolean;
  className?: string;
}

/**
 * Period-over-period delta badge formatted with tabular numerals and semantic color.
 * (e.g. `+18.4% ▲` in green tint, `-3.1% ▼` in rose tint).
 */
export function DeltaBadge({
  value,
  suffix = '%',
  precision = 1,
  showIcon = true,
  invert = false,
  className = '',
}: DeltaBadgeProps) {
  const isZero = Math.abs(value) < 0.001;
  const isPositive = value > 0;
  const isUp = invert ? !isPositive : isPositive;

  const tone = isZero ? 'neutral' : isUp ? 'up' : 'down';
  const prefix = isPositive ? '+' : '';
  const formatted = `${prefix}${value.toFixed(precision)}${suffix}`;

  return (
    <span className={`ui-delta-badge ui-delta-badge--${tone} ${className}`}>
      {showIcon && (
        isZero ? (
          <IconMinus size={11} aria-hidden="true" strokeWidth={2.5} />
        ) : isPositive ? (
          <IconArrowUpRight size={11} aria-hidden="true" strokeWidth={2.5} />
        ) : (
          <IconArrowDownRight size={11} aria-hidden="true" strokeWidth={2.5} />
        )
      )}
      <span>{formatted}</span>
    </span>
  );
}
