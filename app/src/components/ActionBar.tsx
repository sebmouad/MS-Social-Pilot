import type { ReactNode } from "react";

/** Sticky bar at the bottom of the composer and long forms: status text on the left, actions on the right. Spans the phone width above the safe area. */
export function ActionBar({ status, children, label }: { status?: ReactNode; children: ReactNode; label: string }) {
  return <div className="ui-action-bar" role="group" aria-label={label}>
    <div className="ui-action-bar__status" role="status" aria-live="polite">{status}</div>
    <div className="ui-action-bar__actions">{children}</div>
  </div>;
}
