/** Read-only customer browser gate. Never prints credentials or browser payloads. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserContext, type Locator, type Page, type Route } from 'playwright';
import { MODE_COOKIE, THEME_COOKIE, THEMES } from '../src/lib/themes';

/** Round 3: the same checks run in Chromium, Firefox or WebKit (`MATRIX_BROWSER`), over all themes or a chosen subset (`MATRIX_THEMES=vivid,warm`). */
export const ENGINES = { chromium, firefox, webkit } as const;
export type EngineName = keyof typeof ENGINES;
export function engineName(raw: string | undefined): EngineName {
  if (!raw) return 'chromium';
  if (raw in ENGINES) return raw as EngineName;
  throw new Error('UNKNOWN_BROWSER');
}
export type ThemeList = readonly (typeof THEMES)[number][];
export function selectThemes(raw: string | undefined): ThemeList {
  if (!raw) return THEMES;
  const ids = raw.split(',').map(id => id.trim()).filter(Boolean);
  const chosen = THEMES.filter(theme => ids.includes(theme.id));
  if (!chosen.length || chosen.length !== new Set(ids).size) throw new Error('UNKNOWN_THEME');
  return chosen;
}
/** WebKit refuses to store a `Secure` cookie from plain-http loopback (Chromium and Firefox treat loopback as secure). */
let relaxSecureCookie = false;
async function launchBrowser(env: Readonly<Record<string, string | undefined>>) {
  const name = engineName(env.MATRIX_BROWSER);
  relaxSecureCookie = name === 'webkit';
  return ENGINES[name].launch({ headless: true });
}
const passRoute = (route: Route) => route.continue();

export const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;
export const FAMILIES = ['/home', '/publishing', '/inbox', '/analytics', '/ads', '/settings', '/tasks', '/agency'];
/** Main-area candidates, tried in order; on desktop the sidebar's primary (filter apply) button is the page's main action. */
export const MAIN_ACTION_SELECTORS = ['main .ui-button--primary:not(:disabled)', '#shell-filters .ui-button--primary', 'main button:not(:disabled)', 'main a[href]'] as const;
/** On phones the sidebar is a closed drawer, so its primary action is verified after opening the drawer by keyboard. */
export const DRAWER_MAIN_ACTION_SELECTOR = '#shell-filters .ui-button--primary';
export type Finding = { code: string; count?: number; fingerprint?: string; control?: number; route?: string; theme?: string; viewport?: { width: number; height: number } };
export type Cell = {
  route: string; theme: string; viewport: { width: number; height: number };
  findings: Finding[];
  keyboard: { mainAction: 'passed' | 'failed' | 'Not available'; mainActionTarget?: string; dialog: 'passed' | 'failed' | 'Not available' };
};
export type MatrixReport = {
  version: 1; startedAt: string; finishedAt: string; browser: string;
  routes: string[]; excludedDynamicRoutes: string[]; expectedCells: number;
  cells: Cell[]; fatal: Finding[]; failures: number; passed: boolean;
};

export function guardBaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error('BASE_URL_REQUIRED');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('BASE_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('BASE_URL_NOT_LOOPBACK_ORIGIN');
  return url.origin;
}

export function allowRequest(raw: string, base: string, method: string, signingIn: boolean): boolean {
  try {
    const url = new URL(raw);
    return url.origin === base && (['GET', 'HEAD'].includes(method)
      || signingIn && method === 'POST' && url.pathname === '/api/auth/sign-in');
  } catch { return false; }
}

export function customerRoute(route: string): boolean {
  return FAMILIES.some(family => route === family || route.startsWith(`${family}/`));
}

export function discoverRoutes(appDir: string): { routes: string[]; excludedDynamicRoutes: string[] } {
  const routes: string[] = [], excludedDynamicRoutes: string[] = [];
  function walk(dir: string, parts: string[]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('@')) {
        walk(join(dir, entry.name), /^\(.*\)$/.test(entry.name) ? parts : [...parts, entry.name]);
      } else if (entry.name === 'page.tsx') {
        const route = `/${parts.join('/')}`;
        if (customerRoute(route)) (route.includes('[') ? excludedDynamicRoutes : routes).push(route);
      }
    }
  }
  walk(appDir, []);
  return { routes: [...new Set(routes)].sort(), excludedDynamicRoutes: excludedDynamicRoutes.sort() };
}

/** Incomplete/duplicate matrices and missing keyboard evidence must never pass. */
export function finishReport(input: Pick<MatrixReport, 'startedAt' | 'routes' | 'excludedDynamicRoutes' | 'cells' | 'fatal'>): MatrixReport {
  const fatal = [...input.fatal];
  const expectedCells = input.routes.length * THEMES.length * VIEWPORTS.length;
  for (const family of FAMILIES) if (!input.routes.some(route => route === family || route.startsWith(`${family}/`))) fatal.push({ code: 'MISSING_ROUTE_FAMILY', route: family });
  const expected = new Set(input.routes.flatMap(route => THEMES.flatMap(theme => VIEWPORTS.map(v => `${route}|${theme.id}|${v.width}x${v.height}`))));
  const seen = new Set<string>();
  const cells = input.cells.map(cell => {
    const findings = [...cell.findings];
    const key = `${cell.route}|${cell.theme}|${cell.viewport.width}x${cell.viewport.height}`;
    if (!expected.has(key) || seen.has(key)) fatal.push({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    seen.add(key);
    if (cell.keyboard.mainAction !== 'passed') findings.push({ code: 'MAIN_ACTION_UNVERIFIED' });
    if (cell.keyboard.dialog === 'failed') findings.push({ code: 'DIALOG_KEYBOARD_FAILED' });
    return { ...cell, findings };
  });
  if (cells.length !== expectedCells || seen.size !== expected.size || [...expected].some(key => !seen.has(key))) fatal.push({ code: 'INCOMPLETE_MATRIX' });
  for (const theme of THEMES) for (const v of VIEWPORTS) {
    if (!cells.some(c => c.theme === theme.id && c.viewport.width === v.width && c.viewport.height === v.height && c.keyboard.dialog === 'passed')) fatal.push({ code: 'DIALOG_COVERAGE_MISSING', theme: theme.id, viewport: v });
  }
  const failures = fatal.length + cells.reduce((n, cell) => n + cell.findings.length, 0);
  return { ...input, cells, fatal, version: 1, browser: 'chromium', finishedAt: new Date().toISOString(), expectedCells, failures, passed: failures === 0 };
}

export function browserFinding(kind: 'console' | 'pageerror', level: string, message: string): Finding | null {
  const hydration = /hydration|hydrating|server rendered html|did not match|Minified React error #(418|419|421|422|423|425)\b/i.test(message);
  if (kind !== 'pageerror' && level !== 'error' && !hydration) return null;
  // A digest groups errors without retaining tokens, URLs, customer text or credentials.
  return { code: hydration ? 'HYDRATION_WARNING' : kind === 'pageerror' ? 'PAGE_ERROR' : 'CONSOLE_ERROR', fingerprint: createHash('sha256').update(message).digest('hex').slice(0, 16) };
}

async function visibleFocus(target: Locator): Promise<boolean> {
  return target.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor);
    return element === document.activeElement && element.matches(':focus-visible') && (outline || style.boxShadow !== 'none')
      && rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0;
  });
}

async function tabTo(page: Page, target: Locator): Promise<boolean> {
  // Reset the sequential navigation start, then use only real Tab presses.
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
  for (let i = 0; i < 250; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return visibleFocus(target);
  }
  return false;
}

async function checkDialog(page: Page, opener: Locator, cell: Cell): Promise<boolean> {
  if (!await tabTo(page, opener)) return false;
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.first().waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(100);
  await auditControls(page, cell);
  const contained = await dialog.first().evaluate(element => element.contains(document.activeElement));
  await page.keyboard.press('Tab');
  const focus = page.locator(':focus');
  const ring = await focus.count() === 1 && await visibleFocus(focus);
  const trapped = await dialog.first().evaluate(element => element.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await dialog.first().waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(100);
  return contained && ring && trapped && await opener.evaluate(element => element === document.activeElement);
}

async function auditControls(page: Page, cell: Cell) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  if (overflow > 1) cell.findings.push({ code: 'HORIZONTAL_OVERFLOW', count: overflow });
  // Playwright role selectors use the browser accessibility-name algorithm, including labels,
  // aria-labelledby, image alt, hidden descriptions and native input button defaults.
  const controls = page.locator('button, input:not([type=hidden]), textarea, select, [role=button], [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=spinbutton], [role=slider], [role=searchbox], [role=switch]');
  const named = page.getByRole('button', { name: /\S/ }).or(page.getByRole('textbox', { name: /\S/ }))
    .or(page.getByRole('combobox', { name: /\S/ })).or(page.getByRole('checkbox', { name: /\S/ }))
    .or(page.getByRole('radio', { name: /\S/ })).or(page.getByRole('spinbutton', { name: /\S/ }))
    .or(page.getByRole('slider', { name: /\S/ })).or(page.getByRole('searchbox', { name: /\S/ })).or(page.getByRole('switch', { name: /\S/ }));
  // Password inputs have no implicit ARIA role; ariaSnapshot still computes their name.
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    if (!await control.isVisible() || await control.evaluate(e => Boolean(e.closest('[inert], [aria-hidden="true"]')))) continue;
    const hasName = await control.and(named).count() > 0 || /^- \w+(?:[^\n]*?) "[^"\n]*\S[^"\n]*"/.test(await control.ariaSnapshot());
    if (!hasName) cell.findings.push({ code: 'ACCESSIBLE_NAME_MISSING', control: i });
  }
}

/** Phone: the closed drawer hides the sidebar action, so open it by keyboard, Tab to the action, then close it again. */
async function checkDrawerMainAction(page: Page, drawer: Locator, cell: Cell) {
  if (!await tabTo(page, drawer)) { cell.keyboard.mainAction = 'failed'; return; }
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.first().waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(100);
  const candidates = page.locator(DRAWER_MAIN_ACTION_SELECTOR);
  let target: Locator | undefined;
  for (let i = 0; i < await candidates.count(); i++) if (await candidates.nth(i).isVisible()) { target = candidates.nth(i); break; }
  if (target) {
    cell.keyboard.mainActionTarget = `drawer: ${DRAWER_MAIN_ACTION_SELECTOR}`;
    // Only real Tab presses move focus, which starts inside the open drawer and must stay trapped there.
    let reached = false;
    for (let i = 0; i < 100 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate(element => element === document.activeElement);
    }
    cell.keyboard.mainAction = reached && await visibleFocus(target) ? 'passed' : 'failed';
  }
  await page.keyboard.press('Escape');
  await dialog.first().waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(100);
  if (!await drawer.evaluate(element => element === document.activeElement)) cell.findings.push({ code: 'DRAWER_FOCUS_NOT_RESTORED' });
}

async function checkKeyboard(page: Page, cell: Cell) {
  // The phone drawer is a real shared dialog and holds the sidebar main action.
  const drawer = page.locator('.shell-filter-toggle');
  if (await drawer.isVisible()) {
    cell.keyboard.dialog = await checkDialog(page, drawer, cell) ? 'passed' : 'failed';
  }
  const selectors = MAIN_ACTION_SELECTORS;
  let target: Locator | undefined;
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    for (let i = 0; i < await candidates.count(); i++) if (await candidates.nth(i).isVisible()) { target = candidates.nth(i); cell.keyboard.mainActionTarget = selector; break; }
    if (target) break;
  }
  if (target) cell.keyboard.mainAction = await tabTo(page, target) ? 'passed' : 'failed';
  else if (await drawer.isVisible()) await checkDrawerMainAction(page, drawer, cell);
  // Open only the known local task editor; never activate arbitrary customer writes.
  if (cell.route === '/tasks') {
    const opener = page.getByRole('button', { name: 'New task', exact: true });
    cell.keyboard.dialog = await opener.isVisible() && await checkDialog(page, opener, cell) ? 'passed' : 'failed';
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) cell.findings.push({ code: 'DIALOG_LEFT_OPEN' });
  }
}

