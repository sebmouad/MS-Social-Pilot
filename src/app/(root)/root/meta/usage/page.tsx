import { getTranslations } from 'next-intl/server';

import { MetaUsagePanel } from '@/components/root/MetaUsagePanel';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.meta.usageTitle');
}

/** How much of Meta's call allowance the installation uses. Root only. */
export default async function RootMetaUsagePage() {
  await requireRoot();
  const t = await getTranslations('root.meta');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('usageTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('usageSubtitle')}</p>
      </header>
      <MetaUsagePanel />
    </div>
  );
}
