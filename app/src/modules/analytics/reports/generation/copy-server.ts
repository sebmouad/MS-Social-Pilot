import { configOrDefault, configValueOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { localeFromAcceptLanguage } from '@/server/platforms/request-locale';
import { reportDocumentCopySchema, reportDocumentLocaleCopy } from './copy';

/** The requester's browser language, like the rest of the interface; background runs have no request and use the Root language. */
async function requesterLocale(): Promise<'en' | 'fr' | null> {
  try { return localeFromAcceptLanguage((await headers()).get('accept-language')); } catch { return null; }
}

export const loadReportDocumentCopy = cache(async () => {
  const [value, rootLocale, asked, responseCopy] = await Promise.all([configOrDefault('analytics.reportDocumentCopy', reportDocumentCopySchema), runtimeConfig('analytics.reportDocumentLocale'), requesterLocale(), configValueOrDefault('analytics.responseTimeCopy')]);
  const catalog = reportDocumentCopySchema.parse(value);
  const locale = asked ?? (rootLocale === 'fr' ? 'fr' as const : 'en' as const);
  return { responseCopy, copy: reportDocumentLocaleCopy(catalog, locale), locale };
});
