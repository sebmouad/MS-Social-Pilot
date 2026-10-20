"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MODULES, PAGES, type ModuleId } from "@/lib/product";
import { SidebarDockContext } from "./SidebarDock";
import { ModuleGlyph, PageGlyph } from "./icons";
import { ModeToggle } from "./ModeToggle";
import { IconPlus } from "@tabler/icons-react";

function Mark() {
  return <svg className="shell-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23.5 12.2 8l4 9 3.2-5.3L27 23.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="23.5" cy="8.5" r="2.5" fill="currentColor"/></svg>;
}

export function AppShell({ children, activeModule, enabledModules, enabledFeatures, writableFeatures = [], rootAccess, userName, workspaceName, workspaceId, workspaces = [], sidebar, sidebarWhen, installationMode = false }: { children: ReactNode; activeModule: ModuleId; enabledModules: readonly ModuleId[]; enabledFeatures: readonly string[]; writableFeatures?: readonly string[]; rootAccess: boolean; userName: string; workspaceName: string; workspaceId?: string; workspaces?: readonly { id: string; name: string }[]; sidebar?: ReactNode; sidebarWhen?: readonly string[]; installationMode?: boolean }) {
  const pathname = usePathname();
  const visibleSidebar = sidebar && (!sidebarWhen || sidebarWhen.includes(pathname));
  const [filterOpen, setFilterOpen] = useState(false);
  const [sidebarHost, setSidebarHost] = useState<HTMLElement | null>(null);
  const [switching, setSwitching] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const filterRef = useRef<HTMLElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const closeFilters = useCallback(() => {
    setFilterOpen(false);
    requestAnimationFrame(() => filterToggleRef.current?.focus());
  }, []);
  useEffect(() => setFilterOpen(false), [pathname]);
  useEffect(() => {
    if (!filterOpen) return;
    const panel = filterRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter(item => item.getClientRects().length > 0);
    (focusable()[0] ?? panel)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Native dialogs are top-layer modal UI and own Escape plus focus navigation.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented || event.isComposing) return;
        // An open native select owns the first Escape. Its browser popup must
        // close without also dismissing the surrounding navigation drawer.
        if (event.target instanceof HTMLSelectElement) {
          try { if (event.target.matches(':open')) return; } catch { /* Older engines do not expose native popup state. */ }
        }
        event.preventDefault(); closeFilters();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!panel?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    const desktop = window.matchMedia?.('(min-width: 1024px)');
    const onResize = () => {
      if (!desktop?.matches) return;
      setFilterOpen(false);
      requestAnimationFrame(() => {
        const visibleTarget = panel?.querySelector<HTMLElement>('a[aria-current="page"]') ?? document.getElementById('main-content');
        visibleTarget?.focus();
      });
    };
    desktop?.addEventListener('change', onResize);
    return () => { window.removeEventListener('keydown', onKeyDown); desktop?.removeEventListener('change', onResize); document.body.style.overflow = oldOverflow; };
  }, [filterOpen, closeFilters]);
  const active = MODULES.find(module => module.id === activeModule);
  const modulePages = PAGES.filter(page => page.module === activeModule && page.navigation !== false && enabledFeatures.includes(page.id));
  const navigationModules = MODULES.filter(module => enabledModules.includes(module.id) && PAGES.some(page => page.module === module.id && page.navigation !== false && enabledFeatures.includes(page.id)));
  const primaryMobileModules = navigationModules.length > 5 ? navigationModules.slice(0, 4) : navigationModules;
  const moreMobileModules = navigationModules.length > 5 ? navigationModules.slice(4) : [];
  const moduleHref = (module: (typeof MODULES)[number]) => PAGES.find(page => page.module === module.id && page.navigation !== false && enabledFeatures.includes(page.id))?.href ?? module.href;
  const primaryAction = installationMode ? undefined : MODULES.map(module => module.primaryAction).find(action => action && enabledFeatures.includes(action.featureId) && writableFeatures.includes(action.featureId));
  const moduleLink = (module: (typeof MODULES)[number]) => <a key={module.id} href={moduleHref(module)} data-module={module.id} className={`shell-nav__link${activeModule === module.id ? ' is-active' : ''}`} aria-current={activeModule === module.id ? 'page' : undefined}><span className="shell-nav__glyph"><ModuleGlyph id={module.id}/></span><span>{module.mobileTitle ?? module.title}</span></a>;
  async function switchWorkspace(nextId: string) {
    if (switching || nextId === workspaceId) return;
    setSwitching(true); setWorkspaceError('');
    try {
      const response = await fetch('/api/workspaces/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: nextId }) });
      if (!response.ok) throw new Error('Selection refused');
      window.location.assign(MODULES.find(module => module.id === 'home')?.href ?? '/');
    } catch { setWorkspaceError('The workspace could not be switched. Try again.'); setSwitching(false); }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setAccountError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out refused');
      window.location.assign('/sign-in');
    } catch { setAccountError('Could not sign out. Try again.'); setSigningOut(false); }
  }
  return <SidebarDockContext.Provider value={sidebarHost}><div className="shell" data-module={installationMode ? 'root' : activeModule} onSubmitCapture={event => {
    // A drawer button may submit an associated editor form outside the drawer.
    // Reveal its progress and validation feedback instead of leaving it inert.
    if (filterOpen && event.target instanceof HTMLFormElement && event.target.closest('.shell-main')) {
      setFilterOpen(false);
      requestAnimationFrame(() => document.getElementById('main-content')?.focus());
    }
  }}>
    <a className="shell-skip-link" href="#main-content">Skip to content</a>
    <aside className="shell-sidebar shell-module-rail" aria-label="Modules" inert={filterOpen || undefined}>
      <a className="shell-brand" href={installationMode ? '/root' : '/home'} aria-label={installationMode ? 'Social Pilot, Root controls' : 'Social Pilot, home'}><Mark/></a>
      <nav className="shell-nav shell-nav--desktop" aria-label="Main sections">
        {installationMode ? <><a href="/home" data-module="home" className="shell-nav__link"><span className="shell-nav__glyph"><ModuleGlyph id="home"/></span><span>App</span></a><a href="/root" data-module="root" className="shell-nav__link is-active" aria-current="page"><span className="shell-nav__glyph"><ModuleGlyph id="root"/></span><span>Root</span></a></> : navigationModules.map(moduleLink)}
      </nav>
      <nav className="shell-nav shell-nav--mobile" aria-label="Mobile sections">
        {installationMode ? <><a href="/home" data-module="home" className="shell-nav__link"><span className="shell-nav__glyph"><ModuleGlyph id="home"/></span><span>App</span></a><a href="/root" data-module="root" className="shell-nav__link is-active" aria-current="page"><span className="shell-nav__glyph"><ModuleGlyph id="root"/></span><span>Root</span></a></> : primaryMobileModules.map(moduleLink)}
        {moreMobileModules.length > 0 && <details className="shell-nav-more"><summary className={`shell-nav__link${moreMobileModules.some(module => module.id === activeModule) ? ' is-active' : ''}`}><span aria-hidden="true">•••</span><span>More</span></summary><div className="shell-nav-more__menu">{moreMobileModules.map(module => <a key={module.id} href={moduleHref(module)} data-module={module.id} aria-current={activeModule === module.id ? 'page' : undefined}><ModuleGlyph id={module.id}/>{module.title}</a>)}</div></details>}
      </nav>
      {rootAccess && !installationMode && <a className="shell-rail-utility" data-module="root" href="/root"><ModuleGlyph id="root"/><span>Root</span></a>}
      <span className="shell-rail-avatar" aria-label={userName}>{userName.trim().slice(0, 1).toUpperCase() || '?'}</span>
    </aside>
    {filterOpen && <button className="shell-filter-scrim" type="button" aria-label="Close navigation and filters" onClick={closeFilters}/>}
    <aside ref={filterRef} id="shell-filters" className={`shell-context-sidebar${filterOpen ? ' is-open' : ''}`} role={filterOpen ? 'dialog' : undefined} aria-modal={filterOpen ? true : undefined} aria-label={`${installationMode ? 'Root' : active?.title} navigation`} tabIndex={filterOpen ? -1 : undefined}>
      <div className="shell-context-heading"><span className="shell-wordmark">Social Pilot</span><button type="button" className="shell-context-close" onClick={closeFilters} aria-label="Close navigation and filters">×</button></div>
      <div className="shell-workspace">
        <p className="shell-workspace-label" id="shell-workspace-label">{installationMode ? 'Private installation' : 'Workspace'}</p>
        {!installationMode && workspaces.length > 1 ? <select id="shell-workspace" aria-labelledby="shell-workspace-label" className="shell-workspace-select" value={workspaceId} disabled={switching} aria-busy={switching} onChange={event => void switchWorkspace(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select> : <p className="shell-workspace-name">{workspaceName}</p>}
        {switching && <p className="shell-workspace-status" role="status">Switching workspace…</p>}
        {workspaceError && <p className="ui-error" role="alert">{workspaceError}</p>}
      </div>
      {primaryAction && <a className="shell-create ui-button ui-button--primary" href={primaryAction.href}><IconPlus size={17} stroke={2} aria-hidden="true"/>{primaryAction.label}</a>}
      <div className="shell-context-content" onSubmitCapture={() => setFilterOpen(false)} onClickCapture={event => { if ((event.target as Element).closest('a[href]')) setFilterOpen(false); }}>
        {!installationMode && <nav className="shell-subnav" aria-label={`${active?.title} pages`}><p className="shell-subnav__label">{active?.title}</p>{modulePages.map(page => <a key={page.id} href={page.href} data-module={activeModule} className={`shell-subnav__link${pathname === page.href ? ' is-active' : ''}`} aria-current={pathname === page.href ? 'page' : undefined}><span className="shell-subnav__glyph"><PageGlyph href={page.href}/></span>{page.title}</a>)}</nav>}
        {visibleSidebar && <div className="shell-sidebar-filter">{sidebar}</div>}
        <div ref={setSidebarHost} className="shell-sidebar-tools"/>
      </div>
      <footer className="shell-context-footer"><span className="shell-context-user">{userName}</span>{enabledFeatures.includes('settings/account') && <a href="/settings/account">Account</a>}{rootAccess && !installationMode && <a href="/root">Root</a>}<button className="shell-signout" type="button" disabled={signingOut} aria-busy={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>{accountError && <p className="ui-error" role="alert">{accountError}</p>}</footer>
    </aside>
    <div className="shell-main" inert={filterOpen || undefined}><header className="shell-topbar"><div className="shell-topbar__crumb"><button ref={filterToggleRef} className="shell-filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="shell-filters" onClick={() => filterOpen ? closeFilters() : setFilterOpen(true)}>Menu &amp; filters</button><span>{installationMode ? 'Installation' : workspaceName}</span><span aria-hidden="true">/</span><strong>{installationMode ? 'Root' : active?.title}</strong></div><div className="shell-topbar__tools">{installationMode && <span className="shell-root-badge"><ModuleGlyph id="root" size={15}/>Root · private installation controls</span>}<ModeToggle/><span className="shell-topbar__user">{PAGES.find(page => page.href === pathname)?.title ?? (installationMode ? 'Private control center' : 'Workspace')}</span></div></header><main id="main-content" className="shell-content" tabIndex={-1}>{children}</main></div>
  </div></SidebarDockContext.Provider>;
}
