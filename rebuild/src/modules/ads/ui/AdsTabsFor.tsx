import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import type { requireViewer } from '@/server/context';
import type { AdsFilters } from '@/modules/ads/server/queries';
import { loadAdsInsightsCopy } from './ads-insights-server';
import { AdsSubTabs, type AdsSection } from './AdsSubTabs';

type Viewer = Awaited<ReturnType<typeof requireViewer>>;

/**
 * The Ads sub-tabs for a screen that keeps its own header: only the sections this member may use appear.
 * Await it in the screen (not as a child component) so the page renders as one resolved tree.
 */
export async function adsTabsFor(current: AdsSection, viewer: Pick<Viewer, 'entitlements' | 'permissions'>, filters?: AdsFilters) {
  const { copy } = await loadAdsInsightsCopy();
  const use = (feature: string) => canUseFeature(viewer.entitlements, feature) && canAccessFeature(viewer.permissions, feature, 'read');
  const available: AdsSection[] = [
    ...(use('ads/campaigns') ? ['campaigns' as const] : []), ...(use('ads/objects') ? ['manage' as const] : []), ...(use('analytics/ads') ? ['analysis' as const] : []),
  ];
  return <AdsSubTabs current={current} copy={copy} available={available} filters={filters} />;
}
