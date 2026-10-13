import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { brand } from '@/lib/operator';

/** Header and footer of the public product site (S7). Server only. */
export async function SiteFrame({ children }: { children: ReactNode }) {
  const t = await getTranslations('site');
  const { name, logoUrl } = brand();
  const links = [
    { href: '/pricing', label: t('nav.pricing') },
    { href: '/help', label: t('nav.help') },
    { href: '/changelog', label: t('nav.changelog') },
    { href: '/status', label: t('nav.status') },
  ];
  return (
    <div className="flex min-h-screen flex-col bg-[#f0f2f5]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- any host root chooses
              <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-xs text-white">
                {name.split(/\s+/).filter(Boolean).slice(-2).map((word) => word[0]!.toUpperCase()).join('')}
              </span>
            )}
            {name}
          </Link>
          <nav aria-label={t('nav.label')} className="flex flex-wrap gap-x-4 text-sm text-slate-600">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="py-2 hover:text-brand-700">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex gap-2">
            <Link href="/login" className="btn-secondary">{t('signIn')}</Link>
            <Link href="/register" className="btn-primary">{t('start')}</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-sm text-slate-600">
          <span>© {name}</span>
          <Link href="/terms" className="hover:underline">{t('terms')}</Link>
          <Link href="/privacy-policy" className="hover:underline">{t('privacy')}</Link>
          <Link href="/data-deletion" className="hover:underline">{t('dataDeletion')}</Link>
        </div>
      </footer>
    </div>
  );
}
