import type { AdsSummary } from './summary';
import type { StoredAdObject } from './object-store';

/** Add inventory-only rows without inventing daily delivery, reach or freshness. */
export function mergeAdObjectSummaries(summaries: AdsSummary[], objects: StoredAdObject[], accounts: readonly { id: string; name: string; currency: string | null }[]): AdsSummary[] {
  const result = new Map(summaries.map(row => [row.key, row]));
  const byAccount = new Map(accounts.map(account => [account.id, account]));
  for (const item of objects) {
    const account = byAccount.get(item.adAccountId);
    if (!account) continue;
    const key = JSON.stringify([item.adAccountId, item.level, item.objectId]);
    const current = result.get(key);
    if (current) { result.set(key, { ...current, name: item.name ?? current.name, parentId: item.parentId }); continue; }
    result.set(key, { key, level: item.level, id: item.objectId, name: item.name ?? item.objectId, accountId: account.id, accountName: account.name, currency: account.currency,
      spend: 0, impressions: 0, clicks: 0, reach: 0, reachDate: item.fetchedAt, cpc: null, cpm: null, cpp: null, ctr: null, frequency: null, actions: [], fields: null, parentId: item.parentId, fieldsDate: item.fetchedAt, dailyMetrics: [], rows: 0 });
  }
  return [...result.values()];
}
