import { describe, expect, it, vi } from 'vitest';
import { createInstagramDiscovery } from '../src/platforms/instagram/discovery';

const config = { graphBaseUrl: 'https://graph.example.test', graphVersion: 'v99.0', requestTimeoutMs: 5000 };
const pages = [
  { id: 'page-1', name: 'One', accessToken: 'page-secret-1' },
  { id: 'page-2', name: 'Two', accessToken: 'page-secret-2' },
];

describe('Instagram linked-account discovery', () => {
  it('discovers professional Instagram accounts through Meta Pages and returns Page credentials only to its server caller', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://graph.example.test');
      expect(url.searchParams.get('fields')).toBe('instagram_business_account{id,username}');
      if (url.pathname.endsWith('page-1')) {
        expect(url.searchParams.get('access_token')).toBe('page-secret-1');
        return new Response(JSON.stringify({ instagram_business_account: { id: 'ig-1', username: 'brand' } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const discover = createInstagramDiscovery(config, fetcher);
    const result = await discover(pages);
    expect(result).toEqual([{ igUserId: 'ig-1', username: 'brand', pageId: 'page-1', pageAccessToken: 'page-secret-1' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects provider errors without echoing access tokens', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'token invalid page-secret-1' } }), { status: 403 })) as unknown as typeof fetch;
    const discover = createInstagramDiscovery(config, fetcher);
    await expect(discover(pages)).rejects.toThrow('Instagram discovery failed for a linked Page.');
  });
});
