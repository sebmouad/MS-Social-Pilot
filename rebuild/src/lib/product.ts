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
}

export interface ProductModule {
  id: ModuleId;
  title: string;
  href: string;
}

export const MODULES: readonly ProductModule[] = moduleManifests.map(({ id, title, href }) => ({ id, title, href }));

export const PAGES: readonly ProductPage[] = moduleManifests.flatMap(({ id: module, pages }) =>
  pages.map((page) => ({ ...page, module })),
);

export const pageFor = (pathname: string) => PAGES.find((page) => page.href === pathname);
