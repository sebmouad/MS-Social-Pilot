import { analyticsPlatformIds, platformAnalytics } from '@/server/platforms/registry';
import type { AnalyticsAdAccount, AnalyticsAudienceEntry, AnalyticsMetricInput, AnalyticsProviderRequest, AnalyticsTarget } from './catalog';

export type AnalyticsRange = { from: Date; to: Date };
/** Ads authority independent of channel selection; with independentTargets, undefined targetIds means every target. */
export type AnalyticsAdScope = { accountIds?: readonly string[]; targetIds?: readonly string[]; independentTargets?: boolean };

export function analyticsRange(start?: string, end?: string, now = new Date()): AnalyticsRange {
  const valid = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
  const to = valid(end) ? new Date(`${end}T23:59:59.999`) : new Date(now);
  const from = valid(start) ? new Date(`${start}T00:00:00`) : new Date(to.getTime() - 29 * 86_400_000);
  if (from > to) return { from: new Date(to.getTime() - 29 * 86_400_000), to };
  return { from, to };
}

/** Provider modules own storage reads and map them to the shared analytics vocabulary. */
export async function loadAnalytics(workspaceId: string, targetIds: string[], range: AnalyticsRange, allowedTargetIds: readonly string[] | undefined, selectedAdAccountIds: readonly string[] | undefined, allowedProviders: readonly string[], adScope: AnalyticsAdScope = {}) {
  const ids = (await analyticsPlatformIds()).filter(id => allowedProviders.includes(id));
  const loaded = await Promise.all(ids.map(async provider => {
    const host = await platformAnalytics(provider);
    if (!host) return null;
    const data = await host.load({ workspaceId, range, selectedTargetIds: targetIds, allowedTargetIds, selectedAdAccountIds, allowedAdAccountIds: adScope.accountIds, allowedAdTargetIds: adScope.independentTargets ? adScope.targetIds : allowedTargetIds } satisfies AnalyticsProviderRequest);
    return { ...data, metrics: data.metrics.map(metric => ({ ...metric, key: `${provider}:${metric.key}` })) };
  }));
  const providers = loaded.filter((value): value is NonNullable<typeof value> => value !== null);
  const targets = providers.flatMap(provider => provider.targets);
  const selectedTargets = providers.flatMap(provider => provider.selectedTargets);
  const adAccounts: AnalyticsAdAccount[] = providers.flatMap(provider => provider.adAccounts);
  const selectedAdIds = providers.flatMap(provider => provider.selectedAdAccountIds);
  const metrics: AnalyticsMetricInput[] = providers.flatMap(provider => provider.metrics);
  const audienceEntries: AnalyticsAudienceEntry[] = providers.flatMap(provider => provider.audienceEntries);
  const audienceSelected = providers.reduce((sum, provider) => sum + provider.audienceSelected, 0);
  return { targets, selectedTargets, adAccounts, selectedAdIds, adAccountCount: selectedAdIds.length, metrics, audienceEntries, audienceSelected, range };
}
