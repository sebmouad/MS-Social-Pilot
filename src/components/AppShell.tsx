'use client';

import { CommandPalette } from './CommandPalette';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';
import { SIDEBAR_DOCK_ID } from './SidebarDock';
import { isPageActive, moduleOfPath, MODULE_KEYS, type ModuleKey } from '@/lib/modules';
import { mayOpenScreen } from '@/lib/role-access';

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
  /** Root only: the way into the root section. */
  isRoot?: boolean;
  /** False for a viewer: no composer buttons. */
  canWrite?: boolean;
  /** Root is looking after this workspace without being a member of it. */
  rootVisit?: boolean;
  /** The modules this member may use; links to the others are not shown. */
  modules?: ModuleKey[];
  /** The member's role, and what this workspace opens to its clients: a viewer or client sees a shorter list. */
  role?: string;
  clientAccess?: string[];
  /** The product's name and logo, as root set them. */
  brand?: { name: string; logoUrl: string | null };
  children: ReactNode;
}

/** The product's logo, or its initials when root has not set one. */
function BrandMark({ brand, size }: { brand: { name: string; logoUrl: string | null }; size: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-10 w-10 rounded-xl text-[15px]' : 'h-8 w-8 rounded-lg text-xs';
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- any host root chooses; not optimised
    return <img src={brand.logoUrl} alt="" className={`${box} shrink-0 object-cover`} />;
  }
  const initials = brand.name.split(/\s+/).filter(Boolean).slice(-2).map((word) => word[0]!.toUpperCase()).join('') || 'SP';
  return <span className={`flex ${box} shrink-0 items-center justify-center bg-brand-500 font-bold text-white shadow-sm`}>{initials}</span>;
}

interface Item {
  href: string;
  label: string;
  icon: IconName;
  also?: string[];
  badge?: number;
  /** Matched for highlighting but not listed: reached from the top bar instead. */
  hidden?: boolean;
}

interface Area {
  key: string;
  label: string;
  /** The short name under the rail icon. */
  rail: string;
  icon: IconName;
  /** Screens of this area that have no link of their own, e.g. the composer. */
  also?: string[];
  items: Item[];
}

const COLLAPSE_KEY = 'msp-sidebar-collapsed';

/**
 * The app's frame, laid out like Simplified: a narrow icon rail on the far
 * left with the main areas, beside it a sidebar with the pages of the area in
 * use, and a slim top bar for utilities only (fold the sidebar, where you are,
 * workspace settings, your account) — never a row of modules. The sidebar
 * folds away on a laptop; on a phone rail and sidebar are one drawer behind
 * the menu button, with the composer one tap away in the top bar.
 */
