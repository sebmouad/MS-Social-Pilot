import { getTranslations } from 'next-intl/server';

import { ContentMixClient } from '@/components/ContentMixClient';
import { SelectionBar } from '@/components/SelectionBar';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { mixStatus } from '@/lib/content-mix';
import { screenMetadata } from '@/lib/metadata';
import { loadSelection } from '@/lib/page-filter';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('mix.title');
}

/**
 * Content mix (NEXT_PHASES H1): how many posts of each label the coming week
 * should hold per Page or group, and how far the plan is from it.
 */
export default async function ContentMixPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('mix');
  const selection = await loadSelection(auth, await searchParams);
  const workspaceId = auth.workspace.id;

  const [pages, groups, labels, rules, workspace, status] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId, enabled: true, id: { in: selection.ids } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.pageGroup.findMany({
      where: { workspaceId },
      select: { id: true, name: true, pages: { select: { targetId: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.label.findMany({ where: { workspaceId }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
    prisma.contentMixRule.findMany({ where: { workspaceId }, select: { targetId: true, groupId: true, labelId: true, perWeek: true } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { mixAutoFill: true } }),
    mixStatus(workspaceId, new Date(), selection.ids),
  ]);
  const visible = new Set(pages.map((page) => page.id));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </div>
        <SelectionBar auth={auth} selection={selection} />
      </header>
      <ContentMixClient
        canEdit={canManageSettings(auth.role)}
        autoFill={workspace.mixAutoFill}
        pages={pages}
        // A group is offered when one of its Pages is in view; its rules still apply to all of them.
        groups={groups
          .filter((group) => group.pages.some((entry) => visible.has(entry.targetId)))
          .map((group) => ({ id: group.id, name: group.name }))}
        labels={labels}
        rules={rules.filter((rule) => (rule.targetId ? visible.has(rule.targetId) : true))}
        status={status}
      />
    </div>
  );
}
