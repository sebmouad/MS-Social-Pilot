/** Instagram API with Facebook Login: discover professional accounts linked to Pages. */
export type InstagramDiscoveryConfig = { graphBaseUrl: string; graphVersion: string; requestTimeoutMs: number };
export type LinkedPage = { id: string; name: string; accessToken: string };
export type LinkedInstagramAccount = { igUserId: string; username: string; pageId: string; pageAccessToken: string };

const LINK_FIELD = 'instagram_business_account{id,username}';

export function createInstagramDiscovery(config: InstagramDiscoveryConfig, fetchImpl: typeof fetch = fetch) {
  const graph = new URL(config.graphBaseUrl);
  if (graph.protocol !== 'https:' && graph.hostname !== 'localhost') throw new Error('Instagram Graph endpoint must use HTTPS.');
  if (graph.username || graph.password || graph.search || graph.hash) throw new Error('Instagram Graph endpoint cannot include credentials or query data.');
  if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('Instagram Graph version is invalid.');
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 120000) throw new Error('Instagram request timeout is invalid.');

  return async (pages: readonly LinkedPage[]): Promise<LinkedInstagramAccount[]> => {
    const accounts = new Map<string, LinkedInstagramAccount>();
    for (const page of pages) {
      if (!page.id || !page.accessToken) continue;
      const url = new URL(`${config.graphBaseUrl.replace(/\/+$/, '')}/${config.graphVersion}/${encodeURIComponent(page.id)}`);
      url.searchParams.set('fields', LINK_FIELD);
      url.searchParams.set('access_token', page.accessToken);
      let payload: unknown;
      try {
        const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) });
        payload = await response.json();
        if (!response.ok || (payload && typeof payload === 'object' && 'error' in payload)) throw new Error('Provider rejected discovery.');
      } catch { throw new Error('Instagram discovery failed for a linked Page.'); }
      const linked = payload && typeof payload === 'object' && 'instagram_business_account' in payload ? payload.instagram_business_account : null;
      if (!linked || typeof linked !== 'object' || !('id' in linked) || typeof linked.id !== 'string' || !linked.id) continue;
      if (!accounts.has(linked.id)) accounts.set(linked.id, {
        igUserId: linked.id,
        username: 'username' in linked && typeof linked.username === 'string' && linked.username ? linked.username : linked.id,
        pageId: page.id, pageAccessToken: page.accessToken,
      });
    }
    return [...accounts.values()];
  };
}

/** Selected Pages are supplied by the authorized connection service, never enumerated here. */
export function createSelectedInstagramDiscovery(policy: import('./config').InstagramPolicy, options: Parameters<typeof import('./transport').createInstagramGraph>[1] = {}) {
  return async (pages: readonly LinkedPage[], signal?: AbortSignal): Promise<LinkedInstagramAccount[]> => {
    const { createInstagramGraph, object } = await import('./transport');
    const graph = createInstagramGraph(policy, options);
    const accounts = new Map<string, LinkedInstagramAccount>();
    for (const page of pages) {
      if (!page.id || !page.accessToken) continue;
      const result = await graph.request(page.id, page.accessToken, { fields: LINK_FIELD }, 'GET', signal);
      const account = object(result.instagram_business_account);
      if (typeof account.id !== 'string' || !account.id || accounts.has(account.id)) continue;
      accounts.set(account.id, { igUserId: account.id, username: typeof account.username === 'string' && account.username ? account.username : account.id, pageId: page.id, pageAccessToken: page.accessToken });
    }
    return [...accounts.values()];
  };
}
