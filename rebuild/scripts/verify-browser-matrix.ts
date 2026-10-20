/** Read-only customer browser gate. Never prints credentials or browser payloads. */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';
import { THEME_COOKIE, THEMES } from '../src/lib/themes';

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
  version: 1; startedAt: string; finishedAt: string; browser: 'chromium';
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
    browser = await chromium.launch({ headless: true });
    const auth = await browser.newContext({ serviceWorkers: 'block' });
    let signingIn = true;
    const fence = async (context: typeof auth, authPhase: () => boolean) => {
      await context.route('**/*', route => allowRequest(route.request().url(), base, route.request().method(), authPhase()) ? route.continue() : route.abort('blockedbyclient'));
    };
    await fence(auth, () => signingIn);
    // No WebSocket endpoint is required for a built QA preview.
    await auth.routeWebSocket('**/*', socket => socket.close());
    phase = 'SIGN_IN_FAILED';
    const login = await auth.newPage();
    login.on('console', message => { const finding = browserFinding('console', message.type(), message.text()); if (finding) fatal.push(finding); });
    login.on('pageerror', error => { const finding = browserFinding('pageerror', 'error', error.message); if (finding) fatal.push(finding); });
    await login.goto(`${base}/sign-in`, { waitUntil: 'networkidle', timeout: 30000 });
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
            const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
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

async function main() {
  const report = await runMatrix();
  const output = resolve(process.env.BROWSER_MATRIX_REPORT || '/tmp/msp-browser-matrix.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Browser matrix: ${report.passed ? 'PASS' : 'FAIL'}; ${report.cells.length}/${report.expectedCells} cells; ${report.failures} findings. Report written.`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => { console.error('Browser matrix could not write its report.'); process.exitCode = 1; });
}
