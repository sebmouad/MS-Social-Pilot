import { headers } from 'next/headers';
import { Locale } from '@prisma/client';

import { getAuthContext } from '@/lib/auth';
import { env } from '@/lib/env';

/**
 * Which language to render in.
 *
 * Order of preference, most specific first:
 *   1. the signed-in user's own choice
 *   2. the active workspace's default (an agency may run a French client)
 *   3. the browser's Accept-Language
 *   4. English
 */

export const SUPPORTED_LOCALES = Object.values(Locale);
export const DEFAULT_LOCALE = Locale.en;

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

/** Pick the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
      return {
        // "fr-CA" and "fr" both select French.
        language: (tag ?? '').trim().toLowerCase().split('-')[0] ?? '',
        quality: quality ? Number.parseFloat(quality.slice(2)) : 1,
      };
    })
    .filter((entry) => entry.language && Number.isFinite(entry.quality))
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (isSupportedLocale(entry.language)) return entry.language;
  }
  return null;
}

export async function resolveLocale(): Promise<Locale> {
  // A signed-out visitor on /login has no context; fall through to the header.
  const auth = await getAuthContext().catch(() => null);
  if (auth) return auth.user.locale ?? auth.workspace.defaultLocale ?? DEFAULT_LOCALE;

  const requestHeaders = await headers();
  // Read through the settings store rather than the environment directly, so
  // this is editable on the configuration screen like everything else. The
  // getAuthContext call above has already loaded the snapshot, even for the
  // signed-out visitor this branch exists for.
  const configured = env.defaultLocale;

  return (
    negotiateLocale(requestHeaders.get('accept-language')) ??
    (configured && isSupportedLocale(configured) ? configured : DEFAULT_LOCALE)
  );
}
