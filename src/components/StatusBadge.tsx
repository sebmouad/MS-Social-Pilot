'use client';

import { useTranslations } from 'next-intl';

/**
 * Colour is carried here; the wording comes from the message catalogues so a
 * status reads correctly in every language.
 */

const POST_COLOURS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-violet-50 text-violet-700',
  rejected: 'bg-red-50 text-red-700',
  scheduled: 'bg-blue-50 text-blue-700',
  publishing: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
  partially_failed: 'bg-orange-50 text-orange-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const TARGET_COLOURS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  processing: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
  scheduled_remote: 'bg-indigo-50 text-indigo-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  skipped: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status, kind = 'post' }: { status: string; kind?: 'post' | 'target' }) {
  const t = useTranslations('status');
  const colours = kind === 'post' ? POST_COLOURS : TARGET_COLOURS;
  const className = colours[status] ?? 'bg-slate-100 text-slate-600';

  return <span className={`badge ${className}`}>{t(`${kind}.${status}`)}</span>;
}
