import type { KitLocale } from '../kit/copy';

/**
 * Where a post came from when it was not written in the composer. Publishing knows only this neutral shape;
 * an installed feature (such as recipe automation) supplies a provider that answers it from its own records.
 */
export type PostOriginView = { kind: string; label: string; sourceName: string; url: string | null; linkLabel: string };

export interface PostOriginProvider {
  /** Stable identifier used in the `origin` filter parameter. */
  kind: string;
  /** Short badge text, filter option text and the link text, in the viewer's language. */
  label(locale: KitLocale): string;
  filterLabel(locale: KitLocale): string;
  linkLabel(locale: KitLocale, sourceName: string): string;
  /** True when this workspace has anything to filter by; keeps unusable choices out of the sidebar. */
  available(workspaceId: string): Promise<boolean>;
  /** Origins of the given (already authorized) posts; posts without this origin are absent. */
  lookup(workspaceId: string, postIds: readonly string[]): Promise<Map<string, { sourceName: string; url: string | null }>>;
}

/** Only web links are shown; anything else coming from a source is dropped rather than rendered. */
export function safeOriginUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}