export async function runMatrix(env: Readonly<Record<string, string | undefined>> = process.env): Promise<MatrixReport> {
  const startedAt = new Date().toISOString();
  const inventory = discoverRoutes(fileURLToPath(new URL('../src/app', import.meta.url)));
  const cells: Cell[] = [], fatal: Finding[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
    phase = 'BROWSER_LAUNCH_FAILED';
    browser = await launchBrowser(env);
    const auth =await browser.newContext({ serviceWorkers: 'block' });
    let signingIn = true;
    const fence = async (context: typeof auth, authPhase: () => boolean) => {
      await context.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), authPhase()) ? passRoute(route) : route.abort('blockedbyclient'));
    };
    await fence(auth, () => signingIn);
    // No WebSocket endpoint is required for a built QA preview.
    await auth.routeWebSocket('**/*', socket => socket.close());
    phase = 'SIGN_IN_FAILED';
    const login = await auth.newPage();
    login.on('console', message => { const finding = browserFinding('console', message.type(), message.text()); if (finding) fatal.push(finding); });
    login.on('pageerror', error => { const finding = browserFinding('pageerror', 'error', error.message); if (finding) fatal.push(finding); });
    await login.goto(`${base}/sign-in`, { waitUntil: 'load', timeout: 30000 });
    await login.locator('input[name=email]').fill(env.QA_EMAIL);
    await login.locator('input[name=password]').fill(env.QA_PASSWORD);
    await login.getByRole('button', { name: 'Sign in', exact: true }).click();
    await login.waitForURL(`${base}/home`, { timeout: 20000 });
    await login.locator('main#main-content').waitFor();
    signingIn = false;
    const storage = await auth.storageState(); // memory only; contains the authenticated session
    await auth.close();
    phase = 'MATRIX_INTERRUPTED';
    for (const theme of THEMES) for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, storageState: storage, serviceWorkers: 'block' });
      try {
        await fence(context, () => false);
        await context.routeWebSocket('**/*', socket => socket.close());
        await context.addCookies([{ name: THEME_COOKIE, value: theme.id, url: base, sameSite: 'Lax' }]);
        for (const route of inventory.routes) {
          const cell: Cell = { route, theme: theme.id, viewport, findings: [], keyboard: { mainAction: 'Not available', dialog: 'Not available' } };
          cells.push(cell);
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          page.on('console', message => { const finding = browserFinding('console', message.type(), message.text()); if (finding) cell.findings.push(finding); });
          page.on('pageerror', error => { const finding = browserFinding('pageerror', 'error', error.message); if (finding) cell.findings.push(finding); });
          try {
            const response = await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 30000 });
            if (!response || response.status() >= 400) cell.findings.push({ code: 'HTTP_FAILURE', count: response?.status() });
            await page.locator('main#main-content').waitFor();
            // Allow hydration/effects and font layout to settle before inspection.
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
            await page.waitForTimeout(300);
            if (new URL(page.url()).origin !== base || new URL(page.url()).pathname !== route) cell.findings.push({ code: 'UNEXPECTED_REDIRECT' });
            if (await page.locator('html').getAttribute('data-theme') !== theme.id) cell.findings.push({ code: 'THEME_NOT_APPLIED' });
            await auditControls(page, cell);
            await checkKeyboard(page, cell);
          } catch { cell.findings.push({ code: 'ROUTE_CHECK_FAILED' }); }
          finally { await page.close(); }
        }
      } finally { await context.close(); }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  return finishReport({ startedAt, ...inventory, cells, fatal });
}

/* ---------------------------------------------------------------------------------------------
 * Extended appearance matrix: theme x light/dark mode x viewport over customer, Root and public
 * routes. Read-only like the customer gate. Records console/page errors, failed same-origin
 * requests, horizontal overflow, control names, contrast spot checks and failure screenshots.
 * ------------------------------------------------------------------------------------------- */
export const EXTENDED_MODES = ['light', 'dark'] as const;
/** Public pages are visited without a session; dynamic token pages are excluded and reported. */
export const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/password-recovery', '/verify-email', '/join'] as const;
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;
export const CONTRAST_SAMPLE_LIMIT = 600;
export const SCREENSHOT_LIMIT = 150;
export type RouteGroup = 'customer' | 'root' | 'public';
export type ExtendedCell = {
  group: string; route: string; theme: string; mode: string; viewport: { width: number; height: number };
  findings: Finding[]; details: string[]; blockedExternal: number; contrastSampled: number; screenshot?: string;
  /** Round 2: computed colours of the page shell, used to compare system mode with the explicit light/dark modes. */
  signature?: string; liveSignature?: string;
};
export type ExtendedReport = {
  version: 1; startedAt: string; finishedAt: string; browser: string;
  groups: Record<string, string[]>; modes?: readonly string[]; excludedDynamicRoutes: string[]; expectedCells: number;
  cells: ExtendedCell[]; fatal: Finding[]; failures: number; passed: boolean;
};

export function discoverRootRoutes(appDir: string): { routes: string[]; excludedDynamicRoutes: string[] } {
  const routes: string[] = [], excludedDynamicRoutes: string[] = [];
  const dir = join(appDir, 'root');
  function walk(current: string, parts: string[]) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('@')) walk(join(current, entry.name), [...parts, entry.name]);
      else if (entry.name === 'page.tsx') (parts.some(part => part.includes('[')) ? excludedDynamicRoutes : routes).push(`/${['root', ...parts].join('/')}`);
    }
  }
  walk(dir, []);
  return { routes: routes.sort(), excludedDynamicRoutes: excludedDynamicRoutes.sort() };
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Runs in the page. Resolves any CSS colour syntax through a canvas and composites translucent backgrounds. */
async function contrastAudit(page: Page): Promise<{ sampled: number; failures: Array<{ label: string; ratio: number; fg: string; bg: string; text: string }> }> {
  return page.evaluate(({ normal, large, limit }) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
    };
    const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map(i => Math.round(top[i] * top[3] + under[i] * (1 - top[3]))) as [number, number, number];
    const lum = (c: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    /** Effective background: stack ancestors' backgrounds; null when an image or gradient makes it unknowable. */
    const background = (el: Element): [number, number, number] | null => {
      const layers: Array<[number, number, number, number]> = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') return null;
        const c = rgba(style.backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] === 1) break; }
      }
      let base: [number, number, number] = rgba(getComputedStyle(document.documentElement).backgroundColor)[3] === 1 ? rgba(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3) as [number, number, number] : [255, 255, 255];
      for (const layer of layers.reverse()) base = over(layer, base);
      return base;
    };
    const failures: Array<{ label: string; ratio: number; fg: string; bg: string; text: string }> = [];
    let sampled = 0;
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && sampled < limit; node = walker.nextNode()) {
      const text = (node.textContent || '').trim();
      const el = node.parentElement;
      if (!text || !el || seen.has(el) || el.closest('script, style, noscript, svg, [aria-hidden="true"], [inert]')) continue;
      seen.add(el);
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      if (el.closest(':disabled, [aria-disabled="true"], [disabled]')) continue;
      const bg = background(el); if (!bg) continue;
      const fgRaw = rgba(style.color);
      const opacity = (() => { let o = 1; for (let n: Element | null = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; })();
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
      sampled++;
      const size = parseFloat(style.fontSize), bold = parseInt(style.fontWeight, 10) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? large : normal;
      const r = ratio(fg, bg);
      if (r < need) failures.push({ label: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`, ratio: Math.round(r * 100) / 100, fg: `rgb(${fg.join(',')})`, bg: `rgb(${bg.join(',')})`, text: text.slice(0, 24) });
    }
    return { sampled, failures };
  }, { normal: CONTRAST_NORMAL, large: CONTRAST_LARGE, limit: CONTRAST_SAMPLE_LIMIT });
}

export function finishExtended(input: Pick<ExtendedReport, 'startedAt' | 'groups' | 'excludedDynamicRoutes' | 'cells' | 'fatal'> & { modes?: readonly string[]; themes?: ThemeList; browser?: string }): ExtendedReport {
  const fatal = [...input.fatal];
  const expected = new Set<string>();
  for (const group of Object.keys(input.groups)) for (const route of input.groups[group])
    for (const theme of input.themes ?? THEMES) for (const mode of input.modes ?? EXTENDED_MODES) for (const v of VIEWPORTS)
      expected.add(`${group}|${route}|${theme.id}|${mode}|${v.width}x${v.height}`);
  const seen = new Set<string>();
  for (const cell of input.cells) {
    const key = `${cell.group}|${cell.route}|${cell.theme}|${cell.mode}|${cell.viewport.width}x${cell.viewport.height}`;
    if (!expected.has(key) || seen.has(key)) fatal.push({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    seen.add(key);
  }
  if (seen.size !== expected.size) fatal.push({ code: 'INCOMPLETE_MATRIX' });
  const failures = fatal.length + input.cells.reduce((n, cell) => n + cell.findings.length, 0);
  return { ...input, fatal, version: 1, browser: input.browser ?? 'chromium', finishedAt: new Date().toISOString(), expectedCells: expected.size, failures, passed: failures === 0 };
}

/** How a route group is visited: the signed-in QA user, nobody, or a fixture session cookie (pending/no-workspace/empty users). */
export type AuthSpec = 'qa' | 'none' | { cookie: string };
export type PlanGroup = { auth: AuthSpec; routes: string[]; /** Final pathname when it is not the route's own (redirect by design). */ expect?: Record<string, string>; /** Status a not-found/error route is meant to return (default: below 400). */ expectStatus?: Record<string, number> };
export type Plan = { groups: Record<string, PlanGroup>; modes: readonly string[]; excludedDynamicRoutes: string[] };
export const SESSION_COOKIE = 'msp_session';

/** `light`/`dark` set the stored mode; `system-*` store `system` and emulate the device preference. */
export function modeSpec(mode: string): { cookie: 'light' | 'dark' | 'system'; scheme: 'light' | 'dark' } {
  if (mode === 'light' || mode === 'dark') return { cookie: mode, scheme: mode };
  if (mode === 'system-light' || mode === 'system-dark') return { cookie: 'system', scheme: mode === 'system-dark' ? 'dark' : 'light' };
  throw new Error(`UNKNOWN_MODE ${mode}`);
}

export async function runExtendedMatrix(env: Readonly<Record<string, string | undefined>> = process.env): Promise<ExtendedReport> {
  const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
  const customer = discoverRoutes(appDir), root = discoverRootRoutes(appDir);
  const only = env.MATRIX_ONLY?.split(',').filter(Boolean);
  const pick = (routes: string[]) => only ? routes.filter(route => only.some(prefix => route.startsWith(prefix))) : routes;
  return runPlan(env, {
    groups: { customer: { auth: 'qa', routes: pick(customer.routes) }, root: { auth: 'qa', routes: pick(root.routes) }, public: { auth: 'none', routes: pick([...PUBLIC_ROUTES]) } },
    modes: EXTENDED_MODES, excludedDynamicRoutes: [...customer.excludedDynamicRoutes, ...root.excludedDynamicRoutes],
  });
}

export async function runPlan(env: Readonly<Record<string, string | undefined>>, plan: Plan): Promise<ExtendedReport> {
  const startedAt = new Date().toISOString();
  const groups: Record<string, string[]> = Object.fromEntries(Object.entries(plan.groups).map(([name, group]) => [name, group.routes]));
  const excludedDynamicRoutes = plan.excludedDynamicRoutes;
  const cells: ExtendedCell[] = [], fatal: Finding[] = [];
  const shotsDir = resolve(env.BROWSER_MATRIX_SHOTS || join(dirname(resolve(env.BROWSER_MATRIX_REPORT || '/tmp/msp-browser-matrix.json')), 'shots'));
  let shots = 0;
  const themes = selectThemes(env.MATRIX_THEMES);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    browser = await launchBrowser(env);
    const fence = async (context: BrowserContext, authPhase: () => boolean) => {
      await context.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), authPhase()) ? passRoute(route) : route.abort('blockedbyclient'));
    };
    let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
    if (Object.values(plan.groups).some(group => group.auth === 'qa' && group.routes.length)) {
      if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
      phase = 'SIGN_IN_FAILED';
      storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    }
    phase = 'MATRIX_INTERRUPTED';
    for (const theme of themes) for (const mode of plan.modes) for (const viewport of VIEWPORTS) {
      const { cookie: modeCookie, scheme } = modeSpec(mode);
      for (const [group, spec] of Object.entries(plan.groups)) {
        if (!spec.routes.length) continue;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: scheme, ...(spec.auth === 'qa' ? { storageState: storage } : {}) });
        try {
          await fence(context, () => false);
          // /join looks up an invitation with a POST; it is a read-only preview (no token is supplied), so let it through.
          if (group === 'public') await context.route(`${base}/api/auth/invitations/preview`, route => route.continue());
          await context.routeWebSocket('**/*', socket => socket.close());
          // tsx/esbuild wraps named functions with __name(); page.evaluate bodies need it defined in the page.
          await context.addInitScript('window.__name = window.__name || (f => f);');
          await context.addCookies([
            { name: THEME_COOKIE, value: theme.id, url: base, sameSite: 'Lax' },
            { name: MODE_COOKIE, value: modeCookie, url: base, sameSite: 'Lax' },
            ...(typeof spec.auth === 'object' ? [{ name: SESSION_COOKIE, value: spec.auth.cookie, url: base, sameSite: 'Lax' as const }] : []),
          ]);
          for (const route of spec.routes) {
            const cell: ExtendedCell = { group, route, theme: theme.id, mode, viewport, findings: [], details: [], blockedExternal: 0, contrastSampled: 0 };
            cells.push(cell);
            const page = await context.newPage();
            page.setDefaultTimeout(8000);
            const add = (finding: Finding, detail?: string) => { cell.findings.push(finding); if (detail && cell.details.length < 12) cell.details.push(detail); };
            page.on('console', message => {
              // The browser logs the document's own expected status (a deliberate 404) as a console error.
              const expected = spec.expectStatus?.[route];
              if (expected && message.text() === `Failed to load resource: the server responded with a status of ${expected} (${expected === 404 ? 'Not Found' : ''})`) return;
              const f = browserFinding('console', message.type(), message.text()); if (f) add(f, `${f.code}: ${message.text().replace(/\s+/g, ' ').slice(0, 160)}`);
            });
            page.on('pageerror', error => { const f = browserFinding('pageerror', 'error', error.message); if (f) add(f, `${f.code}: ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`); });
            page.on('response', response => {
              const url = new URL(response.url());
              if (url.origin === base && response.status() >= 400 && response.request().resourceType() !== 'document') add({ code: 'REQUEST_FAILED', count: response.status() }, `REQUEST_FAILED ${response.status()} ${url.pathname}`);
            });
            page.on('requestfailed', request => {
              const failure = request.failure()?.errorText || '';
              if (/blockedbyclient/i.test(failure)) { cell.blockedExternal++; return; }
              if (/ERR_ABORTED/i.test(failure)) return; // navigation/prefetch cancelled by the page itself
              add({ code: 'REQUEST_FAILED' }, `REQUEST_FAILED ${failure} ${new URL(request.url()).pathname}`);
            });
            try {
              const response = await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 60000 });
              const wantStatus = spec.expectStatus?.[route];
              if (!response || (wantStatus ? response.status() !== wantStatus : response.status() >= 400)) add({ code: 'HTTP_FAILURE', count: response?.status() }, `HTTP_FAILURE ${response?.status()}`);
              await page.locator('body').waitFor();
              await page.evaluate(() => document.fonts.ready.then(() => undefined));
              await page.waitForTimeout(400);
              const wantPath = spec.expect?.[route] ?? new URL(route, base).pathname;
              if (new URL(page.url()).origin !== base || new URL(page.url()).pathname !== wantPath) add({ code: 'UNEXPECTED_REDIRECT' }, `UNEXPECTED_REDIRECT -> ${new URL(page.url()).pathname}`);
              if (await page.locator('html').getAttribute('data-theme') !== theme.id) add({ code: 'THEME_NOT_APPLIED' });
              if (await page.locator('html').getAttribute('data-mode') !== modeCookie) add({ code: 'MODE_NOT_APPLIED' });
              if (modeCookie === 'system') {
                cell.signature = await shellSignature(page);
                // The device preference changing while the page is open must restyle it without a reload.
                await page.emulateMedia({ colorScheme: scheme === 'dark' ? 'light' : 'dark' });
                await page.waitForTimeout(250);
                cell.liveSignature = await shellSignature(page);
                await page.emulateMedia({ colorScheme: scheme });
                await page.waitForTimeout(150);
              } else cell.signature = await shellSignature(page);
              const overflow = await page.evaluate(() => {
                const doc = document.documentElement, width = doc.clientWidth;
                const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > width + 1 && !e.closest('[hidden], [inert], .sr-only') && getComputedStyle(e).position !== 'fixed'; });
                const label = (e: Element) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
                return { amount: Math.max(doc.scrollWidth, document.body.scrollWidth) - width, culprits: wide.slice(0, 3).map(label) };
              });
              if (overflow.amount > 1) add({ code: 'HORIZONTAL_OVERFLOW', count: overflow.amount }, `HORIZONTAL_OVERFLOW ${overflow.amount}px: ${overflow.culprits.join(' | ')}`);
              const named = { findings: [] as Finding[] };
              const probe: Cell = { route, theme: theme.id, viewport, findings: named.findings, keyboard: { mainAction: 'Not available', dialog: 'Not available' } };
              await auditControls(page, probe);
              for (const f of named.findings.filter(f => f.code !== 'HORIZONTAL_OVERFLOW')) add(f, `${f.code} control #${f.control}`);
              const contrast = await contrastAudit(page);
              cell.contrastSampled = contrast.sampled;
              if (contrast.failures.length) {
                add({ code: 'CONTRAST_LOW', count: contrast.failures.length });
                for (const f of contrast.failures.sort((a, b) => a.ratio - b.ratio).slice(0, 4)) if (cell.details.length < 12) cell.details.push(`CONTRAST ${f.ratio}:1 <${f.label}> "${f.text}" ${f.fg} on ${f.bg}`);
              }
              const wanted = env.MATRIX_SHOT?.split(',').filter(Boolean).some(prefix => route.startsWith(prefix)) && theme.id === (env.MATRIX_SHOT_THEME || 'vivid');
              if ((cell.findings.length || wanted) && shots < SCREENSHOT_LIMIT) {
                const file = `${group}${route.replace(/[^A-Za-z0-9-]/g, '_')}__${theme.id}-${mode}-${viewport.width}.png`;
                await mkdir(shotsDir, { recursive: true });
                await page.screenshot({ path: join(shotsDir, file), fullPage: false }).then(() => { cell.screenshot = file; shots++; }).catch(() => undefined);
              }
            } catch (error) { add({ code: 'ROUTE_CHECK_FAILED' }, `ROUTE_CHECK_FAILED ${(error as Error).message.split('\n')[0].slice(0, 140)}`); }
            finally { await page.close(); }
          }
        } finally { await context.close(); }
      }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  compareSystemModes(cells);
  return finishExtended({ startedAt, groups, modes: plan.modes, themes, browser: engineName(env.MATRIX_BROWSER), excludedDynamicRoutes, cells, fatal });
}

