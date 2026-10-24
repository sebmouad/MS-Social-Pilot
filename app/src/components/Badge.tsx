import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "module";

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Module id; with tone="module" the badge uses that module's color. */
  module?: string;
  /** Solid fill for counts and "new" marks; the default is a soft tint. */
  solid?: boolean;
  className?: string;
};

/**
 * Compact label with optional icon. Meaning must also be in the text (or icon), never color alone.
 * Product statuses keep using StatusChip; Badge is for categories, counts and module tags.
 */
export function Badge({ children, tone = "neutral", icon, module, solid = false, className = "" }: BadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}${solid ? " is-solid" : ""} ${className}`.trim()} data-module={tone === "module" ? module : undefined}>
    {icon && <span className="ui-badge__icon" aria-hidden="true">{icon}</span>}
    <span>{children}</span>
  </span>;
}
