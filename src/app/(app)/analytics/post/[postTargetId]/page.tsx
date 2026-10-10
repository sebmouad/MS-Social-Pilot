import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PostMetricExplorer } from '@/components/PostMetricExplorer';
import { FeedPost } from '@/components/FeedPost';
import { ExternalLink } from '@/components/ExternalLink';
import { Icon } from '@/components/Icon';
import { requirePage } from '@/lib/auth';
import { readPostMetrics } from '@/lib/analytics';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * One post, every metric.
 *
 * Reached from the "By post" table and from the "Other posts" list — the same
 * screen either way, because a post published from the Facebook app has exactly
 * the same catalogue as one scheduled here.
 */
export default async function PostMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ postTargetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('analytics');
  const { postTargetId } = await params;
  const query = await searchParams;

  const external = (Array.isArray(query.external) ? query.external[0] : query.external) === 'true';

  const post = await readPostMetrics({
    workspaceId: auth.workspace.id,
    ...(external ? { externalPostId: postTargetId } : { postTargetId }),
  });

  if (!post) notFound();

  const timezone = auth.workspace.timezone;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/analytics?view=posts" className="text-sm text-brand-600 hover:underline">
          ← {t('backToPosts')}
        </Link>

        <h1 className="text-xl font-semibold text-slate-900">{t('postMetricsTitle')}</h1>
      </header>

      {/* The post itself, as the Page's followers saw it, above its numbers. */}
      <FeedPost
        className="max-w-[680px]"
        author={{ name: post.targetName, pictureUrl: post.targetPictureUrl }}
        meta={[
          post.publishedAt ? formatInZone(post.publishedAt, timezone) : null,
          post.syncedAt ? t('syncedAt', { when: formatInZone(post.syncedAt, timezone) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        message={post.message}
        emptyText="—"
        media={post.media}
        link={post.link}
        linkPreview={post.linkPreview}
        mediaHref={post.url}
        footer={
          post.url ? (
            <ExternalLink href={post.url} className="btn w-full bg-transparent text-[15px] text-slate-600 hover:bg-slate-100">
              <Icon name="facebook" size={18} />
              {t('viewOnFacebook')}
            </ExternalLink>
          ) : undefined
        }
      />

      <PostMetricExplorer
        postTargetId={postTargetId}
        external={external}
        metrics={post.metrics}
      />
    </div>
  );
}