/** Computed colours of body, main and the first navigation landmark: enough to tell light, dark and system apart. */
async function shellSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const read = (el: Element | null) => el ? `${getComputedStyle(el).backgroundColor}/${getComputedStyle(el).color}` : '-';
    return [read(document.body), read(document.querySelector('main')), read(document.querySelector('nav, aside')), getComputedStyle(document.documentElement).colorScheme].join('|');
  });
}

/** System mode must render exactly like the explicit mode it resolves to, and follow the device preference live. */
export function compareSystemModes(cells: ExtendedCell[]) {
  const explicit = new Map<string, string>();
  const key = (c: ExtendedCell, mode: string) => `${c.group}|${c.route}|${c.theme}|${c.viewport.width}|${mode}`;
  for (const c of cells) if ((c.mode === 'light' || c.mode === 'dark') && c.signature) explicit.set(key(c, c.mode), c.signature);
  for (const c of cells) {
    if (!c.mode.startsWith('system-') || !c.signature) continue;
    const resolved = c.mode.endsWith('dark') ? 'dark' : 'light', other = resolved === 'dark' ? 'light' : 'dark';
    const want = explicit.get(key(c, resolved)), wantLive = explicit.get(key(c, other));
    if (want && want !== c.signature) { c.findings.push({ code: 'SYSTEM_MODE_MISMATCH' }); c.details.push(`SYSTEM_MODE_MISMATCH ${c.mode} != ${resolved}: ${c.signature} vs ${want}`.slice(0, 300)); }
    if (wantLive && c.liveSignature && wantLive !== c.liveSignature) { c.findings.push({ code: 'SYSTEM_MODE_NOT_LIVE' }); c.details.push(`SYSTEM_MODE_NOT_LIVE after switching to ${other}: ${c.liveSignature} vs ${wantLive}`.slice(0, 300)); }
  }
}

/* ---------------------------------------------------------------------------------------------
 * Round 2: dynamic-id pages, session-state pages, system mode, empty/not-found states, a full
 * keyboard walk per page, and injected failures (5xx, 401, offline). Everything runs against the
 * synthetic preview database; route interception means injected failures never reach the server.
 * ------------------------------------------------------------------------------------------- */
export const ROUND2_MODES = ['light', 'dark', 'system-light', 'system-dark'] as const;
/** Representative pages for the system-mode comparison (explicit light/dark are rendered beside system in the same run). */
export const SYSTEM_SAMPLE = ['/home', '/publishing/compose', '/publishing/calendar', '/inbox', '/analytics', '/analytics/explorer', '/ads', '/ads/campaigns', '/settings/appearance', '/settings/team', '/tasks', '/agency', '/root', '/root/config', '/root/modules', '/sign-in', '/join'] as const;
export type Fixtures = {
  dynamic: { customer: string[]; root: string[]; public: string[] };
  sessions: { noWorkspace: string; empty: string; verify: string; enroll: string };
  oauth: { clientId: string; redirectUri: string };
};
export type Round2Part = 'dynamic' | 'states' | 'system' | 'empty' | 'notfound' | 'keyboard' | 'failure';

/** The fixture file is local-only and may hold synthetic session tokens; reject anything shaped like a real target. */
export function parseFixtures(raw: unknown): Fixtures {
  const bad = (what: string): never => { throw new Error(`FIXTURES_INVALID ${what}`); };
  const obj = (value: unknown, what: string) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad(what);
  const routes = (value: unknown, what: string) => Array.isArray(value) && value.every(route => typeof route === 'string' && /^\/[A-Za-z0-9/_\-.%?=&]*$/.test(route)) ? value as string[] : bad(what);
  const root = obj(raw, 'root'), dynamic = obj(root.dynamic, 'dynamic'), sessions = obj(root.sessions, 'sessions'), oauth = obj(root.oauth, 'oauth');
  const token = (key: string) => typeof sessions[key] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(sessions[key] as string) ? sessions[key] as string : bad(`sessions.${key}`);
  const redirectUri = typeof oauth.redirectUri === 'string' && /^https:\/\/[^\s]+$/.test(oauth.redirectUri) ? oauth.redirectUri : bad('oauth.redirectUri');
  if (typeof oauth.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(oauth.clientId)) bad('oauth.clientId');
  return {
    dynamic: { customer: routes(dynamic.customer, 'dynamic.customer'), root: routes(dynamic.root, 'dynamic.root'), public: routes(dynamic.public, 'dynamic.public') },
    sessions: { noWorkspace: token('noWorkspace'), empty: token('empty'), verify: token('verify'), enroll: token('enroll') },
    oauth: { clientId: oauth.clientId as string, redirectUri },
  };
}

