import type { IconName } from '@/components/Icon';

/**
 * The three things this app is for, and which screens belong to each.
 *
 * Ten links in one row read as ten equal choices, and a new user could not
 * tell which of them mattered. The product is three jobs — understanding how
 * the Pages are doing, running paid ads, and getting posts out on time — so the
 * top bar is those three, and each module lists its own screens underneath.
 *
 * Everything that serves all three rather than one — the connections they read
 * through, settings, the home overview — sits beside the modules, not in them.
 *
 * Pure data, so the navigation and its tests read the same list.
 */

export type ModuleKey = 'analytics' | 'ads' | 'schedule';

export interface ModulePage {
  href: string;
  /** Key under `nav`. */
  label: string;
  icon: IconName;
  /** Other paths that should light this page up, e.g. a drill-down. */
  also?: string[];
}

export interface AppModule {
  key: ModuleKey;
  /** Where the module tab goes. */
  href: string;
  icon: IconName;
  pages: ModulePage[];
}

export const MODULES: AppModule[] = [
  {
    key: 'analytics',
    href: '/analytics',
    icon: 'analytics',
    pages: [
      { href: '/analytics', label: 'pages', icon: 'analytics' },
      { href: '/reports', label: 'reports', icon: 'reports' },
    ],
  },
  {
    key: 'ads',
    href: '/ads',
    icon: 'megaphone',
    pages: [{ href: '/ads', label: 'adsPerformance', icon: 'megaphone' }],
  },
  {
    key: 'schedule',
    href: '/calendar',
    icon: 'calendar',
    pages: [
      { href: '/calendar', label: 'calendar', icon: 'calendar' },
      { href: '/posts', label: 'posts', icon: 'posts' },
      { href: '/compose', label: 'compose', icon: 'compose' },
      { href: '/approvals', label: 'approvals', icon: 'approvals' },
      { href: '/feeds', label: 'feeds', icon: 'feeds' },
    ],
  },
];

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The module a screen belongs to, or null for the shared screens. */
export function moduleFor(pathname: string): AppModule | null {
  return (
    MODULES.find((module) =>
      module.pages.some((page) => [page.href, ...(page.also ?? [])].some((href) => matches(pathname, href))),
    ) ?? null
  );
}

/** Whether a page link inside a module is the one being shown. */
export function isPageActive(pathname: string, page: ModulePage): boolean {
  return [page.href, ...(page.also ?? [])].some((href) => matches(pathname, href));
}

/** Screens that serve every module, shown beside the modules rather than in them. */
export const SHARED_LINKS: Array<{ href: string; label: string; icon: IconName; also?: string[] }> = [
  { href: '/connections', label: 'connections', icon: 'connections', also: ['/accounts'] },
  { href: '/settings', label: 'settings', icon: 'settings', also: ['/setup'] },
];
