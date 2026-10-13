import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { TemplatesClient } from '@/components/TemplatesClient';
import { requirePage } from '@/lib/auth';
import { canManageTemplates } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { listTemplates } from '@/lib/post-templates-store';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('templates.title');
}

/** Post templates: the team's saved post structures. */
export default async function TemplatesPage() {
  const auth = await requirePage();
  const t = await getTranslations('templates');
  const [templates, labels] = await Promise.all([
    listTemplates(auth.workspace.id),
    prisma.label.findMany({ where: { workspaceId: auth.workspace.id }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <TemplatesClient templates={templates} labels={labels} canEdit={canManageTemplates(auth.role)} />
    </div>
  );
}
