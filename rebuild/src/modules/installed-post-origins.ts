import { recipeOriginSource } from './feeds/server/post-origin-source';
import type { PostOriginSource } from './publishing/server/origin-source';

/**
 * Post-origin sources of every installed feature, in installation order. Publishing's read model reads only this list;
 * it changes when a feature that creates posts is installed.
 */
export const INSTALLED_POST_ORIGIN_SOURCES: readonly PostOriginSource[] = [recipeOriginSource];
