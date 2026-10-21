import type { StoredAdObject } from '@/modules/ads/server/object-store';
import type { FacebookAdsTransport } from './ads-ops/transport';
import { configuredFacebookAdsTransport } from './ads-ops';
import { runtimeConfig } from '@/server/config/store';

/** Graph edge/field names are protocol constants. Pagination policy comes from Root. */
export async function discoverFacebookAdObjects(transport: FacebookAdsTransport, token: string, remoteAccountId: string, adAccountId: string, policy: { pageSize: number; maxPages: number }, now: Date, signal?: AbortSignal): Promise<StoredAdObject[]> {
  const items: StoredAdObject[] = [];
  for (const [level, edge, parentField] of [['campaign', 'campaigns', null], ['adset', 'adsets', 'campaign_id'], ['ad', 'ads', 'adset_id']] as const) {
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < policy.maxPages; page++) {
      const payload = await transport.get(`${encodeURIComponent(remoteAccountId)}/${edge}`, token, {
        fields: ['id', 'account_id', 'name', 'status', ...(parentField ? [parentField] : [])].join(','),
        limit: String(policy.pageSize), ...(after ? { after } : {}),
      }, signal);
      if (!Array.isArray(payload.data)) throw new Error('Invalid ad object discovery response');
      for (const raw of payload.data) {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid ad object discovery identity');
        const row = raw as Record<string, unknown>;
        if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || typeof row.account_id !== 'string' || row.account_id.replace(/^act_/, '') !== remoteAccountId.replace(/^act_/, '')) throw new Error('Ad discovery account mismatch');
        items.push({ adAccountId, level, objectId: row.id, name: typeof row.name === 'string' ? row.name : null, parentId: parentField && typeof row[parentField] === 'string' ? row[parentField] as string : null, status: typeof row.status === 'string' ? row.status.toLowerCase() : null, fetchedAt: now });
      }
      const paging = payload.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
      if (!paging?.next) break;
      const cursor = paging.cursors?.after;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor) || page + 1 === policy.maxPages) throw new Error('Ad discovery pagination incomplete');
      seen.add(cursor); after = cursor;
    }
  }
  return items;
}
export async function configuredDiscoverFacebookAdObjects(token: string, remoteAccountId: string, adAccountId: string, now: Date, signal?: AbortSignal) {
  const [transport, pageSize, maxPages] = await Promise.all([configuredFacebookAdsTransport(), runtimeConfig('meta.pageSize'), runtimeConfig('meta.maxPages')]);
  return discoverFacebookAdObjects(transport, token, remoteAccountId, adAccountId, { pageSize: pageSize as number, maxPages: maxPages as number }, now, signal);
}
