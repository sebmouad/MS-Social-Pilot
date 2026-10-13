import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ConfigClient } from '@/components/ConfigClient';
import { ConnectionsList } from '@/components/root/ConnectionsList';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { NETWORK_LABELS } from '@/lib/networks';
import { isOtherPlatform, settingSection } from '@/lib/root-platforms';
import { GROUP_LABELS, GROUP_ORDER, describeSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.platforms.title');
}

/**
 * One network's root section: its switch and app credentials (moved out of
 * Configuration) and every channel connected to it. Root only.
 */
export default async function RootPlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  await requireRoot();
  const { platform } = await params;
  if (!isOtherPlatform(platform)) notFound();
  const t = await getTranslations('root.platforms');
  const label = NETWORK_LABELS[platform];
  const settings = (await describeSettings()).filter((entry) => settingSection(entry.key, entry.group) === platform);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{label}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle', { network: label })}</p>
      </header>

      <ConfigClient settings={settings} groupLabels={{ ...GROUP_LABELS, networks: t('settingsTitle') }} groupOrder={GROUP_ORDER} />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">{t('channelsTitle')}</h2>
        <ConnectionsList platforms={[platform]} />
      </section>
    </div>
  );
}
