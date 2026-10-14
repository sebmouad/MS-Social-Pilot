import type { IconName } from '@/components/Icon';
import { PRODUCT_FEATURE_KEYS } from './product-catalog';

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
      { href: '/analytics', label: 'pages', icon: 'analytics', also: ['/reports'] },
      { href: '/inbox', label: 'inbox', icon: 'inbox' },
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
      { href: '/queue', label: 'queue', icon: 'clock' },
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

/** The request path, set by `src/middleware.ts`, so server code knows which module is asked for. */
export const PATHNAME_HEADER = 'x-msp-pathname';
/** The request's method, set beside the path by `src/middleware.ts`. */
export const METHOD_HEADER = 'x-msp-method';


export const MODULE_KEYS: ModuleKey[] = MODULES.map((module) => module.key);
export const ACCESS_SWITCH_KEYS = [...MODULE_KEYS, ...PRODUCT_FEATURE_KEYS] as const;
export type AccessSwitchKey = (typeof ACCESS_SWITCH_KEYS)[number];

export function isAccessSwitchKey(value: string): value is AccessSwitchKey {
  return (ACCESS_SWITCH_KEYS as readonly string[]).includes(value);
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as string[]).includes(value);
}

/**
 * The modules a member may use: everything, minus what root switched off for
 * the workspace, minus what root switched off for this member.
 */
export function enabledModules(workspaceOff: readonly string[], memberOff: readonly string[] = []): ModuleKey[] {
  return MODULE_KEYS.filter((key) => !workspaceOff.includes(key) && !memberOff.includes(key));
}

/** API routes that belong to one module, refused when it is switched off. */
const API_MODULES: Array<{ prefix: string; module: ModuleKey }> = [
  { prefix: '/api/analytics', module: 'analytics' },
  { prefix: '/api/inbox', module: 'analytics' },
  { prefix: '/api/reports', module: 'analytics' },
  { prefix: '/api/report-schedules', module: 'analytics' },
  { prefix: '/api/report-templates', module: 'analytics' },
  { prefix: '/api/ads', module: 'ads' },
  { prefix: '/api/posts', module: 'schedule' },
  { prefix: '/api/queue', module: 'schedule' },
  { prefix: '/api/queue-slots', module: 'schedule' },
  { prefix: '/api/feeds', module: 'schedule' },
];

/** The module a screen or API path belongs to, or null when it serves all of them. */
export function moduleOfPath(pathname: string): ModuleKey | null {
  if (pathname.startsWith('/api/')) {
    return API_MODULES.find((entry) => matches(pathname, entry.prefix))?.module ?? null;
  }
  return moduleFor(pathname)?.key ?? null;
}

/**
 * Developer features (API keys, MCP, outgoing webhooks): off unless root turns
 * them on for the workspace, and then for its owner only. Screens 404 and API
 * routes answer 403 otherwise, like a switched-off module.
 */
const DEVELOPER_PATHS = ['/settings/api', '/settings/webhooks', '/api/api-tokens', '/api/webhooks', '/api/webhook-deliveries', '/oauth/authorize', '/api/oauth/authorize'];

export function isDeveloperPath(pathname: string): boolean {
  return DEVELOPER_PATHS.some((prefix) => matches(pathname, prefix));
}

export function mayUseDeveloperFeatures(context: { isInstanceOwner: boolean; workspace: { developerFeatures: boolean } }): boolean {
  // Technical screens are root's alone; workspace owners never see them.
  return context.workspace.developerFeatures && context.isInstanceOwner;
}
