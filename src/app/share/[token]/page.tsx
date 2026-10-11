import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { FeedPost } from '@/components/FeedPost';
import { ShareReview } from '@/components/ShareReview';
import { StatusBadge } from '@/components/StatusBadge';
import { feedLinkOf, feedMediaOf, feedMediaOfPicture } from '@/lib/feed';
import { prisma } from '@/lib/prisma';
import { openShareLink, sharedPostWhere } from '@/lib/share-links';
import { screenMetadata } from '@/lib/metadata';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { ...(await screenMetadata('share.title')), robots: { index: false, follow: false } };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * What a client sees from a shared link, with no account: the posts waiting
 * for their decision, or the plan for the coming weeks. Branded with the
 * workspace's logo, and nothing else of the app around it.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await openShareLink(token);
  if (!link) notFound();
  const t = await getTranslations('share');
  const tCommon = await getTranslations('common');
  const timezone = link.workspace.timezone;
  const now = new Date();

  const posts = await prisma.post.findMany({
    where: {
      ...sharedPostWhere(link),
      ...(link.kind === 'review'
        ? { status: { in: ['pending_approval', 'scheduled', 'draft'] }, OR: [{ scheduledAt: { gte: now } }, { scheduledAt: null }] }
        : {
            status: { in: ['scheduled', 'published', 'partially_failed', 'failed', 'pending_approval'] },
            scheduledAt: { gte: new Date(now.getTime() - link.daysBack * DAY), lte: new Date(now.getTime() + link.daysAhead * DAY) },
          }),
    },
    include: {
      targets: {
        where: link.pageIds.length ? { targetId: { in: link.pageIds } } : {},
        include: { target: { select: { name: true, pictureUrl: true } } },
      },
      reviewDecisions: link.kind === 'review' ? { where: { shareLinkId: link.id }, orderBy: { createdAt: 'asc' } } : false,
    },
    orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 100,
  });

  // A calendar shows the Page as it is, so what went out from Facebook itself
  // belongs on it too — not only what was sent from here.
  const sentFromHere = new Set(posts.flatMap((post) => post.targets.map((row) => row.remotePostId)).filter(Boolean));
  const found =
    link.kind === 'calendar'
      ? await prisma.externalPost.findMany({
          where: {
            target: { workspaceId: link.workspaceId },
            ...(link.pageIds.length ? { targetId: { in: link.pageIds } } : {}),
            createdTime: { gte: new Date(now.getTime() - link.daysBack * DAY), lte: now },
          },
          include: { target: { select: { name: true, pictureUrl: true } } },
          orderBy: { createdTime: 'asc' },
          take: 100,
        })
      : [];

  interface Item {
    id: string;
    at: Date | null;
    author: { name: string; pictureUrl: string | null };
    status: string;
    message: string;
    media: ReturnType<typeof feedMediaOf>;
    link: string | null;
    linkPreview: ReturnType<typeof feedLinkOf>;
    post?: (typeof posts)[number];
  }
  const items: Item[] = [
    ...posts.map((post) => ({
      id: post.id,
      at: post.scheduledAt,
      author: {
        name: post.targets.map((row) => row.target.name).join(', '),
        pictureUrl: post.targets[0]?.target.pictureUrl ?? null,
      },
      status: post.status,
      message: post.message,
      media: feedMediaOf(post.media),
      link: post.link,
      linkPreview: feedLinkOf(post.linkPreview),
      post,
    })),
    ...found
      .filter((row) => !sentFromHere.has(row.remoteId))
      .map((row) => ({
        id: row.id,
        at: row.createdTime,
        author: { name: row.target.name, pictureUrl: row.target.pictureUrl },
        status: 'published',
        message: row.message ?? '',
        media: feedMediaOfPicture(row.pictureUrl, row.statusType === 'added_video'),
        link: null,
        linkPreview: null,
      })),
  ].sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));

  const days = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.at ? formatInZone(item.at, timezone, 'EEEE d MMMM') : t('noDate');
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-4">
          {link.workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.workspace.logoUrl} alt={link.workspace.name} className="h-9 max-w-[140px] object-contain" />
          ) : (
            <span className="text-[15px] font-bold text-slate-900">{link.workspace.name}</span>
          )}
          <span className="ml-auto rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            {link.kind === 'review' ? t('reviewBadge') : t('calendarBadge')}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] space-y-5 px-4 pt-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{link.title}</h1>
          {link.description && <p className="mt-1 text-[15px] text-slate-700">{link.description}</p>}
          <p className="mt-1 text-sm text-slate-500">
            {link.kind === 'review' ? t('reviewHint', { count: items.length }) : t('calendarHint', { back: link.daysBack, ahead: link.daysAhead })}
          </p>
        </div>

        {items.length === 0 && <div className="card p-8 text-center text-sm text-slate-600">{t('empty')}</div>}

        {[...days.entries()].map(([day, list]) => (
          <section key={day} aria-label={day} className="space-y-3">
            <h2 className="px-1 text-[15px] font-semibold text-slate-600 first-letter:uppercase">{day}</h2>
            {list.map((item) => (
              <div key={item.id} className="space-y-0">
                <FeedPost
                  author={item.author}
                  meta={item.at ? formatInZone(item.at, timezone, 'HH:mm') : t('noDate')}
                  badge={<StatusBadge status={item.status} />}
                  message={item.message}
                  emptyText="—"
                  media={item.media}
                  link={item.link}
                  linkPreview={item.linkPreview}
                  seeMore={tCommon('seeMore')}
                  clamp
                />
                {link.kind === 'review' && item.post && (
                  <ShareReview
                    token={token}
                    postId={item.post.id}
                    allowComments={link.allowComments}
                    history={(item.post.reviewDecisions ?? []).map((row) => ({
                      id: row.id,
                      decision: row.decision,
                      comment: row.comment,
                      authorName: row.authorName,
                      when: formatInZone(row.createdAt, timezone, 'd MMM, HH:mm'),
                    }))}
                  />
                )}
              </div>
            ))}
          </section>
        ))}

        <p className="pt-4 text-center text-xs text-slate-400">{t('footer', { workspace: link.workspace.name })}</p>
      </div>
    </main>
  );
}
