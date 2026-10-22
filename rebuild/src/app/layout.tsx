import type { Metadata } from 'next';
import { initialAppearance } from '@/modules/settings/server/appearance';
import { settingsLocale } from '@/modules/settings/ui/locale';
import type { AppearanceCopy } from '@/modules/settings/ui/appearance/copy';
import { ThemeProvider } from '@/components/ThemeProvider';
import { runtimeConfig } from '@/server/config/store';
import { ClientErrorReporterGate } from '@/server/errors/ClientErrorReporterGate';
import { Inter } from 'next/font/google';
import './globals.css';
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });
export const metadata: Metadata = { title: { default: 'Social Pilot', template: '%s · Social Pilot' }, description: 'A clear workspace for every channel.' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ theme: safeTheme, mode: safeMode }, locale, copy] = await Promise.all([initialAppearance(), settingsLocale(), runtimeConfig('settings.appearanceCopy')]);
  return <html lang={locale} className={inter.variable} data-theme={safeTheme} data-mode={safeMode}><body><ThemeProvider initialTheme={safeTheme} initialMode={safeMode} copy={copy[locale] as AppearanceCopy}>{children}<ClientErrorReporterGate /></ThemeProvider></body></html>;
}
