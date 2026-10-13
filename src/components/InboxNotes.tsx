'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Note {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  mine: boolean;
}

/** Private notes on one inbox item: what the team should know before answering. */
export function InboxNotes({ kind, id, count }: { kind: 'comment' | 'message'; id: string; count: number }) {
  const t = useTranslations('inbox');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [total, setTotal] = useState(count);
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch(`/api/inbox/notes?kind=${kind}&id=${encodeURIComponent(id)}`).catch(() => null);
    if (!response?.ok) return setError(true);
    const body = (await response.json()) as { notes: Note[] };
    setNotes(body.notes);
    setTotal(body.notes.length);
  }

  async function add() {
    setError(false);
    const response = await fetch('/api/inbox/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, id, body: text }),
    }).catch(() => null);
    if (!response?.ok) return setError(true);
    setText('');
    await load();
  }

  async function remove(noteId: string) {
    const response = await fetch(`/api/inbox/notes/${noteId}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) await load();
  }

  return (
    <div className="w-full">
      <button
        type="button"
        className="text-xs font-medium text-brand-600 hover:underline"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open && notes === null) void load();
        }}
      >
        {total > 0 ? t('notesCount', { count: total }) : t('addNote')}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-3">
          {notes?.map((note) => (
            <p key={note.id} className="text-sm text-slate-800">
              <span className="font-semibold">{note.author || t('someone')}: </span>
              {note.body}
              {note.mine && (
                <button type="button" className="ms-2 text-xs text-slate-500 hover:text-red-600" onClick={() => void remove(note.id)}>
                  {t('deleteNote')}
                </button>
              )}
            </p>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void add();
            }}
          >
            <input className="input h-9 flex-1" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('notePlaceholder')} aria-label={t('notePlaceholder')} maxLength={2000} />
            <button type="submit" className="btn-secondary h-9" disabled={!text.trim()}>
              {t('saveNote')}
            </button>
          </form>
          <p className="text-xs text-slate-500">{t('notesPrivate')}</p>
          {error && <p className="text-xs text-red-700">{t('noteFailed')}</p>}
        </div>
      )}
    </div>
  );
}
