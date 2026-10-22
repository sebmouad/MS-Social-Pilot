import { cache } from 'react';
import { headers } from 'next/headers';
import { configOrDefault } from '@/server/config/config-or-default';
import { adsInsightsCopySchema, resolveAdsInsightsCopy, type AdsInsightsCopy } from './ads-insights';

/** Insights › Ads copy in the request language; Root value with the shipped default as fallback. One read per request. */
export const loadAdsInsightsCopy = cache(async (): Promise<{ copy: AdsInsightsCopy; locale: 'en' | 'fr' }> => {
  const catalog = await configOrDefault('ads.insightsCopy', adsInsightsCopySchema);
  let locale: 'en' | 'fr' = 'en';
  try { locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { /* no request */ }
  return { copy: resolveAdsInsightsCopy(catalog as never, locale), locale };
});
