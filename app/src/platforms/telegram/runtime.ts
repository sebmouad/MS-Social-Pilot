import { runtimeConfig } from '@/server/config/store';
import { policySchema } from './config';
import { createClient } from './client';
import { createTelegramAdapter } from './adapter';

export async function configuredPolicy() {
  return policySchema.parse(await runtimeConfig('telegram.policy'));
}
export async function configuredClient(locale: 'en' | 'fr' = 'en') {
  return createClient(await configuredPolicy(), fetch, locale);
}
export async function configuredTelegramAdapter(locale: 'en' | 'fr' = 'en') {
  return createTelegramAdapter(await configuredPolicy(), { locale });
}
