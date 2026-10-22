import { IconActivity, IconApps, IconLayoutDashboard, IconTool, IconUsers, type Icon } from '@tabler/icons-react';
import { rootManifest } from '../manifest';

/** Root areas (design v2 S15). Page titles stay in the manifest; only the grouping lives here. */
export type RootAreaId = 'overview' | 'people' | 'modules' | 'operations' | 'activity';
export type RootArea = { id: RootAreaId; label: string; icon: Icon; pages: Array<{ href: string; title: string }> };

const AREA_PAGES: Record<RootAreaId, readonly string[]> = {
  overview: ['/root'],
  people: ['/root/users', '/root/workspaces', '/root/plans', '/root/registration', '/root/sessions', '/root/privileges', '/root/lifecycle'],
  modules: ['/root/config', '/root/modules', '/root/platforms'],
  operations: ['/root/operations', '/root/errors', '/root/backups', '/root/connections'],
  activity: ['/root/activity', '/root/changelog'],
};
const AREA_ICONS: Record<RootAreaId, Icon> = { overview: IconLayoutDashboard, people: IconUsers, modules: IconApps, operations: IconTool, activity: IconActivity };

const TITLES = new Map(rootManifest.sections.flatMap(section => section.pages.map(page => [page.href, page.title] as const)));

/** Detail pages highlight their parent section page. */
export function rootActiveHref(active: string): string {
  if (active.startsWith('/root/modules/') && active !== '/root/modules') return '/root/modules';
  if (active.startsWith('/root/platforms/') && active !== '/root/platforms') return '/root/platforms';
  if (active.startsWith('/root/errors/') && active !== '/root/errors') return '/root/errors';
  return active;
}

export type RootAreaLabels = { overview: string; people: string; modules: string; operations: string; activity: string };

export function rootAreas(labels: RootAreaLabels): readonly RootArea[] {
  return (Object.keys(AREA_PAGES) as RootAreaId[]).map(id => ({
    id, label: labels[id], icon: AREA_ICONS[id],
    pages: AREA_PAGES[id].map(href => ({ href, title: TITLES.get(href) ?? href })),
  }));
}

export function rootAreaFor(active: string): RootAreaId {
  const href = rootActiveHref(active);
  return ((Object.keys(AREA_PAGES) as RootAreaId[]).find(id => AREA_PAGES[id].includes(href)) ?? 'overview');
}
