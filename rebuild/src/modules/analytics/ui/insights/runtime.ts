import { cache } from 'react';
import { headers } from 'next/headers';
import { configOrDefault } from '@/server/config/config-or-default';
import { insightsCopySchema, insightsPolicySchema, resolveInsightsCopy, type InsightsCopy, type InsightsPolicy } from './insights-config';

export type InsightsRuntime = { copy: InsightsCopy; policy: InsightsPolicy; locale: 'en' | 'fr' };

async function requestLocale(): Promise<'en' | 'fr'> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { return 'en'; }
}

/** Insights copy in the request language plus the behaviour policy, from Root with shipped defaults as fallback. One read per request. */
export const loadInsightsUi = cache(async (): Promise<InsightsRuntime> => {
  const [catalog, policy, locale] = await Promise.all([
    configOrDefault('analytics.insightsCopy', insightsCopySchema),
    configOrDefault('analytics.insightsPolicy', insightsPolicySchema),
    requestLocale(),
  ]);
  return { copy: resolveInsightsCopy(catalog as never, locale), policy, locale };
});
