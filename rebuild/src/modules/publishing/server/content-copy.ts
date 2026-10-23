import { cache } from 'react';
import { configValueOrDefault } from '@/server/config/config-or-default';
import { resolveContentCatalog, resolveContentCopy, resolveContentPolicy, type ContentCopy, type ContentPolicy } from '../ui/content-copy';
import { pageLocale } from '../ui/kit/locale';

export type ContentRuntime = { copy: ContentCopy; policy: ContentPolicy; locale: 'en' | 'fr' };

/**
 * Create and Content copy in the request language plus the behaviour policy, both from Root with the shipped
 * defaults as fallback. Saved catalogs merge over the shipped entries, so operator edits survive copy additions
 * and new keys fall back to shipped text. One read per request; screens hand the result to `ContentProvider`.
 */
export const loadContent = cache(async (): Promise<ContentRuntime> => {
  const [savedCatalog, savedPolicy, locale] = await Promise.all([
    configValueOrDefault('publishing.contentCopy'),
    configValueOrDefault('publishing.contentPolicy'),
    pageLocale(),
  ]);
  return { copy: resolveContentCopy(resolveContentCatalog(savedCatalog), locale), policy: resolveContentPolicy(savedPolicy), locale };
});