export function oauthRoute(f: Fixtures): string {
  const query = new URLSearchParams({ client_id: f.oauth.clientId, redirect_uri: f.oauth.redirectUri, response_type: 'code', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256', state: 'matrix' });
  return `/oauth/authorize?${query}`;
}

/** Pages that exist only for a particular session state, with the final path each state must end on. */
export function statePlan(f: Fixtures): Record<string, PlanGroup> {
  const consent = oauthRoute(f);
  return {
    'state-signed-in': { auth: 'qa', routes: ['/', '/access-limited', '/oauth/authorize', consent], expect: { '/': '/home', [consent]: '/oauth/authorize' } },
    'state-signed-out': { auth: 'none', routes: [consent, '/two-step', '/two-step/enroll', '/'], expect: { [consent]: '/oauth/authorize', '/two-step': '/sign-in', '/': '/sign-in' } },
    'state-no-workspace': { auth: { cookie: f.sessions.noWorkspace }, routes: ['/no-workspace'] },
    'state-second-step': { auth: { cookie: f.sessions.verify }, routes: ['/two-step'] },
    'state-enroll': { auth: { cookie: f.sessions.enroll }, routes: ['/two-step/enroll'] },
  };
}

/** Not-found and invalid-token states. The status each one must return is part of the contract. */
export function notFoundPlan(): Record<string, PlanGroup> {
  const signedIn = ['/does-not-exist', '/root/modules/missing', '/root/platforms/missing', '/root/errors/missing', '/publishing/collaboration/post/missing'];
  const anon = ['/does-not-exist', '/bio/missing-slug/view', '/share/qamatrixmissingtoken0000/view'];
  return {
    'notfound-signed-in': { auth: 'qa', routes: signedIn, expectStatus: Object.fromEntries(signedIn.map(route => [route, 404])) },
    'notfound-signed-out': { auth: 'none', routes: anon, expectStatus: Object.fromEntries(anon.map(route => [route, 404])) },
  };
}

export function buildPlan(part: Round2Part, f: Fixtures, inventory: { customer: string[]; root: string[] }): Plan {
  const sample = (routes: readonly string[]) => routes.filter(route => (SYSTEM_SAMPLE as readonly string[]).includes(route));
  const dynamic: Record<string, PlanGroup> = { 'dynamic-customer': { auth: 'qa', routes: f.dynamic.customer }, 'dynamic-root': { auth: 'qa', routes: f.dynamic.root }, 'dynamic-public': { auth: 'none', routes: f.dynamic.public } };
  switch (part) {
    case 'dynamic': return { groups: dynamic, modes: EXTENDED_MODES, excludedDynamicRoutes: [] };
    case 'states': return { groups: statePlan(f), modes: EXTENDED_MODES, excludedDynamicRoutes: [] };
    case 'notfound': return { groups: notFoundPlan(), modes: EXTENDED_MODES, excludedDynamicRoutes: [] };
    case 'empty': return { groups: { 'empty-customer': { auth: { cookie: f.sessions.empty }, routes: inventory.customer } }, modes: EXTENDED_MODES, excludedDynamicRoutes: [] };
    case 'system': return {
      groups: {
        customer: { auth: 'qa', routes: sample(inventory.customer) }, root: { auth: 'qa', routes: sample(inventory.root) }, public: { auth: 'none', routes: sample(PUBLIC_ROUTES) },
        'dynamic-customer': dynamic['dynamic-customer'], 'dynamic-root': { auth: 'qa', routes: f.dynamic.root.slice(0, 2) }, 'dynamic-public': { auth: 'none', routes: f.dynamic.public.slice(0, 2) },
        'state-signed-out': { auth: 'none', routes: [oauthRoute(f)], expect: { [oauthRoute(f)]: '/oauth/authorize' } },
      },
      modes: ROUND2_MODES, excludedDynamicRoutes: [],
    };
    default: throw new Error(`PLAN_NOT_AVAILABLE ${part}`);
  }
}

/* ----- keyboard walk ---------------------------------------------------------------------- */
export type KeyboardCell = {
  group: string; route: string; theme: string; mode: string; viewport: { width: number; height: number };
  findings: Finding[]; details: string[]; stops: number; checks: Record<string, 'passed' | 'failed' | 'Not available'>;
};
export type KeyboardReport = { version: 1; startedAt: string; finishedAt: string; browser: string; groups: Record<string, string[]>; modes: readonly string[]; expectedCells: number; cells: KeyboardCell[]; fatal: Finding[]; failures: number; passed: boolean };
export const KEYBOARD_CHECKS = ['skipLink', 'focusRing', 'noTrap', 'menu', 'select', 'tabs', 'dialog', 'formSubmit', 'mainAction'] as const;
export const TAB_WALK_LIMIT = 220;
/** Date and time inputs spend one Tab per segment (a datetime-local has five), so focus staying put that many times is not a trap. */
export const SEGMENT_TABS = 8;

export function finishKeyboard(input: Pick<KeyboardReport, 'startedAt' | 'groups' | 'modes' | 'cells' | 'fatal'> & { themes?: ThemeList; browser?: string }): KeyboardReport {
  const fatal = [...input.fatal];
  const expected = new Set<string>();
  for (const group of Object.keys(input.groups)) for (const route of input.groups[group]) for (const theme of input.themes ?? THEMES) for (const mode of input.modes) for (const v of VIEWPORTS) expected.add(`${group}|${route}|${theme.id}|${mode}|${v.width}x${v.height}`);
  const seen = new Set<string>();
  for (const cell of input.cells) {
    const key = `${cell.group}|${cell.route}|${cell.theme}|${cell.mode}|${cell.viewport.width}x${cell.viewport.height}`;
    if (!expected.has(key) || seen.has(key)) fatal.push({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    seen.add(key);
  }
  if (seen.size !== expected.size) fatal.push({ code: 'INCOMPLETE_MATRIX' });
  // Every control kind must have been exercised somewhere, otherwise "no failures" proves nothing about it.
  for (const check of ['menu', 'select', 'tabs', 'dialog', 'formSubmit', 'skipLink'] as const) {
    if (input.cells.length && !input.cells.some(cell => cell.checks[check] === 'passed')) fatal.push({ code: 'KEYBOARD_COVERAGE_MISSING', route: check });
  }
  const failures = fatal.length + input.cells.reduce((n, cell) => n + cell.findings.length, 0);
  return { ...input, fatal, version: 1, browser: input.browser ?? 'chromium', finishedAt: new Date().toISOString(), expectedCells: expected.size, failures, passed: failures === 0 };
}

type Stop = { index: number; tag: string; role: string; label: string; popup: string; expanded: string; ring: boolean; inViewport: boolean; inMain: boolean; inShell: boolean; inFilters: boolean; isSubmit: boolean; selectedTab: boolean; skip: boolean };

/** Press Tab through the page once, tagging each stop so later checks can act on it without searching the tab order again. */
async function tabWalk(page: Page, limit: number): Promise<{ stops: Stop[]; trapped: boolean; truncated: boolean }> {
  await page.evaluate(() => { document.querySelectorAll('[data-kbd-stop]').forEach(e => e.removeAttribute('data-kbd-stop')); document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
  const stops: Stop[] = [];
  let same = 0, trapped = false, truncated = true;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((index) => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body || e === document.documentElement) return null;
      if (e.hasAttribute('data-kbd-stop')) return { again: Number(e.getAttribute('data-kbd-stop')) };
      e.setAttribute('data-kbd-stop', String(index));
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(s.outlineColor);
      const name = (e.getAttribute('aria-label') || e.textContent || (e as HTMLInputElement).placeholder || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return {
        index, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', label: name, popup: e.getAttribute('aria-haspopup') || '', expanded: e.getAttribute('aria-expanded') || '',
        ring: e.matches(':focus-visible') && (outline || s.boxShadow !== 'none'), inViewport: r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
        inMain: !!e.closest('main'), inShell: !!e.closest('nav, aside, header'), inFilters: !!e.closest('#shell-filters'), isSubmit: e.matches('form button[type=submit], form input[type=submit], form button:not([type])'),
        selectedTab: e.getAttribute('role') === 'tab' && e.getAttribute('aria-selected') === 'true', skip: e.classList.contains('shell-skip-link'),
      };
    }, stops.length);
    // Focus sitting on the document (browser chrome next) is the end of the order; a page with no controls at all has no stops and cannot trap.
    if (!stop) { same++; if (same >= 4) { trapped = stops.length > 1; truncated = false; break; } continue; }
    if ('again' in stop) { truncated = false; if (stop.again === stops.length - 1) { same++; if (same >= SEGMENT_TABS) { trapped = true; break; } continue; } break; }
    same = 0; stops.push(stop);
  }
  return { stops, trapped, truncated };
}

const kbdHandle = (page: Page, stop: Stop) => page.locator(`[data-kbd-stop="${stop.index}"]`);

async function checkMenu(page: Page, stop: Stop): Promise<boolean> {
  const trigger = kbdHandle(page, stop);
  await trigger.focus(); await page.keyboard.press('Enter');
  const menu = page.locator('[role=menu]').first();
  try { await menu.waitFor({ state: 'visible', timeout: 2000 }); } catch { return false; }
  const items = menu.locator('[role=menuitem]:not([aria-disabled=true])');
  const count = await items.count();
  const active = () => page.evaluate(() => (document.activeElement?.textContent || '').trim());
  const first = await active();
  let moved = count < 2;
  if (count >= 2) { await page.keyboard.press('ArrowDown'); moved = await active() !== first; await page.keyboard.press('End'); await page.keyboard.press('Home'); }
  const expanded = await trigger.getAttribute('aria-expanded') === 'true';
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined);
  const restored = await trigger.evaluate(e => e === document.activeElement);
  return expanded && moved && restored && await menu.count() === 0;
}

async function checkSelect(page: Page, stop: Stop): Promise<boolean> {
  const trigger = kbdHandle(page, stop);
  await trigger.focus(); await page.keyboard.press('Enter');
  const list = page.locator('[role=listbox]').first();
  try { await list.waitFor({ state: 'visible', timeout: 2000 }); } catch { return false; }
  const expanded = await trigger.getAttribute('aria-expanded') === 'true';
  const marker = () => page.evaluate(() => { const a = document.activeElement; return `${a?.getAttribute('aria-activedescendant') || ''}|${a?.id || ''}|${a?.textContent?.trim().slice(0, 20) || ''}`; });
  const before = await marker();
  await page.keyboard.press('ArrowDown');
  const moved = await marker() !== before || await list.locator('[role=option]').count() < 2;
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined);
  return expanded && moved && await list.count() === 0 && await trigger.evaluate(e => e === document.activeElement);
}

async function checkTabs(page: Page, stop: Stop): Promise<boolean> {
  const tab = kbdHandle(page, stop);
  const list = tab.locator('xpath=ancestor::*[@role="tablist"][1]');
  if (await list.locator('[role=tab]:not([disabled])').count() < 2) return true; // a single tab has nothing to move to
  const url = page.url();
  await tab.focus(); await page.keyboard.press('ArrowRight');
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true');
  const changed = !await tab.evaluate(e => e === document.activeElement);
  await page.keyboard.press('ArrowLeft');
  const back = await tab.evaluate(e => e === document.activeElement && e.getAttribute('aria-selected') === 'true');
  if (page.url() !== url) await page.goto(url, { waitUntil: 'load' }).catch(() => undefined);
  return moved && changed && back;
}

/** Same open/contain/Escape/restore contract as `checkDialog`, entering with programmatic focus after the Tab walk proved reachability. */
async function checkDialogFocused(page: Page, opener: Locator, cell: Cell): Promise<boolean> {
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  try { await dialog.first().waitFor({ state: 'visible', timeout: 3000 }); } catch { return false; }
  await page.waitForTimeout(100);
  await auditControls(page, cell);
  const contained = await dialog.first().evaluate(element => element.contains(document.activeElement));
  await page.keyboard.press('Tab');
  const focus = page.locator(':focus');
  const ring = await focus.count() === 1 && await visibleFocus(focus);
  const trapped = await dialog.first().evaluate(element => element.contains(document.activeElement));
  await page.keyboard.press('Escape');
  try { await dialog.first().waitFor({ state: 'hidden', timeout: 3000 }); } catch { return false; }
  await page.waitForTimeout(100);
  return contained && ring && trapped && await opener.evaluate(element => element === document.activeElement);
}

export async function runKeyboardRound2(env: Readonly<Record<string, string | undefined>>, groupsIn: Record<string, PlanGroup>, modes: readonly string[]): Promise<KeyboardReport> {
  const startedAt = new Date().toISOString();
  const cells: KeyboardCell[] = [], fatal: Finding[] = [];
  const groups: Record<string, string[]> = Object.fromEntries(Object.entries(groupsIn).map(([name, group]) => [name, group.routes]));
  const shotsDir = resolve(env.BROWSER_MATRIX_SHOTS || join(dirname(resolve(env.BROWSER_MATRIX_REPORT || '/tmp/msp-browser-matrix.json')), 'shots'));
  let shotCount = 0;
  const themes = selectThemes(env.MATRIX_THEMES);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    phase = 'BROWSER_LAUNCH_FAILED';
    browser = await launchBrowser(env);
    const fence = async (context: BrowserContext) => { await context.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), false) ? route.continue() : route.abort('blockedbyclient')); };
    let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
    if (Object.values(groupsIn).some(group => group.auth === 'qa' && group.routes.length)) {
      if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
      phase = 'SIGN_IN_FAILED';
      storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    }
    phase = 'MATRIX_INTERRUPTED';
    for (const theme of themes) for (const mode of modes) for (const viewport of VIEWPORTS) {
      const { cookie: modeCookie, scheme } = modeSpec(mode);
      for (const [group, spec] of Object.entries(groupsIn)) {
        if (!spec.routes.length) continue;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: scheme, ...(spec.auth === 'qa' ? { storageState: storage } : {}) });
        try {
          await fence(context);
          await context.routeWebSocket('**/*', socket => socket.close());
          await context.addInitScript('window.__name = window.__name || (f => f);');
          await context.addCookies([
            { name: THEME_COOKIE, value: theme.id, url: base, sameSite: 'Lax' }, { name: MODE_COOKIE, value: modeCookie, url: base, sameSite: 'Lax' },
            ...(typeof spec.auth === 'object' ? [{ name: SESSION_COOKIE, value: spec.auth.cookie, url: base, sameSite: 'Lax' as const }] : []),
          ]);
          for (const route of spec.routes) {
            const cell: KeyboardCell = { group, route, theme: theme.id, mode, viewport, findings: [], details: [], stops: 0, checks: Object.fromEntries(KEYBOARD_CHECKS.map(check => [check, 'Not available'])) as KeyboardCell['checks'] };
            cells.push(cell);
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            const add = (finding: Finding, detail?: string) => { cell.findings.push(finding); if (detail && cell.details.length < 12) cell.details.push(detail); };
            page.on('pageerror', error => { const f = browserFinding('pageerror', 'error', error.message); if (f) add(f, `${f.code}: ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`); });
            const shim: Cell = { route, theme: theme.id, viewport, findings: [], keyboard: { mainAction: 'Not available', dialog: 'Not available' } };
            try {
              await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 60000 });
              await page.evaluate(() => document.fonts.ready.then(() => undefined));
              await page.waitForTimeout(350);
              const { stops, trapped, truncated } = await tabWalk(page, TAB_WALK_LIMIT);
              cell.stops = stops.length;
              if (truncated) cell.details.push(`tab walk stopped at ${TAB_WALK_LIMIT} stops`);
              // Focus must never be lost into a dead end.
              cell.checks.noTrap = trapped ? 'failed' : 'passed';
              if (trapped) add({ code: 'KEYBOARD_TRAP' }, `focus stopped moving after stop ${stops.length}: ${stops.slice(-2).map(s => `${s.tag}${s.role ? `[${s.role}]` : ''} "${s.label}"`).join(' -> ')}`);
              // Every stop shows a ring and is on screen.
              const noRing = stops.filter(stop => !stop.ring), offscreen = stops.filter(stop => !stop.inViewport);
              cell.checks.focusRing = stops.length ? (noRing.length || offscreen.length ? 'failed' : 'passed') : 'Not available';
              if (noRing.length) add({ code: 'FOCUS_RING_MISSING', count: noRing.length }, `FOCUS_RING_MISSING: ${noRing.slice(0, 4).map(s => `${s.tag}${s.role ? `[${s.role}]` : ''} "${s.label}"`).join(' | ')}`);
              if (offscreen.length) add({ code: 'FOCUS_OFFSCREEN', count: offscreen.length }, `FOCUS_OFFSCREEN: ${offscreen.slice(0, 4).map(s => `${s.tag} "${s.label}"`).join(' | ')}`);
              // Skip link: first stop, visible, and it moves the next Tab into main.
              if (await page.locator('.shell-skip-link').count()) {
                let ok = stops[0]?.skip === true && stops[0].ring;
                if (ok) {
                  await kbdHandle(page, stops[0]).focus(); await page.keyboard.press('Enter');
                  // Focus lands on main itself; when main has controls the next Tab enters it (an empty main has nothing to enter).
                  const landed = await page.evaluate(() => { const main = document.querySelector('main'); return !!main && (document.activeElement === main || main.contains(document.activeElement)); });
                  const tabbable = await page.locator('main :is(a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"])').count();
                  if (landed && tabbable) { await page.keyboard.press('Tab'); ok = await page.evaluate(() => !!document.activeElement?.closest('main')); } else ok = landed;
                }
                cell.checks.skipLink = ok ? 'passed' : 'failed';
                if (!ok) add({ code: 'SKIP_LINK_FAILED' }, `skip link is not the first stop or does not move focus into main; first stops: ${stops.slice(0, 3).map(s => `${s.tag}${s.role ? `[${s.role}]` : ''} "${s.label}"`).join(' -> ') || '(none)'}`);
              }
              const first = (pred: (s: Stop) => boolean) => stops.find(pred);
              const menu = first(s => s.popup === 'menu'), select = first(s => s.role === 'combobox'), tab = first(s => s.selectedTab);
              if (menu) { cell.checks.menu = await checkMenu(page, menu) ? 'passed' : 'failed'; if (cell.checks.menu === 'failed') add({ code: 'MENU_KEYBOARD_FAILED' }, `menu "${menu.label}"`); }
              if (select) { cell.checks.select = await checkSelect(page, select) ? 'passed' : 'failed'; if (cell.checks.select === 'failed') add({ code: 'SELECT_KEYBOARD_FAILED' }, `select "${select.label}"`); }
              if (tab) { cell.checks.tabs = await checkTabs(page, tab) ? 'passed' : 'failed'; if (cell.checks.tabs === 'failed') add({ code: 'TABS_KEYBOARD_FAILED' }, `tab "${tab.label}"`); }
              // Dialogs: calendar post dialogs, the phone drawer and the task editor are the safe openers (nothing is written by opening them).
              const dialogOpeners: Locator[] = [];
              const drawer = page.locator('.shell-filter-toggle');
              if (await drawer.isVisible()) dialogOpeners.push(drawer);
              const popupDialog = first(s => s.popup === 'dialog');
              if (popupDialog) dialogOpeners.push(kbdHandle(page, popupDialog));
              if (route === '/tasks') { const opener = page.getByRole('button', { name: 'New task', exact: true }); if (await opener.isVisible()) dialogOpeners.push(opener); }
              for (const opener of dialogOpeners) {
                const ok = await checkDialogFocused(page, opener, shim).catch(() => false);
                cell.checks.dialog = ok && cell.checks.dialog !== 'failed' ? 'passed' : 'failed';
                if (!ok) add({ code: 'DIALOG_KEYBOARD_FAILED' }, 'dialog did not open, trap focus, close on Escape and restore focus');
              }
              if (route === '/inbox') {
                await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press('?');
                const guide = page.getByRole('dialog');
                const opened = await guide.first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false);
                if (opened) { await page.keyboard.press('Escape'); await guide.first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined); }
                cell.checks.dialog = opened && await guide.count() === 0 && cell.checks.dialog !== 'failed' ? 'passed' : 'failed';
                if (!opened) add({ code: 'DIALOG_KEYBOARD_FAILED' }, 'inbox shortcuts guide (?) did not open');
              }
              for (const f of shim.findings) add(f, `${f.code} (dialog content)`);
              const submit = first(s => s.isSubmit);
              if (submit) cell.checks.formSubmit = submit.ring ? 'passed' : 'failed';
              if (customerRoute(route) && !route.includes('?')) {
                // The page's action may live in main or in the sidebar filter panel (empty pages keep their actions there).
                cell.checks.mainAction = stops.some(s => s.inMain || s.inFilters) || await drawer.isVisible() ? 'passed' : 'failed';
                if (cell.checks.mainAction === 'failed') add({ code: 'MAIN_ACTION_UNVERIFIED' }, 'no keyboard stop inside main or the sidebar filters, and no filter drawer');
              }
              await page.evaluate(() => document.querySelectorAll('[data-kbd-stop]').forEach(e => e.removeAttribute('data-kbd-stop')));
              if (cell.findings.length && shotCount < SCREENSHOT_LIMIT) {
                const file = `kb-${group}${route.replace(/[^A-Za-z0-9-]/g, '_')}__${theme.id}-${mode}-${viewport.width}.png`;
                await mkdir(shotsDir, { recursive: true });
                await page.screenshot({ path: join(shotsDir, file) }).then(() => { shotCount++; }).catch(() => undefined);
              }
            } catch (error) { add({ code: 'ROUTE_CHECK_FAILED' }, `ROUTE_CHECK_FAILED ${(error as Error).message.split('\n')[0].slice(0, 140)}`); }
            finally { await page.close(); }
          }
        } finally { await context.close(); }
      }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  return finishKeyboard({ startedAt, groups, modes, themes, browser: engineName(env.MATRIX_BROWSER), cells, fatal });
}

