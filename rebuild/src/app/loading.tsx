export default function Loading() {
  return <main className="route-state" aria-live="polite" aria-busy="true">
    <div className="route-state__mark" aria-hidden="true" />
    <p>Loading your workspace…</p>
  </main>;
}
