import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { canAccessFeature } from '@/server/permissions';
import { readFeeds } from '@/modules/feeds/server/feeds';
import { PageHeading } from '../publishing/publishing-ui';
import { FeedManager } from './FeedManager';
import styles from './feeds.module.css';

export default async function FeedsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  if (Object.entries(params).some(([key, value]) => key !== 'page' || typeof value !== 'string') || (params.page && !/^[1-9]\d{0,5}$/.test(params.page))) return <><PageHeading title="Content feeds" description="Review your feed filters." /><RouteNotice error focusKey="feed-load-error">Choose a valid page and try again.</RouteNotice></>;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const scope = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
  try {
    const [result, channels] = await Promise.all([
      readFeeds(actor, params.page ? { page: Number(params.page) } : {}),
      prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, canPublish: true, ...(scope ? { id: { in: [...scope] } } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 }),
    ]);
    return <>
      <PageHeading title="Content feeds" description="Turn new articles from a website feed into post drafts for your channels." summary={`${result.pageSize} per page`} />
      <FeedManager initialFeeds={result.feeds.map(f => ({ ...f, lastPolledAt: f.lastPolledAt?.toISOString() ?? null, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() }))} channels={channels.map(c => ({ id: c.id, name: c.name }))} page={result.page} hasMore={result.hasMore} canWrite={canWrite} limits={result.limits} />
      <p className={styles.privacy}>Feeds create drafts only. Review and schedule each draft in Publishing before anything is posted.</p>
    </>;
  } catch (error) {
    return <><PageHeading title="Content feeds" description="Turn new articles from a website feed into post drafts for your channels." /><RouteNotice error focusKey="feed-load-error">{error instanceof OperationError ? error.message : 'Feeds could not be loaded. Refresh and try again.'}</RouteNotice></>;
  }
}
