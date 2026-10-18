import type { FacebookConfig } from '@/platforms/facebook/config';
import { validateFacebookConfig } from '@/platforms/facebook/config';
import { facebookAppSecretProof, graphObjectUrl, isFacebookDefiniteRejection } from '@/platforms/facebook/protocol';

export type FacebookAdsFetch = typeof fetch;

/** Provider failure. `beforeWrite` means no mutating request was sent. */
export class FacebookAdsOpsError extends Error {
  constructor(message: string, readonly detail: { status: number; code?: number; transient?: boolean; beforeWrite?: boolean; definite?: boolean }) {
    super(message);
    this.name = 'FacebookAdsOpsError';
  }
}

/** A failure proves "nothing changed" only when no write was sent or Graph explicitly rejected it. Everything else stays uncertain. */
export function classifyFacebookAdsFailure(error: unknown): 'rejected' | 'uncertain' {
  if (!(error instanceof FacebookAdsOpsError)) return 'uncertain';
  if (error.detail.beforeWrite) return 'rejected';
  return isFacebookDefiniteRejection(error.detail.status, error.detail.code, error.detail.transient === true) ? 'rejected' : 'uncertain';
}

type GraphBody = { error?: { message?: unknown; code?: unknown; is_transient?: unknown } } & Record<string, unknown>;

export function createFacebookAdsTransport(rawConfig: FacebookConfig, fetchImpl: FacebookAdsFetch = fetch) {
  const config = validateFacebookConfig(rawConfig);
  if (config.appSecretProofEnabled && !config.appSecret) throw new FacebookAdsOpsError('Facebook app secret is required for signed Graph requests.', { status: 0, beforeWrite: true });
  const proof = (token: string) => (config.appSecretProofEnabled ? facebookAppSecretProof(token, config.appSecret!) : undefined);

  async function send(method: 'GET' | 'POST', path: string, token: string, fields: Record<string, string> = {}, signal?: AbortSignal): Promise<GraphBody> {
    const write = method === 'POST';
    if (signal?.aborted) throw new FacebookAdsOpsError('The operation was cancelled before dispatch.', { status: 0, beforeWrite: true });
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]) : AbortSignal.timeout(config.requestTimeoutMs);
    const url = graphObjectUrl(config, path);
    const params = new URLSearchParams(fields);
    const signed = proof(token);
    let init: RequestInit;
    if (write) {
      params.set('access_token', token);
      if (signed) params.set('appsecret_proof', signed);
      init = { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params, redirect: 'error', signal: requestSignal };
    } else {
      for (const [key, value] of params) url.searchParams.set(key, value);
      url.searchParams.set('access_token', token);
      if (signed) url.searchParams.set('appsecret_proof', signed);
      init = { method, redirect: 'error', signal: requestSignal };
    }
    let response: Response;
    try { response = await fetchImpl(url, init); }
    catch { throw new FacebookAdsOpsError('Facebook could not be reached.', { status: 0, beforeWrite: !write }); }
    const payload = await response.json().catch(() => null) as GraphBody | null;
    if (!response.ok || payload?.error) {
      const code = typeof payload?.error?.code === 'number' ? payload.error.code : undefined;
      throw new FacebookAdsOpsError(`Facebook answered ${response.status}.`, { status: response.status, ...(code === undefined ? {} : { code }), transient: payload?.error?.is_transient === true, beforeWrite: !write });
    }
    if (!payload || typeof payload !== 'object') throw new FacebookAdsOpsError('Facebook returned an unreadable response.', { status: response.status, beforeWrite: !write });
    return payload;
  }
  return { get: (path: string, token: string, fields?: Record<string, string>, signal?: AbortSignal) => send('GET', path, token, fields, signal), post: (path: string, token: string, fields: Record<string, string>, signal?: AbortSignal) => send('POST', path, token, fields, signal) };
}
export type FacebookAdsTransport = ReturnType<typeof createFacebookAdsTransport>;
