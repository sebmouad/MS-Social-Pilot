import { runtimeConfig } from '@/server/config/store';
import { policySchema } from './config';
import { createClient } from './client';
export async function configuredClient(locale: 'en' | 'fr' = 'en') {
  return createClient(policySchema.parse(await runtimeConfig('telegram.policy')), fetch, locale);
}
