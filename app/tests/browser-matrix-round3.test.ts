import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { THEMES } from '../src/lib/themes';
import { formatStableDateTime } from '../src/components/LocalTime';
import { ERROR_STATE_COPY, localeFrom } from '../src/components/ErrorState';
import { classifyServerError, engineName, finishServerError, selectThemes, summarizeReport, SERVER_ERROR_LOCALES, VIEWPORTS, type ServerErrorCell, type ServerErrorObservation } from '../scripts/verify-browser-matrix';

describe('round 3 engine and theme selection', () => {
  it('defaults to Chromium and all themes, and rejects unknown names', () => {
    expect(engineName(undefined)).toBe('chromium');
    expect(engineName('webkit')).toBe('webkit');
    expect(() => engineName('safari')).toThrow('UNKNOWN_BROWSER');
    expect(selectThemes(undefined)).toHaveLength(THEMES.length);
    expect(selectThemes('warm, vivid').map(theme => theme.id)).toEqual(['vivid', 'warm']);
    expect(() => selectThemes('vivid,neon')).toThrow('UNKNOWN_THEME');
  });
});

const good: ServerErrorObservation = { status: 500, theme: 'warm', mode: 'dark', wantTheme: 'warm', wantMode: 'dark', locale: 'fr', text: 'Impossible de charger cette page. Réessayer. Retour à l’accueil', retryButtons: 1, retryKeepsPage: true, backgroundLuminance: 0.02, homeLink: true };
describe('server-rendered failure classification', () => {
  it('accepts a themed, translated page with retry and a way back', () => expect(classifyServerError(good)).toEqual([]));
  it('flags the unbranded default error page', () => {
    const codes = classifyServerError({ ...good, theme: null, mode: null, locale: 'en', text: 'Application error: a server-side exception has occurred (see the server logs for more information). Digest: 123', retryButtons: 0, homeLink: false, backgroundLuminance: 1 }).map(f => f.code);
    expect(codes).toEqual(expect.arrayContaining(['SERVER_ERROR_NOT_THEMED', 'SERVER_ERROR_NOT_TRANSLATED', 'SERVER_ERROR_LEAKS_DETAIL', 'SERVER_ERROR_NO_RETRY', 'SERVER_ERROR_NO_WAY_BACK']));
  });
  it('flags English copy shown to a French visitor, a blank page and a broken retry', () => {
    expect(classifyServerError({ ...good, text: 'We couldn’t load this page. Try again' }).map(f => f.code)).toContain('SERVER_ERROR_NOT_TRANSLATED');
    expect(classifyServerError({ ...good, text: '' }).map(f => f.code)).toContain('SERVER_ERROR_BLANK_PAGE');
    expect(classifyServerError({ ...good, retryKeepsPage: false }).map(f => f.code)).toEqual(['SERVER_ERROR_RETRY_BROKEN']);
    expect(classifyServerError({ ...good, status: 200 }).map(f => f.code)).toEqual(['SERVER_ERROR_NOT_SIMULATED']);
  });
  it('expects a dark background in dark mode and a light one in light mode', () => {
    expect(classifyServerError({ ...good, backgroundLuminance: 0.9 }).map(f => f.code)).toEqual(['SERVER_ERROR_NOT_THEMED']);
    expect(classifyServerError({ ...good, wantMode: 'light', mode: 'light', backgroundLuminance: 0.05 }).map(f => f.code)).toEqual(['SERVER_ERROR_NOT_THEMED']);
  });
  it('requires every route x theme x mode x locale x viewport cell', () => {
    const themes = selectThemes('vivid');
    const cells: ServerErrorCell[] = ['light', 'dark'].flatMap(mode => SERVER_ERROR_LOCALES.flatMap(locale => VIEWPORTS.map(viewport => ({ route: '/home', theme: 'vivid', mode: mode as 'light' | 'dark', locale, viewport, findings: [], details: [] }))));
    const base = { startedAt: 'x', routes: ['/home'], fatal: [], themes, browser: 'firefox' };
    expect(finishServerError({ ...base, cells })).toMatchObject({ passed: true, expectedCells: 8, browser: 'firefox' });
    expect(finishServerError({ ...base, cells: cells.slice(1) })).toMatchObject({ passed: false });
  });
});

describe('report summary', () => {
  it('groups findings by code and by route', () => {
    const lines = summarizeReport({ fatal: [], cells: [
      { route: '/a', theme: 'vivid', mode: 'light', viewport: { width: 1440 }, findings: [{ code: 'CONTRAST_LOW' }], details: ['CONTRAST 4.1:1 <a> "x"'] },
      { route: '/a', theme: 'vivid', mode: 'dark', viewport: { width: 1440 }, findings: [{ code: 'CONTRAST_LOW' }], details: ['CONTRAST 4.2:1 <a> "x"'] },
    ] });
    expect(lines[0]).toBe('fatal: none');
    expect(lines).toContain('CONTRAST_LOW: 2');
    expect(lines.some(line => line.startsWith('2x') && line.includes('/a'))).toBe(true);
  });
});

describe('engine-neutral timestamps and error copy', () => {
  it('joins date and time ourselves so WebKit and Node agree', () => {
    expect(formatStableDateTime('2026-10-21T10:53:20Z', { timeZone: 'UTC' })).toBe('21 Oct 2026, 10:53:20');
    expect(formatStableDateTime('2026-10-21T10:53:20Z', { timeZone: 'UTC', style: 'date' })).toBe('21 Oct 2026');
    expect(formatStableDateTime('not a date')).toBe('');
  });
  it('has the same keys in English and French and picks French from the language tag', () => {
    expect(Object.keys(ERROR_STATE_COPY.fr)).toEqual(Object.keys(ERROR_STATE_COPY.en));
    expect(localeFrom('fr-MA')).toBe('fr');
    expect(localeFrom('en-GB')).toBe('en');
    expect(localeFrom(null)).toBe('en');
  });
});
