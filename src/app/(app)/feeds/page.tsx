import { TargetType } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { FeedsClient } from '@/components/FeedsClient';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { parseTargetIds } from '@/lib/json';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('feeds.title');
}


export default async function FeedsPage() {
  const auth = await requirePage();
  const t = await getTranslations('feeds');
  const timezone = auth.workspace.timezone;

  const [feeds, targets] = await Promise.all([
    prisma.feedSource.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    // Facebook only: see `assertNoInstagram`. Offering a destination every
    // item would fail on is worse than not offering it.
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: { not: TargetType.instagram } },
      include: { socialAccount: { select: { name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <FeedsClient
        canManage={canManageSettings(auth.role)}
        feeds={feeds.map((feed) => ({
          id: feed.id,
          name: feed.name,
          url: feed.url,
          enabled: feed.enabled,
          autoApprove: feed.autoApprove,
          messageTemplate: feed.messageTemplate,
          targetIds: parseTargetIds(feed.targetIds),
          lastPolledLabel: feed.lastPolledAt ? formatInZone(feed.lastPolledAt, timezone) : null,
          lastError: feed.lastError,
          pollErrorCount: feed.pollErrorCount,
          itemCount: feed._count.items,
        }))}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.publishBlocker,
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}
