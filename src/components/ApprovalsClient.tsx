'use client';

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
  mediaCount: number;
}

export function ApprovalsClient({ posts }: { posts: PendingPost[] }) {
  const t = useTranslations('approvals');
  const tPosts = useTranslations('posts');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(postId: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(postId);
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/posts/${postId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? tPosts('actionFailed'));
      setBusy(null);
      return;
    }

    setNotice(successMessage);
    setRejecting(null);
    setNote('');
    setBusy(null);
    router.refresh();
  }

  if (posts.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-600">{t('none')}</div>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {posts.map((post) => (
        <article key={post.id} className="card p-5">
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

          <p className="mt-2 text-xs text-slate-500">
            {t('submittedBy', { name: post.submittedBy })}
            {post.submittedLabel ? ` · ${post.submittedLabel}` : ''}
            {post.scheduledLabel ? ` · ${tPosts('scheduledFor', { when: post.scheduledLabel })}` : ''}
            {post.mediaCount > 0 ? ` · ${tPosts('attachments', { count: post.mediaCount })}` : ''}
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
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy === post.id || note.trim().length === 0}
                  onClick={() => act(post.id, { action: 'reject', note }, t('rejected'))}
                >
                  {t('reject')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
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
                onClick={() => act(post.id, { action: 'approve' }, t('approved'))}
              >
                {t('approve')}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy === post.id}
                onClick={() => setRejecting(post.id)}
              >
                {t('reject')}
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
