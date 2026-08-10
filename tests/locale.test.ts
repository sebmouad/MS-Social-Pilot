import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isSupportedLocale, negotiateLocale } from '../src/i18n/locale';

describe('negotiateLocale', () => {
  it('picks an exact match', () => {
    expect(negotiateLocale('fr')).toBe('fr');
    expect(negotiateLocale('en')).toBe('en');
  });

  it('matches a regional variant to its base language', () => {
    // fr-CA and fr-BE both mean French to us.
    expect(negotiateLocale('fr-CA')).toBe('fr');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
  });

  it('respects quality weighting rather than header order', () => {
    expect(negotiateLocale('de;q=0.9,fr;q=1.0')).toBe('fr');
    expect(negotiateLocale('fr;q=0.2,en;q=0.8')).toBe('en');
  });

  it('skips languages it cannot serve', () => {
    expect(negotiateLocale('de-DE,de;q=0.9,fr;q=0.5')).toBe('fr');
  });

  it('returns null when nothing matches', () => {
    expect(negotiateLocale('de,es,it')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
  });

  it('survives a malformed header', () => {
    expect(() => negotiateLocale(';;;q=')).not.toThrow();
    expect(negotiateLocale('fr;q=notanumber')).toBeNull();
  });
});

describe('isSupportedLocale', () => {
  it('accepts the locales we ship', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSupportedLocale('de')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});

/**
 * The catalogues must stay in step. A missing French key degrades to the raw
 * key on screen, which is the kind of thing nobody notices until a customer
 * does — so it is asserted rather than trusted.
 */
describe('message catalogues', () => {
  const load = (locale: string) =>
    JSON.parse(readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<
      string,
      unknown
    >;

  function flatten(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  const en = flatten(load('en')).sort();
  const fr = flatten(load('fr')).sort();

  it('defines every English key in French', () => {
    expect(en.filter((key) => !fr.includes(key))).toEqual([]);
  });

  it('has no French keys missing from English', () => {
    expect(fr.filter((key) => !en.includes(key))).toEqual([]);
  });

  it('covers a meaningful amount of the interface', () => {
    expect(en.length).toBeGreaterThan(150);
  });
});
