'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { FeedAvatar } from './FeedPost';
import { EmptyState } from './EmptyState';

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
  /** The Page's own reply: its photo, and Facebook's "Author" label. */
  fromPage?: boolean;
  pagePictureUrl?: string | null;
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
        <EmptyState icon="comment" title={t('noComments')} hint={canModerate ? t('emptyHint') : undefined} />
      ) : (
        // Facebook's comment threads: the person's initial, their words in a
        // grey bubble, and the small actions under it. Grouped by post, the
        // way a moderator reads them — what was said, under what.
        <div className="space-y-3">
          {byPost(comments).map((group) => (
            <section key={group.key} className="card overflow-hidden">
              <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <Icon name="posts" size={16} className="shrink-0 text-slate-500" />
                <p className="min-w-0 flex-1 truncate text-[13px] text-slate-700" title={group.postMessage}>
                  <span className="font-semibold text-slate-900">{group.targetName}</span>
                  {' · '}
                  {t('onPost', { post: group.postMessage })}
                </p>
              </header>
              <ul className="space-y-3 px-4 py-3">
                {group.comments.map((comment) => (
                  <li key={comment.id} className={`flex gap-2 ${comment.isReply ? 'ml-10' : ''}`}>
                    {comment.fromPage ? (
                      <FeedAvatar
                        name={comment.author}
                        pictureUrl={comment.pagePictureUrl ?? null}
                        size={comment.isReply ? 'xs' : 'sm'}
                      />
                    ) : (
                      <Initial name={comment.author} small={comment.isReply} />
                    )}
                    <div className="min-w-0 flex-1">
                      {/* Hidden is said with a badge and a dashed amber edge,
                          not by fading: a hidden comment is the one a
                          moderator most needs to read clearly. */}
                      <div
                        className={`inline-block max-w-full rounded-2xl px-3 py-2 ${
                          comment.isHidden ? 'border border-dashed border-amber-400 bg-amber-50' : 'bg-slate-100'
                        }`}
                      >
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-900">
                          {comment.author}
                          {comment.fromPage && (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                              <Icon name="compose" size={11} />
                              {t('author')}
                            </span>
                          )}
                          {comment.isHidden && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                              {t('hidden')}
                            </span>
                          )}
                        </p>
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-5 text-slate-900">
                          {comment.message}
                        </p>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-xs font-semibold text-slate-600">
                        <span className="font-normal">{comment.createdLabel}</span>
                        {comment.likeCount > 0 && (
                          <span className="flex items-center gap-1 font-normal">
                            <span
                              aria-hidden
                              className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-white"
                            >
                              <Icon name="thumbsUp" size={9} />
                            </span>
                            {t('likes', { count: comment.likeCount })}
                          </span>
                        )}
                        {comment.replyCount > 0 && (
                          <span className="font-normal">{t('replies', { count: comment.replyCount })}</span>
                        )}

                        {canModerate && (
                          <>
                            <button
                              type="button"
                              className="hover:underline disabled:opacity-50"
                              disabled={busy === comment.id}
                              aria-expanded={replyTo === comment.id}
                              onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                            >
                              {t('reply')}
                            </button>
                            <button
                              type="button"
                              className="hover:underline disabled:opacity-50"
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
                            className="text-rose-600 hover:underline disabled:opacity-50"
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
                        // Facebook's reply box: a rounded field under the
                        // comment, answered as the Page.
                        <div className="mt-2 flex items-end gap-2">
                          <textarea
                            className="input min-h-[40px] flex-1 resize-y rounded-2xl bg-slate-100 py-2"
                            aria-label={t('replyToLabel', { author: comment.author })}
                            value={replyText}
                            onChange={(event) => setReplyText(event.target.value)}
                            placeholder={t('replyPlaceholder')}
                            rows={1}
                          />
                          <button
                            type="button"
                            className="btn-primary rounded-full"
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
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Consecutive comments on the same post, in the order the list has them. */
function byPost(comments: CommentView[]) {
  const groups: Array<{ key: string; postMessage: string; targetName: string; comments: CommentView[] }> = [];
  for (const comment of comments) {
    const key = `${comment.targetName}\u0000${comment.postMessage}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.comments.push(comment);
    else groups.push({ key, postMessage: comment.postMessage, targetName: comment.targetName, comments: [comment] });
  }
  return groups;
}

/** A commenter's initial on a coloured disc; Graph does not give their photo. */
function Initial({ name, small = false }: { name: string; small?: boolean }) {
  const palette = ['bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700'];
  const tone = palette[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${tone} ${
        small ? 'h-6 w-6 text-[11px]' : 'h-8 w-8 text-xs'
      }`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
