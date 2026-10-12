'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { reportBrowserError } from '@/components/ErrorReporter';

/**
 * What a person sees when a page throws.
 *
 * Next's default is "Application error: a server-side exception has occurred"
 * on a blank page — no navigation, no way back, and a suggestion to check the
 * server logs, which is addressed to somebody who does not have them.
 *
 * The digest is shown deliberately. Next replaces the real message in
 * production, on purpose, because an exception can carry a token or a
 * connection string; the digest is the one string that ties what the person
 * saw to the line in the server log that explains it. Without it, "it broke"
 * is the entire bug report.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    console.error('[app] page failed to render', error);
    // A server error arrives here as a digest only; the server recorded it already.
    if (!error.digest) reportBrowserError(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-red-500 text-sm font-bold text-white">
        SP
      </span>

      <h1 className="mt-6 text-2xl font-semibold text-slate-900">{t('errorTitle')}</h1>
      <p className="mt-3 text-sm text-slate-600">{t('errorBody')}</p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {/* `reset` re-renders the segment that failed. A transient failure —
            a dropped database connection, a Graph timeout — clears without a
            full reload, which is most of them. */}
        <button type="button" className="btn-primary" onClick={() => reset()}>
          {t('tryAgain')}
        </button>
        <Link href="/dashboard" className="btn-secondary">
          {t('backToDashboard')}
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-slate-400">
          {t('reference')}: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </main>
  );
}
