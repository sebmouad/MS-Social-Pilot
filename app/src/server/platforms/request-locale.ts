import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';

/** Locale named by an Accept-Language header: only a leading English or French tag counts. */
export function localeFromAcceptLanguage(value: string | null | undefined): 'en' | 'fr' | null {
  const tag = (value ?? '').trim().toLowerCase();
  if (/^fr\b/.test(tag)) return 'fr';
  if (/^en\b/.test(tag)) return 'en';
  return null;
}

/** Customer request preference for module-owned messages; unknown preferences use Root `ui.defaultLocale`. Background work uses the English catalog. */
export async function requestLocale(): Promise<'en' | 'fr'> {
  try {
    const asked = localeFromAcceptLanguage((await headers()).get('accept-language'));
    if (asked) return asked;
    return (await runtimeConfig('ui.defaultLocale')) === 'fr' ? 'fr' : 'en';
  } catch { return 'en'; }
}
