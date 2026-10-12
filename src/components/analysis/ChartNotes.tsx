'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { useConfirm } from '@/components/ConfirmProvider';
import { NOTE_LABEL_MAX, type ChartNoteView } from '@/lib/chart-note-colors';
import { PALETTE, PALETTE_KEYS, type PaletteKey } from '@/lib/palette';

/**
 * The notes on a Page's timelines (NEXT_PHASES H13), listed under the chart,
 * with a form to add one for those who may.
 */
export function ChartNotes({
  notes,
  targetId,
  firstDay,
  lastDay,
  canEdit,
  canNoteAllPages,
}: {
  notes: ChartNoteView[];
  targetId: string;
  firstDay: string;
  lastDay: string;
  canEdit: boolean;
  canNoteAllPages: boolean;
}) {
  const t = useTranslations('chartNotes');
  const tColors = useTranslations('groups.colors');
  const locale = useLocale();
  const router = useRouter();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(lastDay);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<PaletteKey>('blue');
  const [allPages, setAllPages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch('/api/chart-notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: allPages ? null : targetId, day, label, color }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(t('saveFailed'));
    setLabel('');
    setAdding(false);
    router.refresh();
  }

  async function remove(note: ChartNoteView) {
    if (!(await confirm({ title: t('removeConfirm'), body: note.label, confirmLabel: t('remove'), danger: true }))) return;
    const response = await fetch(`/api/chart-notes/${note.id}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) return setError(t('removeFailed'));
    router.refresh();
  }

  if (notes.length === 0 && !canEdit) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('title')}</h4>
        {canEdit && !adding && (
          <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">{t('empty')}</p>
      ) : (
        <ul className="mt-1.5 space-y-1" aria-label={t('title')}>
          {notes.map((note) => (
            <li key={note.id} className="flex items-center gap-2 text-sm text-slate-700">
              <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${PALETTE[note.color].dot}`} />
              <span className="nums shrink-0 text-xs text-slate-500">{dayFormat.format(new Date(`${note.day}T12:00:00Z`))}</span>
              <span className="min-w-0 flex-1 truncate">{note.label}</span>
              {!note.pageOnly && <span className="shrink-0 text-xs text-slate-500">{t('allPagesTag')}</span>}
              {canEdit && (canNoteAllPages || note.pageOnly) && (
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-slate-500 hover:text-red-700"
                  aria-label={t('removeNamed', { label: note.label })}
                  onClick={() => void remove(note)}
                >
                  {t('remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={add} className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[auto_1fr_auto]">
          <div>
            <label className="label" htmlFor="chart-note-day">
              {t('day')}
            </label>
            <input id="chart-note-day" type="date" className="input" min={firstDay} max={lastDay} value={day} onChange={(event) => setDay(event.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="chart-note-label">
              {t('label')}
            </label>
            <input
              id="chart-note-label"
              className="input"
              maxLength={NOTE_LABEL_MAX}
              placeholder={t('labelPlaceholder')}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="chart-note-color">
              {t('color')}
            </label>
            <select id="chart-note-color" className="input" value={color} onChange={(event) => setColor(event.target.value as PaletteKey)}>
              {PALETTE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {tColors(key)}
                </option>
              ))}
            </select>
          </div>
          {canNoteAllPages && (
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-3">
              <input type="checkbox" checked={allPages} onChange={(event) => setAllPages(event.target.checked)} />
              {t('allPages')}
            </label>
          )}
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" className="btn-primary text-sm" disabled={busy || !label.trim()}>
              {t('save')}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setAdding(false)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
