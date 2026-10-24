"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronsLeft, IconChevronsRight, IconCheck, IconChevronDown, IconHelp, IconLogout, IconMenu2, IconPlus, IconSettings, IconShieldLock, IconUserCircle, IconX } from "@tabler/icons-react";
import { MODULES, areaForPath, areaPages, pageForPath, type AreaId, type ModuleId } from "@/lib/product";
import { HUB_ORDER, hubForPath, hubPages, type HubId } from "@/lib/hubs";
import { nextChannelScope, parseChannelScope, withChannelScope } from "@/lib/channel-scope";
import { fill, type ShellCopy, type ShellPolicy } from "@/modules/shell/copy";
import type { ConnectionState } from "@/lib/connection-status";
import { HubGlyph, ModuleGlyph } from "./icons";
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
import { LANGUAGE_COOKIE, type Language } from "@/lib/language";

function Mark() {
  return <svg className="shell-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23.5 12.2 8l4 9 3.2-5.3L27 23.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="23.5" cy="8.5" r="2.5" fill="currentColor"/></svg>;
}

/** Hubs that carry a needs-attention badge, in hub order. */
const BADGED_HUBS: readonly HubId[] = ["engage", "plan", "measure"];
/** Phone bottom bar: the four page hubs; Create stays the raised central action. */
const BOTTOM_HUBS: readonly HubId[] = ["plan", "engage", "measure", "grow"];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PaletteCopy = { trigger: string; placeholder: string; noResults: string; hint: string; close: string; sectionActions: string; sectionPages: string; sectionChannels: string };
export type ShellChannelProp = { id: string; name: string; pictureUrl: string | null; health: ConnectionState };
export type HubCounts = { engage?: number; plan?: number; measure?: number };

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
  /** Root: the private installation section navigation, shown inside the sidebar. Customer pages keep their filters in-page. */
  rootNav?: ReactNode;
  /** Root: the private installation shell. */
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
  /** Pending counts shown on area tabs, keyed by page id (for example Approvals). Zero or missing shows no badge. */
  tabCounts?: Readonly<Record<string, number>>;
  /** Needs-attention counts shown on the hubs (mentions, approvals, alerts). Zero or missing shows no badge. */
  hubCounts?: Readonly<HubCounts>;
  initialCollapsed?: boolean;
};

