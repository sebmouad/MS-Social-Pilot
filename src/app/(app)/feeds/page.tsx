import { PostStatus, TargetType } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { FeedsClient } from '@/components/FeedsClient';
import { requirePage } from '@/lib/auth';
import { targetScope } from '@/lib/page-access';
import { screenMetadata } from '@/lib/metadata';
import { canManageSettings, postIsEditable } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { parseTargetIds } from '@/lib/json';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('feeds.title');
}

/** How many of each feed's latest imports to list. */
const RECENT_ITEMS = 5;

/**
 * Where an imported item's post is best looked at, which depends on where it
 * is in its life: in review, still editable, or already out.
 */
function postHref(post: { id: string; status: PostStatus; targets: Array<{ id: string; status: string }> }): string {
  if (post.status === PostStatus.pending_approval) return '/approvals';
  const published = post.targets.find((target) => target.status === 'published');
  if (published) return `/analytics/post/${published.id}`;
  if (postIsEditable(post)) return `/compose?post=${post.id}`;
  return `/posts?status=${post.status}`;
}

export default async function FeedsPage() {
  const auth = await requirePage();
  const t = await getTranslations('feeds');
  const timezone = auth.workspace.timezone;

  const [feeds, targets] = await Promise.all([
    prisma.feedSource.findMany({
      where: { workspaceId: auth.workspace.id },
      include: {
        _count: { select: { items: true } },
        // What the feed actually did lately, so "12 items imported" can be
        // checked against the posts it turned into.
        items: {
          orderBy: { createdAt: 'desc' },
          take: RECENT_ITEMS,
          include: {
            posts: {
              take: 1,
              select: {
                id: true,
                status: true,
                targets: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Facebook only: see `assertNoInstagram`. Offering a destination every
    // item would fail on is worse than not offering it.
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: { not: TargetType.instagram }, ...targetScope(auth.pageScope) },
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
          recentItems: feed.items.map((item) => {
            const post = item.posts[0];
            return {
              id: item.id,
              title: item.title,
              url: item.url,
              importedLabel: formatInZone(item.createdAt, timezone),
              post: post ? { status: post.status, href: postHref(post) } : null,
            };
          }),
        }))}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.publishBlocker,
          publishBlockerCode: target.publishBlockerCode,
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}
