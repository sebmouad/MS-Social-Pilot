import type { ReactNode } from "react";

/**
 * Shared empty and error panel. Say what is missing (or what failed) and offer
 * the next action. Errors are announced; empty states are plain content.
 */
export function EmptyState({ title, children, action, tone = "empty" }: { title: string; children?: ReactNode; action?: ReactNode; tone?: "empty" | "error" }) {
  return <div className={`ui-state${tone === "error" ? " ui-state--error" : ""}`} role={tone === "error" ? "alert" : undefined}>
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>;
}
