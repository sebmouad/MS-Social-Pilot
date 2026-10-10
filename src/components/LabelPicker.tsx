'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { PALETTE_KEYS, paletteOf } from '@/lib/palette';

export interface LabelOption {
  id: string;
  name: string;
  color: string;
}

/**
 * Tag a post: the chips it carries, and a menu to add more or make a new one
 * by typing its name — the way a label is invented in practice, halfway
 * through writing the post it is for.
 */
export function LabelPicker({
  labels: initial,
  selected,
  onChange,
}: {
  labels: LabelOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('labels');
  const [labels, setLabels] = useState(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const chosen = labels.filter((label) => selected.includes(label.id));
  const needle = query.trim().toLowerCase();
  const matches = labels.filter((label) => label.name.toLowerCase().includes(needle));
  const exact = labels.some((label) => label.name.toLowerCase() === needle);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);

  async function create() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The next colour round the palette, so new labels are told apart.
        body: JSON.stringify({ name, color: PALETTE_KEYS[labels.length % PALETTE_KEYS.length] }),
      });
      const body = (await response.json().catch(() => ({}))) as { label?: LabelOption; error?: string };
      if (!response.ok || !body.label) {
        setError(body.error ?? t('createFailed'));
        return;
      }
      setLabels((current) => [...current, body.label!].sort((a, b) => a.name.localeCompare(b.name)));
      onChange([...selected, body.label.id]);
      setQuery('');
    } catch {
      setError(t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {chosen.map((label) => (
          <span
            key={label.id}
            className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-semibold ring-1 ring-inset ${paletteOf(label.color).chip}`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${paletteOf(label.color).dot}`} />
            {label.name}
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10"
              aria-label={t('remove', { label: label.name })}
              onClick={() => toggle(label.id)}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="tag" size={13} />
          {chosen.length ? t('addMore') : t('add')}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              ref={input}
              className="input py-1.5 text-sm"
              placeholder={t('searchOrCreate')}
              value={query}
              maxLength={40}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (needle && !exact) void create();
                  else if (matches[0]) toggle(matches[0].id);
                }
              }}
            />
          </div>
          <ul role="listbox" aria-multiselectable aria-label={t('title')} className="max-h-56 overflow-y-auto py-1">
            {matches.map((label) => {
              const on = selected.includes(label.id);
              return (
                <li key={label.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                    onClick={() => toggle(label.id)}
                  >
                    <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${paletteOf(label.color).dot}`} />
                    <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    {on && <Icon name="check" size={15} className="text-brand-600" />}
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && !needle && <li className="px-3 py-2 text-xs text-slate-500">{t('none')}</li>}
          </ul>
          {needle && !exact && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-brand-50"
              disabled={busy}
              onClick={() => void create()}
            >
              <Icon name="plus" size={15} />
              {t('create', { name: query.trim() })}
            </button>
          )}
          {error && <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
