import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/lib/themes';
import {
  buildPlan, classifyFailure, compareSystemModes, FAILURE_SCENARIOS, finishExtended, finishFailure, finishKeyboard, LEAK_MARKER, modeSpec, notFoundPlan,
  oauthRoute, parseFixtures, ROUND2_MODES, statePlan, VIEWPORTS, type ExtendedCell, type FailureObservation, type KeyboardCell,
} from '../scripts/verify-browser-matrix';

const token = (seed: string) => (seed + '0'.repeat(42)).slice(0, 42) + 'A';
const raw = () => ({
  dynamic: { customer: ['/content/post/p1'], root: ['/root/modules/publishing'], public: ['/bio/studio/view'] },
  sessions: { noWorkspace: token('a'), empty: token('b'), verify: token('c'), enroll: token('d') },
  oauth: { clientId: 'client-1', redirectUri: 'https://client.example/callback' },
});

describe('round 2 fixtures and plans', () => {
  it('accepts the documented fixture shape and rejects malformed session tokens, routes and redirects', () => {
    expect(parseFixtures(raw()).sessions.empty).toHaveLength(43);
    const bad = raw(); bad.sessions.empty = 'short';
    expect(() => parseFixtures(bad)).toThrow('FIXTURES_INVALID sessions.empty');
    const route = raw(); route.dynamic.root = ['https://evil.example/x'];
    expect(() => parseFixtures(route)).toThrow('FIXTURES_INVALID dynamic.root');
    const redirect = raw(); redirect.oauth.redirectUri = 'http://client.example/cb';
    expect(() => parseFixtures(redirect)).toThrow('FIXTURES_INVALID oauth.redirectUri');
    expect(() => parseFixtures(null)).toThrow('FIXTURES_INVALID root');
  });
  it('builds a full S256 consent URL and state pages with their intended redirects', () => {
    const f = parseFixtures(raw());
    const url = new URL(oauthRoute(f), 'http://localhost');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const states = statePlan(f);
    expect(states['state-signed-in'].expect).toMatchObject({ '/': '/home' });
    expect(states['state-signed-out'].expect).toMatchObject({ '/two-step': '/sign-in' });
    expect(states['state-second-step'].auth).toEqual({ cookie: f.sessions.verify });
  });
  it('expects 404 for every not-found route', () => {
    for (const group of Object.values(notFoundPlan())) for (const route of group.routes) expect(group.expectStatus?.[route]).toBe(404);
  });
  it('compares system mode against explicit light and dark in one run', () => {
    const f = parseFixtures(raw());
    const plan = buildPlan('system', f, { customer: ['/home', '/tasks', '/not-sampled'], root: ['/root'] });
    expect(plan.modes).toEqual(ROUND2_MODES);
    expect(plan.groups.customer.routes).toEqual(['/home', '/tasks']);
    expect(() => buildPlan('keyboard', f, { customer: [], root: [] })).toThrow('PLAN_NOT_AVAILABLE');
  });
  it('maps modes to stored value and device preference', () => {
    expect(modeSpec('dark')).toEqual({ cookie: 'dark', scheme: 'dark' });
    expect(modeSpec('system-dark')).toEqual({ cookie: 'system', scheme: 'dark' });
    expect(modeSpec('system-light')).toEqual({ cookie: 'system', scheme: 'light' });
    expect(() => modeSpec('sepia')).toThrow('UNKNOWN_MODE');
  });
});

