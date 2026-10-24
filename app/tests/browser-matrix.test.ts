import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { THEMES } from '../src/lib/themes';
import { allowRequest, browserFinding, customerRoute, MENU_DRAWER_TOGGLE_SELECTOR, MAIN_ACTION_SELECTORS, discoverRootRoutes, discoverRoutes, FAMILIES, finishReport, finishV2, guardBaseUrl, runMatrix, runV2Matrix, V2_FAMILIES, V2_LOCALES, V2_MODES, V2_PLAYWRIGHT_LOCALE, v2Area, v2Route, VIEWPORTS, type Cell, type V2Cell } from '../scripts/verify-browser-matrix';

function complete() {
  const routes = [...FAMILIES];
  const cells: Cell[] = routes.flatMap(route => THEMES.flatMap(theme => VIEWPORTS.map(viewport => ({
    route, theme: theme.id, viewport, findings: [], keyboard: { mainAction: 'passed' as const, dialog: route === '/tasks' ? 'passed' as const : 'Not available' as const },
  }))));
  return { startedAt: '2026-10-20T00:00:00.000Z', routes, excludedDynamicRoutes: [], cells, fatal: [] };
}

describe('browser matrix loopback and write guards', () => {
  it.each(['http://localhost:3200', 'http://127.0.0.1:3200/', 'https://[::1]:3200'])('accepts loopback origin %s', value => {
    expect(guardBaseUrl(value)).toBe(new URL(value).origin);
  });
  it.each([undefined, '', 'bad', 'https://example.com', 'http://localhost.example.com', 'http://localhost@evil.test', 'http://user:secret@localhost', 'file:///tmp/app', 'http://0.0.0.0:3200', 'http://192.168.1.2', 'http://localhost/home', 'http://localhost/?token=private', 'http://localhost/#secret'])('rejects unsafe origin without reflecting it', value => {
    try { guardBaseUrl(value); throw new Error('unexpected pass'); }
    catch (error) { expect((error as Error).message).toMatch(/^BASE_URL_/); }
  });
  it('blocks remote requests, cross-port redirects and writes after login', () => {
    const base = 'http://localhost:3200';
    expect(allowRequest(`${base}/home`, base, 'GET', false)).toBe(true);
    expect(allowRequest(`${base}/api/auth/sign-in`, base, 'POST', true)).toBe(true);
    for (const [url, method, signingIn] of [
      ['https://example.com', 'GET', true], ['http://localhost:3201', 'GET', false],
      [`${base}/api/auth/sign-in`, 'POST', false], [`${base}/api/posts`, 'POST', true],
      [`${base}/api/posts`, 'DELETE', false], [`${base}/api/posts`, 'PUT', false], ['bad', 'GET', false],
    ] as const) expect(allowRequest(url, base, method, signingIn)).toBe(false);
  });
  it('does not launch a browser when configuration or credentials are missing', async () => {
    const launch = vi.spyOn(chromium, 'launch');
    try {
      const report = await runMatrix({ BASE_URL: 'https://private.test', QA_EMAIL: 'private-email', QA_PASSWORD: 'private-password' });
      expect(report.passed).toBe(false);
      expect(JSON.stringify(report)).not.toMatch(/private-(email|password)|private.test/);
      expect((await runMatrix({ BASE_URL: 'http://127.0.0.1:3200' })).fatal).toContainEqual({ code: 'CONFIGURATION_FAILED' });
      expect(launch).not.toHaveBeenCalled();
    } finally { launch.mockRestore(); }
  });
});

