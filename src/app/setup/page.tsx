import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SetupClient } from '@/components/SetupClient';
import { getAuthContext } from '@/lib/auth';
import { isFirstRun, maySetUp, readSetupState } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * What to do first, on a server nobody has used yet.
 *
 * A fresh deployment used to answer the browser with a sign-in form for an
 * account that does not exist. This is the screen that should meet somebody
 * instead: what is done, what is not, and the next thing to press.
 */
export default async function SetupPage() {
  const auth = await getAuthContext();
  const firstRun = await isFirstRun();

  // Not an error page: someone who cannot set up the installation has no
  // business here but is perfectly entitled to the app.
  if (!maySetUp(auth, firstRun)) redirect('/dashboard');

  const t = await getTranslations('setup');
  const state = await readSetupState(auth?.workspace.id ?? null);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {state.complete ? t('subtitleComplete') : t('subtitle')}
        </p>
      </header>

      <div className="mt-8">
        <SetupClient state={state} signedIn={auth !== null} />
      </div>
    </div>
  );
}
