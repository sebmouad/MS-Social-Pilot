/** Customer modules and routes generated from their per-module manifests. */
import { moduleManifests } from '@/modules';
import type { AreaId, ModulePageManifest } from '@/modules/types';

export type { AreaId };
export type ModuleId = (typeof moduleManifests)[number]['id'];
export type FeatureId = (typeof moduleManifests)[number]['pages'][number]['id'];

export interface ProductPage {
  id: FeatureId;
  title: string;
  href: string;
  module: ModuleId;
  /** Sidebar area the page belongs to, taken from its module manifest. */
  area: AreaId;
  description: string;
  navigation?: boolean;
  palette?: boolean;
  tabRoutes?: readonly string[];
}

export interface ProductModule {
  id: ModuleId;
  title: string;
  mobileTitle?: string;
  href: string;
  primaryAction?: { readonly href: string; readonly label: string; readonly featureId: string };
}

export const MODULES: readonly ProductModule[] = moduleManifests.map((module) => ({
  id: module.id,
  title: module.title,
  mobileTitle: 'mobileTitle' in module ? module.mobileTitle : undefined,
  href: module.href,
  primaryAction: 'primaryAction' in module ? module.primaryAction : undefined,
}));

export const PAGES: readonly ProductPage[] = moduleManifests.flatMap((manifest) =>
  manifest.pages.map((page) => ({ ...page, module: manifest.id, area: (page as ModulePageManifest).area ?? (manifest as { area?: AreaId }).area ?? 'home' })),
);

export const pageFor = (pathname: string) => PAGES.find((page) => page.href === pathname);

/** Fixed order of the sidebar areas. Optional areas (tasks, agency) appear only when used. */
export const AREA_ORDER: readonly AreaId[] = ['home', 'content', 'inbox', 'insights', 'ads', 'tasks', 'agency'];
export const OPTIONAL_AREAS: readonly AreaId[] = ['tasks', 'agency'];

/** Pages the area shows as tabs, in manifest order; pages hidden from navigation and unavailable features are left out. */
export function areaPages(area: AreaId, enabledFeatures: readonly string[]): ProductPage[] {
  return PAGES.filter((page) => page.area === area && page.navigation !== false && enabledFeatures.includes(page.id))
    .map((page, position) => ({ page, position }))
    .sort((a, b) => ((a.page as { tabOrder?: number }).tabOrder ?? Number.MAX_SAFE_INTEGER) - ((b.page as { tabOrder?: number }).tabOrder ?? Number.MAX_SAFE_INTEGER) || a.position - b.position)
    .map(({ page }) => page);
}

/** The page whose route is the longest prefix of the pathname (detail screens stay in their page's area). */
export function pageForPath(pathname: string): ProductPage | undefined {
  const exact = pageFor(pathname);
  if (exact) return exact;
  return [...PAGES].sort((a, b) => b.href.length - a.href.length).find((page) => page.href !== '/' && pathname.startsWith(`${page.href}/`));
}

/** Area of a pathname; falls back to the area of the active module. */
export function areaForPath(pathname: string, fallbackModule?: ModuleId): AreaId | undefined {
  const page = pageForPath(pathname);
  if (page) return page.area;
  const manifest = moduleManifests.find((item) => item.id === fallbackModule) as { area?: AreaId } | undefined;
  return manifest?.area;
}