describe('browser matrix report', () => {
  it('passes only a complete four-theme two-viewport matrix with keyboard evidence', () => {
    const report = finishReport(complete());
    expect(report.passed).toBe(true);
    // Nine route families (Create is its own family; Ads has its own area since design v2) × four themes × two viewports.
    expect(report.expectedCells).toBe(72);
    expect(report.cells).toHaveLength(72);
    expect(report.failures).toBe(0);
    expect(report.finishedAt).toMatch(/^\d{4}-/);
  });
  it('fails on every class of browser finding', () => {
    for (const code of ['CONSOLE_ERROR', 'PAGE_ERROR', 'HYDRATION_WARNING', 'HORIZONTAL_OVERFLOW', 'ACCESSIBLE_NAME_MISSING', 'HTTP_FAILURE', 'UNEXPECTED_REDIRECT', 'THEME_NOT_APPLIED', 'ROUTE_CHECK_FAILED']) {
      const input = complete(); input.cells[0].findings.push({ code });
      expect(finishReport(input)).toMatchObject({ passed: false, failures: 1 });
    }
  });
  it('refuses missing cells and duplicate substitution', () => {
    const input = complete(); input.cells.pop();
    expect(finishReport(input).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
    input.cells.push(input.cells[0]);
    expect(finishReport(input).fatal).toContainEqual({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    expect(finishReport(input).passed).toBe(false);
  });
  it('rejects duplicate inventory entries even with unique cells', () => {
    const input = complete(); input.routes.push(input.routes[0]);
    expect(finishReport(input).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
  });
  it('refuses wrong heights, unexpected themes and route family gaps', () => {
    const input = complete(); input.cells[0] = { ...input.cells[0], viewport: { width: 1440, height: 950 }, theme: 'other' };
    expect(finishReport(input).passed).toBe(false);
    input.routes = input.routes.filter(route => route !== '/tasks');
    expect(finishReport(input).fatal).toContainEqual({ code: 'MISSING_ROUTE_FAMILY', route: '/tasks' });
  });
  it('does not treat missing keyboard data as success or zero', () => {
    const input = complete(); input.cells[0].keyboard.mainAction = 'Not available';
    expect(finishReport(input).cells[0].findings).toContainEqual({ code: 'MAIN_ACTION_UNVERIFIED' });
    for (const cell of input.cells) cell.keyboard.dialog = 'Not available';
    expect(finishReport(input).fatal.filter(f => f.code === 'DIALOG_COVERAGE_MISSING')).toHaveLength(8);
    input.cells[1].keyboard.dialog = 'failed';
    expect(finishReport(input).cells[1].findings).toContainEqual({ code: 'DIALOG_KEYBOARD_FAILED' });
  });
  it('preserves fatal failures and does not mutate report inputs', () => {
    const input = complete(); input.cells[0].keyboard.mainAction = 'failed';
    const before = JSON.stringify(input);
    expect(finishReport({ ...input, fatal: [{ code: 'BROWSER_LAUNCH_FAILED' }] }).passed).toBe(false);
    finishReport(input); expect(JSON.stringify(input)).toBe(before);
  });
  it('records dynamic exclusions and discovers current static pages', () => {
    const inventory = discoverRoutes(fileURLToPath(new URL('../src/app', import.meta.url)));
    for (const route of ['/home', '/create', '/content/calendar', '/content/library/templates', '/inbox/rules', '/insights/reports', '/ads/campaigns', '/settings/account/appearance', '/tasks', '/agency/clients']) expect(inventory.routes).toContain(route);
    expect(inventory.excludedDynamicRoutes).toContain('/content/post/[postId]');
    expect(inventory.routes.some(route => route.startsWith('/root') || route.includes('['))).toBe(false);
    expect(customerRoute('/settings-evil')).toBe(false);
    expect(customerRoute('/sign-in')).toBe(false);
  });
});

describe('main action discovery', () => {
  it('finds the page action in-page and checks the phone navigation drawer separately', () => {
    expect(MAIN_ACTION_SELECTORS).toEqual(['main .ui-button--primary:not(:disabled)', 'main button:not(:disabled)', 'main a[href]', 'main select:not(:disabled)', 'main input:not([type=hidden]):not(:disabled)', 'main textarea:not(:disabled)']);
    expect(MENU_DRAWER_TOGGLE_SELECTOR).toBe('.shell-menu-toggle');
  });
  it('still reports a page with no verified main action', () => {
    const input = complete(); input.cells[1].keyboard.mainAction = 'Not available';
    expect(finishReport(input).cells[1].findings).toContainEqual({ code: 'MAIN_ACTION_UNVERIFIED' });
  });
});

describe('design v2 area matrix', () => {
  const clean = THEMES.filter(theme => theme.id === 'clean');
  const families = [...V2_FAMILIES, '/root'];
  function completeV2() {
    const cells: V2Cell[] = families.flatMap(route => clean.flatMap(theme => V2_MODES.flatMap(mode => V2_LOCALES.flatMap(locale => VIEWPORTS.map(viewport => ({
      route, area: v2Area(route), theme: theme.id, mode, locale, viewport, findings: [], details: [], contrastSampled: 10,
      keyboard: { mainAction: 'passed' as const, dialog: (viewport.width < 1024 ? 'passed' : 'Not available') as 'passed' | 'Not available' },
    }))))));
    return { startedAt: '2026-10-22T00:00:00.000Z', routes: families, excludedDynamicRoutes: ['/content/post/[postId]'], cells, fatal: [] };
  }
  it('covers the eight v2 areas, each in light/dark, phone/desktop and EN/FR, with keyboard evidence', () => {
    expect(V2_MODES).toEqual(['light', 'dark']);
    expect(V2_LOCALES).toEqual(['en', 'fr']);
    expect(V2_PLAYWRIGHT_LOCALE).toEqual({ en: 'en-US', fr: 'fr-FR' });
    const report = finishV2({ ...completeV2(), themes: clean });
    expect(report.passed).toBe(true);
    // Eight areas × Clean × two modes × two locales × two viewports.
    expect(report.expectedCells).toBe(64);
    expect(report.cells).toHaveLength(64);
    expect(report.failures).toBe(0);
  });
  it('classifies v2 routes and areas without matching evil prefixes', () => {
    for (const [route, area] of [['/home', 'Home'], ['/create', 'Create'], ['/content/calendar', 'Content'], ['/inbox/rules', 'Inbox'], ['/insights/compare', 'Insights'], ['/ads/campaigns', 'Ads'], ['/settings/team', 'Settings'], ['/root', 'Root'], ['/root/config', 'Root']] as const) {
      expect(v2Route(route)).toBe(true);
      expect(v2Area(route)).toBe(area);
    }
    for (const route of ['/settings-evil', '/rootx', '/tasks', '/agency', '/agency/clients', '/sign-in', '/home2', '/']) {
      expect(v2Route(route)).toBe(false);
      expect(v2Area(route)).toBe('other');
    }
  });
  it('discovers the current v2 inventory: customer areas plus Root, tasks and agency excluded', () => {
    const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
    const routes = [...discoverRoutes(appDir).routes.filter(v2Route), ...discoverRootRoutes(appDir).routes];
    for (const route of ['/home', '/create', '/content', '/inbox', '/insights', '/ads', '/settings/account', '/root']) expect(routes).toContain(route);
    expect(routes.some(route => route.startsWith('/tasks') || route.startsWith('/agency'))).toBe(false);
    expect(routes.length).toBeGreaterThan(60);
  });
  it('fails on every v2 finding class', () => {
    for (const code of ['CONSOLE_ERROR', 'PAGE_ERROR', 'HYDRATION_WARNING', 'HORIZONTAL_OVERFLOW', 'ACCESSIBLE_NAME_MISSING', 'HTTP_FAILURE', 'UNEXPECTED_REDIRECT', 'THEME_NOT_APPLIED', 'MODE_NOT_APPLIED', 'LOCALE_NOT_APPLIED', 'CONTRAST_LOW', 'REQUEST_FAILED', 'ROUTE_CHECK_FAILED']) {
      const input = completeV2(); input.cells[0].findings.push({ code });
      expect(finishV2({ ...input, themes: clean })).toMatchObject({ passed: false, failures: 1 });
    }
  });
  it('refuses missing cells, duplicate substitution and area gaps', () => {
    const input = completeV2(); input.cells.pop();
    expect(finishV2({ ...input, themes: clean }).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
    input.cells.push(input.cells[0]);
    const duped = finishV2({ ...input, themes: clean });
    expect(duped.fatal).toContainEqual({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
    expect(duped.passed).toBe(false);
    expect(finishV2({ ...completeV2(), routes: families.filter(route => route !== '/root'), themes: clean }).fatal).toContainEqual({ code: 'MISSING_ROUTE_FAMILY', route: '/root' });
  });
  it('requires a Tab walk on every cell and a phone drawer dialog per theme, mode and locale', () => {
    const input = completeV2(); input.cells[0].keyboard.mainAction = 'Not available';
    expect(finishV2({ ...input, themes: clean }).cells[0].findings).toContainEqual({ code: 'MAIN_ACTION_UNVERIFIED' });
    input.cells[1].keyboard.dialog = 'failed';
    expect(finishV2({ ...input, themes: clean }).cells[1].findings).toContainEqual({ code: 'DIALOG_KEYBOARD_FAILED' });
    for (const cell of input.cells) cell.keyboard.dialog = 'Not available';
    // One theme × two modes × two locales of phone dialog coverage.
    expect(finishV2({ ...input, themes: clean }).fatal.filter(f => f.code === 'DIALOG_COVERAGE_MISSING')).toHaveLength(4);
  });
  it('preserves fatal failures and does not mutate report inputs', () => {
    const input = completeV2();
    const before = JSON.stringify(input);
    expect(finishV2({ ...input, fatal: [{ code: 'SIGN_IN_FAILED' }], themes: clean }).passed).toBe(false);
    finishV2({ ...input, themes: clean }); expect(JSON.stringify(input)).toBe(before);
  });
  it('does not launch a browser when configuration or credentials are missing', async () => {
    const launch = vi.spyOn(chromium, 'launch');
    try {
      const report = await runV2Matrix({ BASE_URL: 'https://private.test', QA_EMAIL: 'private-email', QA_PASSWORD: 'private-password' });
      expect(report.passed).toBe(false);
      expect(JSON.stringify(report)).not.toMatch(/private-(email|password)|private.test/);
      expect((await runV2Matrix({ BASE_URL: 'http://127.0.0.1:3200' })).fatal).toContainEqual({ code: 'CONFIGURATION_FAILED' });
      expect(launch).not.toHaveBeenCalled();
    } finally { launch.mockRestore(); }
  });
});

describe('private browser error classification', () => {
  it.each(['Hydration failed for private@example.test', 'Warning: Text content did not match secret', 'Minified React error #418; private'])('captures hydration warnings without payloads', message => {
    expect(browserFinding('console', 'warning', message)).toMatchObject({ code: 'HYDRATION_WARNING', fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/) });
    expect(JSON.stringify(browserFinding('console', 'warning', message))).not.toContain(message);
  });
  it('captures console and uncaught errors but ignores ordinary warnings', () => {
    expect(browserFinding('console', 'error', 'private')).toMatchObject({ code: 'CONSOLE_ERROR' });
    expect(browserFinding('pageerror', 'error', 'private')).toMatchObject({ code: 'PAGE_ERROR' });
    expect(browserFinding('console', 'warning', 'ordinary warning')).toBeNull();
    expect(browserFinding('console', 'log', 'private')).toBeNull();
  });
});
