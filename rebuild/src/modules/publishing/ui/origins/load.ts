import type { KitLocale } from '../kit/copy';
import { installedPostOrigins } from './installed';
import { safeOriginUrl, type PostOriginProvider, type PostOriginView } from './post-origin';

/**
 * Origins of the given posts keyed by post id. A provider that fails is skipped: provenance is decoration and
 * must never stop Posts or the Calendar from loading.
 */
export async function loadPostOrigins(workspaceId: string, postIds: readonly string[], locale: KitLocale, providers: readonly PostOriginProvider[] = installedPostOrigins): Promise<Map<string, PostOriginView>> {
  const result = new Map<string, PostOriginView>();
  if (!postIds.length) return result;
  await Promise.all(providers.map(async provider => {
    const found = await provider.lookup(workspaceId, postIds).catch(() => new Map<string, { sourceName: string; url: string | null }>());
    for (const [postId, origin] of found) {
      if (result.has(postId)) continue;
      result.set(postId, { kind: provider.kind, label: provider.label(locale), sourceName: origin.sourceName, url: safeOriginUrl(origin.url), linkLabel: provider.linkLabel(locale, origin.sourceName) });
    }
  }));
  return result;
}

/** Filter choices the workspace can use now. */
export async function originFilterOptions(workspaceId: string, locale: KitLocale, providers: readonly PostOriginProvider[] = installedPostOrigins): Promise<Array<{ kind: string; label: string }>> {
  const usable = await Promise.all(providers.map(provider => provider.available(workspaceId).catch(() => false)));
  return providers.filter((_, index) => usable[index]).map(provider => ({ kind: provider.kind, label: provider.filterLabel(locale) }));
}

/** The requested `origin` filter when it names an installed origin, otherwise undefined. */
export function parseOriginFilter(value: string | undefined, providers: readonly PostOriginProvider[] = installedPostOrigins): string | undefined {
  return providers.some(provider => provider.kind === value) ? value : undefined;
}
