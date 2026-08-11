'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

interface Props {
  userName: string;
  workspaceId: string;
  workspaceName: string;
  timezone: string;
  workspaces: WorkspaceOption[];
  /** Hides the approvals link for people who cannot act on it. */
  showApprovals: boolean;
  pendingApprovals: number;
}

export function NavBar({
  userName,
  workspaceId,
  workspaceName,
  timezone,
  workspaces,
  showApprovals,
  pendingApprovals,
}: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const links: Array<{ href: string; label: string; icon: IconName; badge?: number }> = [
    { href: '/dashboard', label: t('dashboard'), icon: 'dashboard' },
    { href: '/compose', label: t('compose'), icon: 'compose' },
    { href: '/calendar', label: t('calendar'), icon: 'calendar' },
    { href: '/posts', label: t('posts'), icon: 'posts' },
    ...(showApprovals
      ? [{ href: '/approvals', label: t('approvals'), icon: 'approvals' as IconName, badge: pendingApprovals }]
      : []),
    { href: '/connections', label: t('connections'), icon: 'connections' },
    { href: '/feeds', label: t('feeds'), icon: 'feeds' },
    { href: '/analytics', label: t('analytics'), icon: 'analytics' },
    { href: '/reports', label: t('reports'), icon: 'reports' },
    { href: '/settings', label: t('settings'), icon: 'settings' },
  ];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.refresh();
    router.push('/login');
  }

  async function switchTo(id: string) {
    if (id === workspaceId) return;
    setSwitching(true);
    await fetch('/api/workspace/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    });
    // A full refresh: every server component on the page is scoped to the
    // workspace, so all of them need to re-render against the new one.
    router.refresh();
    setSwitching(false);
  }

  const navLinks = (
    <>
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMenuOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:px-2.5 lg:py-1.5 ${
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon name={link.icon} size={16} className={active ? '' : 'text-slate-400'} />
            {link.label}
            {typeof link.badge === 'number' && link.badge > 0 && (
              <span className="rounded-full bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700">
                {link.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-x-4 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            SP
          </span>
          {/* The wordmark is dropped once the link row appears: ten labels
              plus a workspace switcher already fill the bar, and the product
              name is on the tab, the login screen and every email. */}
          <span className="text-sm font-semibold text-slate-900 lg:hidden">MS Social Pilot</span>
        </Link>

        {/* Ten links wrap into three ragged rows on a phone and push the page
            below the fold. Below `lg` they live behind a menu instead; above
            it they stay on one line and scroll rather than wrapping, so the
            header height never changes with the label lengths. */}
        <nav className="scroll-x hidden min-w-0 flex-1 lg:block">
          <div className="flex items-center gap-0.5">{navLinks}</div>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {workspaces.length > 1 ? (
            <label>
              <span className="sr-only">{t('switchWorkspace')}</span>
              <select
                className="max-w-[7.5rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 lg:max-w-[9rem]"
                value={workspaceId}
                disabled={switching}
                onChange={(event) => switchTo(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="hidden text-sm font-medium text-slate-900 sm:block">{workspaceName}</p>
          )}

          <p className="hidden text-xs text-slate-500 2xl:block">
            {userName} · {timezone}
          </p>

          <button type="button" onClick={signOut} className="btn-secondary hidden lg:inline-flex">
            <Icon name="signOut" size={15} />
            {/* sr-only rather than hidden: `display:none` would take the label
                away from a screen reader too, leaving an unnamed button. */}
            <span className="sr-only 2xl:not-sr-only">{t('signOut')}</span>
          </button>

          <button
            type="button"
            className="btn-secondary lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="sr-only">{t('menu')}</span>
            <Icon name={menuOpen ? 'close' : 'menu'} size={18} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="main-menu" className="border-t border-slate-200 px-4 py-3 lg:hidden">
          <nav className="grid grid-cols-2 gap-1">{navLinks}</nav>
          <button type="button" onClick={signOut} className="btn-secondary mt-3 w-full">
            {t('signOut')}
          </button>
        </div>
      )}
    </header>
  );
}
