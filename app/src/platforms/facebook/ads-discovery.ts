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
  // Ad pictures are a separate, best-effort read (2026-11-15): a refusal or an odd answer leaves the ads without a
  // picture and never fails the sync that the figures depend on.
  if (items.some(item => item.level === 'ad')) {
    const pictures = await readAdPictures(transport, token, remoteAccountId, policy, signal).catch(error => { signal?.throwIfAborted(); void error; return new Map<string, string>(); });
    for (const item of items) if (item.level === 'ad') item.thumbnailUrl = pictures.get(item.objectId) ?? null;
  }
  return items;
}

/** Field sets tried in order: a 240×240 rendering first (Graph's default is 64×64), then the plain thumbnail. */
const AD_PICTURE_FIELDS = ['id,creative.thumbnail_width(240).thumbnail_height(240){thumbnail_url}', 'id,creative{thumbnail_url}'] as const;

async function readAdPictures(transport: FacebookAdsTransport, token: string, remoteAccountId: string, policy: { pageSize: number; maxPages: number }, signal?: AbortSignal): Promise<Map<string, string>> {
  let lastError: unknown = null;
  for (const fields of AD_PICTURE_FIELDS) {
    try {
      const pictures = new Map<string, string>();
      let after: string | undefined;
      for (let page = 0; page < policy.maxPages; page++) {
        const payload = await transport.get(`${encodeURIComponent(remoteAccountId)}/ads`, token, { fields, limit: String(policy.pageSize), ...(after ? { after } : {}) }, signal);
        if (!Array.isArray(payload.data)) throw new Error('Invalid ad picture response');
        for (const raw of payload.data) {
          const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
          const creative = row.creative && typeof row.creative === 'object' ? row.creative as Record<string, unknown> : {};
          const url = creative.thumbnail_url;
          if (typeof row.id === 'string' && typeof url === 'string' && url.startsWith('https://') && url.length <= 2000) pictures.set(row.id, url);
        }
        const paging = payload.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
        const cursor = paging?.cursors?.after;
        if (!paging?.next || typeof cursor !== 'string' || !cursor || cursor === after) break;
        after = cursor;
      }
      return pictures;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError;
}
export async function configuredDiscoverFacebookAdObjects(token: string, remoteAccountId: string, adAccountId: string, now: Date, signal?: AbortSignal) {
  const [transport, pageSize, maxPages] = await Promise.all([configuredFacebookAdsTransport(), runtimeConfig('meta.pageSize'), runtimeConfig('meta.maxPages')]);
  return discoverFacebookAdObjects(transport, token, remoteAccountId, adAccountId, { pageSize: pageSize as number, maxPages: maxPages as number }, now, signal);
}
