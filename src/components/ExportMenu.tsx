'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const KINDS = [
  'posts',
  'page',
  'external',
  'comments',
  'reviews',
  'videos',
  'instagram',
  'instagram_media',
  'ads',
] as const;

/**
 * CSV downloads for every part of the catalogue.
 *
 * Plain links rather than a fetch-and-blob dance: the endpoint already sets
 * `content-disposition`, so the browser's own download handling is both simpler
 * and better behaved than anything reimplemented here.
 */
export function ExportMenu({
  targetId,
  from,
  to,
}: {
  targetId: string;
  from: string;
  to: string;
}) {
  const t = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  function hrefFor(kind: string): string {
    const params = new URLSearchParams({ kind, from, to });
    // Instagram and ads are workspace-wide; scoping them to one Page would
    // silently return nothing.
    if (!kind.startsWith('instagram') && kind !== 'ads') params.set('targetId', targetId);
    return `/api/analytics/export?${params.toString()}`;
  }

  return (
    <div className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((value) => !value)}>
        {tCommon('export')}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {KINDS.map((kind) => (
            <a
              key={kind}
              href={hrefFor(kind)}
              className="block rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              {t(`export_${kind}`)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
