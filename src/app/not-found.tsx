import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { getAuthContext } from '@/lib/auth';

/**
 * The page for a link that leads nowhere.
 *
 * Next's own is a black line of text on white with no way back, no navigation
 * and no translation. Two screens call `notFound()` deliberately — a post that
 * has been published since somebody bookmarked the edit link, an analytics row
 * that has been deleted — so this is a page real people reach by following a
 * link that was valid yesterday, not only by mistyping a URL.
 *
 * It says nothing has happened to their account, because a bare 404 in an app
 * you are signed into reads as though something might have.
 */
export default async function NotFound() {
  const t = await getTranslations('errors');
  const auth = await getAuthContext().catch(() => null);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
        SP
      </span>

      <h1 className="mt-6 text-2xl font-semibold text-slate-900">{t('notFoundTitle')}</h1>
      <p className="mt-3 text-sm text-slate-600">{t('notFoundBody')}</p>

      <p className="mt-8">
        <Link href={auth ? '/dashboard' : '/login'} className="btn-primary">
          {auth ? t('backToDashboard') : t('backToSignIn')}
        </Link>
      </p>
    </main>
  );
}
