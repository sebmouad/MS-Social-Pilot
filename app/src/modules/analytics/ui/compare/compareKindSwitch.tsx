import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import type { requireViewer } from '@/server/context';
import { loadInsightsUi } from '../insights/runtime';

type Viewer = Awaited<ReturnType<typeof requireViewer>>;

/**
 * Compare is one tool (design v2 S11) that compares channels or ad accounts. This switch links the two screens; a kind the
 * member cannot use is absent, and with only one kind there is nothing to switch. Await it in the screen, not as a child.
 */
export async function compareKindSwitch(current: 'channels' | 'ads', viewer: Pick<Viewer, 'entitlements' | 'permissions'>) {
  const { copy } = await loadInsightsUi();
  const use = (feature: string) => canUseFeature(viewer.entitlements, feature) && canAccessFeature(viewer.permissions, feature, 'read');
  if (!use('analytics/compare') || !use('ads/compare')) return null;
  const items = [{ id: 'channels' as const, href: '/insights/compare', label: copy.compareChannels }, { id: 'ads' as const, href: '/ads/compare', label: copy.compareAdAccounts }];
  return <nav className="insights-kindswitch" aria-label={copy.compareKind}>
    {items.map(item => <a key={item.id} href={item.href} aria-current={item.id === current ? 'true' : undefined}>{item.label}</a>)}
  </nav>;
}
