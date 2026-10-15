"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MODULES, PAGES, type ModuleId } from "@/lib/product";

function ModuleIcon({ name }: { name: string }) {
  const shared = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, ReactNode> = {
    Home: <><path d="m3.5 11 8.5-7 8.5 7v8.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" {...shared}/><path d="M9 20.5v-6h6v6" {...shared}/></>,
    Publishing: <><rect x="4" y="3.5" width="16" height="17" rx="3" {...shared}/><path d="M8 8h8m-8 4h8m-8 4h5" {...shared}/></>,
    Inbox: <><path d="M4 5.5h16l1 10.5h-5l-1.5 2h-5L8 16H3z" {...shared}/><path d="M8 11h8" {...shared}/></>,
    Analytics: <><path d="M4 19V5m0 14h16" {...shared}/><path d="m7 15 4-4 3 2 5-6" {...shared}/><circle cx="19" cy="7" r="1" fill="currentColor"/></>,
    Ads: <><path d="M4 19V5m0 14h16" {...shared}/><path d="m7 16 4-5 3 2 5-7" {...shared}/><path d="M15.5 6H19v3.5" {...shared}/></>,
    Settings: <><circle cx="12" cy="12" r="3" {...shared}/><path d="m19 13.5 1.2 1-.9 1.6-1.5-.3a7.5 7.5 0 0 1-1.4 1l-.3 1.6h-1.9l-.5-1.5a7 7 0 0 1-1.7 0l-.8 1.2-1.7-.7.2-1.6a7 7 0 0 1-1.2-1.3l-1.6.1-.6-1.8 1.2-.9a7 7 0 0 1 0-1.7l-1.1-.8.7-1.8 1.5.2a7 7 0 0 1 1.3-1.2L10 5.1l1.8-.6.9 1.2a7 7 0 0 1 1.7 0l.8-1.1 1.8.7-.2 1.5A7 7 0 0 1 18 8l1.6-.1.6 1.8-1.2.9a7 7 0 0 1 0 1.7Z" {...shared}/></>,
  };
  return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">{paths[name]}</svg>;
}

function Mark() {
  return <svg className="shell-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23.5 12.2 8l4 9 3.2-5.3L27 23.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="23.5" cy="8.5" r="2.5" fill="currentColor"/></svg>;
}

