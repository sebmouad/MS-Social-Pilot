'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface CommentView {
  id: string;
  message: string;
  author: string;
  likeCount: number;
  replyCount: number;
  isHidden: boolean;
  isReply: boolean;
  createdLabel: string;
  postMessage: string;
  targetName: string;
}

/**
 * The comment stream, with moderation.
 *
 * Every action writes to Facebook first and only then refreshes — an optimistic
 * update here would show a comment as hidden when Graph had refused, which is
 * exactly the mistake that gets a page reported.
 */
export function CommentsPanel({ comments, targetId }: { comments: CommentView[]; targetId: string }) {
  const t = useTranslations('engagement');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function act(body: Record<string, unknown>, id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch('/api/engagement/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? tCommon('genericError'));
      setReplyTo(null);
      setReplyText('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch('/api/engagement/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? tCommon('genericError'));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('commentsHint')}</p>
        <button type="button" className="btn-secondary" onClick={sync} disabled={syncing}>
          {syncing ? tCommon('working') : t('refresh')}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {comments.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-600">{t('noComments')}</div>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={`card p-4 ${comment.isHidden ? 'opacity-60' : ''} ${
                comment.isReply ? 'ml-6 border-l-2 border-l-slate-200' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{comment.author}</p>
                <p className="text-xs text-slate-500">
                  {comment.targetName} · {comment.createdLabel}
                </p>
              </div>

              <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{comment.message}</p>

              <p className="mt-2 truncate text-xs text-slate-400" title={comment.postMessage}>
                {t('onPost', { post: comment.postMessage })}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-500">
                  {t('likes', { count: comment.likeCount })} ·{' '}
                  {t('replies', { count: comment.replyCount })}
                </span>
                {comment.isHidden && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    {t('hidden')}
                  </span>
                )}

                <button
                  type="button"
                  className="font-medium text-brand-600 hover:underline disabled:opacity-50"
                  disabled={busy === comment.id}
                  onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                >
                  {t('reply')}
                </button>
                <button
                  type="button"
                  className="font-medium text-slate-600 hover:underline disabled:opacity-50"
                  disabled={busy === comment.id}
                  onClick={() =>
                    act(
                      { action: comment.isHidden ? 'unhide' : 'hide', commentId: comment.id },
                      comment.id,
                    )
                  }
                >
                  {comment.isHidden ? t('unhide') : t('hide')}
                </button>
                <button
                  type="button"
                  className="font-medium text-rose-600 hover:underline disabled:opacity-50"
                  disabled={busy === comment.id}
                  onClick={() => {
                    if (confirm(t('confirmDelete'))) {
                      void act({ action: 'delete', commentId: comment.id }, comment.id);
                    }
                  }}
                >
                  {tCommon('delete')}
                </button>
              </div>

              {replyTo === comment.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input min-h-[72px]"
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder={t('replyPlaceholder')}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy === comment.id || replyText.trim().length === 0}
                    onClick={() =>
                      act(
                        { action: 'reply', commentId: comment.id, message: replyText.trim() },
                        comment.id,
                      )
                    }
                  >
                    {busy === comment.id ? tCommon('working') : t('sendReply')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
