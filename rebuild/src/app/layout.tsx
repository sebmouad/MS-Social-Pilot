import { publicWebApp } from '@/modules/settings/web-app/service';
import { WebAppProvider } from '@/modules/settings/web-app/Registration';
import { WEB_APP_ROUTES } from '@/modules/settings/web-app/documents';
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
export async function generateMetadata(): Promise<Metadata> {
  const [policy, locale] = await Promise.all([publicWebApp(), settingsLocale()]);
  const t = policy.copy[locale];
  return { title: { default: t.name, template: `%s · ${t.shortName}` }, description: t.description, manifest: policy.enabled ? `${WEB_APP_ROUTES.manifest}?lang=${locale}` : undefined, icons: { icon: `${WEB_APP_ROUTES.icon}/192`, apple: `${WEB_APP_ROUTES.icon}/192` }, appleWebApp: { capable: policy.enabled, title: t.shortName } };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ theme: safeTheme, mode: safeMode }, locale, copy] = await Promise.all([initialAppearance(), settingsLocale(), runtimeConfig('settings.appearanceCopy')]);
  return <html lang={locale} className={inter.variable} data-theme={safeTheme} data-mode={safeMode}><body><WebAppProvider><ThemeProvider initialTheme={safeTheme} initialMode={safeMode} copy={copy[locale] as AppearanceCopy}>{children}<ClientErrorReporterGate /></ThemeProvider></WebAppProvider></body></html>;
}
