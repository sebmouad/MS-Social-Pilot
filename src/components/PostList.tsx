'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { StatusBadge } from './StatusBadge';
import { ExternalLink } from './ExternalLink';
import { postIsEditable } from '@/lib/constants';

export interface PostView {
  id: string;
  message: string;
  link: string | null;
  status: string;
  publishMode: string;
  scheduledAtLabel: string | null;
  publishedAtLabel: string | null;
  mediaCount: number;
  /** Why a reviewer sent it back; only set while the post is rejected. */
  reviewNote: string | null;
  /** The viewer wrote it, or may manage other people's posts. */
  mayAct: boolean;
  /** Its approval state lets it go out now rather than wait for a reviewer. */
  cleared: boolean;
  targets: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    url: string | null;
    error: string | null;
    /** Ours or Facebook's; only ours can be said in another language. */
    errorCode: string | null;
    attempts: number;
  }>;
}

/** States a post can be sent for review from, as the author sees them. */
const SUBMITTABLE = ['draft', 'rejected'];
/** States "Publish now" makes sense from; the API refuses the rest. */
const PUBLISHABLE_NOW = ['draft', 'scheduled', 'failed', 'partially_failed'];
/** Nothing has gone out yet, so cancelling loses nothing but the plan. */
const CANCELLABLE = ['draft', 'scheduled', 'pending_approval', 'rejected'];

