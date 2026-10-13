'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { CONFIG_SECTIONS, type ConfigSection } from '@/lib/root-config-sections';
import { OTHER_PLATFORMS, PLATFORM_NAMES } from '@/lib/root-platforms';
import { Icon, type IconName } from './Icon';

const CONFIG_ICONS: Record<ConfigSection, IconName> = {
  url: 'link',
  ai: 'sparkles',
  storage: 'image',
  email: 'mail',
  security: 'shield',
  general: 'config',
};

/**
 * The root section's frame: its own sidebar, apart from the workspace app, and
 * a banner on every screen saying that changes here affect the whole
 * installation. On a phone the sidebar is a strip of links above the content.
 */
export function RootShell({ userName, children }: { userName: string; children: ReactNode }) {
  const t = useTranslations('root');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  type Item = { href: string; label: string; icon: IconName; group?: string; danger?: boolean; exact?: boolean; sub?: boolean };
  const settings = t('nav.groupSettings');
  const platforms = t('nav.groupPlatforms');
  const inMeta = pathname.startsWith('/root/meta');
  const items: Item[] = [
    { href: '/root', label: t('nav.overview'), icon: 'dashboard', exact: true },
    ...CONFIG_SECTIONS.map((section): Item => ({ href: `/root/config/${section}`, label: t(`nav.configSections.${section}`), icon: CONFIG_ICONS[section], group: settings })),
    { href: '/root/plans', label: t('nav.plans'), icon: 'tag', group: settings },
    { href: '/root/registration', label: t('nav.registration'), icon: 'mail', group: settings },
    { href: '/root/platforms', label: t('nav.platformsOverview'), icon: 'connections', group: platforms, exact: true },
    { href: '/root/meta', label: t('nav.meta'), icon: 'globe', group: platforms, exact: inMeta },
    ...(inMeta
      ? [
          { href: '/root/meta/usage', label: t('nav.metaUsage'), icon: 'analytics', group: platforms, sub: true },
          { href: '/root/meta/connections', label: t('nav.metaConnections'), icon: 'connections', group: platforms, sub: true },
        ] satisfies Item[]
      : []),
    ...OTHER_PLATFORMS.map((platform): Item => ({ href: `/root/platforms/${platform}`, label: PLATFORM_NAMES[platform], icon: 'share', group: platforms })),
    { href: '/root/connections', label: t('nav.connections'), icon: 'connections', group: platforms },
    { href: '/root/workspaces', label: t('nav.workspaces'), icon: 'folders', group: t('nav.groupPeople') },
    { href: '/root/users', label: t('nav.users'), icon: 'team', group: t('nav.groupPeople') },
    { href: '/root/agency', label: t('nav.agency'), icon: 'analytics', group: t('nav.groupPeople') },
    { href: '/root/privileges', label: t('nav.privileges'), icon: 'key', group: t('nav.groupPeople') },
    { href: '/root/sessions', label: t('nav.sessions'), icon: 'globe', group: t('nav.groupPeople') },
    { href: '/root/status', label: t('nav.status'), icon: 'check', group: t('nav.groupHealth') },
    { href: '/root/worker', label: t('nav.worker'), icon: 'refresh', group: t('nav.groupHealth') },
    { href: '/root/errors', label: t('nav.errors'), icon: 'warning', group: t('nav.groupHealth') },
    { href: '/root/alerts', label: t('nav.alerts'), icon: 'bell', group: t('nav.groupHealth') },
    { href: '/root/backups', label: t('nav.backups'), icon: 'download', group: t('nav.groupHealth') },
    { href: '/root/activity', label: t('nav.activity'), icon: 'clock', group: t('nav.groupHistory') },
    { href: '/root/changelog', label: t('nav.changelog'), icon: 'pencil', group: t('nav.groupHistory') },
    { href: '/root/danger', label: t('nav.danger'), icon: 'warning', danger: true },
  ];
  const active = (item: Item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const nav = (
    <nav aria-label={t('nav.label')} className="space-y-0.5">
      {items.map((item, index) => (
        <div key={item.href} className={item.danger ? 'mt-3 border-t border-slate-200 pt-3' : undefined}>
          {item.group && item.group !== items[index - 1]?.group && (
            <p className="mb-1 mt-3 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.group}</p>
          )}
        <Link
          href={item.href}
          aria-current={active(item) ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-lg px-2.5 font-semibold ${item.sub ? 'ms-6 h-9 text-sm' : 'h-10 text-[15px]'} ${
            active(item) ? 'bg-amber-100 text-amber-900' : item.danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Icon name={item.icon} size={item.sub ? 16 : 20} className={active(item) ? 'text-amber-700' : item.danger ? 'text-red-600' : 'text-slate-500'} />
          <span className="truncate">{item.label}</span>
        </Link>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#root-content" className="sr-only fixed start-3 top-3 z-[100] rounded bg-white px-4 py-3 shadow focus:not-sr-only">{t('nav.skipToContent')}</a>
      <header className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-e">
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
            className="ms-auto flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 lg:hidden"
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
        <main id="root-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
