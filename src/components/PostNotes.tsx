'use client';

import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';
import { mentionMatches, mentionQuery, NOTE_MAX } from '@/lib/mentions';

interface Note {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

interface Member {
  id: string;
  name: string;
}

/**
 * Internal notes on a post: a team-only thread, never
 * published. Typing `@` offers the members who may see the post; the ones
 * mentioned are emailed.
 */
export function PostNotes({ postId, className = 'btn-secondary text-sm' }: { postId: string; className?: string }) {
  const t = useTranslations('notes');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const confirm = useConfirm();
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setNotes(null);
    setFailed(false);
    setError(null);
    const response = await fetch(`/api/posts/${postId}/notes`).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { notes?: Note[]; members?: Member[]; me?: string } | undefined;
    setFailed(!response?.ok);
    setNotes(body?.notes ?? []);
    setMembers(body?.members ?? []);
    setMe(body?.me ?? null);
  }

  function onType(value: string, caret: number) {
    setText(value);
    setQuery(mentionQuery(value.slice(0, caret)));
  }

  function mention(member: Member) {
    const caret = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    const next = `${before.slice(0, at)}@${member.name} ${text.slice(caret)}`;
    setText(next);
    setMentioned((current) => (current.includes(member.id) ? current : [...current, member.id]));
    setQuery(null);
    const position = at + member.name.length + 2;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(position, position);
    });
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/posts/${postId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: text, mentionIds: mentioned }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { note?: Note; error?: string } | undefined;
    setBusy(false);
    if (!response?.ok || !body?.note) {
      setError(body?.error ?? t('sendFailed'));
      return;
    }
    setNotes((current) => [...(current ?? []), body.note!]);
    setText('');
    setMentioned([]);
  }

  async function remove(note: Note) {
    if (!(await confirm({ title: t('removeConfirm'), body: t('removeConfirmBody'), confirmLabel: t('remove'), danger: true }))) return;
    const response = await fetch(`/api/post-notes/${note.id}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) setNotes((current) => (current ?? []).filter((entry) => entry.id !== note.id));
    else setError(t('removeFailed'));
  }

  /** The note with each mention of a member drawn as a chip. */
  function render(body: string) {
    const names = members.map((member) => member.name).sort((a, b) => b.length - a.length);
    if (names.length === 0) return body;
    const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g')).map((part, index) =>
      index % 2 === 1 ? (
        <span key={index} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">
          {part}
        </span>
      ) : (
        part
      ),
    );
  }

  const suggestions = query === null ? [] : mentionMatches(members, query);

  return (
    <>
      <button type="button" className={className} onClick={openDialog}>
        {t('open')}
      </button>
      <Dialog open={open} title={t('title')} onClose={() => setOpen(false)} closeLabel={tCommon('close')} wide>
        <div className="space-y-4">
          <p className="hint">{t('hint')}</p>
          {notes === null ? (
            <p className="text-sm text-slate-600">{t('loading')}</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-slate-600">{failed ? t('loadFailed') : t('none')}</p>
          ) : (
            <ol className="space-y-2" aria-label={t('title')}>
              {notes.map((note) => (
                <li key={note.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-baseline gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-800">{note.authorName ?? t('formerMember')}</span>
                    <span>{format.dateTime(new Date(note.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    {note.authorId === me && (
                      <button type="button" className="ms-auto text-xs font-medium text-slate-500 hover:text-red-700" onClick={() => remove(note)}>
                        {t('remove')}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{render(note.body)}</p>
                </li>
              ))}
            </ol>
          )}

          <div className="relative">
            <label className="label" htmlFor={`note-${postId}`}>
              {t('add')}
            </label>
            <textarea
              id={`note-${postId}`}
              ref={box}
              className="input min-h-[80px]"
              value={text}
              maxLength={NOTE_MAX}
              placeholder={t('placeholder')}
              onChange={(event) => onType(event.target.value, event.target.selectionStart)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query !== null) {
                  event.stopPropagation();
                  setQuery(null);
                }
              }}
            />
            {suggestions.length > 0 && (
              <ul className="mt-1 rounded-lg border border-slate-200 bg-white shadow-surface" aria-label={t('mentionList')}>
                {suggestions.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-start text-sm hover:bg-brand-50"
                      onClick={() => mention(member)}
                    >
                      @{member.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="mt-1 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={send}>
                {busy ? tCommon('working') : t('send')}
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
