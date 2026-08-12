import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

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
    // Matches the mark, so a phone's chrome tints to the same blue.
    themeColor: '#3563e9',
  };
}

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
      </body>
    </html>
  );
}
