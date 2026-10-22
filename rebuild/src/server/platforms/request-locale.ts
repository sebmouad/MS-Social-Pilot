import { headers } from 'next/headers';

/** Customer request preference for module-owned messages; background work uses the English catalog. */
export async function requestLocale(): Promise<'en' | 'fr'> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; }
  catch { return 'en'; }
}
