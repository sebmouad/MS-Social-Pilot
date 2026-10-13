import { getTranslations } from 'next-intl/server';

import { DesignEditor } from '@/components/DesignEditor';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('design.title');
}

/** A small editor for post pictures: a size, a background, some text, then into the media library. */
export default async function DesignPage() {
  await requirePage();
  const t = await getTranslations('design');
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <DesignEditor />
    </div>
  );
}
