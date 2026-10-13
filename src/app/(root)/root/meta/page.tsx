import { getTranslations } from 'next-intl/server';

import { AppCheckButton } from '@/components/AppCheckButton';
import { ConfigClient } from '@/components/ConfigClient';
import { MetaAppSettings } from '@/components/MetaAppSettings';
import { requireRoot } from '@/lib/auth';
import { metaAppSettings } from '@/lib/meta-app';
import { screenMetadata } from '@/lib/metadata';
import { settingSection } from '@/lib/root-platforms';
import { GROUP_LABELS, GROUP_ORDER, describeSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.meta.title');
}

/**
 * Meta (Facebook and Instagram): the values Meta's app dashboard asks for,
 * the app's credentials and Graph settings, Meta-only feature switches, and a
 * live check of the app ID and secret. Root only.
 */
export default async function RootMetaPage() {
  await requireRoot();
  const t = await getTranslations('root.meta');
  const settings = (await describeSettings()).filter((entry) => settingSection(entry.key, entry.group) === 'meta');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('checkTitle')}</h2>
        <AppCheckButton />
      </section>

      <div id="meta-app" className="scroll-mt-20">
        <MetaAppSettings settings={metaAppSettings()} open />
      </div>

      <ConfigClient settings={settings} groupLabels={GROUP_LABELS} groupOrder={GROUP_ORDER} />
    </div>
  );
}
