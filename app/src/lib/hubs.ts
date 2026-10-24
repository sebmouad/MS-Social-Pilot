/** Customer work hubs of the sidebar (UI wave 1): five stable destinations over the
 * manifest areas. Routes, areas, manifests and feature ids are unchanged; hubs only
 * regroup pages for navigation. Home stays the brand landing and Settings stays in
 * the sidebar footer; neither is a hub.
 *
 * - Create: making things (the /create composer plus the studio tools).
 * - Plan: the publishing desk (posts, calendar, queue, approvals, library, feeds)
 *   plus the team task board once the workspace uses it.
 * - Engage: the inbox.
 * - Measure: insights.
 * - Grow: ads plus agency client workspaces once the workspace uses them.
 */
import { areaPages, pageForPath, type ModuleId, type ProductPage } from './product';
import type { AreaId } from '@/modules/types';

export type HubId = 'create' | 'plan' | 'engage' | 'measure' | 'grow';
export const HUB_ORDER: readonly HubId[] = ['create', 'plan', 'engage', 'measure', 'grow'];

/** Hub of one page, or undefined for the Home landing and Settings. */
export function hubForPage(page: ProductPage): HubId | undefined {
  switch (page.area) {
    case 'content': return page.module === 'studio' ? 'create' : 'plan';
    case 'tasks': return 'plan';
    case 'inbox': return 'engage';
    case 'insights': return 'measure';
    case 'ads': return 'grow';
    case 'agency': return 'grow';
    default: return undefined;
  }
}

/**
 * Pages the hub shows as tabs, in the same order as their areas. Tasks and Agency
 * join their hub only when the workspace uses them (`optionalAreas`, as before).
 */
export function hubPages(hub: HubId, enabledFeatures: readonly string[], optionalAreas: readonly AreaId[] = []): ProductPage[] {
  const optional = new Set<AreaId>(optionalAreas);
  switch (hub) {
    case 'create': return areaPages('content', enabledFeatures).filter(page => page.module === 'studio');
    case 'plan': return [...areaPages('content', enabledFeatures).filter(page => page.module !== 'studio'), ...(optional.has('tasks') ? areaPages('tasks', enabledFeatures) : [])];
    case 'engage': return areaPages('inbox', enabledFeatures);
    case 'measure': return areaPages('insights', enabledFeatures);
    case 'grow': return [...areaPages('ads', enabledFeatures), ...(optional.has('agency') ? areaPages('agency', enabledFeatures) : [])];
  }
}

/** Module fallback for routes without a page (the /create composer lives under Publishing). */
const HUB_BY_MODULE: Partial<Record<ModuleId, HubId>> = {
  publishing: 'create', studio: 'create', inbox: 'engage', analytics: 'measure', ads: 'grow', tasks: 'plan', agency: 'grow',
};

/** Hub of a pathname; the Home landing and Settings return undefined. */
export function hubForPath(pathname: string, fallbackModule?: ModuleId): HubId | undefined {
  const page = pageForPath(pathname);
  if (page) return hubForPage(page);
  return (fallbackModule && HUB_BY_MODULE[fallbackModule]) ?? undefined;
}
