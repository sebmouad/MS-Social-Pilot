import { OperationError } from '@/lib/operation-error';
import { ProviderError } from './transport';
import { headers } from 'next/headers';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { policySchema } from './config';
import { createPinterestAdapter } from './adapter';
export async function configuredPolicy() { return policySchema.parse(await runtimeConfig('pinterest.policy')); }
export async function configuredCredentials() {
  const [rawId, appSecret] = await Promise.all([runtimeConfig('pinterest.clientId'), runtimeSecret('pinterest.clientSecret')]);
  const appId: unknown = rawId;
  if (typeof appId !== 'string' || !appId.trim() || !appSecret) throw new Error('Connection unavailable');
  return { appId, appSecret };
}
export async function configuredEngine() {
  let locale: 'en' | 'fr' = 'en';
  try { locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { /* Background requests use English. */ }
  const policy = await configuredPolicy();
  const engine = createPinterestAdapter(policy, fetch, locale);
  class SafeFailure extends OperationError {
    constructor(readonly rejected: boolean, code: 'invalid_request' | 'reconnect_required' | 'upstream_failure', copy: string) { super(code, copy); }
  }
  // Customer copy is resolved at the provider boundary; the shared host stays neutral.
  for (const method of ['publish', 'getRemoteStatus', 'deleteRemote'] as const) {
    const operation = engine.adapter[method];
    if (!operation) continue;
    (engine.adapter as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      try { return await (operation as (...input: unknown[]) => Promise<unknown>)(...args); }
      catch (error) {
        const rejected = error instanceof ProviderError && error.rejected;
        const permission = error instanceof ProviderError && [401, 403].includes(error.status);
        throw new SafeFailure(rejected, permission ? 'reconnect_required' : rejected ? 'invalid_request' : 'upstream_failure', policy.copy[permission ? 'permission' : rejected ? 'invalid' : method === 'publish' ? 'uncertain' : 'unavailable'][locale]);
      }
    };
  }
  const classify = engine.adapter.classifyPublishingFailure;
  engine.adapter.classifyPublishingFailure = error => error instanceof SafeFailure ? error.rejected ? 'rejected' : 'uncertain' : classify?.(error) ?? 'uncertain';
  return engine;
}
