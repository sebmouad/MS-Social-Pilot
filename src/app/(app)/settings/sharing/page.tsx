import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { ShareLinksClient } from '@/components/ShareLinksClient';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { parseTargetIds } from '@/lib/json';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('sharing.title');
}

/** Links for clients: a review page and a read-only calendar, no account needed. */
export default async function SharingPage() {
  const auth = await requirePage();
  if (!canManageSettings(auth.role)) redirect('/settings');
  const t = await getTranslations('sharing');

  const [links, pages, feedback] = await Promise.all([
    prisma.shareLink.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { createdAt: 'desc' } }),
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: TargetType.page },
      select: { id: true, name: true, pictureUrl: true },
      orderBy: { name: 'asc' },
    }),
    prisma.reviewDecision.groupBy({
      by: ['shareLinkId'],
      where: { shareLink: { workspaceId: auth.workspace.id } },
      _count: true,
    }),
  ]);
  const answers = new Map(feedback.map((row) => [row.shareLinkId, row._count]));
  const pageName = new Map(pages.map((page) => [page.id, page.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>
      <ShareLinksClient
        pages={pages}
        links={links.map((link) => ({
          id: link.id,
          kind: link.kind as 'review' | 'calendar' | 'portal',
          title: link.title,
          pages: parseTargetIds(link.targetIds).map((id) => pageName.get(id) ?? '').filter(Boolean),
          createdLabel: formatInZone(link.createdAt, auth.workspace.timezone, 'd MMM yyyy'),
          revoked: link.revokedAt !== null,
          answers: answers.get(link.id) ?? 0,
        }))}
      />
    </div>
  );
}
