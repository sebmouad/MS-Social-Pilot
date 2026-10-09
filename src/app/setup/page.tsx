import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MetaAppSettings } from '@/components/MetaAppSettings';
import { SetupClient } from '@/components/SetupClient';
import { metaAppSettings } from '@/lib/meta-app';
import { getAuthContext } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { isFirstRun, maySetUp, readSetupState } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('setup.title');
}


/**
 * What to do first, on a server nobody has used yet.
 *
 * A fresh deployment has no account to sign in to, so this is the screen that
 * meets whoever just installed it: what is done, what is not, what the machine
 * itself cannot do, and the next thing to press.
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

      {/* Open while the Facebook step is still to do: it is what that step needs. */}
      <div className="mt-6">
        <MetaAppSettings
          settings={metaAppSettings()}
          open={!state.steps.find((step) => step.id === 'facebookApp')?.done}
        />
      </div>
    </div>
  );
}
