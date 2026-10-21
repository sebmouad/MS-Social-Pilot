import { cache } from 'react';
import { authLocale } from '../auth/locale';
import { runtimeConfig } from '@/server/config/store';
import { homeCopySchema, homeLocaleCopy } from '../copy';
import type { AuthLocale } from '../auth/copy';

/** One validated catalog read shared by Home consumers in the current render request. */
const catalog = cache(async () => homeCopySchema.parse(await runtimeConfig('home.uiCopy')));
export async function loadHomeCopy(locale: AuthLocale) {
  return homeLocaleCopy(await catalog(), locale);
}

/** Pending route integration: callers outside Home must pass this JSON to client forms. */
export const loadAuthCopyCatalog = cache(async () => {
  const { authCopySchema, authLocaleCopy } = await import('../auth/copy');
  const catalog = authCopySchema.parse(await runtimeConfig('home.authCopy'));
  return { en: authLocaleCopy(catalog, 'en'), fr: authLocaleCopy(catalog, 'fr') };
});

export async function homeErrorCopy() { return loadHomeCopy(await authLocale()); }
