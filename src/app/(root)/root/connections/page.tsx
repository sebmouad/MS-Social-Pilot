import { getTranslations } from 'next-intl/server';

import { ConnectionsList } from '@/components/root/ConnectionsList';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.connections.title');
}

/**
 * Every channel of every workspace on one screen, grouped by platform; each
 * platform's heading opens its own root section (Meta, or the network's).
 */
export default async function RootConnectionsPage() {
  await requireRoot();
  const t = await getTranslations('root.connections');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>
      <ConnectionsList linkSections />
    </div>
  );
}
