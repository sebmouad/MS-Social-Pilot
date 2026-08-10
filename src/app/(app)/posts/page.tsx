import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PostList } from '@/components/PostList';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseMedia } from '@/lib/json';
import { formatInZone } from '@/lib/time';
import { postStatusFilter } from '@/lib/constants';

export const dynamic = 'force-dynamic';

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
  const auth = await requireAuth();
  const t = await getTranslations('posts');
  const tDash = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const tStatus = await getTranslations('status.post');
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const statuses = postStatusFilter(raw);

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: auth.workspace.id,
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    include: { targets: { include: { target: { select: { name: true, type: true } } } } },
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
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
            attempts: postTarget.attempts,
          })),
        }))}
      />
    </div>
  );
}
