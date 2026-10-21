import { cache } from 'react';
import { headers } from 'next/headers';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { errorCopyDefaults, type AnalyticsErrorCopy } from '../error-copy';
const catalog = cache(() => runtimeConfig('analytics.errorCopy'));
export const analyticsLanguage = cache(async (): Promise<'en' | 'fr'> => {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; }
  catch { return 'en'; } // Background jobs have no HTTP language preference.
});
/** Shared service errors retain their machine code while Root owns customer wording. */
export async function analyticsError(code: OperationErrorCode, key: keyof AnalyticsErrorCopy, locale?: 'en' | 'fr') {
  return new OperationError(code, (await catalog())[key][locale ?? await analyticsLanguage()]);
}
/** Also localizes failures emitted by synchronous parsers before they leave the shared service. */
export async function localizeAnalyticsError(error: unknown): Promise<unknown> {
  if (!(error instanceof OperationError)) return error;
  const key = (Object.keys(errorCopyDefaults) as Array<keyof AnalyticsErrorCopy>).find(key => errorCopyDefaults[key].en === error.message);
  if (key) return analyticsError(error.code, key);
  for (const entry of Object.keys(errorCopyDefaults) as Array<keyof AnalyticsErrorCopy>) {
    if (!entry.includes('{0}')) continue;
    const pattern = entry.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)');
    const match = new RegExp(`^${pattern}$`).exec(error.message);
    if (match) {
      const text = (await catalog())[entry][await analyticsLanguage()].replace(/\{(\d+)\}/g, (token, index: string) => match[Number(index) + 1] ?? token);
      return new OperationError(error.code, text);
    }
  }
  return error;
}
