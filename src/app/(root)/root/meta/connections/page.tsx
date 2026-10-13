import { getTranslations } from 'next-intl/server';

import { ConnectionsList } from '@/components/root/ConnectionsList';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { META_CHANNEL_PLATFORMS } from '@/lib/root-platforms';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.meta.connectionsTitle');
}

/** Every Facebook and Instagram channel of every workspace, with the live connection check. Root only. */
export default async function RootMetaConnectionsPage() {
  await requireRoot();
  const t = await getTranslations('root.meta');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('connectionsTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('connectionsSubtitle')}</p>
      </header>
      <ConnectionsList platforms={META_CHANNEL_PLATFORMS} />
    </div>
  );
}