async function signIn(browser: NonNullable<Awaited<ReturnType<typeof chromium.launch>>>, base: string, email: string, password: string) {
  const auth = await browser.newContext({ serviceWorkers: 'block' });
  if (relaxSecureCookie) {
    // The sign-in form itself is covered by the public-page cells; here the session is obtained over HTTP and installed without `Secure`.
    const response = await fetch(`${base}/api/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email, password }) });
    const value = /msp_session=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
    if (!response.ok || !value) throw new Error('SIGN_IN_FAILED');
    await auth.addCookies([{ name: SESSION_COOKIE, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const state = await auth.storageState();
    await auth.close();
    return state;
  }
  let signingIn = true;
  await auth.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), signingIn) ? passRoute(route) : route.abort('blockedbyclient'));
  await auth.routeWebSocket('**/*', socket => socket.close());
  const login = await auth.newPage();
  await login.goto(`${base}/sign-in`, { waitUntil: 'load', timeout: 60000 });
  await login.locator('input[name=email]').fill(email);
  await login.locator('input[name=password]').fill(password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await login.waitForURL(`${base}/home`, { timeout: 60000 });
  await login.locator('main#main-content').waitFor();
  signingIn = false;
  const state = await auth.storageState();
  await auth.close();
  return state;
}

/* ----- injected failures ------------------------------------------------------------------ */
export const FAILURE_SCENARIOS = ['write-500', 'write-offline', 'write-401', 'read-500', 'read-offline'] as const;
export type FailureScenario = typeof FAILURE_SCENARIOS[number];
/** Planted in every injected body: if it ever reaches the screen the UI is echoing server detail. */
export const LEAK_MARKER = 'QA_LEAK_MARKER';
export const FEEDBACK_PATTERN = /could not|couldn.t|can.t|cannot|failed|try again|unable|error|offline|connection|network|went wrong|unavailable|expired|sign in|échec|échoué|réessay|erreur|connexion|n.a pas pu|impossible|indisponible|expir|reconnect|unknown|refresh|inconnu|actualis/i;
export const SUCCESS_PATTERN = /\b(saved|success|successfully|sent|created|updated|done|enregistré|envoyé|créé|succès|mis à jour)\b/i;
export const GENERIC_LEAK = /\[object Object\]|\bundefined\b|\bNaN\b|TypeError|SyntaxError|Unexpected token|ECONN|PrismaClient|node_modules/;

export type FailureObservation = { requests: number; newLive: string[]; newLines: string[]; inputsBefore: string[]; inputsAfter: string[]; pending: boolean; scopeOpen: boolean; pageText: string };
/** Pure classification so the rules are unit-tested without a browser. */
export function classifyFailure(o: FailureObservation, scenario: FailureScenario, mustStayOpen: boolean): Finding[] {
  const out: Finding[] = [];
  if (!o.requests) return out; // client validation or no request: nothing was injected, nothing to judge
  const text = [...o.newLive, ...o.newLines].join('\n');
  if (!(o.newLive.some(t => FEEDBACK_PATTERN.test(t)) || FEEDBACK_PATTERN.test(text))) out.push({ code: o.newLive.length || SUCCESS_PATTERN.test(text) ? 'FAILURE_NOT_EXPLAINED' : 'NO_FAILURE_FEEDBACK' });
  else if (scenario === 'write-401' && !/sign.?in|session|expired|log.?in|connect|reconnect/i.test(text)) out.push({ code: 'SESSION_EXPIRY_NOT_EXPLAINED' });
  if (SUCCESS_PATTERN.test(text) && !FEEDBACK_PATTERN.test(text)) out.push({ code: 'FALSE_SUCCESS' });
  if (o.pageText.includes(LEAK_MARKER) || GENERIC_LEAK.test(text)) out.push({ code: 'LEAKED_SERVER_DETAIL' });
  if (o.inputsBefore.length && o.inputsBefore.some((value, i) => value && o.inputsAfter[i] !== value)) out.push({ code: 'INPUT_LOST' });
  if (o.pending) out.push({ code: 'STUCK_PENDING' });
  if (mustStayOpen && !o.scopeOpen) out.push({ code: 'DIALOG_CLOSED_ON_FAILURE' });
  return out;
}

export type FailureCell = { route: string; theme: string; mode: string; viewport: { width: number; height: number }; scenario: FailureScenario; probes: string[]; findings: Finding[]; details: string[]; intercepted: number };
export type FailureReport = { version: 1; startedAt: string; finishedAt: string; browser: string; routes: string[]; combos: string[]; scenarios: readonly string[]; expectedCells: number; cells: FailureCell[]; fatal: Finding[]; failures: number; passed: boolean };
export function finishFailure(input: Pick<FailureReport, 'startedAt' | 'routes' | 'combos' | 'cells' | 'fatal'> & { browser?: string }): FailureReport {
  const fatal = [...input.fatal];
  const expected = new Set(input.routes.flatMap(route => input.combos.flatMap(combo => FAILURE_SCENARIOS.map(scenario => `${route}|${combo}|${scenario}`))));
  const seen = new Set<string>();
  for (const cell of input.cells) {
    const key = `${cell.route}|${cell.theme}:${cell.mode}:${cell.viewport.width}|${cell.scenario}`;
    if (!expected.has(key) || seen.has(key)) fatal.push({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    seen.add(key);
  }
  if (seen.size !== expected.size) fatal.push({ code: 'INCOMPLETE_MATRIX' });
  const failures = fatal.length + input.cells.reduce((n, cell) => n + cell.findings.length, 0);
  return { ...input, fatal, version: 1, browser: input.browser ?? 'chromium', scenarios: FAILURE_SCENARIOS, finishedAt: new Date().toISOString(), expectedCells: expected.size, failures, passed: failures === 0 };
}

const FILL: Record<string, string> = { email: 'qa-probe@example.test', password: 'QaProbe-Passw0rd!', number: '3', url: 'https://example.test/qa', tel: '5550100', search: 'qa probe' };
const OPENER_NAME = /^(new|add|create|invite|compose|nouveau|nouvelle|ajouter|créer|inviter)\b/i;

/** Page-side snapshot used before and after an injected failure. `scope` is a CSS selector (a dialog) or empty for the page. */
async function snapshot(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const root: ParentNode = sel ? document.querySelector(sel) ?? document : document;
    const shown = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const live = [...document.querySelectorAll('[role=alert], [role=status], [aria-live]:not([aria-live=off]), .ui-toast, .ui-field__error, [data-state=error]')].filter(shown).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const lines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
    const inputs = [...root.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea')].filter(shown).map(e => e.value);
    return { live, lines, inputs, scopeOpen: sel ? !!document.querySelector(sel) && shown(document.querySelector(sel)!) : true };
  }, scope);
}

async function fillScope(scope: Locator) {
  const fields = scope.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([readonly]):not(:disabled), textarea:not([readonly]):not(:disabled)');
  for (let i = 0; i < Math.min(await fields.count(), 12); i++) {
    const field = fields.nth(i);
    if (!await field.isVisible() || await field.inputValue().catch(() => 'x')) continue;
    const type = await field.getAttribute('type') || 'text';
    if (['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range'].includes(type)) continue;
    await field.fill(FILL[type] ?? 'QA failure probe').catch(() => undefined);
  }
}

export async function runFailureProbe(env: Readonly<Record<string, string | undefined>>, routes: Array<{ route: string; auth: AuthSpec }>, combos: string[]): Promise<FailureReport> {
  const startedAt = new Date().toISOString();
  const cells: FailureCell[] = [], fatal: Finding[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    phase = 'BROWSER_LAUNCH_FAILED';
    browser = await launchBrowser(env);
    let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
    if (routes.some(item => item.auth === 'qa')) {
      if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
      phase = 'SIGN_IN_FAILED';
      storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    }
    phase = 'MATRIX_INTERRUPTED';
    for (const combo of combos) {
      const [themeId, modeId, width] = combo.split(':');
      const viewport = VIEWPORTS.find(v => String(v.width) === width);
      if (!THEMES.some(t => t.id === themeId) || !['light', 'dark'].includes(modeId) || !viewport) throw new Error('FAILURE_COMBO_INVALID');
      for (const scenario of FAILURE_SCENARIOS) {
        const [kind, how] = scenario.split('-') as ['write' | 'read', string];
        for (const item of routes) {
          const context = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: modeId as 'light' | 'dark', ...(item.auth === 'qa' ? { storageState: storage } : {}) });
          const cell: FailureCell = { route: item.route, theme: themeId, mode: modeId, viewport, scenario, probes: [], findings: [], details: [], intercepted: 0 };
          cells.push(cell);
          const add = (finding: Finding, detail?: string) => { cell.findings.push(finding); if (detail && cell.details.length < 12) cell.details.push(detail); };
          try {
            await context.addInitScript('window.__name = window.__name || (f => f);');
            await context.addCookies([
              { name: THEME_COOKIE, value: themeId, url: base, sameSite: 'Lax' }, { name: MODE_COOKIE, value: modeId, url: base, sameSite: 'Lax' },
              ...(typeof item.auth === 'object' ? [{ name: SESSION_COOKIE, value: item.auth.cookie, url: base, sameSite: 'Lax' as const }] : []),
            ]);
            await context.routeWebSocket('**/*', socket => socket.close());
            // Only the injected requests are handled here: everything else keeps the loopback read-only fence.
            let counter = 0; // requests injected since the last reset
            await context.route('**/*', route => {
              const request = route.request(), url = request.url();
              let origin = ''; try { origin = new URL(url).origin; } catch { /* handled below */ }
              if (origin !== base) return route.abort('blockedbyclient');
              const write = !['GET', 'HEAD'].includes(request.method());
              const clientRead = !write && ['fetch', 'xhr'].includes(request.resourceType()) && !/[?&]_rsc=/.test(url) && request.headers()['rsc'] === undefined;
              if ((kind === 'write' && write) || (kind === 'read' && clientRead)) {
                counter++; cell.intercepted++;
                if (how === 'offline') return route.abort('internetdisconnected');
                const status = how === '401' ? 401 : 500;
                // A 401 carries the server's own curated sentence (showing it is fine); a 500 carries raw internals, which must never be shown.
                const body = status === 401 ? { error: 'Sign in again to continue.', code: 'unauthorized' } : { error: `${LEAK_MARKER} at Object.handler (/srv/app/server.js:1:1)`, code: 'internal' };
                return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
              }
              return write ? route.abort('blockedbyclient') : route.continue();
            });
            const open = async () => {
              const page = await context.newPage();
              page.setDefaultTimeout(6000);
              page.on('pageerror', error => { const f = browserFinding('pageerror', 'error', error.message); if (f) add(f, `${f.code}: ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`); });
              // The browser reports every injected failure as a console error; those are the point of the test.
              await page.goto(`${base}${item.route}`, { waitUntil: 'load', timeout: 60000 });
              await page.evaluate(() => document.fonts.ready.then(() => undefined));
              await page.waitForTimeout(500);
              return page;
            };
            if (kind === 'read') {
              const page = await open();
              try {
                counter = 0;
                await page.waitForTimeout(2500);
                const stuck = await page.evaluate(() => [...document.querySelectorAll('[aria-busy="true"], .ui-skeleton')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length);
                const blank = await page.evaluate(() => (document.querySelector('main')?.textContent || '').trim().length === 0);
                const text = await page.evaluate(() => document.body.innerText);
                cell.probes.push(`load (client reads injected: ${cell.intercepted})`);
                if (stuck) add({ code: 'STUCK_LOADING', count: stuck }, `${stuck} skeleton/busy elements still showing after 2.5 s`);
                if (blank) add({ code: 'BLANK_MAIN' }, 'main is empty');
                if (text.includes(LEAK_MARKER) || GENERIC_LEAK.test(text)) add({ code: 'LEAKED_SERVER_DETAIL' }, 'injected server detail or a raw JS value is visible');
              } finally { await page.close(); }
            } else {
              // Writes: submit up to three forms and open up to two creation dialogs, each from a fresh load.
              /** formIndex -1: the whole dialog is the scope; its submit/primary button is the action. */
              const submitForm = async (page: Page, scopeSel: string, formIndex: number, label: string, mustStayOpen: boolean) => {
                const host = scopeSel ? page.locator(scopeSel).first() : page.locator('body');
                const form = formIndex < 0 ? host : host.locator('form:not([method=get]):not([role=search])').nth(formIndex);
                if (!await form.isVisible().catch(() => false)) return;
                const button = formIndex < 0
                  ? form.locator('button[type=submit]:not(:disabled), button.ui-button--primary:not(:disabled)').last()
                  : form.locator('button[type=submit]:not(:disabled), input[type=submit]:not(:disabled), button:not([type]):not(:disabled)').first();
                if (!await button.count() || !await button.isVisible()) return;
                await fillScope(form);
                const before = await snapshot(page, scopeSel);
                counter = 0;
                await button.click({ timeout: 4000 }).catch(() => undefined);
                await page.waitForTimeout(1500);
                const settled = await button.isDisabled().catch(() => false) || await button.getAttribute('aria-busy').catch(() => null) === 'true';
                if (settled) await page.waitForTimeout(2500);
                const after = await snapshot(page, scopeSel);
                const pending = settled && (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-busy').catch(() => null) === 'true');
                const beforeLines = new Set(before.lines), beforeLive = new Set(before.live);
                const found = classifyFailure({
                  requests: counter, newLive: after.live.filter(t => !beforeLive.has(t)), newLines: after.lines.filter(l => !beforeLines.has(l)),
                  inputsBefore: before.inputs, inputsAfter: after.inputs, pending, scopeOpen: after.scopeOpen, pageText: after.lines.join('\n'),
                }, scenario, mustStayOpen);
                cell.probes.push(`${label} form #${formIndex}: ${counter} request(s) injected, ${found.length ? found.map(f => f.code).join(',') : 'handled'}`);
                const shown = [...after.live.filter(t => !beforeLive.has(t)), ...after.lines.filter(l => !beforeLines.has(l))].join(' / ').slice(0, 140);
                for (const f of found) add(f, `${f.code} in ${label} form #${formIndex}; new text: "${shown}"`);
              };
              const page = await open();
              let pageForms = 0, openers: string[] = [];
              try {
                pageForms = Math.min(3, await page.locator('form:not([method=get]):not([role=search])').count());
                const buttons = page.locator('main button:not(:disabled), main a[role=button]');
                for (let i = 0; i < Math.min(await buttons.count(), 40) && openers.length < 2; i++) {
                  const name = ((await buttons.nth(i).getAttribute('aria-label')) || (await buttons.nth(i).innerText()) || '').trim();
                  if (OPENER_NAME.test(name) && await buttons.nth(i).isVisible()) openers.push(name);
                }
              } finally { await page.close(); }
              for (let i = 0; i < pageForms; i++) { const p = await open(); try { await submitForm(p, '', i, 'page', false); } finally { await p.close(); } }
              for (const name of openers) {
                const p = await open();
                try {
                  const opener = p.locator('main').getByRole('button', { name, exact: true }).first();
                  await opener.click({ timeout: 4000 }).catch(() => undefined);
                  const dialog = p.getByRole('dialog').first();
                  if (!await dialog.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) { cell.probes.push(`opener "${name}": no dialog`); continue; }
                  const sel = 'dialog[open], [role=dialog]';
                  // Dialog actions sit in the footer beside the body's form (form="id"), so the whole dialog is the scope.
                  await submitForm(p, sel, -1, `dialog "${name}"`, true);
                } finally { await p.close(); }
              }
            }
          } catch (error) { add({ code: 'ROUTE_CHECK_FAILED' }, `ROUTE_CHECK_FAILED ${(error as Error).message.split('\n')[0].slice(0, 140)}`); }
          finally { await context.close(); }
        }
      }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  return finishFailure({ startedAt, routes: routes.map(r => r.route), combos, browser: engineName(env.MATRIX_BROWSER), cells, fatal });
}

