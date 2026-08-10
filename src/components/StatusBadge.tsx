const POST_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-50 text-blue-700' },
  publishing: { label: 'Publishing', className: 'bg-amber-50 text-amber-700' },
  published: { label: 'Published', className: 'bg-emerald-50 text-emerald-700' },
  partially_failed: { label: 'Partly failed', className: 'bg-orange-50 text-orange-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500' },
};

const TARGET_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Waiting', className: 'bg-slate-100 text-slate-600' },
  processing: { label: 'Publishing', className: 'bg-amber-50 text-amber-700' },
  published: { label: 'Published', className: 'bg-emerald-50 text-emerald-700' },
  scheduled_remote: { label: 'Scheduled on Facebook', className: 'bg-indigo-50 text-indigo-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500' },
  skipped: { label: 'Skipped', className: 'bg-slate-100 text-slate-500' },
};

export function StatusBadge({ status, kind = 'post' }: { status: string; kind?: 'post' | 'target' }) {
  const styles = kind === 'post' ? POST_STYLES : TARGET_STYLES;
  const style = styles[status] ?? { label: status, className: 'bg-slate-100 text-slate-600' };
  return <span className={`badge ${style.className}`}>{style.label}</span>;
}
