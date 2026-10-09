'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { MODULES, SHARED_LINKS, isPageActive, moduleFor, type AppModule } from '@/lib/modules';

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
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSwitching(false), [workspaceId]);

  async function signOut() {
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(`logout answered ${response.status}`);
    } catch {
      // Carrying on to /login would be worse than stopping: the session cookie
      // is still set, so the login page would bounce straight back in and the
      // person would believe they had signed out of a shared machine.
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
    // On success `switching` stays on until the new workspace's props arrive
    // (the effect above): re-enabling the select sooner would show the old
    // workspace's name in it, inviting a second switch mid-flight.

    // To the dashboard rather than staying put: the current URL may name
    // something that only exists in the old workspace — /compose?post=…, a
    // report's date range, a feed — and would answer the new one with a 404.
    // The refresh drops the router cache, whose pages were rendered against
    // the old workspace too.
    setMenuOpen(false);
    router.push('/dashboard');
    router.refresh();
  }

  const current = moduleFor(pathname);
  // Approvals only for people who can act on them, with the queue on the link.
  const pagesOf = (module: AppModule) =>
    module.pages.filter((page) => page.href !== '/approvals' || showApprovals);

  const moduleTabs = (
    <div className="flex h-14 items-stretch gap-1 lg:justify-center">
      {MODULES.map((module) => {
        const active = current?.key === module.key;
        return (
          <Link
            key={module.key}
            href={module.href}
            onClick={() => setMenuOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex items-center gap-2 whitespace-nowrap px-2 text-[15px] font-semibold transition-colors sm:px-4 ${
              active ? 'text-brand-600' : 'my-1 rounded-lg text-slate-600 hover:bg-slate-100'
            }`}
          >
            {/* Facebook's active tab: the colour, and a bar along the bottom. */}
            {active && (
              <span aria-hidden className="absolute inset-x-1 bottom-0 h-[3px] rounded-t-sm bg-brand-500" />
            )}
            {/* Words only on a phone: three names and the menu button have to
                fit in 390px, and the name is what says where you are. */}
            <Icon name={module.icon} size={20} className={`hidden sm:block ${active ? 'text-brand-500' : 'text-slate-600'}`} />
            {/* A shorter name where the width is short: French runs to
                "Planification", which does not fit beside two others. */}
            <span className="sm:hidden">{t(`moduleShort.${module.key}`)}</span>
            <span className="hidden sm:inline">{t(`module.${module.key}`)}</span>
            {module.key === 'schedule' && showApprovals && pendingApprovals > 0 && (
              <span
                className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white"
              >
                {pendingApprovals}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );

  const sharedLinks = (place: 'bar' | 'menu') => (
    <>
      {SHARED_LINKS.map((link) => {
        const active = [link.href, ...(link.also ?? [])].some(
          (href) => pathname === href || pathname.startsWith(`${href}/`),
        );
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMenuOpen(false)}
            aria-current={active ? 'page' : undefined}
            title={t(link.label)}
            className={
              place === 'bar'
                ? `flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-brand-50 text-brand-600' : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
                  }`
                : `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[15px] font-semibold transition-colors ${
                    active ? 'bg-brand-50 text-brand-600' : 'text-slate-900 hover:bg-slate-100'
                  }`
            }
          >
            <Icon name={link.icon} size={place === 'bar' ? 20 : 18} />
            {/* Round icons in the bar, as on Facebook, with the name kept for
                screen readers and the tooltip; named rows in the phone menu. */}
            <span className={place === 'bar' ? 'sr-only' : ''}>{t(link.label)}</span>
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="sticky top-0 z-20 bg-white shadow-bar">
      <div className="mx-auto flex max-w-7xl items-center gap-x-2 px-4 sm:gap-x-4 sm:px-6">
        {/* Home: the overview across all three modules. */}
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2" aria-label={t('home')}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-[15px] font-bold text-white">
            SP
          </span>
        </Link>

        {/* Three modules fit on any screen, so they are never behind a menu:
            the one thing a person should always see is where they are. */}
        <nav aria-label={t('modules')} className="scroll-x min-w-0 flex-1">
          {moduleTabs}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <nav aria-label={t('shared')} className="hidden items-center gap-0.5 lg:flex">
            {sharedLinks('bar')}
          </nav>

          {workspaces.length > 1 ? (
            <label className="hidden sm:block">
              <span className="sr-only">{t('switchWorkspace')}</span>
              <select
                className="h-10 max-w-[11rem] cursor-pointer rounded-full border-0 bg-slate-200 py-0 pl-3.5 pr-8 text-[15px] font-semibold text-slate-900 hover:bg-slate-300 focus:ring-2 focus:ring-brand-500"
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
            <p
              className="hidden max-w-[10rem] truncate text-[15px] font-semibold text-slate-900 sm:block"
              title={workspaceName}
            >
              {workspaceName}
            </p>
          )}

          <p className="hidden text-xs text-slate-500 2xl:block">
            {userName} · {timezone}
          </p>

          <button
            type="button"
            onClick={signOut}
            className="hidden h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 transition-colors hover:bg-slate-300 lg:flex"
            title={t('signOut')}
          >
            <Icon name="signOut" size={18} />
            {/* sr-only rather than hidden: `display:none` would take the label
                away from a screen reader too, leaving an unnamed button. */}
            <span className="sr-only">{t('signOut')}</span>
          </button>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 hover:bg-slate-300 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="sr-only">{t('menu')}</span>
            <Icon name={menuOpen ? 'close' : 'menu'} size={18} />
          </button>
        </div>
      </div>

      {/* The module's own screens, one row under the modules. */}
      {current && pagesOf(current).length > 1 && (
        <div className="border-t border-slate-200">
          <nav
            aria-label={t(`module.${current.key}`)}
            className="scroll-x mx-auto max-w-7xl px-4 sm:px-6"
          >
            <div className="flex h-12 items-stretch gap-1">
              {pagesOf(current).map((page) => {
                const active = isPageActive(pathname, page);
                return (
                  <Link
                    key={page.href}
                    href={page.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold transition-colors ${
                      active ? 'text-brand-600' : 'my-1.5 rounded-md text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {active && (
                      <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-sm bg-brand-500" />
                    )}
                    <Icon name={page.icon} size={16} className={active ? 'text-brand-500' : 'text-slate-500'} />
                    {t(page.label)}
                    {page.href === '/approvals' && pendingApprovals > 0 && (
                      <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white">
                        {pendingApprovals}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-6"
        >
          <p className="min-w-0">{error}</p>
          <button
            type="button"
            className="shrink-0 text-red-500 hover:text-red-700"
            onClick={() => setError(null)}
          >
            <span className="sr-only">{t('dismiss')}</span>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {menuOpen && (
        <div id="main-menu" className="border-t border-slate-200 px-4 py-3 lg:hidden">
          {workspaces.length > 1 && (
            <label className="mb-3 block sm:hidden">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('switchWorkspace')}</span>
              <select
                className="input"
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
          )}
          <nav aria-label={t('menu')} className="grid grid-cols-2 gap-1">
            <Link
              href="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Icon name="dashboard" size={16} className="text-slate-400" />
              {t('home')}
            </Link>
            {sharedLinks('menu')}
          </nav>
          <button type="button" onClick={signOut} className="btn-secondary mt-3 w-full">
            {t('signOut')}
          </button>
        </div>
      )}
    </header>
  );
}
