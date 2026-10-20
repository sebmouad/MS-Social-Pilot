export default function Loading() {
  return <div className="route-state" role="status" aria-busy="true">
    <div className="route-state__mark" aria-hidden="true" />
    <p>Loading your workspace…</p>
  </div>;
}
