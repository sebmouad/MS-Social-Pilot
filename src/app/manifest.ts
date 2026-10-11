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
    // "Share → MS Social Pilot" from any app on the phone opens the composer
    // with the page's link and title filled in.
    share_target: {
      action: '/compose',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
    shortcuts: [
      { name: t('shortcutCompose'), url: '/compose' },
      { name: t('shortcutCalendar'), url: '/calendar' },
      { name: t('shortcutAnalytics'), url: '/analytics' },
    ],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
