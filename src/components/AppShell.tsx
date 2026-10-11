'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';
import { isPageActive } from '@/lib/modules';

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
  children: ReactNode;
}

interface Item {
  href: string;
  label: string;
  icon: IconName;
  also?: string[];
  badge?: number;
}

const COLLAPSE_KEY = 'msp-sidebar-collapsed';

/**
 * The app's frame: a sidebar on the left with every screen in it, grouped by
 * the job — publishing, analytics, the workspace — as the scheduling tools lay
 * it out. On a laptop it folds down to its icons; on a phone it is a drawer
 * behind the menu button, with the composer one tap away in the top bar.
 */
export function AppShell({
  userName,
  workspaceId,
  workspaceName,
  timezone,
  workspaces,
  showApprovals,
  pendingApprovals,
  children,
}: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSwitching(false), [workspaceId]);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Storage off: the sidebar opens wide.
    }
  }, []);
  // Arriving somewhere closes the drawer, rather than leaving it over the screen.
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [drawer]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // As above.
    }
  }

  async function signOut() {
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(`logout answered ${response.status}`);
    } catch {
      // Carrying on to /login with the cookie still set would bounce straight
      // back in, and the person would believe they had signed out.
      setError(t('signOutFailed'));
      return;
    }
    router.refresh();
    router.push('/login');
  }

  async function switchTo(id: string) {
    if (id === workspaceId) return;
    setSwitching(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('switchFailed'));
        setSwitching(false);
        return;
      }
    } catch {
      setError(t('switchFailed'));
      setSwitching(false);
      return;
    }
    // To the dashboard: the current URL may name something only the old
    // workspace has, and would answer the new one with a 404.
    router.push('/dashboard');
    router.refresh();
  }

  const sections: Array<{ key: string; label: string | null; items: Item[] }> = [
    { key: 'home', label: null, items: [{ href: '/dashboard', label: t('home'), icon: 'dashboard' }] },
    {
      key: 'publish',
      label: t('section_publish'),
      items: [
        { href: '/calendar', label: t('calendar'), icon: 'calendar' },
        { href: '/queue', label: t('queue'), icon: 'clock' },
        { href: '/posts', label: t('posts'), icon: 'posts' },
        ...(showApprovals ? [{ href: '/approvals', label: t('approvals'), icon: 'approvals' as IconName, badge: pendingApprovals }] : []),
        { href: '/feeds', label: t('feeds'), icon: 'feeds' },
      ],
    },
    {
      key: 'analyse',
      label: t('section_analyse'),
      items: [
        { href: '/analytics', label: t('pages'), icon: 'analytics' },
        { href: '/reports', label: t('reports'), icon: 'reports' },
        { href: '/ads', label: t('module.ads'), icon: 'megaphone' },
      ],
    },
    {
      key: 'workspace',
      label: t('section_workspace'),
      items: [
        { href: '/connections', label: t('connections'), icon: 'connections', also: ['/accounts'] },
        { href: '/settings/sharing', label: t('clientLinks'), icon: 'link' },
        { href: '/settings', label: t('settings'), icon: 'settings', also: ['/setup'] },
      ],
    },
  ];

  // The most specific link wins: /settings/sharing lights itself, not Settings.
  const allItems = sections.flatMap((section) => section.items);
  const activeHref =
    allItems
      .filter((item) => isPageActive(pathname, item))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  const wide = !collapsed || drawer;

  const panel = (inDrawer: boolean) => {
    const open = inDrawer || !collapsed;
    return (
      <div className="flex h-full flex-col">
        <div className={`flex items-center gap-2.5 px-3 pb-2 pt-4 ${open ? '' : 'justify-center'}`}>
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label={t('home')}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-[15px] font-bold text-white shadow-sm">
              SP
            </span>
            {open && <span className="text-[15px] font-bold text-slate-900">Social Pilot</span>}
          </Link>
          {inDrawer && (
            <button
              type="button"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
              onClick={() => setDrawer(false)}
            >
              <Icon name="close" size={18} />
              <span className="sr-only">{t('closeMenu')}</span>
            </button>
          )}
        </div>

        {/* The client being worked on: what every screen below is about. */}
        <div className="px-3 py-2">
          {open ? (
            workspaces.length > 1 ? (
              <label className="block">
                <span className="mb-1 block px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('switchWorkspace')}</span>
                <select
                  className="h-10 w-full cursor-pointer truncate rounded-lg border-0 bg-slate-100 py-0 pl-3 pr-8 text-sm font-semibold text-slate-900 hover:bg-slate-200 focus:ring-2 focus:ring-brand-500"
                  value={workspaceId}
                  disabled={switching}
                  onChange={(event) => void switchTo(event.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="truncate rounded-lg bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-900" title={workspaceName}>
                {workspaceName}
              </p>
            )
          ) : (
            <span
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700"
              title={workspaceName}
            >
              {workspaceName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="px-3 pb-2 pt-1">
          <Link
            href="/compose"
            className={`btn-primary w-full ${open ? '' : 'px-0'}`}
            title={open ? undefined : t('compose')}
            aria-current={pathname.startsWith('/compose') ? 'page' : undefined}
          >
            <Icon name="plus" size={18} />
            {open ? t('newPost') : <span className="sr-only">{t('newPost')}</span>}
          </Link>
        </div>

        <nav aria-label={t('modules')} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {sections.map((section) => (
            <div key={section.key}>
              {section.label &&
                (open ? (
                  <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{section.label}</p>
                ) : (
                  <div className="mx-auto mb-2 h-px w-8 bg-slate-200" aria-hidden />
                ))}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={open ? undefined : item.label}
                        className={`relative flex h-10 items-center gap-3 rounded-lg text-[15px] font-semibold transition-colors ${
                          open ? 'px-2.5' : 'justify-center'
                        } ${active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        <Icon name={item.icon} size={20} className={active ? 'text-brand-600' : 'text-slate-500'} />
                        <span className={open ? 'truncate' : 'sr-only'}>{item.label}</span>
                        {item.badge ? (
                          <span
                            className={`rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white ${
                              open ? 'ml-auto' : 'absolute right-1 top-1'
                            }`}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-3 py-3">
          {open && (
            <p className="mb-2 truncate px-2 text-xs text-slate-500" title={`${userName} · ${timezone}`}>
              <span className="font-semibold text-slate-700">{userName}</span> · {timezone}
            </p>
          )}
          <div className={`flex gap-1 ${open ? '' : 'flex-col items-center'}`}>
            <button
              type="button"
              onClick={() => void signOut()}
              className={`flex h-9 items-center gap-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 ${open ? 'flex-1 px-2.5' : 'w-9 justify-center'}`}
              title={t('signOut')}
            >
              <Icon name="signOut" size={18} />
              <span className={open ? '' : 'sr-only'}>{t('signOut')}</span>
            </button>
            {!inDrawer && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex"
                aria-pressed={collapsed}
                title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
              >
                <Icon name="chevronLeft" size={18} className={collapsed ? 'rotate-180' : ''} />
                <span className="sr-only">{collapsed ? t('expandSidebar') : t('collapseSidebar')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen lg:flex">
      <header
        className={`sticky top-0 z-30 bg-white lg:h-screen lg:shrink-0 lg:border-r lg:border-slate-200 lg:transition-[width] lg:duration-200 ${
          wide ? 'lg:w-64' : 'lg:w-[76px]'
        }`}
      >
        {/* Laptop and up: the sidebar itself, sticky beside the screen. */}
        <div className="hidden h-full lg:block">{panel(false)}</div>

        {/* Phone and tablet: a slim bar, and the sidebar as a drawer. */}
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-3 lg:hidden">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 hover:bg-slate-100"
            aria-expanded={drawer}
            aria-controls="main-menu"
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" size={20} />
            <span className="sr-only">{t('menu')}</span>
          </button>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2" aria-label={t('home')}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">SP</span>
            <span className="truncate text-[15px] font-bold text-slate-900">{workspaceName}</span>
          </Link>
          <Link href="/compose" className="btn-primary ml-auto h-9 px-3" aria-label={t('newPost')}>
            <Icon name="plus" size={18} />
            <span className="hidden sm:inline">{t('newPost')}</span>
          </Link>
        </div>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label={t('closeMenu')} onClick={() => setDrawer(false)} />
            <div id="main-menu" role="dialog" aria-modal="true" aria-label={t('menu')} className="absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] bg-white shadow-xl">
              {panel(true)}
            </div>
          </div>
        )}
      </header>

      <div className="min-w-0 flex-1">
        {error && (
          <div role="alert" className="flex items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-6">
            <p className="min-w-0">{error}</p>
            <button type="button" className="shrink-0 text-red-500 hover:text-red-700" onClick={() => setError(null)}>
              <span className="sr-only">{t('dismiss')}</span>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
