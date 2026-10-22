"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronsLeft, IconChevronsRight, IconAdjustmentsHorizontal, IconCheck, IconChevronDown, IconHelp, IconLogout, IconMenu2, IconPlus, IconSettings, IconShieldLock, IconUserCircle, IconX } from "@tabler/icons-react";
import { MODULES, areaForPath, areaPages, pageForPath, type AreaId, type ModuleId } from "@/lib/product";
import { nextChannelScope, parseChannelScope, withChannelScope } from "@/lib/channel-scope";
import { fill, type ShellCopy, type ShellPolicy } from "@/modules/shell/copy";
import type { ConnectionState } from "@/lib/connection-status";
import { SidebarDockContext } from "./SidebarDock";
import { ModuleGlyph } from "./icons";
import { CommandPalette } from "./CommandPalette";
import { ToastProvider } from "./Toast";
import { ShellCopyProvider } from "./ShellCopy";
import { ChannelScopeList, type ScopeChannel } from "./ChannelScopeList";
import { BottomBar, type BottomBarItem } from "./BottomBar";
import { LinkTabs } from "./Tabs";
import { Menu, type MenuItem } from "./Menu";
import { Avatar } from "./Avatar";
import { Drawer } from "./Drawer";
import { useOptionalTheme, MODES } from "./ThemeProvider";

function Mark() {
  return <svg className="shell-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23.5 12.2 8l4 9 3.2-5.3L27 23.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="23.5" cy="8.5" r="2.5" fill="currentColor"/></svg>;
}

/** Glyph module id for each sidebar area; colours come from the `--area-*` tokens. */
const AREA_GLYPH: Record<AreaId, string> = { home: "home", content: "publishing", inbox: "inbox", insights: "analytics", tasks: "tasks", agency: "agency", settings: "settings" };
const FIXED_AREAS: readonly AreaId[] = ["home", "content", "inbox", "insights"];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PaletteCopy = { trigger: string; placeholder: string; noResults: string; hint: string; close: string };
export type ShellChannelProp = { id: string; name: string; pictureUrl: string | null; health: ConnectionState };

type AppShellProps = {
  children: ReactNode;
  activeModule: ModuleId;
  enabledModules: readonly ModuleId[];
  enabledFeatures: readonly string[];
  writableFeatures?: readonly string[];
  rootAccess: boolean;
  userName: string;
  workspaceName: string;
  workspaceId?: string;
  workspaces?: readonly { id: string; name: string }[];
  /** Transitional "Page tools": filters and options of pages that have not moved to the new header yet. */
  sidebar?: ReactNode;
  sidebarWhen?: readonly string[];
  /** Root: the private installation shell. Its section navigation (`sidebar`) is shown inside the sidebar. */
  installationMode?: boolean;
  paletteCopy?: PaletteCopy;
  copy: ShellCopy;
  policy: ShellPolicy;
  channels?: readonly ShellChannelProp[];
  /** Scope remembered in the cookie, already validated against `channels`. */
  initialScope?: readonly string[];
  initialScopeDropped?: number;
  /** Optional areas the workspace uses (Tasks once a task exists; Agency with more than one workspace). */
  optionalAreas?: readonly AreaId[];
  initialCollapsed?: boolean;
};

