'use client';

import Link from 'next/link';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { fillReply } from '@/lib/reply-template';

import { Icon } from './Icon';

interface SavedReply {
  id: string;
  name: string;
  body: string;
}

/** Read once per screen, the first time someone reaches for a saved reply. */
let cache: Promise<SavedReply[]> | null = null;

function loadReplies(): Promise<SavedReply[]> {
  cache ??= fetch('/api/saved-replies')
    .then((response) => (response.ok ? response.json() : { replies: [] }))
    .then((body: { replies?: SavedReply[] }) => body.replies ?? [])
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

/** After the list changes, so the next reply box reads it again. */
export function forgetSavedReplies(): void {
  cache = null;
}

/**
 * Saved replies for a reply box. Typing `/` at the start of
 * the box, or the button, lists them; picking one puts it in the box with the
 * person's first name and the Page's name filled in, ready to edit and send.
 *
 * Returns the pieces for the box to place: a key handler for the textarea
 * (Enter picks the first match while the list is open, Escape closes it), the
 * button, and the list.
 */
export function useSavedReplies(options: {
  value: string;
  setValue: (value: string) => void;
  /** The person being answered. */
  name: string | null;
  page: string;
}): { onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; button: ReactNode; panel: ReactNode } {
  const t = useTranslations('savedReplies');
  const [replies, setReplies] = useState<SavedReply[] | null>(null);
  const [forced, setForced] = useState(false);

  const slash = options.value.startsWith('/') && !options.value.includes('\n');
  const open = forced || slash;
  const query = slash ? options.value.slice(1).trim().toLowerCase() : '';

  useEffect(() => {
    if (open && replies === null) void loadReplies().then(setReplies);
  }, [open, replies]);

  const matches = (replies ?? []).filter(
    (reply) => !query || reply.name.toLowerCase().includes(query) || reply.body.toLowerCase().includes(query),
  );

  function pick(reply: SavedReply) {
    options.setValue(fillReply(reply.body, { name: options.name, page: options.page }));
    setForced(false);
  }

  function close() {
    setForced(false);
    if (slash) options.setValue('');
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && !event.shiftKey && matches[0]) {
      event.preventDefault();
      pick(matches[0]);
    }
  };

  const button = (
    <button
      type="button"
      className="btn-ghost inline-flex h-10 shrink-0 items-center rounded-full px-3 text-sm"
      aria-expanded={open}
      onClick={() => (open ? close() : setForced(true))}
      aria-label={t('button')}
      title={t('hint')}
    >
      <Icon name="comment" size={18} />
      <span className="ms-1 hidden sm:inline">{t('button')}</span>
    </button>
  );

  const panel = open ? (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-surface">
      {replies === null ? (
        <p className="px-2 py-1 text-sm text-slate-500">{t('loading')}</p>
      ) : matches.length === 0 ? (
        <p className="px-2 py-1 text-sm text-slate-600">
          {replies.length === 0 ? t('none') : t('noMatch')}{' '}
          <Link className="font-medium text-brand-600 hover:underline" href="/inbox/replies">
            {t('manage')}
          </Link>
        </p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label={t('listLabel')}>
          {matches.map((reply) => (
            <li key={reply.id}>
              <button
                type="button"
                className="w-full rounded-lg px-2 py-1.5 text-start hover:bg-slate-100 focus-visible:bg-slate-100"
                onClick={() => pick(reply)}
              >
                <span className="block text-sm font-semibold text-slate-900">{reply.name}</span>
                <span className="block truncate text-xs text-slate-600">{reply.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return { onKeyDown, button, panel };
}
