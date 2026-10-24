import { runtimeConfig } from '@/server/config/store';
import { policySchema } from './config';
import { createClient } from './client';
import { createBlueskyAdapter } from './adapter';

export async function configuredPolicy() {
  return policySchema.parse(await runtimeConfig('bluesky.policy'));
}
export async function configuredClient(locale: 'en' | 'fr' = 'en') {
  return createClient(await configuredPolicy(), fetch, locale);
}
export async function configuredBlueskyAdapter(locale: 'en' | 'fr' = 'en') {
  return createBlueskyAdapter(await configuredPolicy(), { locale });
}
