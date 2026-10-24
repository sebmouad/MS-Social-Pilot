import { headers } from 'next/headers';
import type { AuthLocale } from './copy';

/** Signed-out pages have no stored preference yet, so the browser's first language decides. */
export async function authLocale(): Promise<AuthLocale> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; }
  catch { return 'en'; }
}
