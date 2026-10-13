import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BioClient } from '@/components/BioClient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { getBio } from '@/lib/bio';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('bio.title');
}

/** The link-in-bio page: owners and admins. */
export default async function BioSettingsPage() {
  const auth = await requirePage();
  if (!canManageSettings(auth.role)) notFound();
  const t = await getTranslations('bio');
  const page = await getBio(auth.workspace.id);
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <BioClient
        initial={{
          slug: page?.slug ?? '',
          title: page?.title ?? auth.workspace.name,
          description: page?.description ?? '',
          avatarUrl: page?.avatarUrl ?? '',
          enabled: page?.enabled ?? true,
          links: page?.links.map((link) => ({ label: link.label, url: link.url, clicks: link.clicks })) ?? [],
        }}
      />
    </div>
  );
}
