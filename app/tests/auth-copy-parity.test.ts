import { describe, expect, it } from 'vitest';
import { authCopy } from '../src/modules/home/auth/copy';
import { homeCopy } from '../src/modules/home/copy';

/** Every key and function shape must exist in both languages; a missing French string would show as undefined. */
function shape(value: unknown): unknown {
  if (typeof value === 'function') return 'function';
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]));
  return typeof value;
}

describe('signed-out and home copy', () => {
  it('has the same shape in English and French', () => {
    expect(shape(authCopy('fr'))).toEqual(shape(authCopy('en')));
    expect(shape(homeCopy('fr'))).toEqual(shape(homeCopy('en')));
  });

  it('translates every plain string', () => {
    const flat = (value: unknown, path = ''): Array<[string, string]> => typeof value === 'string' ? [[path, value]] : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => flat(inner, `${path}.${key}`)) : [];
    const en = new Map(flat(authCopy('en')));
    const same = flat(authCopy('fr')).filter(([path, text]) => en.get(path) === text && text.length > 3).map(([path]) => path);
    expect(same).toEqual(['.shell.brand']); // Product branding is shared between locales.
  });

  it('interpolates the invitation sentence in both languages', () => {
    expect(authCopy('fr').join.inviteAs('Atelier', 'editor')).toMatchObject({ workspace: 'Atelier', role: 'editor' });
    expect(authCopy('en').join.passwordShort(12)).toBe('Use at least 12 characters.');
  });
});