function writeCookie(name: string, value: string, days: number) {
  try { document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${Math.round(days * 86400)}; samesite=lax`; } catch { /* a blocked cookie only loses the remembered choice */ }
}

/** A count badge reads "99+" past 99 so it never stretches its row. */
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function AppShell({ children, activeModule, enabledModules, enabledFeatures, writableFeatures = [], rootAccess, userName, workspaceName, workspaceId, workspaces = [], rootNav, installationMode = false, paletteCopy, copy, policy, channels = [], initialScope = [], initialScopeDropped = 0, optionalAreas = [], tabCounts = {}, hubCounts = {}, initialCollapsed = false }: AppShellProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const theme = useOptionalTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [compactViewport, setCompactViewport] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  const activeHub = installationMode ? undefined : hubForPath(pathname, activeModule);
  const activeArea = installationMode ? undefined : areaForPath(pathname, activeModule);
  const activePage = pageForPath(pathname);
  const effectiveOptionalAreas = useMemo(
    () => activeArea && (activeArea === "tasks" || activeArea === "agency") && !optionalAreas.includes(activeArea)
      ? [...optionalAreas, activeArea]
      : optionalAreas,
    [activeArea, optionalAreas],
  );
  const primaryAction = installationMode ? undefined : MODULES.map(module => module.primaryAction).find(action => action && enabledFeatures.includes(action.featureId) && writableFeatures.includes(action.featureId));
  const hubOn = (hub: HubId) => hubPages(hub, enabledFeatures, effectiveOptionalAreas).length > 0 || (hub === "create" && primaryAction !== undefined);
  const hubs = HUB_ORDER.filter(hubOn);
  const hubHref = (hub: HubId) => hubPages(hub, enabledFeatures, effectiveOptionalAreas)[0]?.href ?? primaryAction?.href ?? "/home";
  const hubCount = (hub: HubId) => (BADGED_HUBS.includes(hub) ? hubCounts[hub as keyof HubCounts] : undefined) ?? 0;
  const hubName = (hub: HubId) => {
    const count = hubCount(hub);
    return count > 0 ? `${copy.hubs[hub]}, ${fill(copy.hubCounts[hub as keyof ShellCopy["hubCounts"]], { count })}` : copy.hubs[hub];
  };
  // Settings keeps its in-content section list; every other customer page belongs to a hub or is the Home landing.
  const settingsActive = !installationMode && activeArea === "settings";
  const settingsPages = areaPages("settings", enabledFeatures);
  const pageLabel = (page: { id: string; title: string }) => (copy.pageTitles as Record<string, string>)[page.id] ?? page.title;
  // Every signed-in page shares the root layout's title; name the tab after the current page so history and tabs stay readable.
  const documentTitle = installationMode ? copy.root : activePage ? pageLabel(activePage) : undefined;
  useEffect(() => {
    if (!documentTitle) return;
    const current = document.title;
    const brand = current.includes(" · ") ? current.slice(current.lastIndexOf(" · ") + 3) : current;
    document.title = brand && brand !== documentTitle ? `${documentTitle} · ${brand}` : documentTitle;
  }, [documentTitle, pathname]);
  // Phone tab strips scroll; bring the current tab into view instead of leaving it clipped past the edge.
  useEffect(() => {
    for (const strip of document.querySelectorAll<HTMLElement>(".shell-tabs .ui-tabs__list, .shell-settings__list")) {
      const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current || strip.scrollWidth <= strip.clientWidth) continue;
      const box = strip.getBoundingClientRect(), tab = current.getBoundingClientRect();
      if (tab.right > box.right - 32 || tab.left < box.left) strip.scrollLeft += tab.left - box.left - 16;
    }
  }, [pathname]);
  const activeHubPages = activeHub ? hubPages(activeHub, enabledFeatures, effectiveOptionalAreas) : [];
  const tabs = activeHubPages.map(page => ({ id: page.id, href: page.href, label: pageLabel(page), ...(tabCounts[page.id] ? { count: tabCounts[page.id] } : {}) }));
  const settingsTabs = settingsActive ? settingsPages.map(page => ({ id: page.id, href: page.href, label: pageLabel(page) })) : [];
  // Sections that are not tabs themselves (Library sections, post details) keep their parent tab current: the longest tab route that prefixes the path.
  const underRoute = (route: string) => pathname === route || pathname.startsWith(`${route}/`);
  const activeTabId = tabs.find(tab => tab.id === activePage?.id)?.id
    ?? activeHubPages.find(page => page.tabRoutes?.some(underRoute))?.id
    ?? [...tabs].filter(tab => underRoute(tab.href)).sort((a, b) => b.href.length - a.href.length)[0]?.id;
  const activeSettingsId = settingsTabs.find(tab => tab.id === activePage?.id)?.id
    ?? [...settingsTabs].filter(tab => underRoute(tab.href)).sort((a, b) => b.href.length - a.href.length)[0]?.id;

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
  const [currentLanguage, setCurrentLanguage] = useState<string>("");
  useEffect(() => { setCurrentLanguage(document.documentElement.lang); }, []);
  // The cookie becomes the request's Accept-Language in middleware; a reload re-renders the whole document, including <html lang>.
  const chooseLanguage = (language: Language) => {
    if (language === currentLanguage) return;
    document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };
  const userItems: MenuItem[] = [
    ...(enabledFeatures.includes("settings/account") ? [{ key: "account", label: copy.account, icon: <IconUserCircle size={17} stroke={1.75} />, onSelect: go("/settings/account") }] : []),
    ...(theme ? MODES.map(mode => ({ key: `mode-${mode.id}`, label: `${copy.theme} · ${theme.copy[mode.id]}`, icon: theme.mode === mode.id ? <IconCheck size={17} stroke={2} /> : <span style={{ width: 17 }} />, disabled: theme.busy, onSelect: () => { void theme.setMode(mode.id).catch(() => undefined); } })) : []),
    ...([["en", copy.languageEnglish], ["fr", copy.languageFrench]] as [Language, string][]).map(([id, name]) => ({ key: `language-${id}`, label: `${copy.language} · ${name}`, icon: currentLanguage === id ? <IconCheck size={17} stroke={2} /> : <span style={{ width: 17 }} />, onSelect: () => chooseLanguage(id) })),
    { key: "help", label: copy.help, icon: <IconHelp size={17} stroke={1.75} />, onSelect: go("/help") },
    ...(rootAccess && !installationMode ? [{ key: "root", label: copy.root, icon: <IconShieldLock size={17} stroke={1.75} />, onSelect: go("/root") }] : []),
    { key: "signout", label: signingOut ? copy.signingOut : copy.signOut, icon: <IconLogout size={17} stroke={1.75} />, disabled: signingOut, onSelect: () => { void signOut(); } },
  ];

  const onHubKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href]")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]!.focus();
  };

  const hubLink = (hub: HubId) => {
    const count = hubCount(hub);
    const name = hubName(hub);
    return <a key={hub} href={hubHref(hub)} data-hub={hub} className={`shell-hub${activeHub === hub ? " is-active" : ""}`}
      aria-current={activeHub === hub && pageForPath(pathname)?.href === hubHref(hub) ? "page" : activeHub === hub ? "true" : undefined}
      aria-label={count > 0 ? name : undefined} title={rail || count > 0 ? name : undefined}>
      <span className="shell-hub__glyph"><HubGlyph id={hub} size={17} /></span><span className="shell-hub__label">{copy.hubs[hub]}</span>
      {count > 0 && <span className="shell-hub__badge" aria-hidden="true">{badgeText(count)}</span>}
    </a>;
  };
  const rail = collapsed && !menuOpen || (compactViewport && !menuOpen);
  const bottomItems: BottomBarItem[] = installationMode
    ? [{ id: "home", href: "/home", label: copy.backToApp, icon: <ModuleGlyph id="home" size={22} />, active: false }, { id: "root", href: "/root", label: copy.root, icon: <ModuleGlyph id="root" size={22} />, active: true }]
    : BOTTOM_HUBS.filter(hubOn).map(hub => {
      const count = hubCount(hub);
      return { id: hub, href: hubHref(hub), label: copy.hubs[hub], icon: <HubGlyph id={hub} size={22} />, active: activeHub === hub, ...(count > 0 ? { badge: count, badgeLabel: hubName(hub) } : {}) };
    });

  const scopeActive = !settingsActive && activeArea !== "tasks" && activeArea !== "agency";
  const sidebarScope = showScope && <section className="shell-channels" aria-label={copy.channels}>
    <h2 className="shell-section-label">{copy.channels}</h2>
    <ChannelScopeList channels={channels as ScopeChannel[]} selectedIds={scope} onSelect={onSelectChannel} onReset={() => applyScope([])} collapsedCount={policy.channelsCollapsedCount} searchThreshold={policy.channelSearchThreshold}
      manageHref={enabledFeatures.includes("settings/connections") ? "/settings/channels" : undefined} compact={rail} busy={navigating} scopeActive={scopeActive} />
  </section>;

  const currentWorkspace = workspaces.find(entry => entry.id === workspaceId);
  const workspaceItems: MenuItem[] = workspaces.map(entry => ({
    key: entry.id, label: entry.name, disabled: switching,
    icon: entry.id === workspaceId
      ? <span className="shell-workspace__current"><Avatar name={entry.name} size="sm" decorative /><IconCheck size={13} stroke={2.5} aria-hidden="true" /></span>
      : <Avatar name={entry.name} size="sm" decorative />,
    onSelect: () => { void switchWorkspace(entry.id); },
  }));

  return <ShellCopyProvider copy={copy}><ToastProvider>
    <div className="shell" data-area={installationMode ? "root" : activeArea} data-module={installationMode ? "root" : activeModule} data-rail={rail ? "true" : undefined} data-menu={menuOpen ? "open" : undefined}>
      <a className="shell-skip-link" href="#main-content">{copy.skipLink}</a>
      <aside ref={sidebarRef} id="shell-sidebar" className="shell-sidebar" role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen ? true : undefined} aria-label={copy.mainNavigation} tabIndex={menuOpen ? -1 : undefined}>
        <div className="shell-sidebar__head">
          <a className="shell-brand" href={installationMode ? "/root" : "/home"} aria-label={`Social Pilot, ${installationMode ? copy.root : copy.areas.home}`}><Mark /><span className="shell-wordmark">Social Pilot</span></a>
          <button type="button" className="shell-sidebar__close" onClick={closeMenu} aria-label={copy.closeMenu}><IconX size={20} stroke={1.9} aria-hidden="true" /></button>
        </div>
        <div className="shell-workspace">
          <p className="shell-workspace-label" id="shell-workspace-label">{installationMode ? copy.privateInstallation : copy.workspace}</p>
          {!installationMode && workspaces.length > 1
            ? <Menu label={`${copy.workspace}: ${currentWorkspace?.name ?? workspaceName}`} align="start" className="shell-workspace__menu" items={workspaceItems}
              trigger={<><Avatar name={currentWorkspace?.name ?? workspaceName} size="sm" decorative /><span className="shell-workspace__name">{currentWorkspace?.name ?? workspaceName}</span><IconChevronDown size={15} stroke={2} aria-hidden="true" className="shell-workspace__chevron" /></>} />
            : <p className="shell-workspace-name"><Avatar name={workspaceName} size="sm" decorative /><span className="shell-workspace__name">{workspaceName}</span></p>}
          {switching && <p className="shell-workspace-status" role="status">{copy.switchingWorkspace}</p>}
          {workspaceError && <p className="ui-error" role="alert">{workspaceError}</p>}
        </div>
        {primaryAction && <a className="shell-create ui-button ui-button--primary" href={primaryAction.href} aria-label={rail ? copy.createPost : undefined} title={rail ? copy.createPost : undefined}><IconPlus size={18} stroke={2.2} aria-hidden="true" /><span className="shell-create__label">{copy.createPost}</span></a>}
        <div className="shell-sidebar__scroll">
          <nav className="shell-hubs" aria-label={copy.mainNavigation} onKeyDown={onHubKey}>
            {installationMode
              ? <><a href="/home" className="shell-hub"><span className="shell-hub__glyph"><ModuleGlyph id="home" size={17} /></span><span className="shell-hub__label">{copy.backToApp}</span></a><a href="/root" className="shell-hub is-active" aria-current="page"><span className="shell-hub__glyph"><ModuleGlyph id="root" size={17} /></span><span className="shell-hub__label">{copy.root}</span></a></>
              : hubs.map(hubLink)}
          </nav>
          {installationMode ? <div className="shell-root-nav">{rootNav}</div> : sidebarScope}
        </div>
        <footer className="shell-sidebar__foot">
          {!installationMode && settingsPages.length > 0 && <a href={settingsPages[0]!.href} className={`shell-hub${settingsActive ? " is-active" : ""}`} aria-current={settingsActive ? "page" : undefined} title={rail ? copy.areas.settings : undefined}><span className="shell-hub__glyph"><IconSettings size={17} stroke={1.75} aria-hidden="true" /></span><span className="shell-hub__label">{copy.areas.settings}</span></a>}
          <div className="shell-user">
            <Menu label={copy.userMenu} align="start" className="shell-user__menu" items={userItems} trigger={<><Avatar name={userName} size="sm" decorative /><span className="shell-user__name">{userName}</span><IconChevronDown size={15} stroke={2} aria-hidden="true" className="shell-user__chevron" /></>} />
          </div>
          {accountError && <p className="ui-error" role="alert">{accountError}</p>}
          <button type="button" className="shell-collapse" aria-expanded={!collapsed} onClick={toggleCollapsed} aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar} title={collapsed ? copy.expandSidebar : copy.collapseSidebar}>{collapsed ? <IconChevronsRight size={18} stroke={1.9} aria-hidden="true" /> : <IconChevronsLeft size={18} stroke={1.9} aria-hidden="true" />}</button>
        </footer>
      </aside>
      {menuOpen && <button className="shell-scrim" type="button" aria-label={copy.closeMenu} onClick={closeMenu} />}
      <div className="shell-main" inert={menuOpen || undefined}>
        <header className="shell-topbar">
          <div className="shell-topbar__start">
            <button ref={menuToggleRef} className="shell-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="shell-sidebar" aria-label={copy.openMenu} onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}><IconMenu2 size={20} stroke={1.9} aria-hidden="true" /></button>
            {showScope && <button type="button" className="shell-scope-chip" aria-haspopup="dialog" aria-expanded={scopeOpen} onClick={() => setScopeOpen(true)}><span className="shell-scope-chip__label">{scopeLabel}</span><IconChevronDown size={15} stroke={2} aria-hidden="true" /></button>}
            {installationMode && <span className="shell-root-badge"><ModuleGlyph id="root" size={15} /><span>{copy.rootBadge}</span></span>}
          </div>
          <div className="shell-topbar__tools">
            {!installationMode && paletteCopy && <CommandPalette copy={paletteCopy} />}
          </div>
        </header>
        <main id="main-content" className="shell-content" tabIndex={-1}>
          {tabs.length > 1 && !settingsActive && <LinkTabs items={tabs} activeId={activeTabId} label={fill(copy.hubTabsLabel, { hub: activeHub ? copy.hubs[activeHub] : "" })} maxVisible={policy.maxVisibleTabs} moreLabel={copy.moreTabs} className="shell-tabs" />}
          {!installationMode && dropped > 0 && <p className="shell-notice" role="status">{dropped === 1 ? copy.scopeDroppedOne : fill(copy.scopeDroppedMany, { count: dropped })}</p>}
          {settingsActive && !installationMode && settingsTabs.length > 1
            ? <div className="shell-settings">
              {/* Settings sections are an in-content list (left on desktop, a scrolling strip on phones), not hub tabs. */}
              <nav className="shell-settings__list" aria-label={fill(copy.areaTabsLabel, { area: copy.areas.settings })}>
                <ul>{settingsTabs.map(tab => <li key={tab.id}><a href={tab.href} aria-current={tab.id === activeSettingsId ? "page" : undefined}>{tab.label}</a></li>)}</ul>
              </nav>
              <div className="shell-settings__body">{children}</div>
            </div>
            : children}
        </main>
      </div>
      {bottomItems.length > 0 && <BottomBar label={copy.bottomBar} items={bottomItems} create={primaryAction ? { href: primaryAction.href, label: copy.createPost } : undefined} />}
      {scopeOpen && showScope && <Drawer open title={copy.scopeSheetTitle} variant="sheet" closeLabel={copy.close} onClose={() => setScopeOpen(false)}>
        <ChannelScopeList channels={channels as ScopeChannel[]} selectedIds={scope} onSelect={onSelectChannel} onReset={() => applyScope([])} collapsedCount={policy.channelsCollapsedCount} searchThreshold={policy.channelSearchThreshold} manageHref={enabledFeatures.includes("settings/connections") ? "/settings/channels" : undefined} busy={navigating} scopeActive={scopeActive} />
      </Drawer>}
    </div>
  </ToastProvider></ShellCopyProvider>;
}
