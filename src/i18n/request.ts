import { getRequestConfig } from 'next-intl/server';
import { Locale } from '@prisma/client';

import { resolveLocale } from './locale';

/**
 * Per-request i18n configuration for server components.
 *
 * The locale is resolved from the signed-in user, then the workspace default,
 * then Accept-Language, then English — see `resolveLocale`.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Timezone is deliberately fixed to UTC here. Every date in the UI is
    // formatted through src/lib/time.ts with an explicit workspace timezone;
    // letting next-intl apply a second, different zone would silently shift
    // scheduled times.
    timeZone: 'UTC',
    now: new Date(),
    onError(error) {
      // A missing translation should degrade to the key, not blank the page.
      if (process.env.NODE_ENV === 'development') console.warn('[i18n]', error.message);
    },
    getMessageFallback({ key, namespace }) {
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});

export { Locale };
