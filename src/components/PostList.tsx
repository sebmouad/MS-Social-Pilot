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

export function PostList({ posts }: { posts: PostView[] }) {
  const t = useTranslations('posts');

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

  async function act(postId: string, path: string, method: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(postId);
    setError(null);
    try {
      const response = await fetch(path, { method });
      const body = (await response.json().catch(() => ({}))) as { error?: string; failures?: string[] };
      if (!response.ok) {
        setError(body.error ?? t('actionFailed'));
        return;
      }
      if (body.failures?.length) setError(body.failures.join(' '));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (posts.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-600">{t('noPosts')}</div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {posts.map((post) => {
        const canPublishNow = ['draft', 'scheduled', 'failed', 'partially_failed'].includes(post.status);
        const canCancel = ['draft', 'scheduled'].includes(post.status);
        // The same rule the API enforces, so the button is never a dead end.
        const canEdit = postIsEditable(post);
        const canRetry = post.targets.some((target) => target.status === 'failed');

        return (
          <article key={post.id} className="card p-5">
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
              {canPublishNow && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === post.id}
                  onClick={() => act(post.id, `/api/posts/${post.id}/publish`, 'POST')}
                >
                  {tCompose('publishNow')}
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === post.id}
                  onClick={() => act(post.id, `/api/posts/${post.id}/retry`, 'POST')}
                >
                  {t('retryFailed')}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={busy === post.id}
                onClick={() => act(post.id, `/api/posts/${post.id}/duplicate`, 'POST')}
              >
                {tCommon('duplicate')}
              </button>
              {canCancel && (
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy === post.id}
                  onClick={() =>
                    act(
                      post.id,
                      `/api/posts/${post.id}`,
                      'DELETE',
                      t('cancelConfirm'),
                    )
                  }
                >
                  {tCommon('cancel')}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
