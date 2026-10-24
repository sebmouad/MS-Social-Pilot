import type { ReactNode } from "react";

/**
 * Shared empty and error panel. Say what is missing (or what failed) and offer
 * the next action. Errors are announced; empty states are plain content.
 * `icon` adds a tinted glyph chip above the title (use a Tabler icon).
 */
export function EmptyState({ title, children, action, tone = "empty", icon }: { title: string; children?: ReactNode; action?: ReactNode; tone?: "empty" | "error"; icon?: ReactNode }) {
  return <div className={`ui-state${tone === "error" ? " ui-state--error" : ""}`} role={tone === "error" ? "alert" : undefined}>
    {icon && <span className="ui-state__icon" aria-hidden="true">{icon}</span>}
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>;
}
