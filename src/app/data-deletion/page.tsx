import { getTranslations } from 'next-intl/server';

/**
 * Status page for Facebook data deletion requests.
 *
 * The data-deletion callback returns this URL plus a confirmation code, and
 * Meta requires that a user can visit it to check on their request. Deletion is
 * performed synchronously by the callback, so by the time anyone lands here the
 * work is already done.
 *
 * The visitor is usually signed out — they arrive from Facebook, not from the
 * app — so the language comes from their browser's Accept-Language.
 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const t = await getTranslations('connections.dataDeletion');

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 sm:px-6">
      <div className="card p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>

        {code ? (
          <>
            <p className="mt-3 text-sm text-slate-600">{t('completed')}</p>
            <p className="mt-4 text-sm text-slate-600">
              {t('code')}{' '}
              <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{code}</code>
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">{t('noCode')}</p>
        )}

        <p className="mt-6 text-xs text-slate-500">{t('retained')}</p>
      </div>
    </main>
  );
}
