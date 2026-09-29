'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from './ExternalLink';

export interface PendingPost {
  id: string;
  message: string;
  link: string | null;
  scheduledLabel: string | null;
  /** Its scheduled moment has gone, so approving publishes it immediately. */
  overdue: boolean;
  submittedBy: string;
  submittedLabel: string | null;
  targets: string[];
  media: Array<{ id: string; kind: 'image' | 'video'; url: string; altText: string | null }>;
  /** The reviewer may open it in the composer and change it themselves. */
  editable: boolean;
}

/** Enough to recognise what is attached; the composer shows the rest. */
const THUMBNAILS = 4;

export function ApprovalsClient({ posts }: { posts: PendingPost[] }) {
  const t = useTranslations('approvals');
  const tPosts = useTranslations('posts');
  const tCommon = useTranslations('common');
  const tCompose = useTranslations('compose');
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

  function approve(post: PendingPost) {
    // The badge says it, but a reviewer clearing a queue presses the same
    // button down the list; an overdue post goes out to real Pages the moment
    // this lands, so it gets asked about rather than just labelled.
    if (post.overdue && !window.confirm(t('overdueConfirm'))) return;
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
        <article key={post.id} className="card p-5" aria-busy={busy === post.id}>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-800">
            {post.message || <span className="text-slate-400">{tPosts('noText')}</span>}
          </p>

          {post.link && (
            <ExternalLink
              href={post.link}
              className="mt-1 block truncate text-xs text-brand-600 hover:underline"
            >
              {post.link}
            </ExternalLink>
          )}

          {post.media.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={tPosts('attachments', { count: post.media.length })}>
              {post.media.slice(0, THUMBNAILS).map((item, index) => (
                <li key={item.id ?? index}>
                  {item.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- uploads and external URLs alike; next/image would need every host allow-listed
                    <img
                      src={item.url}
                      alt={item.altText ?? ''}
                      loading="lazy"
                      className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600">
                      {tCompose('video')}
                    </span>
                  )}
                </li>
              ))}
              {post.media.length > THUMBNAILS && (
                <li className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                  {t('moreMedia', { count: post.media.length - THUMBNAILS })}
                </li>
              )}
            </ul>
          )}

          <p className="mt-2 text-xs text-slate-500">
            {t('submittedBy', { name: post.submittedBy })}
            {post.submittedLabel ? ` · ${post.submittedLabel}` : ''}
            {post.scheduledLabel ? ` · ${tPosts('scheduledFor', { when: post.scheduledLabel })}` : ''}
            {post.media.length > 0 ? ` · ${tPosts('attachments', { count: post.media.length })}` : ''}
          </p>

          {/* A queue worked through after a week away is where this matters:
              every overdue post in it goes out the moment it is approved. */}
          {post.overdue && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {t('overdue')}
            </p>
          )}

          <p className="mt-1 text-xs text-slate-500">{post.targets.join(', ')}</p>

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
        </article>
      ))}
    </div>
  );
}
