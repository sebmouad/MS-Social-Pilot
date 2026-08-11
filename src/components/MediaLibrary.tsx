'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

export interface MediaFileView {
  id: string;
  filename: string;
  kind: 'image' | 'video';
  size: number;
  url: string;
  uploadedLabel: string;
  /** Posts that have not gone out yet and still reference this file. */
  heldBy: Array<{ id: string; excerpt: string }>;
}

interface Props {
  files: MediaFileView[];
  usage: { bytes: number; quotaBytes: number; percent: number };
  truncated: boolean;
}

function megabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The media library.
 *
 * A file held by a post that has not gone out yet cannot be deleted, and the
 * screen says which posts and links to them. The API enforces this either way —
 * deleting a file out from under a scheduled post would fail hours later as a
 * Graph error nobody could connect back to a deletion — but a Delete button
 * that answers 409 teaches somebody the product is broken rather than that the
 * file is in use.
 */
export function MediaLibrary({ files, usage, truncated }: Props) {
  const t = useTranslations('media');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(file: MediaFileView) {
    if (!window.confirm(t('deleteConfirm', { filename: file.filename }))) return;

    setBusy(file.id);
    setError(null);
    try {
      const response = await fetch(`/api/media/${file.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('deleteFailed'));
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const nearlyFull = usage.percent >= 80;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{t('usageTitle')}</h2>
          <p className="text-sm text-slate-600">
            {t('usageOf', {
              used: megabytes(usage.bytes),
              total: megabytes(usage.quotaBytes),
            })}
          </p>
        </div>

        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={usage.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('usageTitle')}
        >
          <div
            className={`h-full rounded-full ${nearlyFull ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${Math.max(usage.percent, 1)}%` }}
          />
        </div>

        {nearlyFull && <p className="mt-2 text-xs text-amber-700">{t('usageNearlyFull')}</p>}
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => {
            const held = file.heldBy.length > 0;

            return (
              <li key={file.id} className="card flex flex-wrap items-start gap-4 p-4">
                {file.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.url}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
                    <Icon name="video" size={22} />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{file.filename}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {megabytes(file.size)} · {file.uploadedLabel}
                  </p>

                  {held && (
                    <p className="mt-2 text-xs text-slate-600">
                      {t('heldBy', { count: file.heldBy.length })}{' '}
                      {file.heldBy.map((post, index) => (
                        <span key={post.id}>
                          {index > 0 && ', '}
                          <Link
                            href={`/compose?post=${post.id}`}
                            className="text-brand-600 hover:underline"
                          >
                            {post.excerpt}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-danger shrink-0"
                  disabled={held || busy === file.id}
                  title={held ? t('heldTooltip') : undefined}
                  onClick={() => void remove(file)}
                >
                  <Icon name="trash" size={15} />{' '}
                  {busy === file.id ? tCommon('working') : tCommon('delete')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {truncated && <p className="text-xs text-slate-500">{t('truncated')}</p>}
    </div>
  );
}
