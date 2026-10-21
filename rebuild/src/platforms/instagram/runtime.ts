import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { instagramPolicySchema } from './config';
import { createInstagramAdapter, createInstagramCollector } from './adapter';
export async function configuredInstagramPolicy() {
  return instagramPolicySchema.parse(await runtimeConfig('instagram.policy'));
}
export async function configuredInstagramAdapter(locale: 'en' | 'fr' = 'en') {
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  return createInstagramAdapter(policy, { locale, ...(appSecret ? { appSecret } : {}) });
}
export async function configuredInstagramCollector() {
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  return createInstagramCollector(policy, { ...(appSecret ? { appSecret } : {}) });
}

/** Credentials returned here are server-only and must be encrypted by connection persistence. */
export async function configuredInstagramDiscovery() {
  const { createSelectedInstagramDiscovery } = await import('./discovery');
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  return createSelectedInstagramDiscovery(policy, { ...(appSecret ? { appSecret } : {}) });
}
