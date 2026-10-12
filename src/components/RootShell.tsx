'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';

/**
 * The root section's frame: its own sidebar, apart from the workspace app, and
 * a banner on every screen saying that changes here affect the whole
 * installation. On a phone the sidebar is a strip of links above the content.
 */
export function RootShell({ userName, children }: { userName: string; children: ReactNode }) {
  const t = useTranslations('root');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: Array<{ href: string; label: string; icon: IconName }> = [
    { href: '/root', label: t('nav.overview'), icon: 'dashboard' },
    { href: '/root/config', label: t('nav.config'), icon: 'config' },
    { href: '/root/workspaces', label: t('nav.workspaces'), icon: 'folders' },
    { href: '/root/users', label: t('nav.users'), icon: 'team' },
    { href: '/root/sessions', label: t('nav.sessions'), icon: 'globe' },
    { href: '/root/registration', label: t('nav.registration'), icon: 'mail' },
    { href: '/root/privileges', label: t('nav.privileges'), icon: 'key' },
    { href: '/root/worker', label: t('nav.worker'), icon: 'refresh' },
    { href: '/root/alerts', label: t('nav.alerts'), icon: 'bell' },
    { href: '/root/backups', label: t('nav.backups'), icon: 'download' },
    { href: '/root/activity', label: t('nav.activity'), icon: 'clock' },
    { href: '/root/danger', label: t('nav.danger'), icon: 'warning' },
  ];
  const active = (href: string) => (href === '/root' ? pathname === href : pathname.startsWith(href));

  const nav = (
    <nav aria-label={t('nav.label')} className="space-y-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active(item.href) ? 'page' : undefined}
          className={`flex h-10 items-center gap-3 rounded-lg px-2.5 text-[15px] font-semibold ${
            active(item.href) ? 'bg-amber-100 text-amber-900' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Icon name={item.icon} size={20} className={active(item.href) ? 'text-amber-700' : 'text-slate-500'} />
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <header className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-3 py-3 lg:pt-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
            <Icon name="shield" size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-slate-900">{t('title')}</span>
            <span className="block truncate text-xs text-slate-500">{userName}</span>
          </span>
          <button
            type="button"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 lg:hidden"
            aria-expanded={open}
            aria-controls="root-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? 'close' : 'menu'} size={20} />
            <span className="sr-only">{t('nav.menu')}</span>
          </button>
        </div>
        <div id="root-menu" className={`${open ? 'block' : 'hidden'} px-3 pb-3 lg:block`}>
          {nav}
          <Link
            href="/dashboard"
            className="mt-4 flex h-10 items-center gap-3 rounded-lg border border-slate-200 px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Icon name="chevronLeft" size={18} className="text-slate-500" />
            {t('nav.back')}
          </Link>
        </div>
      </header>

      <div className="min-w-0 flex-1">
        <p role="note" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 sm:px-6">
          <Icon name="shield" size={16} className="shrink-0" /> {t('banner')}
        </p>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
