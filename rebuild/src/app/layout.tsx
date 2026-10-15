import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { THEME_COOKIE, THEMES } from '@/lib/themes';
import { runtimeConfig } from '@/server/config/store';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Social Pilot', template: '%s · Social Pilot' }, description: 'A clear workspace for every channel.' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const fallback = THEMES[0].id;
  const defaultTheme = await runtimeConfig('theme.default').catch(() => fallback);
  const savedTheme = cookieStore.get(THEME_COOKIE)?.value ?? defaultTheme;
  const safeTheme = THEMES.some(theme => theme.id === savedTheme) ? String(savedTheme) : fallback;
  return <html lang="en" data-theme={safeTheme}><body><ThemeProvider initialTheme={safeTheme}>{children}</ThemeProvider></body></html>;
}
