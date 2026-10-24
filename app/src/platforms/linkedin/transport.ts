import type { Policy } from './config';
/** Protocol failures never retain provider bodies, URLs or credentials. */
export class ProviderError extends Error {
  constructor(readonly status: number, readonly rejected = false) { super('Provider request failed'); }
}
export function transport(policy: Policy, fetcher: typeof fetch = fetch) {
  return async (url: string | URL, init: RequestInit = {}) => {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(policy.requestTimeoutMs)]) : AbortSignal.timeout(policy.requestTimeoutMs) });
    if (!response.ok) throw new ProviderError(response.status, response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status));
    return response;
  };
}
