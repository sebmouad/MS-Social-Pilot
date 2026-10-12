'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { countCharacters } from '@/lib/text';

interface Snippet {
  id: string;
  name: string;
  body: string;
}

/** A short, well-used set: what Page posts actually reach for. */
const EMOJI = [
  '😀', '😂', '😍', '🥰', '😎', '🤩', '😋', '🤤', '😉', '🙌', '👏', '👍', '🙏', '💪', '👉', '👇',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🔥', '✨', '⭐', '🎉', '🎁', '🎈', '📣', '📢', '💡', '✅',
  '☀️', '🌸', '🌿', '🍂', '❄️', '🌙', '☕', '🍰', '🥐', '🍕', '🍔', '🥗', '🍷', '🛍️', '📍', '📅',
  '⏰', '💬', '📸', '🎥', '🎶', '🏆', '💯', '🆕', '🔔', '➡️', '⬇️', '❗', '❓', '💰', '🚚', '📞',
];

/**
 * The strip under the post box: saved texts, emoji, and the counts that
 * matter on Facebook — characters, hashtags, mentions.
 *
 * Everything inserts at the cursor, as typing would, so a signature can go
 * at the end and an emoji in the middle without retyping round it.
 */
export function ComposerTools({
  text,
  insert,
  canDelete,
}: {
  text: string;
  /** Put text at the cursor of the post box. */
  insert: (value: string) => void;
  canDelete: boolean;
}) {
  const t = useTranslations('compose');
  const [open, setOpen] = useState<'snippets' | 'emoji' | null>(null);
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(null);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    if (open !== 'snippets' || snippets) return;
    fetch('/api/snippets')
      .then((response) => response.json())
      .then((body: { snippets?: Snippet[] }) => setSnippets(body.snippets ?? []))
      .catch(() => setSnippets([]));
  }, [open, snippets]);

  async function save() {
    setError(null);
    const response = await fetch('/api/snippets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), body: text.trim() }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { snippet?: Snippet; error?: string } | undefined;
    if (!response?.ok || !body?.snippet) {
      setError(body?.error ?? t('snippetFailed'));
      return;
    }
    setSnippets((current) => [...(current ?? []), body.snippet!].sort((a, b) => a.name.localeCompare(b.name)));
    setName('');
  }

  async function remove(id: string) {
    const response = await fetch(`/api/snippets/${id}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) setSnippets((current) => (current ?? []).filter((snippet) => snippet.id !== id));
  }

  const hashtags = (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
  const mentions = (text.match(/(^|\s)@[\p{L}\p{N}_.]+/gu) ?? []).length;

  return (
    <div ref={box} className="relative mt-2 flex flex-wrap items-center gap-1">
      <button
        type="button"
        className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${
          open === 'snippets' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
        }`}
        aria-expanded={open === 'snippets'}
        onClick={() => setOpen(open === 'snippets' ? null : 'snippets')}
      >
        <Icon name="posts" size={15} />
        {t('snippets')}
      </button>
      <button
        type="button"
        className={`flex h-8 w-8 items-center justify-center rounded-full text-base ${
          open === 'emoji' ? 'bg-brand-50' : 'hover:bg-slate-100'
        }`}
        aria-label={t('emoji')}
        aria-expanded={open === 'emoji'}
        onClick={() => setOpen(open === 'emoji' ? null : 'emoji')}
      >
        <span aria-hidden>😊</span>
      </button>
      <span className="nums ms-auto flex items-center gap-3 text-xs text-slate-500" aria-live="polite">
        <span>{t('characters', { count: countCharacters(text) })}</span>
        <span title={t('hashtagCount', { count: hashtags })}># {hashtags}</span>
        <span title={t('mentionCount', { count: mentions })}>@ {mentions}</span>
      </span>

      {open === 'emoji' && (
        <div className="absolute start-0 top-full z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="grid grid-cols-8 gap-0.5" role="group" aria-label={t('emoji')}>
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-slate-100"
                aria-label={emoji}
                onClick={() => insert(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {open === 'snippets' && (
        <div className="absolute start-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <ul className="max-h-60 overflow-y-auto py-1">
            {snippets === null && <li className="px-3 py-2 text-xs text-slate-500">{t('loadingSnippets')}</li>}
            {snippets?.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{t('noSnippets')}</li>}
            {snippets?.map((snippet) => (
              <li key={snippet.id} className="group flex items-start gap-1 px-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-start hover:bg-slate-50"
                  onClick={() => {
                    insert(snippet.body);
                    setOpen(null);
                  }}
                >
                  <span className="block truncate text-sm font-semibold text-slate-900">{snippet.name}</span>
                  <span className="block truncate text-xs text-slate-500">{snippet.body}</span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="mt-1.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:flex group-hover:flex"
                    aria-label={t('deleteSnippet', { name: snippet.name })}
                    onClick={() => void remove(snippet.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex items-center gap-1.5 border-t border-slate-100 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <input
              className="input py-1 text-sm"
              placeholder={t('snippetName')}
              aria-label={t('snippetName')}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="btn-secondary shrink-0 px-2.5 py-1 text-xs" disabled={!name.trim() || !text.trim()}>
              {t('saveSnippet')}
            </button>
          </form>
          <p className="px-3 pb-2 text-[11px] text-slate-500">{error ?? t('snippetHint')}</p>
        </div>
      )}
    </div>
  );
}
