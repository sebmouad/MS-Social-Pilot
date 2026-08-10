'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

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

  const links = [
    { href: '/dashboard', label: t('dashboard') },
    { href: '/compose', label: t('compose') },
    { href: '/calendar', label: t('calendar') },
    { href: '/posts', label: t('posts') },
    ...(showApprovals ? [{ href: '/approvals', label: t('approvals'), badge: pendingApprovals }] : []),
    { href: '/accounts', label: t('accounts') },
    { href: '/feeds', label: t('feeds') },
    { href: '/analytics', label: t('analytics') },
    { href: '/reports', label: t('reports') },
    { href: '/settings', label: t('settings') },
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

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            SP
          </span>
          <span className="hidden text-sm font-semibold text-slate-900 sm:inline">MS Social Pilot</span>
        </Link>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {link.label}
                {'badge' in link && typeof link.badge === 'number' && link.badge > 0 && (
                  <span className="rounded-full bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700">
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {workspaces.length > 1 ? (
            <label className="flex flex-col text-right">
              <span className="sr-only">{t('switchWorkspace')}</span>
              <select
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-900"
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

          <p className="hidden text-xs text-slate-500 lg:block">
            {userName} · {timezone}
          </p>

          <button type="button" onClick={signOut} className="btn-secondary">
            {t('signOut')}
          </button>
        </div>
      </div>
    </header>
  );
}
