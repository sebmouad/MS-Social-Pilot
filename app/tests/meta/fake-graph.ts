/**
 * A stand-in for graph.facebook.com: records every request the engine sends (method, path, query and form body,
 * without the token and proof) and answers from a route table, so each Meta permission's call can be checked
 * without reaching Meta.
 */
export type Sent = { method: string; path: string; query: Record<string, string>; body: Record<string, string>; token: string | null; proof: boolean };
type Route = { method?: string; path: RegExp; reply: unknown | ((sent: Sent) => unknown); status?: number };

export function fakeGraph(routes: Route[]) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const query = Object.fromEntries(url.searchParams);
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init?.body instanceof FormData ? Object.fromEntries([...init.body].filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
    const token = query.access_token ?? form.access_token ?? null;
    const proof = Boolean(query.appsecret_proof ?? form.appsecret_proof);
    for (const bag of [query, form]) { delete bag.access_token; delete bag.appsecret_proof; }
    const entry: Sent = { method: init?.method ?? 'GET', path: url.pathname.replace(/^\/v\d+\.\d+/, ''), query, body: form, token, proof };
    sent.push(entry);
    const route = routes.find(item => (!item.method || item.method === entry.method) && item.path.test(entry.path));
    const json = route ? typeof route.reply === 'function' ? (route.reply as (s: Sent) => unknown)(entry) : route.reply : { error: { message: `No fake route for ${entry.method} ${entry.path}`, code: 100 } };
    return new Response(JSON.stringify(json), { status: route ? route.status ?? 200 : 400, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

export const facebookConfig = {
  graphBaseUrl: 'https://graph.facebook.com', oauthBaseUrl: 'https://www.facebook.com/v25.0', graphVersion: 'v25.0', requestTimeoutMs: 5000, maxPages: 2, pageSize: 25,
  pageInsightMetrics: ['page_follows', 'page_media_view'], adInsightFields: ['impressions', 'reach', 'spend'], maxImageUploadBytes: 8_000_000,
  allowedImageMimeTypes: ['image/jpeg', 'image/png'], appSecretProofEnabled: true, appSecret: 'test-secret',
};