describe('system mode comparison', () => {
  const cell = (mode: string, signature: string, liveSignature?: string): ExtendedCell => ({ group: 'g', route: '/home', theme: 'vivid', mode, viewport: VIEWPORTS[0], findings: [], details: [], blockedExternal: 0, contrastSampled: 1, signature, liveSignature });
  it('passes when system renders as the explicit mode and follows the device preference live', () => {
    const cells = [cell('light', 'L'), cell('dark', 'D'), cell('system-light', 'L', 'D'), cell('system-dark', 'D', 'L')];
    compareSystemModes(cells);
    expect(cells.flatMap(c => c.findings)).toEqual([]);
  });
  it('reports a system cell that does not match its explicit mode or does not switch live', () => {
    const cells = [cell('light', 'L'), cell('dark', 'D'), cell('system-dark', 'L', 'D')];
    compareSystemModes(cells);
    expect(cells[2].findings.map(f => f.code)).toEqual(['SYSTEM_MODE_MISMATCH', 'SYSTEM_MODE_NOT_LIVE']);
  });
  it('requires cells for every configured mode', () => {
    const groups = { g: ['/home'] };
    const full = THEMES.flatMap(t => ROUND2_MODES.flatMap(mode => VIEWPORTS.map(viewport => ({ ...cell(mode, 'x'), theme: t.id, viewport }))));
    expect(finishExtended({ startedAt: 'x', groups, modes: ROUND2_MODES, excludedDynamicRoutes: [], cells: full, fatal: [] }).passed).toBe(true);
    expect(finishExtended({ startedAt: 'x', groups, modes: ROUND2_MODES, excludedDynamicRoutes: [], cells: full.slice(1), fatal: [] }).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
  });
});

describe('failure classification', () => {
  const base: FailureObservation = { requests: 1, newLive: [], newLines: [], inputsBefore: ['hello'], inputsAfter: ['hello'], pending: false, scopeOpen: true, pageText: '' };
  const codes = (o: Partial<FailureObservation>, scenario: typeof FAILURE_SCENARIOS[number] = 'write-500', open = false) => classifyFailure({ ...base, ...o }, scenario, open).map(f => f.code);
  it('ignores interactions that sent no request', () => { expect(codes({ requests: 0 })).toEqual([]); });
  it('accepts a clear failure message that keeps the input', () => { expect(codes({ newLive: ['We could not save. Try again.'] })).toEqual([]); });
  it('flags silence, misleading success, lost input and stuck buttons', () => {
    expect(codes({})).toEqual(['NO_FAILURE_FEEDBACK']);
    expect(codes({ newLive: ['Saved'] })).toContain('FALSE_SUCCESS');
    expect(codes({ newLive: ['Could not save'], inputsAfter: [''] })).toEqual(['INPUT_LOST']);
    expect(codes({ newLive: ['Could not save'], pending: true })).toEqual(['STUCK_PENDING']);
  });
  it('flags a dialog that closes on failure and server detail on screen', () => {
    expect(codes({ newLive: ['Could not save'], scopeOpen: false }, 'write-500', true)).toEqual(['DIALOG_CLOSED_ON_FAILURE']);
    expect(codes({ newLive: ['Could not save'], pageText: `x ${LEAK_MARKER} y` })).toEqual(['LEAKED_SERVER_DETAIL']);
  });
  it('treats a message that is not about the failure as unexplained, and expects session expiry to say so', () => {
    expect(codes({ newLive: ['Your account'] })).toEqual(['FAILURE_NOT_EXPLAINED']);
    expect(codes({ newLive: ['Could not save'] }, 'write-401')).toEqual(['SESSION_EXPIRY_NOT_EXPLAINED']);
    expect(codes({ newLive: ['Sign in again to continue.'] }, 'write-401')).toEqual([]);
  });
  it('requires every route, viewport combo and scenario', () => {
    const cells = FAILURE_SCENARIOS.map(scenario => ({ route: '/home', theme: 'meta', mode: 'dark', viewport: VIEWPORTS[0], scenario, probes: [], findings: [], details: [], intercepted: 0 }));
    expect(finishFailure({ startedAt: 'x', routes: ['/home'], combos: ['meta:dark:1440'], cells, fatal: [] }).passed).toBe(true);
    expect(finishFailure({ startedAt: 'x', routes: ['/home'], combos: ['meta:dark:1440'], cells: cells.slice(1), fatal: [] }).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
  });
});

describe('keyboard report', () => {
  const checks = { skipLink: 'passed', focusRing: 'passed', noTrap: 'passed', menu: 'passed', select: 'passed', tabs: 'passed', dialog: 'passed', formSubmit: 'passed', mainAction: 'passed' } as const;
  const cells = (): KeyboardCell[] => THEMES.flatMap(t => ['light', 'dark'].flatMap(mode => VIEWPORTS.map(viewport => ({ group: 'g', route: '/home', theme: t.id, mode, viewport, findings: [], details: [], stops: 5, checks: { ...checks } }))));
  const input = (c: KeyboardCell[]) => ({ startedAt: 'x', groups: { g: ['/home'] }, modes: ['light', 'dark'], cells: c, fatal: [] });
  it('passes a complete run and fails a missing cell', () => {
    expect(finishKeyboard(input(cells())).passed).toBe(true);
    expect(finishKeyboard(input(cells().slice(1))).fatal).toContainEqual({ code: 'INCOMPLETE_MATRIX' });
  });
  it('does not accept a run in which a control kind was never exercised', () => {
    const none = cells().map(c => ({ ...c, checks: { ...c.checks, menu: 'Not available' as const } }));
    expect(finishKeyboard(input(none)).fatal).toContainEqual({ code: 'KEYBOARD_COVERAGE_MISSING', route: 'menu' });
  });
});
