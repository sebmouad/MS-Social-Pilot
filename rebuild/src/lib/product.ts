/** Customer modules and routes generated from their per-module manifests. */
import { moduleManifests } from '@/modules';

export type ModuleId = (typeof moduleManifests)[number]['id'];
export type FeatureId = (typeof moduleManifests)[number]['pages'][number]['id'];

export interface ProductPage {
  id: FeatureId;
  title: string;
  href: string;
  module: ModuleId;
  description: string;
  navigation?: boolean;
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

export const PAGES: readonly ProductPage[] = moduleManifests.flatMap(({ id: module, pages }) =>
  pages.map((page) => ({ ...page, module })),
);

export const pageFor = (pathname: string) => PAGES.find((page) => page.href === pathname);
