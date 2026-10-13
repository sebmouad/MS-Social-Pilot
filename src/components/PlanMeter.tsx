/**
 * "13 of 15 used", as a thin bar: what the plan allows, on the screen where
 * the allowance is spent. Shown only when the plan has a limit.
 */
export function PlanMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const full = used >= limit;
  return (
    <div className="max-w-sm space-y-1" role="group" aria-label={label}>
      <p className={`text-sm ${full ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{label}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
      </div>
    </div>
  );
}
