import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { THEMES } from '../src/lib/themes';
import { allowRequest, browserFinding, customerRoute, DRAWER_MAIN_ACTION_SELECTOR, MAIN_ACTION_SELECTORS, discoverRoutes, FAMILIES, finishReport, guardBaseUrl, runMatrix, VIEWPORTS, type Cell } from '../scripts/verify-browser-matrix';

function complete() {
  const routes = FAMILIES.map(route => route === '/publishing' ? '/publishing/posts' : route);
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
    expect(report.expectedCells).toBe(64);
    expect(report.cells).toHaveLength(64);
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
    for (const route of ['/home', '/publishing/compose', '/inbox/moderation', '/analytics/reports', '/ads/campaigns', '/settings/appearance', '/tasks', '/agency/clients']) expect(inventory.routes).toContain(route);
    expect(inventory.excludedDynamicRoutes).toContain('/publishing/collaboration/post/[postId]');
    expect(inventory.routes.some(route => route.startsWith('/root') || route.includes('['))).toBe(false);
    expect(customerRoute('/settings-evil')).toBe(false);
    expect(customerRoute('/sign-in')).toBe(false);
  });
});

describe('main action discovery', () => {
  it('keeps the sidebar primary action as the page action and verifies it in the phone drawer', () => {
    expect(MAIN_ACTION_SELECTORS).toEqual(['main .ui-button--primary:not(:disabled)', '#shell-filters .ui-button--primary', 'main button:not(:disabled)', 'main a[href]']);
    expect(MAIN_ACTION_SELECTORS).toContain(DRAWER_MAIN_ACTION_SELECTOR);
  });
  it('still reports a page with no verified main action', () => {
    const input = complete(); input.cells[1].keyboard.mainAction = 'Not available';
    expect(finishReport(input).cells[1].findings).toContainEqual({ code: 'MAIN_ACTION_UNVERIFIED' });
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
