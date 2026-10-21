import { headers } from 'next/headers';

/** Customer request preference; background collectors use the English catalog. */
export async function instagramLocale(): Promise<'en' | 'fr'> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; }
  catch { return 'en'; }
}
