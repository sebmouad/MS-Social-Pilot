'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';

/** Sub-navigation shared by every settings screen. */
export function SettingsNav({ showConfig = false }: { showConfig?: boolean }) {
  const t = useTranslations();
  const pathname = usePathname();

  const tabs: Array<{ href: string; label: string; icon: IconName }> = [
    { href: '/settings', label: t('settings.workspace'), icon: 'settings' },
    { href: '/settings/team', label: t('team.title'), icon: 'team' },
    { href: '/settings/notifications', label: t('notifications.title'), icon: 'bell' },
    { href: '/settings/media', label: t('media.title'), icon: 'image' },
    // Instance configuration is owner-only, so the tab is not shown to anyone
    // who would only reach a refusal by clicking it.
    ...(showConfig
      ? [{ href: '/settings/config', label: t('config.title'), icon: 'config' as IconName }]
      : []),
  ];

  return (
    <nav className="scroll-x flex gap-1 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        // Exact match for /settings so it does not light up on its children.
        const active = tab.href === '/settings' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
