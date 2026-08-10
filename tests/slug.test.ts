import { describe, expect, it } from 'vitest';

import { shortSlug, slugify, uniqueSlug } from '../src/lib/slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Marketing')).toBe('acme-marketing');
  });

  it('strips diacritics rather than dropping the letters', () => {
    // A French client name must not become "caf-lon".
    expect(slugify('Café Léon')).toBe('cafe-leon');
    expect(slugify('Крым')).toBe('workspace');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugify('  ***Hello___World!!!  ')).toBe('hello-world');
  });

  it('never returns an empty string', () => {
    expect(slugify('!!!')).toBe('workspace');
    expect(slugify('')).toBe('workspace');
  });

  it('caps the length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when it is free', async () => {
    expect(await uniqueSlug('Acme', async () => false)).toBe('acme');
  });

  it('appends a counter when taken', async () => {
    const taken = new Set(['acme', 'acme-2', 'acme-3']);
    expect(await uniqueSlug('Acme', async (candidate) => taken.has(candidate))).toBe('acme-4');
  });

  it('falls back to randomness rather than looping forever', async () => {
    const slug = await uniqueSlug('Acme', async () => true);
    expect(slug).toMatch(/^acme-[0-9a-f]{8}$/);
  });
});

describe('shortSlug', () => {
  it('produces the requested length', () => {
    expect(shortSlug(7)).toHaveLength(7);
    expect(shortSlug(12)).toHaveLength(12);
  });

  it('omits characters that are confused when retyped', () => {
    const sample = Array.from({ length: 200 }, () => shortSlug(16)).join('');
    // No 0/O, 1/l/I.
    expect(sample).not.toMatch(/[0O1lI]/);
  });

  it('is not obviously repetitive', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => shortSlug()));
    expect(slugs.size).toBeGreaterThan(495);
  });
});