function writeCookie(name: string, value: string, days: number) {
  try { document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${Math.round(days * 86400)}; samesite=lax`; } catch { /* a blocked cookie only loses the remembered choice */ }
}

export function AppShell({ children, activeModule, enabledModules, enabledFeatures, writableFeatures = [], rootAccess, userName, workspaceName, workspaceId, workspaces = [], sidebar, sidebarWhen, installationMode = false, paletteCopy, copy, policy, channels = [], initialScope = [], initialScopeDropped = 0, optionalAreas = [], initialCollapsed = false }: AppShellProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const theme = useOptionalTheme();
  const toolsTitleId = useId();
  const visibleTools = Boolean(sidebar) && (!sidebarWhen || sidebarWhen.includes(pathname));

  const [menuOpen, setMenuOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const [dockUsed, setDockUsed] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [compactViewport, setCompactViewport] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const toolsRef = useRef<HTMLDialogElement>(null);
  const toolsToggleRef = useRef<HTMLButtonElement>(null);

  const activeArea = installationMode ? undefined : areaForPath(pathname, activeModule);
  const activePage = pageForPath(pathname);
  const areaOn = (area: AreaId) => areaPages(area, enabledFeatures).length > 0 && (FIXED_AREAS.includes(area) || optionalAreas.includes(area));
  const areas = (["home", "content", "inbox", "insights", "tasks", "agency"] as const).filter(areaOn);
  const settingsPages = areaPages("settings", enabledFeatures);
  const areaHref = (area: AreaId) => areaPages(area, enabledFeatures)[0]?.href ?? "/home";
  const pageLabel = (page: { id: string; title: string }) => (copy.pageTitles as Record<string, string>)[page.id] ?? page.title;
  const primaryAction = installationMode ? undefined : MODULES.map(module => module.primaryAction).find(action => action && enabledFeatures.includes(action.featureId) && writableFeatures.includes(action.featureId));
  const tabs = activeArea ? areaPages(activeArea, enabledFeatures).map(page => ({ id: page.id, href: page.href, label: pageLabel(page) })) : [];

  // ---- channel scope: the URL wins, then the remembered cookie (01 §5) ----
  const channelIds = useMemo(() => channels.map(channel => channel.id), [channels]);
  const urlScope = useMemo(() => parseChannelScope({ search: search ?? undefined, allowed: channelIds }), [search, channelIds]);
  const scope = urlScope.source === "url" ? urlScope.ids : [...initialScope];
  const dropped = urlScope.source === "url" ? urlScope.dropped : initialScopeDropped;
  const scopeLabel = scope.length === 0 ? copy.allChannels : scope.length === 1 ? channels.find(channel => channel.id === scope[0])?.name ?? copy.allChannels : fill(copy.channelCount, { count: scope.length });
  const showScope = !installationMode && channels.length > 0;
  const applyScope = useCallback((ids: string[]) => {
    if (workspaceId) writeCookie(`${policy.scopeCookiePrefix}${workspaceId}`, ids.join(","), policy.scopeCookieDays);
    setNavigating(true);
    window.location.assign(withChannelScope(`${pathname}${search?.toString() ? `?${search.toString()}` : ""}`, ids));
  }, [pathname, search, workspaceId, policy.scopeCookiePrefix, policy.scopeCookieDays]);
  const onSelectChannel = (id: string, additive: boolean) => applyScope(nextChannelScope(scope, id, additive));
  useEffect(() => {
    // A removed channel must not stay in the remembered scope.
    if (dropped > 0 && workspaceId) writeCookie(`${policy.scopeCookiePrefix}${workspaceId}`, scope.join(","), policy.scopeCookieDays);
  }, [dropped, scope, workspaceId, policy.scopeCookiePrefix, policy.scopeCookieDays]);

  // ---- collapse (desktop) and viewport class ----
  const toggleCollapsed = useCallback(() => {
    setCollapsed(value => { writeCookie(policy.sidebarCookie, value ? "0" : "1", policy.sidebarCookieDays); return !value; });
  }, [policy.sidebarCookie, policy.sidebarCookieDays]);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 1023px)");
    if (!query) return;
    const update = () => setCompactViewport(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], dialog[open]")) return;
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  // ---- overlay menu (tablet and phone): focus trap, Escape, inert background, scroll lock ----
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    requestAnimationFrame(() => menuToggleRef.current?.focus());
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const panel = sidebarRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(item => item.getClientRects().length > 0);
    (focusable()[0] ?? panel)?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Native dialogs and open popovers are top-layer UI and own Escape plus focus navigation.
      if (document.querySelector("dialog[open]") || document.querySelector(".ui-popover")) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented || event.isComposing) return;
        if (event.target instanceof HTMLSelectElement) {
          try { if (event.target.matches(":open")) return; } catch { /* Older engines do not expose native popup state. */ }
        }
        event.preventDefault(); closeMenu();
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); panel?.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      if (!panel?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    const desktop = window.matchMedia?.("(min-width: 1024px)");
    const onResize = () => {
      if (!desktop?.matches) return;
      setMenuOpen(false);
      requestAnimationFrame(() => (panel?.querySelector<HTMLElement>('a[aria-current="page"]') ?? document.getElementById("main-content"))?.focus());
    };
    desktop?.addEventListener("change", onResize);
    return () => { window.removeEventListener("keydown", onKeyDown); desktop?.removeEventListener("change", onResize); document.body.style.overflow = oldOverflow; };
  }, [menuOpen, closeMenu]);

  // ---- Page tools: a modal sheet that stays mounted so docked controls keep their form state ----
  useEffect(() => {
    const dialog = toolsRef.current;
    if (!dialog) return;
    if (toolsOpen && !dialog.open) dialog.showModal?.();
    if (!toolsOpen && dialog.open) dialog.close?.();
  }, [toolsOpen]);
  useEffect(() => setToolsOpen(false), [pathname]);
  useEffect(() => {
    if (!toolsHost) return;
    const update = () => setDockUsed(toolsHost.childElementCount > 0);
    update();
    const observer = new MutationObserver(update);
    observer.observe(toolsHost, { childList: true });
    return () => observer.disconnect();
  }, [toolsHost]);
  const closeTools = useCallback(() => {
    setToolsOpen(false);
    requestAnimationFrame(() => toolsToggleRef.current?.focus());
  }, []);
  const toolsAvailable = visibleTools || dockUsed;

  async function switchWorkspace(nextId: string) {
    if (switching || nextId === workspaceId) return;
    setSwitching(true); setWorkspaceError("");
    try {
      const response = await fetch("/api/workspaces/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: nextId, confirmation: `SELECT WORKSPACE ${nextId}` }) });
      if (!response.ok) throw new Error("Selection refused");
      window.location.assign(MODULES.find(module => module.id === "home")?.href ?? "/");
    } catch { setWorkspaceError(copy.workspaceSwitchFailed); setSwitching(false); }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setAccountError("");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out refused");
      window.location.assign("/sign-in");
    } catch { setAccountError(copy.signOutFailed); setSigningOut(false); }
  }

  const go = (href: string) => () => { window.location.assign(href); };
  const userItems: MenuItem[] = [
    ...(enabledFeatures.includes("settings/account") ? [{ key: "account", label: copy.account, icon: <IconUserCircle size={17} stroke={1.75} />, onSelect: go("/settings/account") }] : []),
    ...(theme ? MODES.map(mode => ({ key: `mode-${mode.id}`, label: `${copy.theme} · ${theme.copy[mode.id]}`, icon: theme.mode === mode.id ? <IconCheck size={17} stroke={2} /> : <span style={{ width: 17 }} />, disabled: theme.busy, onSelect: () => { void theme.setMode(mode.id).catch(() => undefined); } })) : []),
    { key: "help", label: copy.help, icon: <IconHelp size={17} stroke={1.75} />, onSelect: go("/help") },
    ...(rootAccess && !installationMode ? [{ key: "root", label: copy.root, icon: <IconShieldLock size={17} stroke={1.75} />, onSelect: go("/root") }] : []),
    { key: "signout", label: signingOut ? copy.signingOut : copy.signOut, icon: <IconLogout size={17} stroke={1.75} />, disabled: signingOut, onSelect: () => { void signOut(); } },
  ];

  const onAreaKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href]")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]!.focus();
  };

  const areaLink = (area: AreaId) => <a key={area} href={areaHref(area)} data-area={area} className={`shell-area${activeArea === area ? " is-active" : ""}`} aria-current={activeArea === area && pageForPath(pathname)?.href === areaHref(area) ? "page" : activeArea === area ? "true" : undefined} title={rail ? copy.areas[area] : undefined}>
    <span className="shell-area__glyph"><ModuleGlyph id={AREA_GLYPH[area]} size={18} /></span><span className="shell-area__label">{copy.areas[area]}</span>
  </a>;
  const rail = collapsed && !menuOpen || (compactViewport && !menuOpen);
  const bottomItems: BottomBarItem[] = installationMode
    ? [{ id: "home", href: "/home", label: copy.backToApp, icon: <ModuleGlyph id="home" size={22} />, active: false }, { id: "root", href: "/root", label: copy.root, icon: <ModuleGlyph id="root" size={22} />, active: true }]
    : FIXED_AREAS.filter(areaOn).map(area => ({ id: area, href: areaHref(area), label: copy.areas[area], icon: <ModuleGlyph id={AREA_GLYPH[area]} size={22} />, active: activeArea === area }));

  const sidebarScope = showScope && <section className="shell-channels" aria-label={copy.channels}>
    <h2 className="shell-section-label">{copy.channels}</h2>
    <ChannelScopeList channels={channels as ScopeChannel[]} selectedIds={scope} onSelect={onSelectChannel} onReset={() => applyScope([])} collapsedCount={policy.channelsCollapsedCount} searchThreshold={policy.channelSearchThreshold}
      manageHref={enabledFeatures.includes("settings/connections") ? "/settings/connections" : undefined} compact={rail} busy={navigating} />
  </section>;

  return <ShellCopyProvider copy={copy}><SidebarDockContext.Provider value={toolsHost}><ToastProvider>
    <div className="shell" data-area={activeArea} data-module={installationMode ? "root" : activeModule} data-rail={rail ? "true" : undefined} data-menu={menuOpen ? "open" : undefined} onSubmitCapture={event => {
      // A Page tools button may submit an editor form outside the sheet. Reveal its progress and validation feedback instead of leaving it inert.
      if (toolsOpen && event.target instanceof HTMLFormElement) {
        setToolsOpen(false);
        if (event.target.closest(".shell-main")) requestAnimationFrame(() => document.getElementById("main-content")?.focus());
      }
    }}>
      <a className="shell-skip-link" href="#main-content">{copy.skipLink}</a>
      <aside ref={sidebarRef} id="shell-sidebar" className="shell-sidebar" role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen ? true : undefined} aria-label={copy.mainNavigation} tabIndex={menuOpen ? -1 : undefined}>
        <div className="shell-sidebar__head">
          <a className="shell-brand" href={installationMode ? "/root" : "/home"} aria-label={`Social Pilot, ${installationMode ? copy.root : copy.areas.home}`}><Mark/><span className="shell-wordmark">Social Pilot</span></a>
          <button type="button" className="shell-sidebar__close" onClick={closeMenu} aria-label={copy.closeMenu}><IconX size={20} stroke={1.9} aria-hidden="true"/></button>
        </div>
        <div className="shell-workspace">
          <p className="shell-workspace-label" id="shell-workspace-label">{installationMode ? copy.privateInstallation : copy.workspace}</p>
          {!installationMode && workspaces.length > 1
            ? <select id="shell-workspace" aria-labelledby="shell-workspace-label" className="shell-workspace-select" value={workspaceId} disabled={switching} aria-busy={switching} onChange={event => void switchWorkspace(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
            : <p className="shell-workspace-name">{workspaceName}</p>}
          {switching && <p className="shell-workspace-status" role="status">{copy.switchingWorkspace}</p>}
          {workspaceError && <p className="ui-error" role="alert">{workspaceError}</p>}
        </div>
        {primaryAction && <a className="shell-create ui-button ui-button--primary" href={primaryAction.href} aria-label={rail ? copy.createPost : undefined} title={rail ? copy.createPost : undefined}><IconPlus size={18} stroke={2.2} aria-hidden="true"/><span className="shell-create__label">{copy.createPost}</span></a>}
        <div className="shell-sidebar__scroll">
          <nav className="shell-areas" aria-label={copy.mainNavigation} onKeyDown={onAreaKey}>
            {installationMode
              ? <><a href="/home" data-area="home" className="shell-area"><span className="shell-area__glyph"><ModuleGlyph id="home" size={18}/></span><span className="shell-area__label">{copy.backToApp}</span></a><a href="/root" data-area="root" className="shell-area is-active" aria-current="page"><span className="shell-area__glyph"><ModuleGlyph id="root" size={18}/></span><span className="shell-area__label">{copy.root}</span></a></>
              : areas.map(areaLink)}
          </nav>
          {installationMode ? <div className="shell-root-nav">{sidebar}</div> : sidebarScope}
        </div>
        <footer className="shell-sidebar__foot">
          {!installationMode && settingsPages.length > 0 && <a href={areaHref("settings")} data-area="settings" className={`shell-area${activeArea === "settings" ? " is-active" : ""}`} aria-current={activeArea === "settings" ? "page" : undefined} title={rail ? copy.areas.settings : undefined}><span className="shell-area__glyph"><IconSettings size={18} stroke={1.75} aria-hidden="true"/></span><span className="shell-area__label">{copy.areas.settings}</span></a>}
          <div className="shell-user">
            <Menu label={copy.userMenu} align="start" className="shell-user__menu" items={userItems} trigger={<><Avatar name={userName} size="sm" decorative /><span className="shell-user__name">{userName}</span><IconChevronDown size={15} stroke={2} aria-hidden="true" className="shell-user__chevron"/></>} />
          </div>
          {accountError && <p className="ui-error" role="alert">{accountError}</p>}
          <button type="button" className="shell-collapse" aria-expanded={!collapsed} onClick={toggleCollapsed} aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar} title={collapsed ? copy.expandSidebar : copy.collapseSidebar}>{collapsed ? <IconChevronsRight size={18} stroke={1.9} aria-hidden="true"/> : <IconChevronsLeft size={18} stroke={1.9} aria-hidden="true"/>}</button>
        </footer>
      </aside>
      {menuOpen && <button className="shell-scrim" type="button" aria-label={copy.closeMenu} onClick={closeMenu}/>}
      <div className="shell-main" inert={menuOpen || undefined}>
        <header className="shell-topbar">
          <div className="shell-topbar__start">
            <button ref={menuToggleRef} className="shell-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="shell-sidebar" aria-label={copy.openMenu} onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}><IconMenu2 size={20} stroke={1.9} aria-hidden="true"/></button>
            {showScope && <button type="button" className="shell-scope-chip" aria-haspopup="dialog" aria-expanded={scopeOpen} onClick={() => setScopeOpen(true)}><span className="shell-scope-chip__label">{scopeLabel}</span><IconChevronDown size={15} stroke={2} aria-hidden="true"/></button>}
            {installationMode && <span className="shell-root-badge"><ModuleGlyph id="root" size={15}/><span>{copy.rootBadge}</span></span>}
          </div>
          <div className="shell-topbar__tools">
            {!installationMode && paletteCopy && <CommandPalette copy={paletteCopy}/>}
            {!installationMode && toolsAvailable && <button ref={toolsToggleRef} type="button" className="shell-tools-toggle" aria-haspopup="dialog" aria-expanded={toolsOpen} onClick={() => setToolsOpen(true)}><IconAdjustmentsHorizontal size={17} stroke={1.9} aria-hidden="true"/><span>{copy.pageTools}</span></button>}
          </div>
        </header>
        <main id="main-content" className="shell-content" tabIndex={-1}>
          {tabs.length > 1 && <LinkTabs items={tabs} activeId={activePage?.id} label={fill(copy.areaTabsLabel, { area: activeArea ? copy.areas[activeArea] : "" })} maxVisible={policy.maxVisibleTabs} moreLabel={copy.moreTabs} className="shell-tabs"/>}
          {!installationMode && dropped > 0 && <p className="shell-notice" role="status">{dropped === 1 ? copy.scopeDroppedOne : fill(copy.scopeDroppedMany, { count: dropped })}</p>}
          {children}
        </main>
      </div>
      {bottomItems.length > 0 && <BottomBar label={copy.bottomBar} items={bottomItems} create={primaryAction ? { href: primaryAction.href, label: copy.createPost } : undefined}/>}
      {scopeOpen && showScope && <Drawer open title={copy.scopeSheetTitle} variant="sheet" closeLabel={copy.close} onClose={() => setScopeOpen(false)}>
        <ChannelScopeList channels={channels as ScopeChannel[]} selectedIds={scope} onSelect={onSelectChannel} onReset={() => applyScope([])} collapsedCount={policy.channelsCollapsedCount} searchThreshold={policy.channelSearchThreshold} manageHref={enabledFeatures.includes("settings/connections") ? "/settings/connections" : undefined} busy={navigating}/>
      </Drawer>}
      <dialog ref={toolsRef} className="ui-drawer ui-drawer--end ui-drawer--sheet shell-tools" aria-labelledby={toolsTitleId}
        onCancel={event => { event.preventDefault(); closeTools(); }}
        onClose={() => setToolsOpen(false)}
        onMouseDown={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeTools(); } }}>
        <div className="ui-drawer__header"><div><h2 id={toolsTitleId}>{copy.pageToolsTitle}</h2><p>{copy.pageToolsHint}</p></div><button type="button" className="shell-tools__close" data-dialog-cancel aria-label={copy.close} onClick={closeTools}><IconX size={18} stroke={1.75} aria-hidden="true"/></button></div>
        <div className="ui-drawer__body shell-tools__body">
          {!installationMode && visibleTools && <div className="shell-sidebar-filter">{sidebar}</div>}
          <div ref={setToolsHost} className="shell-sidebar-tools"/>
        </div>
      </dialog>
    </div>
  </ToastProvider></SidebarDockContext.Provider></ShellCopyProvider>;
}
