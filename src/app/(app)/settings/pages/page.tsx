import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { GroupsAndLabels } from '@/components/GroupsAndLabels';
import { PageProfiles } from '@/components/PageProfiles';
import { requirePage } from '@/lib/auth';
import { canManageSettings, canPublishWithoutApproval } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { targetScope } from '@/lib/page-access';
import { listLabels, listPageGroups } from '@/lib/page-groups';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('groups.title');
}

/**
 * How the workspace's Pages and posts are sorted: Page groups — a client, a
 * brand, a country — and the labels posts carry. Both are used everywhere
 * else as one-click filters; this is where they are made.
 */
export default async function PagesAndGroupsPage() {
  const auth = await requirePage();
  const t = await getTranslations('groups');

  const [pages, groups, labels, usage] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: { not: TargetType.group }, ...targetScope(auth.pageScope) },
      select: {
        id: true,
        name: true,
        pictureUrl: true,
        type: true,
        category: true,
        brandVoice: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
      },
      orderBy: { name: 'asc' },
    }),
    listPageGroups(auth.workspace.id, auth.pageScope),
    listLabels(auth.workspace.id),
    prisma.postLabel.groupBy({ by: ['labelId'], where: { label: { workspaceId: auth.workspace.id } }, _count: true }),
  ]);
  const used = new Map(usage.map((row) => [row.labelId, row._count]));
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: auth.workspace.id },
    select: { utmSource: true, utmMedium: true, utmCampaignTemplate: true },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <PageProfiles
        canEdit={canManageSettings(auth.role)}
        workspaceUtm={{ source: workspace.utmSource, medium: workspace.utmMedium, campaign: workspace.utmCampaignTemplate }}
        pages={pages
          .filter((page) => page.type === TargetType.page)
          .map(({ type: _type, ...page }) => page)}
      />

      <GroupsAndLabels
        canManageGroups={canManageSettings(auth.role)}
        canManageLabels={canPublishWithoutApproval(auth.role)}
        pages={pages.map(({ id, name, pictureUrl, type, category }) => ({ id, name, pictureUrl, type, category }))}
        groups={groups}
        labels={labels.map((label) => ({ ...label, posts: used.get(label.id) ?? 0 }))}
      />
    </div>
  );
}
