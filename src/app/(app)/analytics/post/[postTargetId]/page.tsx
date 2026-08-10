import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PostMetricExplorer } from '@/components/PostMetricExplorer';
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
        <p className="whitespace-pre-wrap text-sm text-slate-700">{post.message}</p>

        <p className="text-xs text-slate-500">
          {post.targetName}
          {post.publishedAt && ` · ${formatInZone(post.publishedAt, timezone)}`}
          {post.syncedAt && ` · ${t('syncedAt', { when: formatInZone(post.syncedAt, timezone) })}`}
        </p>

        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-medium text-brand-600 hover:underline"
          >
            {t('viewOnFacebook')}
          </a>
        )}
      </header>

      <PostMetricExplorer
        postTargetId={postTargetId}
        external={external}
        metrics={post.metrics}
      />
    </div>
  );
}
