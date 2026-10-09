import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * Enough to pin the app to a phone's home screen.
 *
 * There is a whole browser walk at phone width, which says this is a thing
 * people do with it — and a web app added to a home screen with no manifest
 * gets the domain as its name and a screenshot of the page as its icon.
 *
 * `standalone` so it opens without the browser's own chrome: the app has its
 * own navigation and does not need a second address bar above it.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('app');

  return {
    name: t('name'),
    short_name: 'Social Pilot',
    description: t('tagline'),
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    // The same blue as the mark, so the splash and the icon agree.
    theme_color: '#1877f2',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
