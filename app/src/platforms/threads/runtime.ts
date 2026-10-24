import { runtimeConfig, runtimeSecret } from '@/server/config/store';

import { threadsPolicySchema } from './config';
import { createThreadsAdapter } from './adapter';
/** Server-only staging factory, deliberately not installed in the customer host. */
export async function configuredThreadsAdapter(locale: 'en' | 'fr' = 'en') {
  return createThreadsAdapter(threadsPolicySchema.parse(await runtimeConfig('threads.policy')), { locale });
}
/** Caller must first authorize the actor and create durable workspace/user-bound one-use state. */
export async function configuredThreadsOAuth(request: Request, state: string) {
  const [raw, appId, appSecret] = await Promise.all([runtimeConfig('threads.policy'), runtimeConfig('threads.appId'), runtimeSecret('threads.appSecret')]);
  const policy = threadsPolicySchema.parse(raw);
  if (typeof appId !== 'string' || !appId || !appSecret || !state) throw new Error('Threads configuration unavailable');
  const redirectUri = new URL(policy.callbackPath, String(await runtimeConfig('app.publicOrigin'))).toString();
  const adapter = createThreadsAdapter(policy);
  return { authorizationUrl: adapter.getAuthorizationUrl({ appId, redirectUri, state, scopes: policy.scopes }), exchange: (code: string) => adapter.exchangeCode({ appId, appSecret, redirectUri, code }) };
}
