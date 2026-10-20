const WIDTHS = ["92%", "78%", "86%", "64%", "72%"];

/**
 * Placeholder lines that keep the final layout's footprint while data loads.
 * `label` is the only text assistive technology receives, so pass localized copy.
 */
export function Skeleton({ lines = 3, label = "Loading…" }: { lines?: number; label?: string }) {
  return <div role="status" aria-busy="true" style={{ display: "grid", gap: "var(--space-3)" }}>
    <span className="ui-visually-hidden">{label}</span>
    {Array.from({ length: lines }, (_, index) => <span key={index} className="ui-skeleton" aria-hidden="true" style={{ width: WIDTHS[index % WIDTHS.length] }} />)}
  </div>;
}
