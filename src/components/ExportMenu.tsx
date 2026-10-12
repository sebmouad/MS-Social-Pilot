'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
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
 *
 * A menu in the ARIA sense: it says it opens one, takes focus to its first
 * entry, moves with the arrow keys, and closes on Escape or a click anywhere
 * else — the last two being what anyone expects of a dropdown, and what this
 * one did not do, so it stayed open over the chart until clicked again.
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
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const items = () => [...(container.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;

    items()[0]?.focus();

    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }

    const entries = items();
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      entries[(to + entries.length) % entries.length]?.focus();
    };

    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  }

  function hrefFor(kind: string): string {
    const params = new URLSearchParams({ kind, from, to });
    // Instagram and ads are workspace-wide; scoping them to one Page would
    // silently return nothing.
    if (!kind.startsWith('instagram') && kind !== 'ads') params.set('targetId', targetId);
    return `/api/analytics/export?${params.toString()}`;
  }

  return (
    <div ref={container} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {tCommon('export')}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={tCommon('export')}
          className="absolute end-0 z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {KINDS.map((kind) => (
            <a
              key={kind}
              role="menuitem"
              href={hrefFor(kind)}
              className="block rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
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
