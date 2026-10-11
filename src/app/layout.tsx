import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

import { ServiceWorker } from '@/components/ServiceWorker';
import { env } from '@/lib/env';

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

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
