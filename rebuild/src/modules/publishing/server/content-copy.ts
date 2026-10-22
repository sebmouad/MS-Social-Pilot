import { cache } from 'react';
import { configOrDefault } from '@/server/config/config-or-default';
import { contentCopySchema, contentPolicySchema, resolveContentCopy, type ContentCopy, type ContentPolicy } from '../ui/content-copy';
import { pageLocale } from '../ui/kit/locale';

export type ContentRuntime = { copy: ContentCopy; policy: ContentPolicy; locale: 'en' | 'fr' };

/**
 * Create and Content copy in the request language plus the behaviour policy, both from Root with the shipped
 * defaults as fallback. One read per request; screens hand the result to `ContentProvider`.
 */
export const loadContent = cache(async (): Promise<ContentRuntime> => {
  const [catalog, policy, locale] = await Promise.all([
    configOrDefault('publishing.contentCopy', contentCopySchema),
    configOrDefault('publishing.contentPolicy', contentPolicySchema),
    pageLocale(),
  ]);
  return { copy: resolveContentCopy(catalog as never, locale), policy, locale };
});
