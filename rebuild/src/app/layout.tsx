import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { MODE_COOKIE, THEME_COOKIE, THEMES, isModeId } from '@/lib/themes';
import { runtimeConfig } from '@/server/config/store';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Social Pilot', template: '%s · Social Pilot' }, description: 'A clear workspace for every channel.' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const fallback = THEMES[0].id;
  const defaultTheme = await runtimeConfig('theme.default').catch(() => fallback);
  const savedTheme = cookieStore.get(THEME_COOKIE)?.value ?? defaultTheme;
  const safeTheme = THEMES.some(theme => theme.id === savedTheme) ? String(savedTheme) : fallback;
  const defaultMode = await runtimeConfig('theme.defaultMode').catch(() => 'system');
  const savedMode = cookieStore.get(MODE_COOKIE)?.value ?? defaultMode;
  const safeMode = isModeId(savedMode) ? savedMode : 'system';
  return <html lang="en" data-theme={safeTheme} data-mode={safeMode}><body><ThemeProvider initialTheme={safeTheme} initialMode={safeMode}>{children}</ThemeProvider></body></html>;
}
