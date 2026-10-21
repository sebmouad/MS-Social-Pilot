import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { reportDocumentCopySchema, reportDocumentLocaleCopy } from './copy';
export const loadReportDocumentCopy = cache(async () => {
  const [value, locale, responseCopy] = await Promise.all([runtimeConfig('analytics.reportDocumentCopy'), runtimeConfig('analytics.reportDocumentLocale'), runtimeConfig('analytics.responseTimeCopy')]);
  const catalog = reportDocumentCopySchema.parse(value);
  return { responseCopy, copy: reportDocumentLocaleCopy(catalog, locale === 'fr' ? 'fr' : 'en'), locale: locale === 'fr' ? 'fr' as const : 'en' as const };
});
