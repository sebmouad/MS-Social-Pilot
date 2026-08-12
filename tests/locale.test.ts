import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';

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

  /** Every message that takes a placeholder, with the placeholders it uses. */
  function placeholders(value: unknown, prefix = ''): Array<[string, string, Set<string>]> {
    if (typeof value === 'string') {
      // The name up to the first comma, so `{count, plural, …}` reads as
      // `count` rather than as the whole ICU body.
      const names = new Set(
        [...value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((match) => match[1]!),
      );
      return names.size > 0 ? [[prefix, value, names]] : [];
    }
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      placeholders(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('uses the same placeholders in both languages', () => {
    // A French string that forgets {count} renders the sentence without the
    // number, which reads as finished text and is never reported as a bug.
    const enPlaceholders = new Map(placeholders(load('en')).map(([key, , names]) => [key, names]));
    const frPlaceholders = new Map(placeholders(load('fr')).map(([key, , names]) => [key, names]));

    const mismatched: string[] = [];
    for (const [key, names] of enPlaceholders) {
      const other = frPlaceholders.get(key) ?? new Set<string>();
      const same = names.size === other.size && [...names].every((name) => other.has(name));
      if (!same) mismatched.push(key);
    }

    expect(mismatched).toEqual([]);
  });

  it('pluralises every message that counts something', () => {
    // "1 Facebook connections expire" shipped once. A message whose only
    // variable is a count, and whose text carries a bare plural noun, has to
    // go through ICU plural rather than concatenating a number onto a string.
    const offenders: string[] = [];

    for (const locale of ['en', 'fr']) {
      for (const [key, text, names] of placeholders(load(locale))) {
        if (!names.has('count')) continue;
        if (text.includes('plural')) continue;
        // Bare `{count} things` where the noun is plural regardless of value.
        if (/\{count\}\s+\S*(s|x)\b/.test(text)) offenders.push(`${locale}:${key}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Every sentence the API sends back has to be translatable.
 *
 * `fail('…')` puts an English string on the wire that no catalogue can reach,
 * so a French customer reads English at the one moment something has gone
 * wrong. Errors carrying a key go through `AppError`, which `handleApiError`
 * translates against the request's locale. This is a sweep rather than a list:
 * a new route is covered the moment it exists.
 */
describe('the sentences the API sends back', () => {
  /**
   * `fail()` calls that are allowed to pass a value straight through, because
   * the text did not originate here and there is nothing to translate it
   * against — Facebook's own wording, a validator's message, an operator-only
   * setting name.
   */
  const PASSTHROUGH = [
    'error.message',
    'range.message',
    'result.reason',
    'result.error',
    'Unknown setting',
  ];

  function routeFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) return routeFiles(full);
      return entry === 'route.ts' ? [full] : [];
    });
  }

  it('never hard-codes one into a route', () => {
    const files = routeFiles('src/app/api');
    // Guards against the walk finding nothing, which would make this vacuous.
    expect(files.length).toBeGreaterThan(30);

    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (!/\bfail\(/.test(line)) return;
        if (PASSTHROUGH.some((allowed) => line.includes(allowed))) return;
        // A quoted sentence, rather than a variable, is the thing being caught.
        if (/fail\(\s*['"`]/.test(line)) offenders.push(`${file}:${index + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('has both catalogues for every key the errors module can throw', async () => {
    const { errors } = await import('../src/lib/errors');
    const read = (locale: string) =>
      JSON.parse(
        readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8'),
      ) as Record<string, unknown>;
    const en = read('en');
    const fr = read('fr');

    const missing: string[] = [];
    for (const [name, make] of Object.entries(errors)) {
      // Called with no arguments: only the key matters here, and one
      // shorthand takes the key itself as its first argument.
      const error = (make as () => { key: string })();
      const segments = error.key.split('.');
      const lookup = (catalogue: Record<string, unknown>) =>
        segments.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogue);

      if (typeof lookup(en) !== 'string') missing.push(`en:${error.key} (errors.${name})`);
      if (typeof lookup(fr) !== 'string') missing.push(`fr:${error.key} (errors.${name})`);
    }

    expect(missing).toEqual([]);
  });
});
