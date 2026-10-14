import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider, THEME_COOKIE } from '@/components/ThemeProvider';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Social Pilot', template: '%s · Social Pilot' }, description: 'A clear workspace for every channel.' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const savedTheme = cookieStore.get(THEME_COOKIE)?.value ?? 'grove';
  const safeTheme = ['grove', 'coast', 'clay', 'nightfall'].includes(savedTheme) ? savedTheme : 'grove';
  return <html lang="en" data-theme={safeTheme}><body><ThemeProvider initialTheme={safeTheme}>{children}</ThemeProvider></body></html>;
}
