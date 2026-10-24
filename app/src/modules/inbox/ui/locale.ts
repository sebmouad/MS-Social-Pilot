import { headers } from 'next/headers';
import type { InboxLocale } from './copy';

/** Customer-screen language from the request, resolved the same way as Publishing; English without a request. */
export async function inboxLocale(): Promise<InboxLocale> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { return 'en'; }
}
