import { getTranslations } from 'next-intl/server';

import { ConfigClient } from '@/components/ConfigClient';
import { aiSpend } from '@/lib/ai';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { GROUP_LABELS, GROUP_ORDER, describeSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('config.title');
}

/**
 * Instance configuration: every integration key and app-wide setting. Root
 * only, and not scoped to a workspace — these settings are the whole
 * installation's.
 */
export default async function RootConfigPage() {
  await requireRoot();
  const t = await getTranslations('config');
  const [settings, spend] = await Promise.all([describeSettings(), aiSpend()]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <ConfigClient settings={settings} groupLabels={GROUP_LABELS} groupOrder={GROUP_ORDER} aiSpend={spend} />

      <p className="text-xs text-slate-500">{t('footnote')}</p>
    </div>
  );
}
