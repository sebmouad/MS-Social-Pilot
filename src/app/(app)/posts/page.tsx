import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PostList } from '@/components/PostList';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { parseMedia } from '@/lib/json';
import { formatInZone } from '@/lib/time';
import { postStatusFilter } from '@/lib/constants';
import { Pagination } from '@/components/Pagination';
import { pageHref, pageNumber, paginate } from '@/lib/paging';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('posts.title');
}


const FILTERS = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('posts');
  const tDash = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const tStatus = await getTranslations('status.post');
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const statuses = postStatusFilter(raw);

  const where = {
    workspaceId: auth.workspace.id,
    ...(statuses ? { status: { in: statuses } } : {}),
  };

  // Counted first, so the page number can be clamped against what is actually
  // there rather than showing an empty screen to somebody who bookmarked a
  // page that no longer exists.
  const page = paginate({
    total: await prisma.post.count({ where }),
    requested: pageNumber(params.page),
  });

  const posts = await prisma.post.findMany({
    where,
    include: { targets: { include: { target: { select: { name: true, type: true } } } } },
    // `id` last, and not for tidiness: without a unique tiebreaker two posts
    // sharing a timestamp can land in a different order on each query, and
    // then page two repeats a row page one already showed.
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    skip: page.skip,
    take: page.take,
  });

  const timezone = auth.workspace.timezone;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </div>
        <Link href="/compose" className="btn-primary">
          {tDash('newPost')}
        </Link>
      </header>

      <nav className="flex flex-wrap gap-1">
        {FILTERS.map((filter) => {
          const active = (raw ?? '') === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/posts?status=${filter.value}` : '/posts'}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {filter.value ? tStatus(filter.value) : tCommon('all')}
            </Link>
          );
        })}
      </nav>

      <PostList
        posts={posts.map((post) => ({
          id: post.id,
          message: post.message,
          link: post.link,
          status: post.status,
          publishMode: post.publishMode,
          scheduledAtLabel: post.scheduledAt ? formatInZone(post.scheduledAt, timezone) : null,
          publishedAtLabel: post.publishedAt ? formatInZone(post.publishedAt, timezone) : null,
          mediaCount: parseMedia(post.media).length,
          targets: post.targets.map((postTarget) => ({
            id: postTarget.id,
            name: postTarget.target.name,
            type: postTarget.target.type,
            status: postTarget.status,
            url: postTarget.remoteUrl,
            error: postTarget.errorMessage,
            errorCode: postTarget.errorCode,
            attempts: postTarget.attempts,
          })),
        }))}
      />

      <Pagination page={page} href={(next) => pageHref('/posts', params, next)} />
    </div>
  );
}
