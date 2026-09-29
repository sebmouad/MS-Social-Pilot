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
 *
 * The controls are hidden from anyone who cannot use them. The API refuses them
 * either way — that is the boundary — but a Delete button that answers 403
 * reads as a broken product rather than as a permission.
 */
export function CommentsPanel({
  comments,
  targetId,
  canModerate,
  canDelete,
}: {
  comments: CommentView[];
  targetId: string;
  canModerate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('engagement');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [syncing, setSyncing] = useState(false);

  /**
   * POST and report, the one way both actions talk to the server.
   *
   * The body is read leniently: a proxy's HTML error page or an empty 502 is
   * not JSON, and parsing it anyway put "Unexpected token '<'" on screen in
   * place of a sentence. The server's own message wins when there is one —
   * it is already translated, and it says which rule was broken. A request
   * that never arrived (offline, connection reset) gets the generic line
   * rather than the browser's "Failed to fetch".
   */
  async function post(url: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? tCommon('genericError'));
        return false;
      }
      return true;
    } catch {
      setError(tCommon('genericError'));
      return false;
    }
  }

  async function act(body: Record<string, unknown>, id: string) {
    setBusy(id);
    setError(null);
    try {
      if (!(await post('/api/engagement/comments', body))) return;
      setReplyTo(null);
      setReplyText('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      if (await post('/api/engagement/sync', { targetId })) router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-600">{t('commentsHint')}</p>
        {/* Editors and above, the same rule the sync route enforces. */}
        {canModerate && (
          <button type="button" className="btn-secondary" onClick={sync} disabled={syncing}>
            {syncing ? tCommon('working') : t('refresh')}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {comments.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-600">{t('noComments')}</div>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              // Hidden is said with a badge and a tint, not by fading the
              // card: faded grey text on white fails contrast, and a hidden
              // comment is exactly the one a moderator needs to read clearly.
              className={`card p-4 ${comment.isHidden ? 'border-amber-200 bg-amber-50' : ''} ${
                comment.isReply ? 'ml-4 border-l-2 border-l-slate-300 sm:ml-8' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-slate-900">
                  {comment.author}
                  {comment.isHidden && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {t('hidden')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {comment.targetName} · {comment.createdLabel}
                </p>
              </div>

              <p className="mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-700">{comment.message}</p>

              <p className="mt-2 truncate text-xs text-slate-500" title={comment.postMessage}>
                {t('onPost', { post: comment.postMessage })}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-500">
                  {t('likes', { count: comment.likeCount })} ·{' '}
                  {t('replies', { count: comment.replyCount })}
                </span>

                {canModerate && (
                  <>
                    <button
                      type="button"
                      className="font-medium text-brand-600 hover:underline disabled:opacity-50"
                      disabled={busy === comment.id}
                      aria-expanded={replyTo === comment.id}
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
                  </>
                )}

                {canDelete && (
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
                )}
              </div>

              {canModerate && replyTo === comment.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input min-h-[72px]"
                    aria-label={t('replyToLabel', { author: comment.author })}
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
