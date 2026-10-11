'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { FeedPost, type FeedLinkPreview } from './FeedPost';

export interface PendingPost {
  id: string;
  message: string;
  /** Reviewed with the post: it goes out under the same name. */
  firstComment: string | null;
  link: string | null;
  linkPreview: FeedLinkPreview | null;
  scheduledLabel: string | null;
  /** Its scheduled moment has gone, so approving publishes it immediately. */
  overdue: boolean;
  submittedBy: string;
  submittedLabel: string | null;
  targets: string[];
  /** The first destination's photo, for the post's header. */
  pictureUrl: string | null;
  media: Array<{ id: string; kind: 'image' | 'video'; url: string; altText: string | null }>;
  /** The reviewer may open it in the composer and change it themselves. */
  editable: boolean;
}

export function ApprovalsClient({ posts }: { posts: PendingPost[] }) {
  const t = useTranslations('approvals');
  const tPosts = useTranslations('posts');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Send a decision.
   *
   * `finally` clears the busy state whatever happens, a dropped connection
   * included, so a failed request never leaves the buttons disabled.
   */
  async function act(postId: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(postId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/posts/${postId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; notice?: string };
      if (!response.ok) {
        setError(payload.error ?? tPosts('actionFailed'));
        return;
      }

      // The server's own word wins when it has one: it knows things this
      // screen does not, such as a post Facebook would not hold falling back
      // to our worker.
      setNotice(payload.notice ?? successMessage);
      setRejecting(null);
      setNote('');
      router.refresh();
    } catch {
      setError(tPosts('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function approve(post: PendingPost) {
    // The badge says it, but a reviewer clearing a queue presses the same
    // button down the list; an overdue post goes out to real Pages the moment
    // this lands, so it gets asked about rather than just labelled.
    if (post.overdue && !(await confirm({ title: t('overdueConfirm'), confirmLabel: t('approve') }))) return;
    void act(post.id, { action: 'approve' }, post.overdue ? t('approvedNow') : t('approved'));
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

      {/* Below the banners, not instead of them: approving the last post in
          the queue empties it, and that is exactly when "approved" has to
          still be on screen. */}
      {posts.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-600">{t('none')}</div>
      )}

      {posts.map((post) => (
        <article key={post.id} aria-busy={busy === post.id}>
          {/* Exactly what will go out, drawn as Facebook will draw it: the
              reviewer signs off on the post, not on a description of it. */}
          <FeedPost
            as="div"
            className="rounded-b-none"
            author={{ name: post.targets.join(', '), pictureUrl: post.pictureUrl }}
            meta={post.scheduledLabel ? tPosts('scheduledFor', { when: post.scheduledLabel }) : tPosts('noTimeSet')}
            badge={
              post.overdue ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {t('overdue')}
                </span>
              ) : undefined
            }
            message={post.message}
            emptyText={tPosts('noText')}
            media={post.media.map((item) => ({ kind: item.kind, url: item.url, alt: item.altText }))}
            link={post.link}
            linkPreview={post.linkPreview}
            comment={post.firstComment ? { text: post.firstComment } : undefined}
          />
          <div className="card rounded-t-none border-t border-slate-200 p-4 shadow-surface">
          <p className="text-xs text-slate-500">
            {t('submittedBy', { name: post.submittedBy })}
            {post.submittedLabel ? ` · ${post.submittedLabel}` : ''}
            {post.media.length > 0 ? ` · ${tPosts('attachments', { count: post.media.length })}` : ''}
          </p>

          {rejecting === post.id ? (
            <div className="mt-4 space-y-2">
              <label className="label" htmlFor={`note-${post.id}`}>
                {t('rejectReason')}
              </label>
              <textarea
                id={`note-${post.id}`}
                className="input min-h-[72px]"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy === post.id || note.trim().length === 0}
                  onClick={() => act(post.id, { action: 'reject', note }, t('rejected'))}
                >
                  {busy === post.id ? tCommon('working') : t('reject')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === post.id}
                  onClick={() => {
                    setRejecting(null);
                    setNote('');
                  }}
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy === post.id}
                onClick={() => approve(post)}
              >
                {busy === post.id ? tCommon('working') : t('approve')}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy === post.id}
                onClick={() => {
                  // One note box at a time: a half-written reason for another
                  // post must not be sent as this one's.
                  setRejecting(post.id);
                  setNote('');
                }}
              >
                {t('reject')}
              </button>
              {post.editable && (
                <Link href={`/compose?post=${post.id}`} className="btn-secondary">
                  {tCommon('edit')}
                </Link>
              )}
            </div>
          )}
          </div>
        </article>
      ))}
    </div>
  );
}
