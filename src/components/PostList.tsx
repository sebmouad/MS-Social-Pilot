'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { StatusBadge } from './StatusBadge';

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
    attempts: number;
  }>;
}

export function PostList({ posts }: { posts: PostView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(postId: string, path: string, method: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(postId);
    setError(null);
    try {
      const response = await fetch(path, { method });
      const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[] };
      if (!response.ok) {
        setError(body.error ?? 'That action failed.');
        return;
      }
      if (body.errors?.length) setError(body.errors.join(' '));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (posts.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-600">
        No posts here yet.
      </div>
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
        const canRetry = post.targets.some((target) => target.status === 'failed');

        return (
          <article key={post.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm text-slate-800">
                  {post.message || <span className="text-slate-400">(no text)</span>}
                </p>
                {post.link && (
                  <a
                    href={post.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-xs text-brand-600 hover:underline"
                  >
                    {post.link}
                  </a>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {post.publishedAtLabel
                    ? `Published ${post.publishedAtLabel}`
                    : post.scheduledAtLabel
                      ? `Scheduled for ${post.scheduledAtLabel}`
                      : 'No time set'}
                  {post.publishMode === 'native' && ' · held by Facebook'}
                  {post.mediaCount > 0 && ` · ${post.mediaCount} attachment${post.mediaCount === 1 ? '' : 's'}`}
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
                    <a
                      href={target.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      View on Facebook
                    </a>
                  )}
                  {target.error && (
                    <span className="text-red-600">
                      {target.error}
                      {target.attempts > 1 && ` (${target.attempts} attempts)`}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              {canPublishNow && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === post.id}
                  onClick={() => act(post.id, `/api/posts/${post.id}/publish`, 'POST')}
                >
                  Publish now
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === post.id}
                  onClick={() => act(post.id, `/api/posts/${post.id}/retry`, 'POST')}
                >
                  Retry failed
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={busy === post.id}
                onClick={() => act(post.id, `/api/posts/${post.id}/duplicate`, 'POST')}
              >
                Duplicate
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
                      'Cancel this post? Anything already scheduled inside Facebook will be deleted there too.',
                    )
                  }
                >
                  Cancel
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
