"use client";
import { useEffect, useState, type ReactNode } from "react";
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

export function AppShell({ children, activeModule, enabledModules, enabledFeatures, rootAccess, userName, workspaceName, sidebar }: { children: ReactNode; activeModule: ModuleId; enabledModules: readonly ModuleId[]; enabledFeatures: readonly string[]; rootAccess: boolean; userName: string; workspaceName: string; sidebar?: ReactNode }) {
  const pathname = usePathname();
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => setFilterOpen(false), [pathname]);
  const modulePages = PAGES.filter(page => page.module === activeModule && enabledFeatures.includes(page.id));
  const enabledModuleSet = new Set(enabledModules);
  const enabledModulePages = new Set(enabledFeatures.map(id => PAGES.find(page => page.id === id)?.module).filter(Boolean));
  return <div className="shell">
    <aside className="shell-sidebar" aria-label="Main navigation">
      <a className="shell-brand" href="/home" aria-label="Social Pilot, home"><Mark/><span>Social Pilot</span></a>
      <nav className="shell-nav">{MODULES.filter(module => enabledModuleSet.has(module.id) && enabledModulePages.has(module.id)).map((module) => <a key={module.id} href={PAGES.find(page => page.module === module.id && enabledFeatures.includes(page.id))?.href ?? module.href} className={`shell-nav__link${activeModule === module.id ? " is-active" : ""}`} aria-current={activeModule === module.id ? "page" : undefined}>
        <span className="shell-nav__glyph"><ModuleIcon name={module.title}/></span><span>{module.title}</span>
      </a>)}</nav>
      {modulePages.length > 1 && <nav className="shell-subnav" aria-label={`${MODULES.find(module => module.id === activeModule)?.title} pages`}>
        <p className="shell-subnav__label">{MODULES.find(module => module.id === activeModule)?.title}</p>
        {modulePages.map(page => <a key={page.id} href={page.href} className={`shell-subnav__link${pathname === page.href ? " is-active" : ""}`} aria-current={pathname === page.href ? "page" : undefined}>{page.title}</a>)}
        {rootAccess && activeModule === 'settings' && <a className="shell-subnav__link shell-root-mobile" href="/root/config">Root controls</a>}
      </nav>}
      {sidebar && <div id="shell-filters" className={`shell-sidebar-filter${filterOpen ? " is-open" : ""}`} onSubmitCapture={() => setFilterOpen(false)} onClickCapture={event => { if ((event.target as Element).closest('a[href]')) setFilterOpen(false); }}>{sidebar}</div>}
      {rootAccess && <a className="shell-subnav__link shell-root-link" href="/root/config">Root controls</a>}
    </aside>
    <div className="shell-main"><header className="shell-topbar"><div className="shell-topbar__crumb"><span>{workspaceName}</span><span aria-hidden="true">/</span><strong>{MODULES.find(module => module.id === activeModule)?.title}</strong></div><div className="shell-topbar__actions">{sidebar && <button className="shell-filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="shell-filters" onClick={() => setFilterOpen(open => !open)}>{filterOpen ? "Close filters" : "Filters"}</button>}<span className="shell-topbar__user">{userName}</span><button className="shell-signout" type="button" onClick={async () => { const response = await fetch('/api/auth/sign-out', { method: 'POST' }); if (response.ok) window.location.assign('/sign-in'); }}>Sign out</button></div></header><main className="shell-content">{children}</main></div>
  </div>;
}
