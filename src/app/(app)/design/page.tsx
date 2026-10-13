import { getTranslations } from 'next-intl/server';

import { DesignEditor } from '@/components/DesignEditor';
import { ScreenHeader } from '@/components/ScreenHeader';
import { imageAvailable } from '@/lib/ai-image';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('design.title');
}

/** A small editor for post pictures: a size, a background, some text, then into the media library. */
export default async function DesignPage() {
  const auth = await requirePage();
  const t = await getTranslations('design');
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { aiEnabled: true } });
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <DesignEditor canGenerate={workspace.aiEnabled && imageAvailable()} />
    </div>
  );
}
