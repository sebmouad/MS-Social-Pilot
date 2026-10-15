import { FACEBOOK_CONFIG, facebookModule } from './facebook/module';
import type { PlatformModule } from './module';
import { humanizeMetricKey, type MetricDefinition, type MetricScope } from './metrics';

/**
 * Installed platform modules — the only list of platforms in the product.
 *
 * To add a platform: create `src/platforms/<id>/` (engine + `module.ts` with its
 * manifest and settings), add the manifest and settings here, and its server
 * wiring to `src/server/platforms/index.ts`. Root then shows it on the Platforms
 * screen with its on/off switch, and customers see it once it is on and set up.
 */
export const PLATFORM_MODULES = [facebookModule] as const satisfies readonly PlatformModule[];

/** Every module's Root settings, merged into the configuration registry. */
export const PLATFORM_CONFIG = [...FACEBOOK_CONFIG] as const;

export type PlatformId = (typeof PLATFORM_MODULES)[number]['id'];

export function platformModule(id: string): PlatformModule | undefined {
  return (PLATFORM_MODULES as readonly PlatformModule[]).find((module) => module.id === id);
}

export interface CatalogueMetric {
  definition: MetricDefinition;
  /** Module that supplies the definition (null for names no module describes). */
  module: { id: string; name: string } | null;
  /** True when a module listed the metric; false when it was inferred or is unknown. */
  known: boolean;
}

/**
 * The metric catalogue of the installed modules. Shared analytics code uses this
 * and never names a platform: the module id and name come from the definition's
 * owner.
 */
export function findMetric(scope: MetricScope, key: string): CatalogueMetric {
  const modules = PLATFORM_MODULES as readonly PlatformModule[];
  for (const module of modules) {
    const definition = module.metrics.find((item) => item.scope === scope && item.key === key);
    if (definition) return { definition, module: { id: module.id, name: module.name }, known: true };
  }
  for (const module of modules) {
    const definition = module.inferMetric?.(scope, key);
    if (definition) return { definition, module: { id: module.id, name: module.name }, known: false };
  }
  return {
    definition: { key, scope, name: humanizeMetricKey(key), definition: 'A stored measure.', unit: 'count', aggregation: 'sum', group: scope === 'ads' ? 'advertising' : 'engagement' },
    module: null,
    known: false,
  };
}
