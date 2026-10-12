import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

import { ServiceWorker } from '@/components/ServiceWorker';
import { getAuthContext } from '@/lib/auth';
import { env } from '@/lib/env';
import { textDirection } from '@/lib/languages';
import { DEFAULT_THEME } from '@/lib/themes';

import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');

  return {
    title: t('name'),
    description: t('tagline'),
    // Absolute, because Facebook and Resend both fetch pages from their own
    // servers and a relative URL means nothing to either.
    metadataBase: new URL(env.appUrl),
    manifest: '/manifest.webmanifest',
    // Saved to an iPhone's home screen: its own icon, opening full screen.
    appleWebApp: { capable: true, title: 'Social Pilot', statusBarStyle: 'default' },
    icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  };
}

/**
 * Matches the mark, so a phone's chrome tints to the same blue as the icon.
 *
 * This belongs in `viewport`, not `metadata`: Next drops `themeColor` from a
 * metadata export with a warning, which means the tint quietly never happened.
 */
export const viewport: Viewport = {
  themeColor: '#1877f2',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Messages are passed to the client provider so client components can
  // translate without a second round trip.
  const messages = await getMessages();
  // The signed-in person's look; already loaded for the locale, so no extra query.
  const auth = await getAuthContext().catch(() => null);

  return (
    <html lang={locale} dir={textDirection(locale)} data-theme={auth?.user.theme ?? DEFAULT_THEME}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
