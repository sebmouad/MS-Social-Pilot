import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ header: null as string | null, fallback: 'en' as string }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => state.header }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => state.fallback }));

import { localeFromAcceptLanguage, requestLocale } from '../src/server/platforms/request-locale';

describe('request locale', () => {
  it('reads only a leading English or French tag', () => {
    expect(localeFromAcceptLanguage('fr-CA,en;q=0.8')).toBe('fr');
    expect(localeFromAcceptLanguage('EN-gb')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE,fr;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it('uses Root ui.defaultLocale only when the browser asks for neither language', async () => {
    state.fallback = 'fr';
    state.header = 'de-DE';
    expect(await requestLocale()).toBe('fr');
    state.header = null;
    expect(await requestLocale()).toBe('fr');
    state.header = 'en-US';
    expect(await requestLocale()).toBe('en');
    state.fallback = 'en';
    state.header = 'ja';
    expect(await requestLocale()).toBe('en');
  });
});
