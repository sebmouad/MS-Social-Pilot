// Ad pictures (2026-11-15): read with the ads in a separate, best-effort request. A refusal never fails discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Load the platform registry first, as the app does: the Facebook modules import each other.
import '@/server/platforms/registry';
import { discoverFacebookAdObjects } from '@/platforms/facebook/ads-discovery';
import type { FacebookAdsTransport } from '@/platforms/facebook/ads-ops/transport';

const now = new Date('2026-11-15T12:00:00Z');
const policy = { pageSize: 25, maxPages: 3 };
const base: Record<string, unknown[]> = {
  campaigns: [{ id: 'c1', account_id: '123', name: 'Campaign', status: 'ACTIVE' }],
  adsets: [{ id: 's1', account_id: '123', name: 'Set', status: 'ACTIVE', campaign_id: 'c1' }],
  ads: [{ id: 'a1', account_id: '123', name: 'Ad one', status: 'ACTIVE', adset_id: 's1' }, { id: 'a2', account_id: '123', name: 'Ad two', status: 'PAUSED', adset_id: 's1' }],
};

/** `picture` answers the picture request for a given field set, or throws to refuse it. */
function transportWith(picture: (fields: string) => unknown) {
  const calls: string[] = [];
  const transport = {
    async get(path: string, _token: string, params: Record<string, string>) {
      const edge = path.split('/').pop()!;
      calls.push(`${edge}:${params.fields}`);
      if (edge === 'ads' && params.fields.includes('creative')) return picture(params.fields);
      return { data: base[edge] ?? [] };
    },
  } as unknown as FacebookAdsTransport;
  return { transport, calls };
}

test('ad pictures: each ad gets its creative picture, campaigns and ad sets get none', async () => {
  const { transport, calls } = transportWith(() => ({ data: [{ id: 'a1', creative: { thumbnail_url: 'https://scontent.example/a1.jpg' } }, { id: 'a2', creative: { thumbnail_url: 'https://scontent.example/a2.jpg' } }] }));
  const items = await discoverFacebookAdObjects(transport, 'token', 'act_123', 'acct', policy, now);
  assert.equal(items.find(item => item.objectId === 'a1')?.thumbnailUrl, 'https://scontent.example/a1.jpg');
  assert.equal(items.find(item => item.objectId === 'a2')?.thumbnailUrl, 'https://scontent.example/a2.jpg');
  assert.equal(items.find(item => item.level === 'campaign')?.thumbnailUrl, undefined);
  assert.ok(calls.some(call => call.includes('thumbnail_width(240)')));
});

test('ad pictures: when the sized request is refused, the plain thumbnail is used', async () => {
  const { transport } = transportWith(fields => { if (fields.includes('thumbnail_width')) throw new Error('(#100) unknown field'); return { data: [{ id: 'a1', creative: { thumbnail_url: 'https://scontent.example/small.jpg' } }] }; });
  const items = await discoverFacebookAdObjects(transport, 'token', 'act_123', 'acct', policy, now);
  assert.equal(items.find(item => item.objectId === 'a1')?.thumbnailUrl, 'https://scontent.example/small.jpg');
  assert.equal(items.find(item => item.objectId === 'a2')?.thumbnailUrl, null);
});

test('ad pictures: when every picture request is refused, ads are still discovered without pictures', async () => {
  const { transport } = transportWith(() => { throw new Error('(#10) permission'); });
  const items = await discoverFacebookAdObjects(transport, 'token', 'act_123', 'acct', policy, now);
  assert.equal(items.length, 4);
  assert.ok(items.filter(item => item.level === 'ad').every(item => item.thumbnailUrl === null));
});

test('ad pictures: an address that is not https is ignored', async () => {
  const { transport } = transportWith(() => ({ data: [{ id: 'a1', creative: { thumbnail_url: 'http://insecure.example/a1.jpg' } }] }));
  const items = await discoverFacebookAdObjects(transport, 'token', 'act_123', 'acct', policy, now);
  assert.equal(items.find(item => item.objectId === 'a1')?.thumbnailUrl, null);
});