/* ----- round 3: server-rendered failure (the database is unreachable) -------------------------- */
export const SERVER_ERROR_LOCALES = ['en', 'fr'] as const;
/** Pages that throw while the layout still renders once the operator breaks their one dependency (the `labels` table; see the matrix doc). */
export const BOUNDARY_ROUTES = ['/publishing/labels'] as const;
export const SERVER_ERROR_ROUTES = ['/home', '/publishing/posts', '/inbox', '/analytics', '/ads', '/settings/team', '/root', '/sign-in'] as const;
export type ServerErrorObservation = {
  status: number; theme: string | null; mode: string | null; wantTheme: string; wantMode: 'light' | 'dark'; locale: 'en' | 'fr';
  text: string; retryButtons: number; retryKeepsPage: boolean; backgroundLuminance: number; homeLink: boolean;
};
const SERVER_ERROR_WORDS = { en: /try again|couldn.t load|something went wrong/i, fr: /réessayer|impossible|charger|un problème/i } as const;
const SERVER_ERROR_LEAK = /digest|exception|prisma|econn|node_modules|stack|postgres|server logs|\b127\.0\.0\.1\b/i;
/** Pure so the rules are unit-tested without a browser. */
export function classifyServerError(o: ServerErrorObservation): Finding[] {
  const out: Finding[] = [];
  if (o.status < 500) out.push({ code: 'SERVER_ERROR_NOT_SIMULATED', count: o.status });
  if (o.text.replace(/\s+/g, '').length < 20) out.push({ code: 'SERVER_ERROR_BLANK_PAGE' });
  if (o.theme !== o.wantTheme || o.mode !== o.wantMode || (o.wantMode === 'dark' ? o.backgroundLuminance > 0.35 : o.backgroundLuminance < 0.6)) out.push({ code: 'SERVER_ERROR_NOT_THEMED' });
  if (!SERVER_ERROR_WORDS[o.locale].test(o.text) || (o.locale === 'fr' && SERVER_ERROR_WORDS.en.test(o.text) && !SERVER_ERROR_WORDS.fr.test(o.text))) out.push({ code: 'SERVER_ERROR_NOT_TRANSLATED' });
  if (SERVER_ERROR_LEAK.test(o.text)) out.push({ code: 'SERVER_ERROR_LEAKS_DETAIL' });
  if (o.retryButtons < 1) out.push({ code: 'SERVER_ERROR_NO_RETRY' });
  else if (!o.retryKeepsPage) out.push({ code: 'SERVER_ERROR_RETRY_BROKEN' });
  if (!o.homeLink) out.push({ code: 'SERVER_ERROR_NO_WAY_BACK' });
  return out;
}

