import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { GroupsAndLabels } from '@/components/GroupsAndLabels';
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
      select: { id: true, name: true, pictureUrl: true, type: true, category: true },
      orderBy: { name: 'asc' },
    }),
    listPageGroups(auth.workspace.id, auth.pageScope),
    listLabels(auth.workspace.id),
    prisma.postLabel.groupBy({ by: ['labelId'], where: { label: { workspaceId: auth.workspace.id } }, _count: true }),
  ]);
  const used = new Map(usage.map((row) => [row.labelId, row._count]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <GroupsAndLabels
        canManageGroups={canManageSettings(auth.role)}
        canManageLabels={canPublishWithoutApproval(auth.role)}
        pages={pages}
        groups={groups}
        labels={labels.map((label) => ({ ...label, posts: used.get(label.id) ?? 0 }))}
      />
    </div>
  );
}
