import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { FeedPost } from '@/components/FeedPost';
import { ShareReview } from '@/components/ShareReview';
import { StatusBadge } from '@/components/StatusBadge';
import { feedLinkOf, feedMediaOf } from '@/lib/feed';
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

  const days = new Map<string, typeof posts>();
  for (const post of posts) {
    const key = post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'EEEE d MMMM') : t('noDate');
    days.set(key, [...(days.get(key) ?? []), post]);
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
            {link.kind === 'review' ? t('reviewHint', { count: posts.length }) : t('calendarHint', { back: link.daysBack, ahead: link.daysAhead })}
          </p>
        </div>

        {posts.length === 0 && <div className="card p-8 text-center text-sm text-slate-600">{t('empty')}</div>}

        {[...days.entries()].map(([day, list]) => (
          <section key={day} aria-label={day} className="space-y-3">
            <h2 className="px-1 text-[15px] font-semibold text-slate-600 first-letter:uppercase">{day}</h2>
            {list.map((post) => (
              <div key={post.id} className="space-y-0">
                <FeedPost
                  author={{
                    name: post.targets.map((row) => row.target.name).join(', '),
                    pictureUrl: post.targets[0]?.target.pictureUrl ?? null,
                  }}
                  meta={post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'HH:mm') : t('noDate')}
                  badge={<StatusBadge status={post.status} />}
                  message={post.message}
                  emptyText="—"
                  media={feedMediaOf(post.media)}
                  link={post.link}
                  linkPreview={feedLinkOf(post.linkPreview)}
                  seeMore={tCommon('seeMore')}
                  clamp
                />
                {link.kind === 'review' && (
                  <ShareReview
                    token={token}
                    postId={post.id}
                    allowComments={link.allowComments}
                    history={(post.reviewDecisions ?? []).map((row) => ({
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