/* ----- round 4: one page throws while the layout still renders (the page error boundary) ------- */
/** What a visitor or an attached debugger must never see: driver/SQL detail, stack frames, file paths, secrets, session cookies. */
export const BOUNDARY_LOG_LEAK = /prisma|postgres|relation "|42P01|\bat \S+ \(|\bat async\b|node_modules|\.next\/|\/srv\/|\/private\/|127\.0\.0\.1:5|DATABASE_URL|ENCRYPTION_KEY|SESSION_SECRET|msp_session|password|OperationError|upstream_failure/i;
export type BoundaryObservation = Omit<ServerErrorObservation, 'status'> & { status: number; logs: string[]; alerts: number; boundaryShown: boolean };
/** Pure so the rules are unit-tested without a browser. The status is recorded by the caller: a streamed page error legitimately answers 200. */
export function classifyBoundary(o: BoundaryObservation): Finding[] {
  if (!o.boundaryShown) return [{ code: 'BOUNDARY_NOT_SIMULATED' }];
  const out = classifyServerError({ ...o, status: 500 });
  if (/\b\d{6,12}\b/.test(o.text)) out.push({ code: 'BOUNDARY_DIGEST_ON_SCREEN' });
  if (o.alerts < 1) out.push({ code: 'BOUNDARY_NOT_ANNOUNCED' });
  if (o.logs.some(line => BOUNDARY_LOG_LEAK.test(line) || line.includes(LEAK_MARKER))) out.push({ code: 'BOUNDARY_LOGS_DETAIL' });
  return out;
}

export type ServerErrorCell = { route: string; theme: string; mode: 'light' | 'dark'; locale: 'en' | 'fr'; viewport: { width: number; height: number }; findings: Finding[]; details: string[] };
export type ServerErrorReport = { version: 1; startedAt: string; finishedAt: string; browser: string; routes: string[]; expectedCells: number; cells: ServerErrorCell[]; fatal: Finding[]; failures: number; passed: boolean };
export function finishServerError(input: Pick<ServerErrorReport, 'startedAt' | 'routes' | 'cells' | 'fatal'> & { themes?: ThemeList; browser?: string }): ServerErrorReport {
  const fatal = [...input.fatal];
  const expectedCells = input.routes.length * (input.themes ?? THEMES).length * 2 * SERVER_ERROR_LOCALES.length * VIEWPORTS.length;
  if (input.cells.length !== expectedCells) fatal.push({ code: 'INCOMPLETE_MATRIX' });
  const failures = fatal.length + input.cells.reduce((n, cell) => n + cell.findings.length, 0);
  return { version: 1, startedAt: input.startedAt, routes: input.routes, cells: input.cells, fatal, browser: input.browser ?? 'chromium', finishedAt: new Date().toISOString(), expectedCells, failures, passed: failures === 0 };
}

/** BASE_URL must be a build started with an unreachable DATABASE_URL: every render then fails, which exercises the server-side error path. */
export async function runServerError(env: Readonly<Record<string, string | undefined>>, routes: string[], boundary = false): Promise<ServerErrorReport> {
  const startedAt = new Date().toISOString();
  const cells: ServerErrorCell[] = [], fatal: Finding[] = [];
  const themes = selectThemes(env.MATRIX_THEMES);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    phase = 'BROWSER_LAUNCH_FAILED';
    browser = await launchBrowser(env);
    // Boundary mode: the layout works, so the visitor is signed in and one page fails (the operator makes it throw, see the matrix doc).
    let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
    if (boundary) {
      if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
      phase = 'SIGN_IN_FAILED';
      storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    }
    phase = 'MATRIX_INTERRUPTED';
    for (const theme of themes) for (const mode of ['light', 'dark'] as const) for (const locale of SERVER_ERROR_LOCALES) for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: mode, locale: locale === 'fr' ? 'fr-FR' : 'en-US', ...(storage ? { storageState: storage } : {}) });
      try {
        await context.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), false) ? route.continue() : route.abort('blockedbyclient'));
        await context.addInitScript('window.__name = window.__name || (f => f);');
        await context.addCookies([{ name: THEME_COOKIE, value: theme.id, url: base, sameSite: 'Lax' }, { name: MODE_COOKIE, value: mode, url: base, sameSite: 'Lax' }]);
        for (const route of routes) {
          const cell: ServerErrorCell = { route, theme: theme.id, mode, locale, viewport, findings: [], details: [] };
          cells.push(cell);
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          // Everything the browser logs while the failure happens: a customer's debugger or a support screenshot must not expose internals.
          const logs: string[] = [];
          page.on('console', message => { if (logs.length < 50) logs.push(message.text().slice(0, 400)); });
          page.on('pageerror', error => { if (logs.length < 50) logs.push(`${error.name}: ${error.message}`.slice(0, 400)); });
          try {
            const response = await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(1500); // the client renders the boundary after hydration
            const read = () => page.evaluate(() => {
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              const resolve = (el: Element) => { for (let n: Element | null = el; n; n = n.parentElement) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(n).backgroundColor; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; if (d[3] > 200) return [d[0], d[1], d[2]]; } return [255, 255, 255]; };
              const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
              const [r, g, b] = resolve(document.body);
              const root = document.documentElement;
              return {
                theme: root.getAttribute('data-theme'), mode: root.getAttribute('data-mode'), text: document.body.innerText || '',
                retryButtons: [...document.querySelectorAll('button, a')].filter(e => /try again|réessayer|retry/i.test(e.textContent || '')).length,
                alerts: document.querySelectorAll('[role=alert]').length,
                homeLink: [...document.querySelectorAll('a[href]')].some(a => ['/', '/home', '/sign-in'].includes(new URL((a as HTMLAnchorElement).href).pathname)),
                backgroundLuminance: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b),
              };
            });
            const before = await read();
            const retry = page.getByRole('button', { name: /try again|réessayer|retry/i }).first();
            let retryKeepsPage = false;
            if (await retry.count()) {
              await retry.click().catch(() => undefined);
              await page.waitForTimeout(1500);
              const after = await read();
              retryKeepsPage = after.text.replace(/\s+/g, '').length >= 20 && after.retryButtons >= 1;
            }
            const observed = { status: response?.status() ?? 0, theme: before.theme, mode: before.mode, wantTheme: theme.id, wantMode: mode, locale, text: before.text, retryButtons: before.retryButtons, retryKeepsPage, backgroundLuminance: before.backgroundLuminance, homeLink: before.homeLink };
            const found = boundary
              ? classifyBoundary({ ...observed, logs, alerts: before.alerts, boundaryShown: before.retryButtons > 0 && before.alerts > 0 })
              : classifyServerError(observed);
            for (const f of found) { cell.findings.push(f); }
            if (found.length) cell.details.push(`status ${response?.status()} theme=${before.theme} mode=${before.mode} lum=${before.backgroundLuminance.toFixed(2)} text="${before.text.replace(/\s+/g, ' ').slice(0, 120)}"`);
            const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
            if (overflow > 1) cell.findings.push({ code: 'HORIZONTAL_OVERFLOW', count: overflow });
            const contrast = await contrastAudit(page);
            if (contrast.failures.length) { cell.findings.push({ code: 'CONTRAST_LOW', count: contrast.failures.length }); cell.details.push(...contrast.failures.slice(0, 2).map(f => `CONTRAST ${f.ratio}:1 "${f.text}"`)); }
            if (env.MATRIX_SHOT && env.BROWSER_MATRIX_SHOTS) {
              await mkdir(env.BROWSER_MATRIX_SHOTS, { recursive: true });
              await page.screenshot({ path: join(env.BROWSER_MATRIX_SHOTS, `${boundary ? 'boundary' : 'servererror'}-${engineName(env.MATRIX_BROWSER)}-${theme.id}-${mode}-${locale}-${viewport.width}.png`) });
            }
          } catch (error) { cell.findings.push({ code: 'ROUTE_CHECK_FAILED' }); cell.details.push((error as Error).message.split('\n')[0].slice(0, 140)); }
          finally { await page.close(); }
        }
      } finally { await context.close(); }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  return finishServerError({ startedAt, routes, cells, fatal, themes, browser: engineName(env.MATRIX_BROWSER) });
}

/**
 * "Try again" must really ask the server again. The operator restores the broken dependency and creates BOUNDARY_RECOVERY_FILE
 * while this waits (the harness itself never changes server state); the retry must then show the page, not the boundary again.
 */
export async function runBoundaryRecovery(env: Readonly<Record<string, string | undefined>>, route: string): Promise<ServerErrorReport> {
  const startedAt = new Date().toISOString();
  const cell: ServerErrorCell = { route, theme: 'vivid', mode: 'light', locale: 'en', viewport: VIEWPORTS[0], findings: [], details: [] };
  const fatal: Finding[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  try {
    const base = guardBaseUrl(env.BASE_URL);
    if (!env.QA_EMAIL || !env.QA_PASSWORD || !env.BOUNDARY_RECOVERY_FILE) throw new Error('QA_CREDENTIALS_REQUIRED');
    browser = await launchBrowser(env);
    phase = 'SIGN_IN_FAILED';
    const storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    phase = 'MATRIX_INTERRUPTED';
    const context = await browser.newContext({ viewport: cell.viewport, serviceWorkers: 'block', storageState: storage });
    try {
      await context.route('**/*', handler => allowRequest(handler.request().url(), base, handler.request().method(), false) ? handler.continue() : handler.abort('blockedbyclient'));
      await context.addInitScript('window.__name = window.__name || (f => f);');
      await context.addCookies([{ name: THEME_COOKIE, value: 'vivid', url: base, sameSite: 'Lax' }, { name: MODE_COOKIE, value: 'light', url: base, sameSite: 'Lax' }]);
      const page = await context.newPage();
      await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 60000 });
      const retry = page.getByRole('button', { name: /try again|réessayer/i }).first();
      await retry.waitFor({ state: 'visible', timeout: 10000 });
      console.log('BOUNDARY_RECOVERY_WAITING');
      for (let i = 0; i < 180 && !existsSync(env.BOUNDARY_RECOVERY_FILE); i++) await new Promise(done => setTimeout(done, 1000));
      await retry.click();
      const gone = await retry.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
      if (!gone) { cell.findings.push({ code: 'BOUNDARY_RETRY_DID_NOT_RECOVER' }); cell.details.push(`still showing the error after retry: "${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 100)}"`); }
    } finally { await context.close(); }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  const failures = fatal.length + cell.findings.length;
  return { version: 1, startedAt, finishedAt: new Date().toISOString(), browser: engineName(env.MATRIX_BROWSER), routes: [route], expectedCells: 1, cells: [cell], fatal, failures, passed: failures === 0 };
}

/** Round 5 fixes check pages that show uploaded media. A stored file that is gone must show the "Image unavailable" placeholder, never the browser's broken-image icon. */
export const MEDIA_ROUTES = ['/publishing/posts', '/publishing/queue', '/publishing/approvals', '/publishing/calendar'] as const;
export const SAVED_VIEW_ROUTE = '/publishing/posts';

export type MediaObservation = { images: number; broken: number; placeholders: number };
/** Pure classification: a broken image is a defect; placeholders are the expected state for missing files. */
export function classifyMedia(observed: MediaObservation): Finding[] {
  return observed.broken > 0 ? [{ code: 'BROKEN_IMAGE_VISIBLE', count: observed.broken }] : [];
}
/** An expired session is a sign-in problem, not a naming or generic save failure: the alert must offer a way to sign in again or say the session ended. */
export function classifySavedViewFeedback(text: string | null): Finding[] {
  if (text === null) return [{ code: 'SAVED_VIEW_NO_FEEDBACK' }];
  return /session|sign.?in|log.?in|connexion/i.test(text) ? [] : [{ code: 'SAVED_VIEW_SESSION_NOT_EXPLAINED' }];
}

