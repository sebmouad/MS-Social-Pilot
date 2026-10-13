import { SubTabs } from '@/components/SubTabs';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { ContentMixClient } from '@/components/ContentMixClient';
import { ChannelsLayout } from '@/components/ChannelsLayout';
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
 * Content mix: how many posts of each label the coming week
 * should hold per Page or group, and how far the plan is from it.
 */
export default async function ContentMixPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('mix');
  const tNav = await getTranslations('nav');
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
    <ChannelsLayout auth={auth} selection={selection}>
    <div className="min-w-0 flex-1 space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} actions={<SubTabs label={tNav('contentMix')} current="/queue/mix" items={[{ href: '/queue', label: tNav('queue') }, { href: '/queue/mix', label: tNav('contentMix') }]} />} />
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
    </ChannelsLayout>
  );
}