export function AppShell({ children, activeModule, enabledModules, enabledFeatures, rootAccess, userName, workspaceName, sidebar, sidebarWhen, installationMode = false }: { children: ReactNode; activeModule: ModuleId; enabledModules: readonly ModuleId[]; enabledFeatures: readonly string[]; rootAccess: boolean; userName: string; workspaceName: string; sidebar?: ReactNode; sidebarWhen?: readonly string[]; installationMode?: boolean }) {
  const pathname = usePathname();
  const visibleSidebar = sidebar && (!sidebarWhen || sidebarWhen.includes(pathname));
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const closeFilters = useCallback(() => {
    setFilterOpen(false);
    requestAnimationFrame(() => filterToggleRef.current?.focus());
  }, []);
  useEffect(() => setFilterOpen(false), [pathname]);
  useEffect(() => {
    if (!filterOpen) return;
    const panel = filterRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter(item => item.getClientRects().length > 0);
    (focusable()[0] ?? panel)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeFilters(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!panel?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filterOpen, closeFilters]);
  const modulePages = PAGES.filter(page => page.module === activeModule && page.navigation !== false && enabledFeatures.includes(page.id));
  const enabledModuleSet = new Set(enabledModules);
  const enabledModulePages = new Set(enabledFeatures.map(id => PAGES.find(page => page.id === id && page.navigation !== false)?.module).filter(Boolean));
  const navigationModules = MODULES.filter(module => enabledModuleSet.has(module.id) && enabledModulePages.has(module.id));
  const primaryMobileModules = navigationModules.length > 5 ? navigationModules.slice(0, 4) : navigationModules;
  const moreMobileModules = navigationModules.length > 5 ? navigationModules.slice(4) : [];
  const moduleHref = (module: (typeof MODULES)[number]) => PAGES.find(page => page.module === module.id && page.navigation !== false && enabledFeatures.includes(page.id))?.href ?? module.href;
  return <div className="shell">
    <a className="shell-skip-link" href="#main-content">Skip to content</a>
    <aside className="shell-sidebar" aria-label="Main navigation">
      <a className="shell-brand" href={installationMode ? '/root/config' : '/home'} aria-label={installationMode ? 'Social Pilot, Root controls' : 'Social Pilot, home'}><Mark/><span>Social Pilot</span></a>
      <p className="shell-workspace-label">Workspace</p>
      <p className="shell-workspace-name" title={workspaceName}>{workspaceName}</p>
      <nav className="shell-nav shell-nav--desktop">{installationMode && <a href="/root/config" className="shell-nav__link is-active" aria-current="page"><span className="shell-nav__glyph"><ModuleIcon name="Settings"/></span><span>Root controls</span></a>}{navigationModules.map((module) => <a key={module.id} href={moduleHref(module)} className={`shell-nav__link${activeModule === module.id ? " is-active" : ""}`} aria-current={activeModule === module.id ? "page" : undefined}>
        <span className="shell-nav__glyph"><ModuleIcon name={module.title}/></span><span>{module.title}</span>
      </a>)}</nav>
      <nav className="shell-nav shell-nav--mobile" aria-label="Main sections">{installationMode && <a href="/root/config" className="shell-nav__link is-active" aria-current="page"><span className="shell-nav__glyph"><ModuleIcon name="Settings"/></span><span>Root controls</span></a>}{primaryMobileModules.map((module) => <a key={module.id} href={moduleHref(module)} className={`shell-nav__link${activeModule === module.id ? " is-active" : ""}`} aria-current={activeModule === module.id ? "page" : undefined}>
        <span className="shell-nav__glyph"><ModuleIcon name={module.title}/></span><span>{module.mobileTitle ?? module.title}</span>
      </a>)}{moreMobileModules.length > 0 && <details className="shell-nav-more"><summary className={`shell-nav__link${moreMobileModules.some(module => module.id === activeModule) ? " is-active" : ""}`}><span className="shell-nav__glyph" aria-hidden="true">•••</span><span>More</span></summary><div className="shell-nav-more__menu">{moreMobileModules.map(module => <a key={module.id} href={moduleHref(module)} aria-current={activeModule === module.id ? "page" : undefined}><ModuleIcon name={module.title}/>{module.title}</a>)}</div></details>}</nav>
      {modulePages.length > 1 && <nav className="shell-subnav" aria-label={`${MODULES.find(module => module.id === activeModule)?.title} pages`}>
        <p className="shell-subnav__label">{MODULES.find(module => module.id === activeModule)?.title}</p>
        {modulePages.map(page => <a key={page.id} href={page.href} className={`shell-subnav__link${pathname === page.href ? " is-active" : ""}`} aria-current={pathname === page.href ? "page" : undefined}>{page.title}</a>)}
        {rootAccess && activeModule === 'settings' && <a className="shell-subnav__link shell-root-mobile" href="/root/config">Root controls</a>}
      </nav>}
      {visibleSidebar && filterOpen && <button className="shell-filter-scrim" type="button" aria-label="Close filters" onClick={closeFilters} />}
      {visibleSidebar && <div ref={filterRef} id="shell-filters" className={`shell-sidebar-filter${filterOpen ? " is-open" : ""}`} role={filterOpen ? 'dialog' : undefined} aria-modal={filterOpen ? 'true' : undefined} aria-label={filterOpen ? 'Filters' : undefined} tabIndex={filterOpen ? -1 : undefined} onSubmitCapture={() => setFilterOpen(false)} onClickCapture={event => { if ((event.target as Element).closest('a[href]')) setFilterOpen(false); }}>{sidebar}</div>}
      {rootAccess && !installationMode && <a className="shell-subnav__link shell-root-link" href="/root/config">Root controls</a>}
    </aside>
    <div className="shell-main"><header className="shell-topbar"><div className="shell-topbar__crumb"><span>{workspaceName}</span><span aria-hidden="true">/</span><strong>{installationMode ? 'Root' : MODULES.find(module => module.id === activeModule)?.title}</strong></div><div className="shell-topbar__actions">{visibleSidebar && <button ref={filterToggleRef} className="shell-filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="shell-filters" onClick={() => filterOpen ? closeFilters() : setFilterOpen(true)}>{filterOpen ? "Close filters" : "Filters"}</button>}<span className="shell-topbar__user">{userName}</span><button className="shell-signout" type="button" onClick={async () => { const response = await fetch('/api/auth/sign-out', { method: 'POST' }); if (response.ok) window.location.assign('/sign-in'); }}>Sign out</button></div></header><main id="main-content" className="shell-content" tabIndex={-1}>{children}</main></div>
  </div>;
}
