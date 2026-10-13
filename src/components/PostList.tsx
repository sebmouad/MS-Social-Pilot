'use client';

import { EmptyState } from '@/components/EmptyState';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';

import { StatusBadge } from './StatusBadge';
import { LabelChips } from './LabelChips';
import { ExternalLink } from './ExternalLink';
import { Icon, type IconName } from './Icon';
import {
  FeedAvatar as Avatar,
  LinkCard,
  MediaGrid,
  richText,
  LARGE_TEXT_MAX,
  type FeedLinkPreview,
  type FeedMedia,
} from './FeedPost';
import { postIsEditable } from '@/lib/constants';

export interface PostView {
  id: string;
  message: string;
  /** Posted as the Page under the post when it goes out. */
  firstComment: string | null;
  link: string | null;
  status: string;
  publishMode: string;
  scheduledAtLabel: string | null;
  publishedAtLabel: string | null;
  mediaCount: number;
  /** The first photo, shown beside the text as Facebook's planner does. */
  thumbnailUrl: string | null;
  /** Everything attached, drawn in Facebook's layouts. */
  media?: FeedMedia[];
  linkPreview?: FeedLinkPreview | null;
  /** The day heading the post sits under, in the workspace's zone. */
  day: { key: string; label: string };
  /** What its published destinations earned, or null before any did. */
  results: { reach: number; reactions: number; comments: number; shares: number } | null;
  /** Why a reviewer sent it back; only set while the post is rejected. */
  reviewNote: string | null;
  /** Who approved it and when, once it is approved. */
  approvedBy?: { name: string; at: string } | null;
  /** The workspace's custom fields this post has a value for. */
  fields?: Array<{ name: string; value: string }>;
  /** The post's labels, in name order. */
  labels?: Array<{ id: string; name: string; color: string }>;
  /** The viewer wrote it, or may manage other people's posts. */
  mayAct: boolean;
  /** Its approval state lets it go out now rather than wait for a reviewer. */
  cleared: boolean;
  targets: Array<{
    id: string;
    name: string;
    type: string;
    pictureUrl: string | null;
    firstCommentPosted: boolean;
    /** Why Facebook refused the first comment, until a retry succeeds. */
    firstCommentError: string | null;
    status: string;
    url: string | null;
    /** Taken down from Facebook from here, after it was published. */
    removed?: boolean;
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
  labels = [],
}: {
  posts: PostView[];
  /** The workspace's labels, for the bulk "add / remove label" action. */
  labels?: Array<{ id: string; name: string }>;
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
  const confirm = useConfirm();
  const tCompose = useTranslations('compose');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tBulk = useTranslations('posts.bulk');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Posts that left the list (cancelled, filtered out) drop out of the selection.
  const chosen = posts.filter((post) => selected.has(post.id)).map((post) => post.id);

  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /** One action on every selected post; the server reports the ones it refused. */
  async function bulk(action: { kind: 'cancel' } | { kind: 'shift'; days: number } | { kind: 'label'; labelId: string; add: boolean }) {
    if (chosen.length === 0) return;
    if (
      action.kind === 'cancel' &&
      !(await confirm({
        title: tBulk('cancelTitle', { count: chosen.length }),
        body: tBulk('cancelBody'),
        confirmLabel: tBulk('cancel'),
        cancelLabel: tBulk('keep'),
        danger: true,
      }))
    )
      return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/posts/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: chosen, action }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        done?: number;
        failed?: Array<{ id: string; message: string }>;
      };
      if (!response.ok) {
        setError(body.error ?? t('actionFailed'));
        return;
      }
      if (body.done) setNotice(tBulk('done', { count: body.done }));
      if (body.failed?.length) {
        setError(`${tBulk('someFailed', { count: body.failed.length })} ${[...new Set(body.failed.map((entry) => entry.message))].join(' ')}`);
        setSelected(new Set(body.failed.map((entry) => entry.id)));
      } else {
        setSelected(new Set());
      }
      router.refresh();
    } catch {
      setError(t('actionFailed'));
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Run one post action.
   *
   * `finally` clears the busy state whatever happens, a dropped connection
   * included: a button left disabled after a failed request reads as the app
   * having hung, and the only way out was a reload.
   */
  async function act(
    postId: string,
    request: { path: string; method: string; body?: unknown; confirmText?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean },
    onSuccess?: (body: { postId?: string }) => void,
  ) {
    if (request.confirmText && !(await confirm({ title: request.confirmText, confirmLabel: request.confirmLabel, cancelLabel: request.cancelLabel, danger: request.danger }))) return;

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

      {chosen.length > 0 && (
        <div
          role="toolbar"
          aria-label={tBulk('selected', { count: chosen.length })}
          className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200"
          aria-busy={bulkBusy}
        >
          <span className="text-sm font-semibold text-slate-900">{tBulk('selected', { count: chosen.length })}</span>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <span>{tBulk('moveBy')}</span>
            <select
              className="input h-9 w-auto py-0"
              value=""
              disabled={bulkBusy}
              onChange={(event) => {
                const days = Number(event.target.value);
                if (days) void bulk({ kind: 'shift', days });
              }}
            >
              <option value="">{tBulk('move')}</option>
              {[1, 2, 7, 14, 30].map((days) => (
                <option key={days} value={days}>
                  {tBulk('days', { count: days })}
                </option>
              ))}
              {[1, 7].map((days) => (
                <option key={-days} value={-days}>
                  {tBulk('daysEarlier', { count: days })}
                </option>
              ))}
            </select>
          </label>
          {labels.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="sr-only">{tBulk('addLabel')}</span>
                <select
                  className="input h-9 w-auto py-0"
                  value=""
                  disabled={bulkBusy}
                  onChange={(event) => event.target.value && void bulk({ kind: 'label', labelId: event.target.value, add: true })}
                >
                  <option value="">{tBulk('addLabel')}</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="sr-only">{tBulk('removeLabel')}</span>
                <select
                  className="input h-9 w-auto py-0"
                  value=""
                  disabled={bulkBusy}
                  onChange={(event) => event.target.value && void bulk({ kind: 'label', labelId: event.target.value, add: false })}
                >
                  <option value="">{tBulk('removeLabel')}</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button type="button" className="btn-danger" disabled={bulkBusy} onClick={() => void bulk({ kind: 'cancel' })}>
            {tBulk('cancel')}
          </button>
          <button type="button" className="btn-ghost ms-auto" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            {tBulk('clear')}
          </button>
        </div>
      )}

      {/* Below the error, not instead of it: cancelling the last post on a
          filtered tab empties the tab, and what Facebook refused to remove
          still has to be said. */}
      {posts.length === 0 && (
        <EmptyState title={emptyText ?? t('noPosts')} />
      )}

      {groupByDay(posts).map((group) => (
        <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-3">
          <h2 id={`day-${group.key}`} className="flex items-center gap-2 px-1 pt-2 text-[15px] font-semibold text-slate-600">
            {group.posts.some((post) => post.mayAct) && (
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
                aria-label={tBulk('selectDay')}
                checked={group.posts.filter((post) => post.mayAct).every((post) => selected.has(post.id))}
                onChange={(event) => toggle(group.posts.filter((post) => post.mayAct).map((post) => post.id), event.target.checked)}
              />
            )}
            {group.label}
          </h2>
          {group.posts.map((post) => {
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
        const canRemove =
          post.mayAct && post.targets.some((target) => target.status === 'published' && target.type === 'page' && target.url && !target.removed);
        const refusedComments = post.targets.filter((target) => target.firstCommentError);
        const canRetryComment = post.mayAct && Boolean(post.firstComment) && refusedComments.length > 0;
        const commentState = !post.firstComment
          ? null
          : refusedComments.length > 0
            ? 'refused'
            : post.targets.some((target) => target.firstCommentPosted)
              ? 'posted'
              : 'pending';
        const working = busy === post.id;
        const lead = post.targets[0];
        // One destination that went fine needs no row of its own: the header
        // already names it. Several, a failure or a link to the post do.
        const showTargets =
          post.targets.length > 1 || post.targets.some((target) => target.url || failureText(target));

        return (
          <article key={post.id} className="card overflow-hidden" aria-busy={working}>
            <header className="flex items-start gap-3 px-4 pt-3">
              {post.mayAct && (
                <input
                  type="checkbox"
                  className="mt-3 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                  aria-label={tBulk('select')}
                  checked={selected.has(post.id)}
                  onChange={(event) => toggle([post.id], event.target.checked)}
                />
              )}
              <Avatar name={lead?.name ?? ''} pictureUrl={lead?.pictureUrl ?? null} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-slate-900">
                  {post.targets.map((target) => target.name).join(', ') || t('noText')}
                </p>
                <p className="text-[13px] text-slate-600">
                  {post.publishedAtLabel
                    ? t('publishedAt', { when: post.publishedAtLabel })
                    : post.scheduledAtLabel
                      ? t('scheduledFor', { when: post.scheduledAtLabel })
                      : t('noTimeSet')}
                  {post.publishMode === 'native' && ` · ${t('heldByFacebook')}`}
                  {post.mediaCount > 0 && ` · ${t('attachments', { count: post.mediaCount })}`}
                </p>
              </div>
              {post.targets.some((target) => target.removed) &&
              post.targets.every((target) => target.removed || target.status !== 'published') ? (
                <span className="badge bg-slate-100 text-slate-600">{t('removedFromFacebook')}</span>
              ) : (
                <StatusBadge status={post.status} />
              )}
            </header>
            {post.labels && post.labels.length > 0 && (
              <div className="px-4 pt-2">
                <LabelChips labels={post.labels} />
              </div>
            )}

            <p
              className={`whitespace-pre-wrap px-4 py-3 [overflow-wrap:anywhere] text-slate-900 ${
                // Facebook's large type for a short status with nothing attached.
                largeText(post) ? 'text-2xl leading-8' : 'text-[15px] leading-5'
              }`}
            >
              {post.message ? richText(post.message) : <span className="text-slate-500">{t('noText')}</span>}
            </p>
            {attachmentsOf(post).length > 0 ? (
              <div className="mb-1">
                <MediaGrid media={attachmentsOf(post)} />
              </div>
            ) : (
              (post.linkPreview || post.link) && (
                <div className="mb-1">
                  <LinkCard preview={post.linkPreview ?? { url: post.link! }} />
                </div>
              )
            )}

            {/* The reason is the whole point of a rejection: without it the
                author can only guess what to change before resubmitting. */}
            {post.reviewNote && (
              <div className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="text-xs font-semibold">{tApprovals('reviewNote')}</p>
                <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{post.reviewNote}</p>
              </div>
            )}

            {post.fields && post.fields.length > 0 && (
              <ul className="mx-4 mb-3 flex flex-wrap gap-1.5">
                {post.fields.map((field) => (
                  <li key={field.name} className="badge bg-slate-100 text-slate-700">
                    {field.name}: {field.value}
                  </li>
                ))}
              </ul>
            )}

            {post.approvedBy && (
              <p className="mx-4 mb-3 text-xs text-emerald-700">{tApprovals('approvedBy', { name: post.approvedBy.name, at: post.approvedBy.at })}</p>
            )}

            {showTargets && (
              <ul className="mx-4 mb-3 space-y-1.5">
                {post.targets.map((target) => (
                  <li key={target.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-semibold text-slate-700">{target.name}</span>
                    {target.removed ? (
                      <span className="badge bg-slate-100 text-slate-600">{t('removedFromFacebook')}</span>
                    ) : (
                      <StatusBadge status={target.status} kind="target" />
                    )}
                    {/* A cancelled or removed post was taken off Facebook: its old address leads nowhere. */}
                    {target.url && target.status !== 'cancelled' && !target.removed && (
                      <ExternalLink href={target.url} className="font-semibold text-brand-600 hover:underline">
                        {t('viewOnFacebook')}
                      </ExternalLink>
                    )}
                    {failureText(target) && (
                      <span className="text-red-700">
                        {failureText(target)}
                        {target.attempts > 1 && ` ${t('attempts', { count: target.attempts })}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {post.results && (
              <dl className="mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-[15px] text-slate-600">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t('result.reactions')}</dt>
                  <span
                    aria-hidden
                    className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-500 text-white"
                  >
                    <Icon name="thumbsUp" size={11} />
                  </span>
                  <dd className="nums">{post.results.reactions.toLocaleString()}</dd>
                </div>
                <div className="flex flex-wrap gap-x-3">
                  {(['comments', 'shares', 'reach'] as const).map((key) => (
                    <div key={key} className="flex gap-1">
                      <dd className="nums">{post.results![key].toLocaleString()}</dd>
                      <dt>{t(`result.${key}`).toLowerCase()}</dt>
                    </div>
                  ))}
                </div>
              </dl>
            )}

            {/* The first comment, drawn as it appears under the post. */}
            {post.firstComment && (
              <div className="mx-4 mb-2 flex gap-2 border-t border-slate-200 pt-2">
                <Avatar name={lead?.name ?? ''} pictureUrl={lead?.pictureUrl ?? null} size="sm" />
                <div className="min-w-0">
                  <div className="rounded-2xl bg-slate-100 px-3 py-2">
                    <p className="text-[13px] font-semibold text-slate-900">{lead?.name}</p>
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-5 text-slate-900">
                      {post.firstComment}
                    </p>
                  </div>
                  <p
                    className={`mt-0.5 px-3 text-xs font-semibold ${
                      commentState === 'refused'
                        ? 'text-red-700'
                        : commentState === 'posted'
                          ? 'text-emerald-700'
                          : 'text-slate-500'
                    }`}
                  >
                    {t(`firstComment.${commentState}`)}
                    {commentState === 'refused' && `: ${refusedComments[0]!.firstCommentError}`}
                  </p>
                </div>
              </div>
            )}

            {/* Facebook's action bar: quiet, equal-width, icon and word. */}
            <div className="mx-4 flex flex-wrap items-center gap-1 border-t border-slate-200 py-1">
              {canEdit && (
                <Link href={`/compose?post=${post.id}`} className={ACTION}>
                  <ActionIcon name="compose" />
                  {tCommon('edit')}
                </Link>
              )}
              {canSubmit && (
                <button
                  type="button"
                  className={`${ACTION} text-brand-600`}
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/approve`,
                      method: 'POST',
                      body: { action: 'submit' },
                    })
                  }
                >
                  <ActionIcon name="approvals" />
                  {post.status === 'rejected' ? tApprovals('resubmit') : t('submitForReview')}
                </button>
              )}
              {canWithdraw && (
                <button
                  type="button"
                  className={ACTION}
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/approve`,
                      method: 'POST',
                      body: { action: 'withdraw' },
                    })
                  }
                >
                  <ActionIcon name="close" />
                  {t('withdraw')}
                </button>
              )}
              {canPublishNow && (
                <button
                  type="button"
                  className={ACTION}
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/publish`,
                      method: 'POST',
                      // It goes to real Pages the moment this is pressed, and
                      // there is no taking a published post back from here.
                      confirmText: t('publishNowConfirm', { count: post.targets.length }),
                      confirmLabel: t('publishNow'),
                    })
                  }
                >
                  <ActionIcon name="megaphone" />
                  {tCompose('publishNow')}
                </button>
              )}
              {canRetryComment && (
                <button
                  type="button"
                  className={ACTION}
                  disabled={working}
                  onClick={() => act(post.id, { path: `/api/posts/${post.id}/first-comment`, method: 'POST' })}
                >
                  <ActionIcon name="comment" />
                  {t('retryComment')}
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  className={ACTION}
                  disabled={working}
                  onClick={() => act(post.id, { path: `/api/posts/${post.id}/retry`, method: 'POST' })}
                >
                  <ActionIcon name="refresh" />
                  {t('retryFailed')}
                </button>
              )}
              <button
                type="button"
                className={ACTION}
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
                <ActionIcon name="posts" />
                  {tCommon('duplicate')}
              </button>
              {canRemove && (
                <button
                  type="button"
                  className={`${ACTION} text-red-700 hover:bg-red-50`}
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}/remove`,
                      method: 'POST',
                      confirmText: t('removeConfirm', { count: post.targets.filter((target) => target.status === 'published' && !target.removed).length }),
                      confirmLabel: t('removeAction'),
                      cancelLabel: t('keepPost'),
                      danger: true,
                    })
                  }
                >
                  <ActionIcon name="trash" />
                  {t('removeAction')}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  className={`${ACTION} text-red-700 hover:bg-red-50`}
                  disabled={working}
                  onClick={() =>
                    act(post.id, {
                      path: `/api/posts/${post.id}`,
                      method: 'DELETE',
                      confirmText: t('cancelConfirm'),
                      confirmLabel: t('cancelPost'),
                      cancelLabel: t('keepPost'),
                      danger: true,
                    })
                  }
                >
                  <ActionIcon name="trash" />
                  {tCommon('cancel')}
                </button>
              )}
              {working && (
                <span className="ms-auto self-center text-xs text-slate-500" role="status">
                  {tCommon('working')}
                </span>
              )}
            </div>
          </article>
        );
          })}
        </section>
      ))}
    </div>
  );
}

/** The action bar's button: a quiet, flexible strip like Facebook's Like and Share. */
const ACTION =
  'btn flex-1 gap-1.5 whitespace-nowrap bg-transparent px-1.5 text-[13px] text-slate-600 hover:bg-slate-100 sm:gap-2 sm:px-2 sm:text-[15px]';

function ActionIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} className="shrink-0" />;
}

/** What the post carries; older callers send only the first photo. */
function attachmentsOf(post: PostView): FeedMedia[] {
  if (post.media) return post.media;
  return post.thumbnailUrl ? [{ kind: 'image', url: post.thumbnailUrl }] : [];
}

function largeText(post: PostView): boolean {
  const text = post.message.trim();
  return text.length > 0 && text.length <= LARGE_TEXT_MAX && attachmentsOf(post).length === 0 && !post.link;
}

/** Consecutive posts sharing a day, in the order the list already has them. */
function groupByDay(posts: PostView[]): Array<{ key: string; label: string; posts: PostView[] }> {
  // By key, not by run: the list is ordered by when a post is planned, and a
  // published post's day comes from when it went out, so one day can recur.
  const groups = new Map<string, { key: string; label: string; posts: PostView[] }>();
  for (const post of posts) {
    const group = groups.get(post.day.key);
    if (group) group.posts.push(post);
    else groups.set(post.day.key, { key: post.day.key, label: post.day.label, posts: [post] });
  }
  return [...groups.values()];
}
