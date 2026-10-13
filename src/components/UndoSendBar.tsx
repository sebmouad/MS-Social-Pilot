'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Undo send: right after "Publish now", the post waits a few
 * seconds with a way to take it back. Taken back, it opens again as a draft.
 */
export function UndoSendBar({ postId, until }: { postId: string; until: string }) {
  const t = useTranslations('compose');
  const deadline = new Date(until).getTime();
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearTimeout(timer);
  }, [left, deadline]);

  async function undo() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${postId}/undo-send`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('couldNotSave'));
        return;
      }
      // A fresh load, so the composer starts from the draft and not from what
      // it still holds of the post it just sent.
      window.location.assign(`/compose?post=${postId}`);
    } catch {
      setError(t('couldNotSave'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {left > 0 ? (
        <>
          <p className="flex-1">{t('undoSendWaiting', { seconds: left })}</p>
          <button type="button" className="btn-secondary" disabled={pending} onClick={undo}>
            {t('undoSend')}
          </button>
        </>
      ) : (
        <p className="flex-1">
          {t('undoSendGone')}{' '}
          <Link href="/posts" className="font-medium underline underline-offset-2">
            {t('openPostList')}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="w-full text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