export function PostList({
  posts,
  needsReview = false,
  emptyText,
}: {
  posts: PostView[];
  /** The viewer's posts go through review, so drafts offer "Submit for review". */
  needsReview?: boolean;
  /** Said instead of the usual empty message, e.g. when a search found nothing. */
  emptyText?: string;
}) {
  const t = useTranslations('posts');
  const tApprovals = useTranslations('approvals');

  /**
   * What went wrong, in the reader's language when we are the ones who said it.
   *
   * `errorCode` carries Facebook's codes as well as ours. Facebook's stay in
   * Facebook's words: it wrote the useful part, and a translated paraphrase of
   * "Unsupported get request" helps nobody. Ours are sentences this app
   * composed, so they can be said in French to a French reader.
   */
  function failureText(target: { error: string | null; errorCode: string | null }): string | null {
    if (target.errorCode) {
      const key = `failure.${target.errorCode}` as Parameters<typeof t>[0];
      if (t.has(key)) return t(key);
    }
    return target.error;
  }
  const tCommon = useTranslations('common');
  const tCompose = useTranslations('compose');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Run one post action.
   *
   * `finally` clears the busy state whatever happens, a dropped connection
   * included: a button left disabled after a failed request reads as the app
   * having hung, and the only way out was a reload.
   */
  async function act(
    postId: string,
    request: { path: string; method: string; body?: unknown; confirmText?: string },
    onSuccess?: (body: { postId?: string }) => void,
  ) {
    if (request.confirmText && !window.confirm(request.confirmText)) return;

    setBusy(postId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(request.path, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        failures?: string[];
        postId?: string;
        /** Something the server wants said even though it worked. */
        notice?: string;
      };
      if (!response.ok) {
        setError(body.error ?? t('actionFailed'));
        return;
      }
      if (body.failures?.length) setError(body.failures.join(' '));
      if (body.notice) setNotice(body.notice);
      if (onSuccess) onSuccess(body);
      else router.refresh();
    } catch {
      setError(t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          {notice}
        </div>
      )}

      {/* Below the error, not instead of it: cancelling the last post on a
          filtered tab empties the tab, and what Facebook refused to remove
          still has to be said. */}
      {posts.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-600">{emptyText ?? t('noPosts')}</div>
      )}

      {posts.map((post) => {
        // Facebook is holding it: our worker has nothing to send, and the
        // publish route refuses it, so offering the button is a dead end.
        const heldByFacebook = post.targets.some((target) => target.status === 'scheduled_remote');
        const canPublishNow =
          post.mayAct && post.cleared && !heldByFacebook && PUBLISHABLE_NOW.includes(post.status);
        const canCancel = post.mayAct && CANCELLABLE.includes(post.status);
        const canSubmit = post.mayAct && needsReview && SUBMITTABLE.includes(post.status);
        const canWithdraw = post.mayAct && post.status === 'pending_approval';
        // The same rule the API enforces, so the button is never a dead end.
        const canEdit = post.mayAct && postIsEditable(post);
        const canRetry = post.mayAct && post.targets.some((target) => target.status === 'failed');
        const working = busy === post.id;

        return (
          <article key={post.id} className="card p-5" aria-busy={working}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-800">
                  {post.message || <span className="text-slate-400">{t('noText')}</span>}
                </p>
                {post.link && (
                  <ExternalLink
                    href={post.link}
                    className="mt-1 block truncate text-xs text-brand-600 hover:underline"
                  >
                    {post.link}
                  </ExternalLink>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {post.publishedAtLabel
                    ? t('publishedAt', { when: post.publishedAtLabel })
                    : post.scheduledAtLabel
                      ? t('scheduledFor', { when: post.scheduledAtLabel })
                      : t('noTimeSet')}
                  {post.publishMode === 'native' && ` · ${t('heldByFacebook')}`}
                  {post.mediaCount > 0 && ` · ${t('attachments', { count: post.mediaCount })}`}
                </p>
              </div>
              <StatusBadge status={post.status} />
            </div>

            {/* The reason is the whole point of a rejection: without it the
                author can only guess what to change before resubmitting. */}
            {post.reviewNote && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="text-xs font-medium">{tApprovals('reviewNote')}</p>
                <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{post.reviewNote}</p>
              </div>
            )}

            <ul className="mt-4 space-y-1.5">
              {post.targets.map((target) => (
                <li key={target.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-700">{target.name}</span>
                  <StatusBadge status={target.status} kind="target" />
                  {target.url && (
                    <ExternalLink href={target.url} className="text-brand-600 hover:underline">
                      {t('viewOnFacebook')}
                    </ExternalLink>
                  )}
                  {failureText(target) && (
                    <span className="text-red-600">
                      {failureText(target)}
                      {target.attempts > 1 && ` ${t('attempts', { count: target.attempts })}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              {canEdit && (
                <Link href={`/compose?post=${post.id}`} className="btn-secondary">
                  {tCommon('edit')}
                </Link>
              )}
              {canSubmit && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/approve`,
                      method: 'POST',
                      body: { action: 'submit' },
                    })
                  }
                >
                  {post.status === 'rejected' ? tApprovals('resubmit') : t('submitForReview')}
                </button>
              )}
              {canWithdraw && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/approve`,
                      method: 'POST',
                      body: { action: 'withdraw' },
                    })
                  }
                >
                  {t('withdraw')}
                </button>
              )}
              {canPublishNow && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/publish`,
                      method: 'POST',
                      // It goes to real Pages the moment this is pressed, and
                      // there is no taking a published post back from here.
                      confirmText: t('publishNowConfirm', { count: post.targets.length }),
                    })
                  }
                >
                  {tCompose('publishNow')}
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={working}
                  onClick={() => act(post.id, { path: `/api/posts/${post.id}/retry`, method: 'POST' })}
                >
                  {t('retryFailed')}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={working}
                onClick={() =>
                  act(post.id, { path: `/api/posts/${post.id}/duplicate`, method: 'POST' }, (body) => {
                    // Straight into the copy: a duplicate is made to be changed,
                    // and one that appears silently somewhere down the list is
                    // easy to miss and end up publishing twice.
                    if (body.postId) router.push(`/compose?post=${body.postId}`);
                    else router.refresh();
                  })
                }
              >
                {tCommon('duplicate')}
              </button>
              {canCancel && (
                <button
                  type="button"
                  className="btn-danger"
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}`,
                      method: 'DELETE',
                      confirmText: t('cancelConfirm'),
                    })
                  }
                >
                  {tCommon('cancel')}
                </button>
              )}
              {working && (
                <span className="self-center text-xs text-slate-500" role="status">
                  {tCommon('working')}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