export async function runRound5Fixes(env: Readonly<Record<string, string | undefined>>): Promise<MatrixReport> {
  const startedAt = new Date().toISOString();
  const cells: Cell[] = [], fatal: Finding[] = [];
  const themes = selectThemes(env.MATRIX_THEMES);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'CONFIGURATION_FAILED';
  const routes = [...MEDIA_ROUTES];
  try {
    const base = guardBaseUrl(env.BASE_URL);
    if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_CREDENTIALS_REQUIRED');
    browser = await launchBrowser(env);
    phase = 'SIGN_IN_FAILED';
    const storage = await signIn(browser, base, env.QA_EMAIL, env.QA_PASSWORD);
    phase = 'MATRIX_INTERRUPTED';
    for (const theme of themes) for (const mode of ['light', 'dark'] as const) for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: mode, storageState: storage });
      try {
        // Reads only. The saved-view POST is allowed through because the session cookie has been removed first, so the server must refuse it.
        await context.route('**/*', route => {
          const request = route.request();
          const savedViewPost = request.method() === 'POST' && new URL(request.url()).pathname === '/api/publishing/saved-views';
          return savedViewPost || allowRequest(request.url(), base, request.method(), false) ? route.continue() : route.abort('blockedbyclient');
        });
        await context.addInitScript('window.__name = window.__name || (f => f);');
        await context.addCookies([{ name: THEME_COOKIE, value: theme.id, url: base, sameSite: 'Lax' }, { name: MODE_COOKIE, value: mode, url: base, sameSite: 'Lax' }]);
        for (const route of routes) {
          const cell: Cell = { route, theme: theme.id, viewport, findings: [], keyboard: { mainAction: 'Not available', dialog: 'Not available' } };
          cells.push(cell);
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          try {
            await page.goto(`${base}${route}`, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(1500); // images settle and onError handlers swap in the placeholder
            const observed = await page.evaluate(() => {
              const images = [...document.querySelectorAll('img')].filter(img => img.getClientRects().length > 0);
              return { images: images.length, broken: images.filter(img => img.complete && img.naturalWidth === 0).length, placeholders: document.querySelectorAll('[data-media-missing]').length };
            });
            cell.findings.push(...classifyMedia(observed));
            if (route === '/publishing/calendar') {
              const contrast = await contrastAudit(page);
              if (contrast.failures.length) cell.findings.push({ code: 'CONTRAST_LOW', count: contrast.failures.length });
            }
          } catch { cell.findings.push({ code: 'ROUTE_CHECK_FAILED' }); }
          finally { await page.close(); }
        }
        // Saved views: expire the session, then save. Filters live in the sidebar on desktop; phones are verified with the drawer closed (not applicable).
        if (viewport.width >= 1024) {
          const cell: Cell = { route: SAVED_VIEW_ROUTE, theme: theme.id, viewport, findings: [], keyboard: { mainAction: 'Not available', dialog: 'Not available' } };
          cells.push(cell);
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          try {
            await page.goto(`${base}${SAVED_VIEW_ROUTE}?status=published`, { waitUntil: 'load', timeout: 60000 });
            const name = page.locator('input[id$="-name"]').first();
            await name.waitFor({ state: 'visible' });
            await name.fill('Round five check');
            await context.clearCookies({ name: SESSION_COOKIE });
            await name.locator('xpath=ancestor::form').locator('button[type=submit]').click();
            const alert = page.locator('section[aria-labelledby$="-heading"] [role=alert]').first();
            const text = await alert.waitFor({ state: 'visible', timeout: 8000 }).then(() => alert.innerText(), () => null);
            cell.findings.push(...classifySavedViewFeedback(text));
          } catch { cell.findings.push({ code: 'ROUTE_CHECK_FAILED' }); }
          finally { await page.close(); }
        }
      } finally { await context.close(); }
    }
  } catch { fatal.push({ code: phase }); }
  finally { if (browser) await browser.close().catch(() => { fatal.push({ code: 'BROWSER_CLOSE_FAILED' }); }); }
  const failures = fatal.length + cells.reduce((n, cell) => n + cell.findings.length, 0);
  const expectedCells = themes.length * 2 * (routes.length * 2 + 1);
  return { version: 1, startedAt, finishedAt: new Date().toISOString(), browser: engineName(env.MATRIX_BROWSER), routes: [...routes, SAVED_VIEW_ROUTE], excludedDynamicRoutes: [], expectedCells, cells, fatal, failures, passed: failures === 0 && cells.length === expectedCells };
}

/** Optional: QA_CREDENTIALS_FILE points at a local JSON {email,password}, keeping secrets out of shell history. */
function loadCredentialsFile() {
  const file = process.env.QA_CREDENTIALS_FILE;
  if (!file || (process.env.QA_EMAIL && process.env.QA_PASSWORD)) return;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { email?: string; password?: string };
  process.env.QA_EMAIL ||= parsed.email; process.env.QA_PASSWORD ||= parsed.password;
}

/** `BROWSER_MATRIX_SCOPE=round2:<part>`; MATRIX_GROUPS / MATRIX_ONLY narrow a run so parts can be split across processes (the report then covers only what it names). */
async function mainRound2(part: Round2Part, output: string) {
  const fixtures = parseFixtures(JSON.parse(readFileSync(process.env.MATRIX_FIXTURES || '', 'utf8')));
  const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
  const inventory = { customer: discoverRoutes(appDir).routes, root: discoverRootRoutes(appDir).routes };
  const wantGroups = process.env.MATRIX_GROUPS?.split(',').filter(Boolean), only = process.env.MATRIX_ONLY?.split(',').filter(Boolean);
  const narrow = (groups: Record<string, PlanGroup>): Record<string, PlanGroup> => Object.fromEntries(Object.entries(groups)
    .filter(([name]) => !wantGroups || wantGroups.includes(name))
    .map(([name, group]) => [name, { ...group, routes: only ? group.routes.filter(route => only.some(prefix => route.startsWith(prefix))) : group.routes }]));
  if (part === 'keyboard') {
    const groups = narrow({
      'keyboard-customer': { auth: 'qa', routes: inventory.customer }, 'keyboard-root': { auth: 'qa', routes: inventory.root }, 'keyboard-public': { auth: 'none', routes: [...PUBLIC_ROUTES] },
      ...Object.fromEntries(Object.entries(buildPlan('dynamic', fixtures, inventory).groups)), ...statePlan(fixtures),
    });
    const report = await runKeyboardRound2(process.env, groups, EXTENDED_MODES);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Round 2 keyboard: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  if (part === 'failure') {
    const combos = (process.env.FAILURE_COMBOS || 'meta:dark:1440,warm:light:390').split(',').filter(Boolean);
    const keep = (route: string) => !only || only.some(prefix => route.startsWith(prefix));
    const routes = [...inventory.customer.map(route => ({ route, auth: 'qa' as const })), ...inventory.root.map(route => ({ route, auth: 'qa' as const })), ...PUBLIC_ROUTES.map(route => ({ route: route as string, auth: 'none' as const })),
      { route: '/two-step', auth: { cookie: fixtures.sessions.verify } }, { route: '/two-step/enroll', auth: { cookie: fixtures.sessions.enroll } }].filter(item => keep(item.route));
    const report = await runFailureProbe(process.env, routes, combos);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Round 2 failure states: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const plan = buildPlan(part, fixtures, inventory);
  plan.groups = narrow(plan.groups);
  const report = await runPlan(process.env, plan);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Round 2 ${part}: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
  process.exitCode = report.passed ? 0 : 1;
}

/** `tsx scripts/verify-browser-matrix.ts run.json`: a local JSON object of environment settings (BASE_URL, MATRIX_FIXTURES, ...); real environment wins. */
function loadConfigArgument() {
  const file = process.argv[2];
  if (!file || !file.endsWith('.json')) return;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  // Later KEY=value arguments override the file, so one settings file serves every engine and part.
  for (const arg of process.argv.slice(3)) { const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(arg); if (match) process.env[match[1]] = match[2]; }
  for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(key)) process.env[key] ||= value;
}

/** `tsx scripts/verify-browser-matrix.ts summary report.json`: findings grouped by code, then by route + first detail line. */
export function summarizeReport(report: { cells: Array<{ route: string; findings: Finding[]; details?: string[]; theme?: string; mode?: string; viewport: { width: number } }>; fatal?: Finding[] }): string[] {
  const byCode = new Map<string, number>(), byKey = new Map<string, { count: number; cells: Set<string>; detail: string }>();
  for (const cell of report.cells) {
    for (const f of cell.findings) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    for (const detail of cell.details ?? []) {
      const code = /^[A-Z_]+/.exec(detail)?.[0] ?? 'DETAIL';
      const key = `${code} ${cell.route} ${detail.replace(/^[A-Z_]+:? ?/, '').replace(/\d+(\.\d+)?/g, '#').slice(0, 90)}`;
      const entry = byKey.get(key) ?? { count: 0, cells: new Set<string>(), detail: `${cell.route} ${detail}` };
      entry.count++; entry.cells.add(`${cell.theme ?? ''}/${cell.mode ?? ''}/${cell.viewport.width}`);
      byKey.set(key, entry);
    }
  }
  return [`fatal: ${(report.fatal ?? []).map(f => f.code).join(',') || 'none'}`, ...[...byCode].map(([code, n]) => `${code}: ${n}`), '--',
    ...[...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 40).map(e => `${e.count}x [${[...e.cells].slice(0, 4).join(' ')}${e.cells.size > 4 ? ' …' : ''}] ${e.detail.slice(0, 200)}`)];
}

async function main() {
  if (process.argv[2] === 'summary' && process.argv[3]) {
    console.log(summarizeReport(JSON.parse(readFileSync(process.argv[3], 'utf8'))).join('\n'));
    return;
  }
  loadConfigArgument();
  loadCredentialsFile();
  const output = resolve(process.env.BROWSER_MATRIX_REPORT || '/tmp/msp-browser-matrix.json');
  await mkdir(dirname(output), { recursive: true });
  if (process.env.BROWSER_MATRIX_SCOPE === 'round5:fixes') {
    const report = await runRound5Fixes(process.env);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Round 5 fixes: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const round4 = /^round4:(boundary|recovery)$/.exec(process.env.BROWSER_MATRIX_SCOPE || '');
  if (round4) {
    const only = process.env.MATRIX_ONLY?.split(',').filter(Boolean);
    const routes = only?.length ? only : [...BOUNDARY_ROUTES];
    const report = round4[1] === 'boundary' ? await runServerError(process.env, routes, true) : await runBoundaryRecovery(process.env, routes[0]);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Round 4 ${round4[1]}: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const round3 = /^round3:(system|servererror|notfound)$/.exec(process.env.BROWSER_MATRIX_SCOPE || '');
  if (round3) {
    const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
    const only = process.env.MATRIX_ONLY?.split(',').filter(Boolean);
    const pick = (routes: readonly string[]) => (only ? routes.filter(route => only.some(prefix => route.startsWith(prefix))) : [...routes]);
    if (round3[1] === 'servererror') {
      const report = await runServerError(process.env, pick(SERVER_ERROR_ROUTES));
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      console.log(`Round 3 server error: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
      process.exitCode = report.passed ? 0 : 1;
      return;
    }
    if (round3[1] === 'notfound') {
      // Unknown routes need no fixture ids: signed in and signed out, status 404 required.
      const plan: Plan = { groups: { 'notfound-signed-in': { auth: 'qa', routes: ['/does-not-exist'], expectStatus: { '/does-not-exist': 404 } }, 'notfound-signed-out': { auth: 'none', routes: ['/does-not-exist'], expectStatus: { '/does-not-exist': 404 } } }, modes: ROUND2_MODES, excludedDynamicRoutes: [] };
      const report = await runPlan(process.env, plan);
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      console.log(`Round 3 not found: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
      process.exitCode = report.passed ? 0 : 1;
      return;
    }
    // System mode on every customer, Root and public page (round 2 compared a 22-page sample).
    const plan: Plan = {
      groups: { customer: { auth: 'qa', routes: pick(discoverRoutes(appDir).routes) }, root: { auth: 'qa', routes: pick(discoverRootRoutes(appDir).routes) }, public: { auth: 'none', routes: pick(PUBLIC_ROUTES) } },
      modes: ROUND2_MODES, excludedDynamicRoutes: [],
    };
    const report = await runPlan(process.env, plan);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Round 3 system: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const round2 = /^round2:(dynamic|states|system|empty|notfound|keyboard|failure)$/.exec(process.env.BROWSER_MATRIX_SCOPE || '');
  if (round2) return mainRound2(round2[1] as Round2Part, output);
  if (process.env.BROWSER_MATRIX_SCOPE === 'customer') {
    const report = await runMatrix();
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Browser matrix: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const report = await runExtendedMatrix();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Extended browser matrix: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => { console.error('Browser matrix could not write its report.'); process.exitCode = 1; });
}
