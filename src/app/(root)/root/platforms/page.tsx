import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Icon } from '@/components/Icon';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { NETWORK_LABELS } from '@/lib/networks';
import { prisma } from '@/lib/prisma';
import { platformOf } from '@/lib/root-connections';
import { META_CHANNEL_PLATFORMS, OTHER_PLATFORMS } from '@/lib/root-platforms';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.platforms.title');
}

/** Every platform root sets up, with how many channels each one has. Root only. */
export default async function RootPlatformsPage() {
  await requireRoot();
  const t = await getTranslations('root.platforms');
  const counts = await prisma.target.groupBy({ by: ['type'], _count: { _all: true } });
  const channels = new Map<string, number>();
  for (const row of counts) {
    const platform = platformOf(row.type as string);
    channels.set(platform, (channels.get(platform) ?? 0) + row._count._all);
  }
  const metaCount = META_CHANNEL_PLATFORMS.reduce((sum, platform) => sum + (channels.get(platform) ?? 0), 0);
  const tiles = [
    { href: '/root/meta', label: t('meta'), count: metaCount },
    ...OTHER_PLATFORMS.map((platform) => ({ href: `/root/platforms/${platform}`, label: NETWORK_LABELS[platform], count: channels.get(platform) ?? 0 })),
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('overviewSubtitle')}</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link href={tile.href} className="card flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-slate-900">{tile.label}</span>
                <span className="block text-sm text-slate-500">{t('channels', { count: tile.count })}</span>
              </span>
              <Icon name="chevronRight" size={18} className="shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/root/connections" className="inline-flex text-sm font-semibold text-brand-600 hover:underline">
        {t('allConnections')}
      </Link>
    </div>
  );
}