export function AppShell({
  userName,
  workspaceId,
  workspaceName,
  timezone,
  workspaces,
  showApprovals,
  pendingApprovals,
  isRoot = false,
  canWrite = true,
  rootVisit = false,
  modules = MODULE_KEYS,
  role = 'owner',
  clientAccess = [],
  brand = { name: 'MS Social Pilot', logoUrl: null },
  children,
}: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSwitching(false), [workspaceId]);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Storage off: the sidebar opens wide.
    }
  }, []);
  // Arriving somewhere closes the drawer, rather than leaving it over the screen.
  useEffect(() => {
    setDrawer(false);
    setAccount(false);
  }, [pathname]);
  useEffect(() => {
    if (!account) return;
    const away = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccount(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setAccount(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [account]);
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

  async function leaveVisit() {
    setError(null);
    try {
      const response = await fetch('/api/root/visit', { method: 'DELETE' });
      if (!response.ok) throw new Error(`leave answered ${response.status}`);
    } catch {
      setError(t('leaveVisitFailed'));
      return;
    }
    router.push(`/root/workspaces/${workspaceId}`);
    router.refresh();
  }

  const usable = (href: string) => {
    const module = moduleOfPath(href);
    return (module === null || modules.includes(module)) && mayOpenScreen(role, clientAccess, href);
  };
  const canCompose = canWrite && modules.includes('schedule');

  // The main areas, each on the icon rail, each with its own pages in the
  // sidebar beside it — as Simplified lays it out.
  const allAreas: Area[] = [
    { key: 'home', label: t('home'), rail: t('rail_home'), icon: 'dashboard', items: [{ href: '/dashboard', label: t('home'), icon: 'dashboard' }] },
    {
      key: 'publish',
      label: t('section_publish'),
      rail: t('rail_publish'),
      icon: 'calendar',
      also: ['/compose'],
      items: [
        { href: '/calendar', label: t('calendar'), icon: 'calendar' },
        { href: '/calendar/dates', label: t('keyDates'), icon: 'star' },
        { href: '/queue', label: t('queue'), icon: 'clock' },
        { href: '/templates', label: t('templates'), icon: 'compose' },
        { href: '/design', label: t('design'), icon: 'image' },
        { href: '/posts', label: t('posts'), icon: 'posts' },
        ...(showApprovals ? [{ href: '/approvals', label: t('approvals'), icon: 'approvals' as IconName, badge: pendingApprovals }] : []),
        { href: '/feeds', label: t('feeds'), icon: 'feeds' },
      ],
    },
    { key: 'inbox', label: t('inbox'), rail: t('rail_inbox'), icon: 'inbox', items: [{ href: '/inbox', label: t('inbox'), icon: 'inbox' }, { href: '/inbox/comments', label: t('comments'), icon: 'comment' }, { href: '/inbox/reviews', label: t('reviews'), icon: 'star' }, { href: '/inbox/response-time', label: t('responseTime'), icon: 'clock' }, { href: '/inbox/replies', label: t('savedReplies'), icon: 'comment' }, { href: '/inbox/rules', label: t('moderation'), icon: 'shield' }] },
    {
      key: 'analyse',
      label: t('section_analyse'),
      rail: t('rail_analyse'),
      icon: 'analytics',
      items: [
        { href: '/analytics', label: t('pages'), icon: 'analytics', also: ['/reports'] },
        { href: '/analytics/tests', label: t('captionTests'), icon: 'trendUp' },
        { href: '/analytics/links', label: t('linkClicks'), icon: 'link' },
        { href: '/analytics/campaigns', label: t('campaigns'), icon: 'tag' },
      ],
    },
    { key: 'ads', label: t('module.ads'), rail: t('rail_ads'), icon: 'megaphone', items: [{ href: '/ads', label: t('module.ads'), icon: 'megaphone' }] },
    {
      key: 'workspace',
      label: t('section_workspace'),
      rail: t('rail_workspace'),
      icon: 'folders',
      items: [
        { href: '/connections', label: t('connections'), icon: 'connections', also: ['/accounts'] },
        { href: '/tasks', label: t('tasks'), icon: 'approvals' },
        { href: '/settings/sharing', label: t('clientLinks'), icon: 'link' },
        ...(role === 'owner' ? [{ href: '/agency', label: t('agency'), icon: 'folders' as IconName }] : []),
        { href: '/settings', label: t('settings'), icon: 'settings', also: ['/setup'], hidden: true },
      ],
    },
  ];

  // Root's switches: a module that is off has no links, and an empty area goes.
  const areas = allAreas
    .map((area) => ({ ...area, items: area.items.filter((item) => usable(item.href)) }))
    .filter((area) => area.items.length > 0);

  // The most specific link wins: /settings/sharing lights itself, not Settings.
  const allItems = areas.flatMap((area) => area.items);
  const activeItem =
    allItems
      .filter((item) => isPageActive(pathname, item))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  const activeHref = activeItem?.href ?? null;
  const activeArea =
    areas.find((area) => area.items.some((item) => item.href === activeHref)) ??
    areas.find((area) => area.also?.some((href) => pathname === href || pathname.startsWith(`${href}/`))) ??
    areas[0];

  const pageLinks = (items: Item[]) => (
    <ul className="space-y-0.5">
      {items.filter((item) => !item.hidden).map((item) => {
        const active = item.href === activeHref;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-10 items-center gap-3 rounded-lg px-2.5 text-[15px] font-semibold transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon name={item.icon} size={20} className={active ? 'text-brand-600' : 'text-slate-500'} />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <span className="ms-auto rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white">{item.badge}</span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const workspacePicker =
    workspaces.length > 1 ? (
      <label className="block">
        <span className="mb-1 block px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('switchWorkspace')}</span>
        <select
          className="h-10 w-full cursor-pointer truncate rounded-lg border-0 bg-slate-100 py-0 ps-3 pe-8 text-sm font-semibold text-slate-900 hover:bg-slate-200 focus:ring-2 focus:ring-brand-500"
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
    );

  const composeButton = canCompose && (
    <Link href="/compose" className="btn-primary w-full" aria-current={pathname.startsWith('/compose') ? 'page' : undefined}>
      <Icon name="plus" size={18} />
      {t('newPost')}
    </Link>
  );

  const rootLink = isRoot && (
    <Link href="/root" className="flex h-10 items-center gap-3 rounded-lg bg-amber-50 px-2.5 text-[15px] font-semibold text-amber-900 hover:bg-amber-100">
      <Icon name="shield" size={20} className="text-amber-700" />
      <span className="truncate">{t('root')}</span>
    </Link>
  );

  const initials =
    userName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || '?';

  return (
    <div className="min-h-screen lg:flex">
      <header className="sticky top-0 z-30 bg-white lg:flex lg:h-screen lg:shrink-0">
        {/* Laptop and up: the icon rail with the main areas… */}
        <div className="rail hidden w-[76px] flex-col items-center border-e py-3 lg:flex">
          <Link href="/dashboard" className="mb-3" aria-label={t('home')}>
            <BrandMark brand={brand} size="md" />
          </Link>
          <nav aria-label={t('areas')} className="min-h-0 w-full flex-1 overflow-y-auto px-1.5">
            <ul className="space-y-1">
              {areas.map((area) => {
                const active = area.key === activeArea?.key;
                const first = area.items[0]!;
                const badge = area.items.reduce((sum, item) => sum + (item.badge ?? 0), 0);
                return (
                  <li key={area.key}>
                    <Link
                      href={first.href}
                      aria-current={active ? 'true' : undefined}
                      className="rail-item relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-semibold leading-tight transition-colors"
                    >
                      <Icon name={area.icon} size={22} />
                      <span className="w-full text-center tracking-tight [overflow-wrap:anywhere]">{area.rail}</span>
                      {badge > 0 && (
                        <span className="absolute end-1.5 top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-4 text-white">{badge}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {/* …and beside it the sidebar with the pages of the area in use. */}
        {!collapsed && activeArea && (
          <div className="shell-sidebar hidden w-60 flex-col border-e border-slate-200 lg:flex">
            <div className="px-3 pt-4">
              <CommandPalette items={allItems.map((item) => ({ href: item.href, label: item.label }))} />
            </div>
            <p className="px-5 pb-1 pt-3 text-[17px] font-bold text-slate-900">{activeArea.label}</p>
            <div className="px-3 py-2">{workspacePicker}</div>
            {composeButton && <div className="px-3 pb-2 pt-1">{composeButton}</div>}
            <nav aria-label={t('modules')} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {pageLinks(activeArea.items)}
              <div id={SIDEBAR_DOCK_ID} className="mt-4 space-y-3 empty:hidden" />
            </nav>
          </div>
        )}

        {/* Phone and tablet: a slim bar, and rail and sidebar as one drawer. */}
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
            <BrandMark brand={brand} size="sm" />
            <span className="truncate text-[15px] font-bold text-slate-900">{workspaceName}</span>
          </Link>
          {usable('/settings') && (
            <Link
              href="/settings"
              title={t('workspaceSettings')}
              className="ms-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
            >
              <Icon name="settings" size={20} />
              <span className="sr-only">{t('workspaceSettings')}</span>
            </Link>
          )}
          {canCompose && (
            <Link href="/compose" className={`btn-primary h-9 px-3 ${usable('/settings') ? '' : 'ms-auto'}`} aria-label={t('newPost')}>
              <Icon name="plus" size={18} />
              <span className="hidden sm:inline">{t('newPost')}</span>
            </Link>
          )}
        </div>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label={t('closeMenu')} onClick={() => setDrawer(false)} />
            <div
              id="main-menu"
              role="dialog"
              aria-modal="true"
              aria-label={t('menu')}
              className="absolute inset-y-0 start-0 flex w-[17rem] max-w-[85vw] flex-col bg-white shadow-xl"
            >
              <div className="flex items-center gap-2.5 px-3 pb-2 pt-4">
                <BrandMark brand={brand} size="md" />
                <span className="text-[15px] font-bold text-slate-900">{brand.name}</span>
                <button
                  type="button"
                  className="ms-auto flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                  onClick={() => setDrawer(false)}
                >
                  <Icon name="close" size={18} />
                  <span className="sr-only">{t('closeMenu')}</span>
                </button>
              </div>
              <div className="px-3 py-2">{workspacePicker}</div>
              {composeButton && <div className="px-3 pb-2 pt-1">{composeButton}</div>}
              <nav aria-label={t('modules')} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
                {areas.map((area) => (
                  <div key={area.key}>
                    {area.items.length > 1 && (
                      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{area.label}</p>
                    )}
                    {pageLinks(area.items)}
                  </div>
                ))}
              </nav>
              <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                {rootLink}
                <p className="truncate px-2 text-xs text-slate-500" title={`${userName} · ${timezone}`}>
                  <span className="font-semibold text-slate-700">{userName}</span> · {timezone}
                </p>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Icon name="signOut" size={18} />
                  {t('signOut')}
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="min-w-0 flex-1">
        {/* Laptop and up: a slim bar of utilities. Never a row of modules. */}
        <div className="sticky top-0 z-20 hidden h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:flex">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-pressed={collapsed}
            title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          >
            <Icon name="menu" size={18} />
            <span className="sr-only">{collapsed ? t('expandSidebar') : t('collapseSidebar')}</span>
          </button>
          <nav aria-label={t('breadcrumb')} className="min-w-0">
            <ol className="flex min-w-0 items-center gap-1.5 text-sm">
              <li className="truncate text-slate-500">{collapsed ? workspaceName : activeArea?.label}</li>
              {activeItem && activeItem.label !== activeArea?.label && (
                <>
                  <li aria-hidden className="text-slate-400">
                    <Icon name="chevronRight" size={14} />
                  </li>
                  <li className="truncate font-semibold text-slate-900" aria-current="page">
                    {activeItem.label}
                  </li>
                </>
              )}
            </ol>
          </nav>
          <div className="ms-auto flex items-center gap-1">
            {collapsed && canCompose && (
              <Link href="/compose" className="btn-primary h-9 px-3">
                <Icon name="plus" size={18} />
                {t('newPost')}
              </Link>
            )}
            {usable('/settings') && (
              <Link
                href="/settings"
                title={t('workspaceSettings')}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Icon name="settings" size={18} />
                <span className="sr-only">{t('workspaceSettings')}</span>
              </Link>
            )}
            <div className="relative" ref={accountRef}>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800 hover:ring-2 hover:ring-brand-200"
                aria-expanded={account}
                aria-haspopup="true"
                onClick={() => setAccount(!account)}
              >
                {initials}
                <span className="sr-only">{t('accountMenu')}</span>
              </button>
              {account && (
                <div className="absolute end-0 top-11 z-40 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <p className="truncate px-2.5 pb-2 pt-1 text-sm" title={`${userName} · ${timezone}`}>
                    <span className="block truncate font-semibold text-slate-900">{userName}</span>
                    <span className="block truncate text-xs text-slate-500">{timezone}</span>
                  </p>
                  <Link href="/settings/account" className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                    <Icon name="team" size={18} />
                    {t('yourAccount')}
                  </Link>
                  {isRoot && (
                    <Link href="/root" className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50">
                      <Icon name="shield" size={18} className="text-amber-700" />
                      {t('root')}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Icon name="signOut" size={18} />
                    {t('signOut')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {rootVisit && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
            <p className="flex min-w-0 items-center gap-2">
              <Icon name="shield" size={16} className="shrink-0 text-amber-700" />
              {t('rootVisit', { name: workspaceName })}
            </p>
            <button type="button" className="btn-secondary h-9" onClick={() => void leaveVisit()}>
              {t('leaveVisit')}
            </button>
          </div>
        )}
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
