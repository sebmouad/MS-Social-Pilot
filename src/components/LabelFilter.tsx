'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { paletteOf } from '@/lib/palette';

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

/**
 * Narrow a screen to the posts carrying one label. Kept in the address as
 * `label`, beside the sidebar's Pages, so the filters combine and survive a
 * reload.
 */
export function LabelFilter({ labels, active }: { labels: LabelOption[]; active: string | null }) {
  const t = useTranslations('labels');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (labels.length === 0) return null;
  const current = labels.find((label) => label.id === active) ?? null;

  function choose(id: string | null) {
    setOpen(false);
    const params = new URLSearchParams(search.toString());
    params.delete('page');
    if (id) params.set('label', id);
    else params.delete('label');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ${
          current ? `ring-1 ring-inset ${paletteOf(current.color).chip}` : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {current ? (
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${paletteOf(current.color).dot}`} />
        ) : (
          <Icon name="tag" size={16} />
        )}
        <span className="max-w-[10rem] truncate">{current?.name ?? t('allLabels')}</span>
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('filterBy')}
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {[{ id: null, name: t('allLabels'), color: '' }, ...labels].map((label) => (
            <button
              key={label.id ?? 'all'}
              type="button"
              role="option"
              aria-selected={label.id === (current?.id ?? null)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                label.id === (current?.id ?? null) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-800 hover:bg-slate-50'
              }`}
              onClick={() => choose(label.id)}
            >
              {label.id ? (
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${paletteOf(label.color).dot}`} />
              ) : (
                <Icon name="tag" size={15} className="text-slate-500" />
              )}
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
