import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_ERROR_COPY, rootErrorCopySchema } from './config';

export async function loadRootErrorCopy() {
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  // Bootstrap fallback also keeps errors inspectable when configuration storage fails.
  const catalog = await runtimeConfig('root.errorCopy').then(value => rootErrorCopySchema.parse(value)).catch(() => ROOT_ERROR_COPY);
  return { copy: catalog[locale], locale };
}
