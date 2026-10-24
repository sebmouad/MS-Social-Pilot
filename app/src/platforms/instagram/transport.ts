import { createHmac } from 'node:crypto';
import { PlatformApiError } from '../errors';
import type { InstagramPolicy } from './config';

export class InstagramError extends PlatformApiError {
  constructor(message: string, readonly outcome: 'rejected' | 'uncertain', retryable = false) { super(message, retryable); this.name = 'InstagramError'; }
}
export type Json = Record<string, unknown>;
export const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
export type InstagramGraph = ReturnType<typeof createInstagramGraph>;
/** Wire fields/edges and Graph error codes are protocol invariants, isolated to this module. No mutation retries. */
export function createInstagramGraph(policy: InstagramPolicy, options: { fetch?: typeof fetch; appSecret?: string; locale?: 'en' | 'fr' } = {}) {
  const text = (key: keyof InstagramPolicy['copy']) => policy.copy[key][options.locale ?? 'en'];
  async function request(path: string, token: string, params: Record<string, string> = {}, method: 'GET' | 'POST' | 'DELETE' = 'GET', signal?: AbortSignal): Promise<Json> {
    if (!token || (policy.appSecretProofEnabled && !options.appSecret)) throw new InstagramError(text('permission'), 'rejected');
    if (signal?.aborted) throw new InstagramError(text('unavailable'), 'rejected');
    const url = new URL(`${policy.graphBaseUrl.replace(/\/+$/, '')}/${policy.graphVersion}/${path.split('/').map(encodeURIComponent).join('/')}`);
    const fields = new URLSearchParams(params);
    if (policy.appSecretProofEnabled) fields.set('appsecret_proof', createHmac('sha256', options.appSecret!).update(token).digest('hex'));
    if (method === 'GET') url.search = fields.toString();
    let response: Response; let raw: unknown;
    try {
      response = await (options.fetch ?? fetch)(url, { method, headers: { Authorization: `Bearer ${token}` }, ...(method !== 'GET' ? { body: fields } : {}), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(policy.requestTimeoutMs)]) : AbortSignal.timeout(policy.requestTimeoutMs) });
      raw = await response.json();
    } catch { throw new InstagramError(text('unavailable'), 'uncertain', true); }
    const result = object(raw); const error = object(result.error);
    if (!response.ok || result.error) {
      const definite = response.status >= 400 && response.status < 500 && response.status !== 429 && error.is_transient !== true && [10, 100, 190, 200].includes(Number(error.code));
      throw new InstagramError(text('unavailable'), definite ? 'rejected' : 'uncertain', response.status >= 500 || response.status === 429 || error.is_transient === true);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InstagramError(text('unavailable'), 'uncertain');
    return result;
  }
  async function list(path: string, token: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<{ items: Json[]; truncated: boolean }> {
    const items: Json[] = []; let after: string | undefined;
    for (let page = 0; page < policy.maxPages; page++) {
      const result = await request(path, token, { ...params, limit: String(policy.pageSize), ...(after ? { after } : {}) }, 'GET', signal);
      if (!Array.isArray(result.data)) throw new InstagramError(text('unavailable'), 'uncertain');
      items.push(...result.data.map(object));
      const paging = object(result.paging); const cursor = object(paging.cursors).after;
      if (!paging.next) return { items, truncated: false };
      if (typeof cursor !== 'string' || !cursor || cursor === after) return { items, truncated: true };
      after = cursor; // Never follow provider-supplied URLs: credentials stay on the configured origin.
    }
    return { items, truncated: true };
  }
  return { request, list, text };
}
