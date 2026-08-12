import { getTranslations } from 'next-intl/server';

import { ConfigClient } from '@/components/ConfigClient';
import { SettingsNav } from '@/components/SettingsNav';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageInstance } from '@/lib/constants';
import { GROUP_LABELS, GROUP_ORDER, describeSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('config.title');
}


/**
 * Instance configuration.
 *
 * Owner-only, and not scoped to a workspace: these settings are the whole
 * installation's, so an agency admin for one client has no business reading
 * which integrations another client's installation has configured.
 */
export default async function ConfigPage() {
  const auth = await requirePage();
  const t = await getTranslations('config');

  if (!canManageInstance(auth.role)) {
    // Still a titled page. Someone who followed a colleague's link here lands
    // on a card with no heading otherwise: nothing names the screen they are
    // looking at, and a screen reader announces a document with no title.
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        </header>

        <SettingsNav showConfig={canManageInstance(auth.role)} />

        <div className="card p-8 text-center text-sm text-slate-600">{t('ownerOnly')}</div>
      </div>
    );
  }

  const settings = await describeSettings();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsNav showConfig={canManageInstance(auth.role)} />

      <ConfigClient settings={settings} groupLabels={GROUP_LABELS} groupOrder={GROUP_ORDER} />

      <p className="text-xs text-slate-500">{t('footnote')}</p>
    </div>
  );
}
