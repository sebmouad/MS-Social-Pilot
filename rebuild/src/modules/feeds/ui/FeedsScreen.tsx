import { headers } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { canAccessFeature } from '@/server/permissions';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { readFeeds } from '../server/feeds';
import { automaticCheckingStatus } from '../server/polling';
import { FEEDS_FEATURE_ID } from '../manifest';
import { feedsLocale, feedsText, type FeedsCopyKey } from '../copy';
import { FeedManager } from './FeedManager';
import { RecipeSource, type RecipePool, type RecipeView } from './RecipeSource';
import { RecipeStatusCard } from './RecipeStatusCard';
import { loadRecipeStatus } from './recipe-status';
import { readRecipeSource } from '../server/wordpress';
import styles from './feeds.module.css';

export default async function FeedsScreen({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const locale = feedsLocale((await headers()).get('accept-language'));
  const [copy, recipeCopy] = await Promise.all([runtimeConfig('feeds.copy'), runtimeConfig('feeds.recipeCopy')]);
  const t = (key: FeedsCopyKey, values: Record<string, string | number> = {}) => feedsText(locale, key, values, copy);
  const viewer = await requireViewer({ feature: FEEDS_FEATURE_ID, channelScoped: true });
  const params = await searchParams;
  const heading = <PageHeading title={t('title')} description={t('description')} />;
  if (Object.entries(params).some(([key, value]) => key !== 'page' || typeof value !== 'string') || (params.page && !/^[1-9]\d{0,5}$/.test(params.page))) return <>{heading}<RouteNotice error focusKey="feed-load-error">{t('invalidPage')}</RouteNotice></>;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, FEEDS_FEATURE_ID, 'write');
  const scope = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
  const recipes = await readRecipeSource(actor).catch(() => null);
  // The status card is decoration on top of the authorized read: a failure here hides the card, never the page.
  const recipeStatus = recipes?.source ? await Promise.all([runtimeConfig('feeds.wordpress.statusUpcomingCount'), runtimeConfig('feeds.wordpress.statusFailureWindowDays')]).then(([upcomingLimit, failureWindowDays]) => loadRecipeStatus({
    workspaceId: viewer.workspaceId, source: recipes.source!, available: recipes.available, pool: recipes.pool as RecipePool | null | undefined,
    upcomingLimit: upcomingLimit as number, failureWindowDays: failureWindowDays as number, allowedTargetIds: scope,
  })).catch(() => null) : null;
  try {
    const [result, channels, automatic] = await Promise.all([
      readFeeds(actor, params.page ? { page: Number(params.page) } : {}),
      prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, canPublish: true, ...(scope ? { id: { in: [...scope] } } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 }),
      automaticCheckingStatus(),
    ]);
    return <>
      <PageHeading title={t('title')} description={t('description')} summary={t('pageSize', { count: result.pageSize })} />
      {recipeStatus ? <RecipeStatusCard status={recipeStatus} locale={locale} copy={copy} /> : null}
      <FeedManager initialFeeds={result.feeds.map(f => ({ ...f, lastPolledAt: f.lastPolledAt?.toISOString() ?? null, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() }))}
        channels={channels.map(c => ({ id: c.id, name: c.name }))} page={result.page} hasMore={result.hasMore} canWrite={canWrite} limits={result.limits} locale={locale} automaticMinutes={automatic.intervalMinutes} copy={copy} />
      {recipes && (recipes.source || canWrite) && <RecipeSource initial={recipes as unknown as RecipeView} locale={locale} canWrite={canWrite} copy={recipeCopy} />}
      <p className={styles.privacy}>{t('footnote')}</p>
    </>;
  } catch (error) {
    return <>{heading}<RouteNotice error focusKey="feed-load-error">{error instanceof OperationError ? error.message : t('loadFailed')}</RouteNotice></>;
  }
}
