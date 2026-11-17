import { headers } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { PageHeader } from '@/components/PageHeader';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { canAccessFeature } from '@/server/permissions';
import { readFeeds } from '../server/feeds';
import { automaticCheckingStatus } from '../server/polling';
import { FEEDS_FEATURE_ID } from '../manifest';
import { feedsLocale, feedsText, type FeedsCopyKey } from '../copy';
import { FeedManager } from './FeedManager';
import { FeedsTabs } from './FeedsTabs';
import { RefreshSoon } from './RefreshSoon';
import { recipeText, type RecipeCopyCatalog, type RecipeCopyKey } from '../copy-recipes';
import { RecipeSource, type RecipePool, type RecipeView } from './RecipeSource';
import { recipeFigures } from './recipe-figures';
import { loadRecipeStatus } from './recipe-status';
import { readRecipeSource } from '../server/wordpress';
import { withRecipeLabels } from '../server/recipe-labels';
import styles from './feeds.module.css';

export default async function FeedsScreen({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const locale = feedsLocale((await headers()).get('accept-language'));
  const [copy, recipeCopy] = await Promise.all([runtimeConfig('feeds.copy'), runtimeConfig('feeds.recipeCopy')]);
  const t = (key: FeedsCopyKey, values: Record<string, string | number> = {}) => feedsText(locale, key, values, copy);
  const viewer = await requireViewer({ feature: FEEDS_FEATURE_ID, channelScoped: true });
  const params = await searchParams;
  const heading = <PageHeader module="publishing" title={t('title')} description={t('description')} actions={<a className="ui-button ui-button--secondary" href="/content/autopilot">{locale === 'fr' ? 'Pilote automatique' : 'Autopilot'}</a>} />;
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
    const [result, channels, automatic, aiAvailable] = await Promise.all([
      readFeeds(actor, params.page ? { page: Number(params.page) } : {}),
      prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, canPublish: true, ...(scope ? { id: { in: [...scope] } } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 }),
      automaticCheckingStatus(),
      import('@/modules/studio/server/ai').then(ai => ai.articleWritingAvailable(viewer.workspaceId)).catch(() => false),
    ]);
    const feedList = <FeedManager initialFeeds={result.feeds.map(f => ({ ...f, lastPolledAt: f.lastPolledAt?.toISOString() ?? null, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() }))}
      channels={channels.map(c => ({ id: c.id, name: c.name }))} page={result.page} hasMore={result.hasMore} canWrite={canWrite} limits={result.limits} locale={locale} automaticMinutes={automatic.intervalMinutes} copy={copy} aiAvailable={aiAvailable} />;
    const showRecipes = recipes && (recipes.source || canWrite);
    const r = (key: RecipeCopyKey) => recipeText(locale, key, {}, recipeCopy as RecipeCopyCatalog);
    return <>
      {heading}
      {showRecipes && recipes.source && recipes.available && !recipes.pool ? <RefreshSoon /> : null}
      {showRecipes ? <FeedsTabs label={r('tabsLabel')} recipesLabel={r('feedsRecipes')} feedsLabel={r('feedsOther')} feedCount={result.feeds.length} initial={recipes.source || params.page === undefined && !result.feeds.length ? 'recipes' : 'feeds'}
        recipes={<RecipeSource initial={withRecipeLabels(recipes, locale) as unknown as RecipeView} locale={locale} canWrite={canWrite} copy={recipeCopy}
          figures={recipeStatus ? recipeFigures(recipeStatus, locale, copy) : undefined} />} feeds={feedList} /> : feedList}
      <p className={styles.privacy}>{t('footnote')}</p>
    </>;
  } catch (error) {
    return <>{heading}<RouteNotice error focusKey="feed-load-error">{error instanceof OperationError ? error.message : t('loadFailed')}</RouteNotice></>;
  }
}
