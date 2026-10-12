'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';

/** Sub-navigation shared by every settings screen. */
export function SettingsNav({
  showPermissions = false,
  showHistory = true,
  showExport = false,
  showWebhooks = false,
}: {
  /** Admins: the read-only list of who may do what in this workspace. */
  showPermissions?: boolean;
  /** Hidden from anyone who would only reach a refusal by clicking it. */
  showHistory?: boolean;
  /** Owner only: download everything the workspace holds. */
  showExport?: boolean;
  /** Owners and admins: outgoing webhooks. */
  showWebhooks?: boolean;
}) {
  const t = useTranslations();
  const pathname = usePathname();

  const tabs: Array<{ href: string; label: string; icon: IconName }> = [
    { href: '/settings', label: t('settings.workspace'), icon: 'settings' },
    { href: '/settings/team', label: t('team.title'), icon: 'team' },
    { href: '/settings/pages', label: t('groups.title'), icon: 'folders' },
    { href: '/settings/sharing', label: t('sharing.title'), icon: 'link' },
    { href: '/settings/api', label: t('apiKeys.title'), icon: 'code' },
    { href: '/settings/notifications', label: t('notifications.title'), icon: 'bell' },
    ...(showWebhooks ? [{ href: '/settings/webhooks', label: t('webhooks.title'), icon: 'share' as IconName }] : []),
    { href: '/settings/account', label: t('account.title'), icon: 'key' },
    { href: '/settings/media', label: t('media.title'), icon: 'image' },
    ...(showHistory
      ? [{ href: '/settings/history', label: t('history.title'), icon: 'clock' as IconName }]
      : []),
    ...(showExport ? [{ href: '/settings/export', label: t('workspaceExport.title'), icon: 'download' as IconName }] : []),
    // Instance configuration lives in the root section now (/root/config).
    ...(showPermissions
      ? [{ href: '/settings/permissions', label: t('root.privileges.workspaceTitle'), icon: 'key' as IconName }]
      : []),
  ];

  return (
    // Named, because the page already has a main navigation: two unnamed
    // landmarks read as "navigation, navigation" to a screen reader.
    // A strip of tabs on a phone; Facebook's left menu from a laptop up.
    <nav
      aria-label={t('settings.title')}
      className="scroll-x flex gap-1 border-b border-slate-200 pb-3 lg:card lg:flex-col lg:gap-0.5 lg:border-b-0 lg:p-2"
    >
      {tabs.map((tab) => {
        // Exact match for /settings so it does not light up on its children.
        const active = tab.href === '/settings' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium lg:gap-3 lg:px-2 lg:py-2 lg:text-[15px] lg:font-semibold ${
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 lg:text-slate-900'
            }`}
          >
            {/* Facebook's menu icons sit on grey discs. */}
            <span
              className={`flex shrink-0 items-center justify-center lg:h-9 lg:w-9 lg:rounded-full ${
                active ? 'lg:bg-brand-500 lg:text-white' : 'lg:bg-slate-200 lg:text-slate-700'
              }`}
            >
              <Icon name={tab.icon} size={16} />
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
