import { headers } from 'next/headers';
import type { KitLocale } from './copy';

/** Customer-screen language from the request; English when there is no request context. */
export async function pageLocale(): Promise<KitLocale> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { return 'en'; }
}
