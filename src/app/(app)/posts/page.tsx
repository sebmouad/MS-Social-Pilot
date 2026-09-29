import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { PostList } from '@/components/PostList';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { parseMedia } from '@/lib/json';
import { formatInZone } from '@/lib/time';
import { canManageOthersPosts, canPublishWithoutApproval, postStatusFilter } from '@/lib/constants';
import { Pagination } from '@/components/Pagination';
import { pageHref, pageNumber, paginate } from '@/lib/paging';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('posts.title');
}

/**
 * The status tabs, in the order a post moves through them.
 *
 * Every status a post can sit in has a tab. A post waiting on a reviewer, or
 * sent back by one, is exactly what its author comes here to find, and a list
 * that can only show those under "All" makes them look lost.
 */
const FILTERS = [
  '',
  'draft',
  'pending_approval',
  'rejected',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

/** Long enough for any phrase worth searching for; short enough to stay a filter. */
const MAX_SEARCH = 200;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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
  const raw = first(params.status);
  const statuses = postStatusFilter(raw);
  const search = (first(params.q) ?? '').trim().slice(0, MAX_SEARCH);
  const destination = first(params.target) ?? '';

  // The workspace's destinations, for the filter. Every one, enabled or not:
  // a Page that was switched off last month still has posts worth finding.
  const destinations = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  const where: Prisma.PostWhereInput = {
    workspaceId: auth.workspace.id,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(search ? { message: { contains: search, mode: 'insensitive' } } : {}),
    // Still scoped by the post's workspace above, so an id from somewhere
    // else simply matches nothing rather than reaching into another client.
    ...(destination ? { targets: { some: { targetId: destination } } } : {}),
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
  // Whether this person's own posts have to be reviewed before they go out.
  const needsReview = auth.workspace.requiresApproval && !canPublishWithoutApproval(auth.role);
  const filtered = Boolean(search || destination);

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

      <nav className="flex flex-wrap gap-1" aria-label={t('statusFilter')}>
        {FILTERS.map((value) => {
          const active = (raw ?? '') === value;
          return (
            <Link
              key={value || 'all'}
              // Switching tabs keeps the search and the destination: somebody
              // narrowing down to one Page's failures means both at once.
              href={pageHref('/posts', { ...params, status: value || undefined }, 1)}
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {value ? tStatus(value) : tCommon('all')}
            </Link>
          );
        })}
      </nav>

      {/* A plain GET form, so a search is a URL like every other filter here:
          it pages, bookmarks and survives a refresh. */}
      <form method="get" action="/posts" role="search" className="flex flex-wrap items-end gap-2">
        {raw && <input type="hidden" name="status" value={raw} />}

        <div className="min-w-[12rem] flex-1">
          <label className="label" htmlFor="posts-q">
            {t('searchLabel')}
          </label>
          <input
            id="posts-q"
            name="q"
            type="search"
            className="input"
            defaultValue={search}
            maxLength={MAX_SEARCH}
            placeholder={t('searchPlaceholder')}
          />
        </div>

        {/* One destination has nothing to choose between. */}
        {destinations.length > 1 && (
          <div className="min-w-0 max-w-full">
            <label className="label" htmlFor="posts-target">
              {t('destinationFilter')}
            </label>
            <select id="posts-target" name="target" className="input max-w-full" defaultValue={destination}>
              <option value="">{t('allDestinations')}</option>
              {destinations.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="submit" className="btn-secondary">
          {tCommon('search')}
        </button>
        {filtered && (
          <Link href={pageHref('/posts', { status: raw }, 1)} className="btn-secondary">
            {t('clearFilters')}
          </Link>
        )}
      </form>

      <PostList
        emptyText={filtered ? t('noMatches') : undefined}
        needsReview={needsReview}
        posts={posts.map((post) => ({
          id: post.id,
          message: post.message,
          link: post.link,
          status: post.status,
          publishMode: post.publishMode,
          scheduledAtLabel: post.scheduledAt ? formatInZone(post.scheduledAt, timezone) : null,
          publishedAtLabel: post.publishedAt ? formatInZone(post.publishedAt, timezone) : null,
          mediaCount: parseMedia(post.media).length,
          // Only a rejected post's note is still the reviewer's last word:
          // resubmitting clears it, and an approval never sets one.
          reviewNote: post.status === 'rejected' ? post.reviewNote : null,
          // The same ownership rule the API applies to edit, cancel, retry,
          // publish and submit, so none of those buttons is a dead end.
          mayAct: post.authorId === auth.user.id || canManageOthersPosts(auth.role),
          // The approval gate "Publish now" goes through: an approved post may
          // go out early; an unreviewed one from somebody whose work is
          // reviewed may not.
          cleared:
            post.approvalStatus === 'approved' ||
            (post.approvalStatus === 'not_required' && !needsReview),
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
