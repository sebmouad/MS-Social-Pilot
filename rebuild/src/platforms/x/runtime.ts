import { requestOrigin } from '@/server/request-origin';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { createXAdapter } from './adapter';
import { xPolicySchema } from './config';
/** Protocol construction only. Intentionally not installed as a customer host. */
export async function configuredXAdapter(locale: 'en' | 'fr' = 'en') {
  const [policy, clientId, clientSecret] = await Promise.all([runtimeConfig('x.policy'), runtimeSecret('x.clientId'), runtimeSecret('x.clientSecret')]);
  if (!clientId || !clientSecret) throw new Error('X application credentials are unavailable.');
  return createXAdapter(xPolicySchema.parse(policy), { clientId, clientSecret }, { locale });
}

/** Origin is resolved through the same trusted host policy as other connections. */
export async function startConfiguredXOAuth(request: Request, state: string) {
  const adapter = await configuredXAdapter();
  return adapter.startOAuth({ requestOrigin: requestOrigin(request), state });
}
