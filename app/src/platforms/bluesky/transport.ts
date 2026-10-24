import { PlatformApiError } from '../errors';
import type { Policy } from './config';
/** Never include response bodies, request URLs or credentials in failures. No retries. */
export function transport(policy: Policy, send: typeof fetch = fetch, locale: 'en' | 'fr' = 'en') {
  return async (path: string, body: unknown, token?: string): Promise<unknown> => {
    try {
      const response = await send(`${policy.baseUrl.replace(/\/$/, '')}/${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(policy.requestTimeoutMs),
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { throw new PlatformApiError(policy.unavailable[locale], false); }
  };
}
