'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Sub-navigation shared by every settings screen. */
export function SettingsNav() {
  const t = useTranslations();
  const pathname = usePathname();

  const tabs = [
    { href: '/settings', label: t('settings.workspace') },
    { href: '/settings/team', label: t('team.title') },
    { href: '/settings/notifications', label: t('notifications.title') },
  ];

  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        // Exact match for /settings so it does not light up on its children.
        const active = tab.href === '/settings' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
