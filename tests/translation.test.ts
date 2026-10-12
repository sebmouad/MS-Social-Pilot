import { describe, expect, it } from 'vitest';

import { groupByLanguage, isRightToLeft, keepTokens } from '../src/lib/translation';
import { createPostSchema } from '../src/lib/validation';

/** AI translation (NEXT_PHASES G11): the parts that need no model. */

describe('translation helpers', () => {
  it('knows which languages read right to left', () => {
    expect(isRightToLeft('ar')).toBe(true);
    expect(isRightToLeft('he-IL')).toBe(true);
    expect(isRightToLeft('fa')).toBe(true);
    expect(isRightToLeft('pa-Arab')).toBe(true);
    expect(isRightToLeft('en-US')).toBe(false);
    expect(isRightToLeft('az-Latn')).toBe(false);
    expect(isRightToLeft(null)).toBe(false);
  });

  it('puts back any link, hashtag or mention the translation lost', () => {
    expect(keepTokens('Hi #a https://x.test', 'Salut #a https://x.test')).toBe('Salut #a https://x.test');
    expect(keepTokens('Hi #a @b', 'Salut')).toBe('Salut\n\n#a @b');
  });

  it('groups Pages by language, keeping their order', () => {
    expect(
      groupByLanguage([
        { id: 'p1', language: 'fr-FR' },
        { id: 'p2', language: null },
        { id: 'p3', language: 'fr-FR' },
        { id: 'p4', language: 'es-MX' },
      ]),
    ).toEqual([
      { language: 'fr-FR', targetIds: ['p1', 'p3'] },
      { language: null, targetIds: ['p2'] },
      { language: 'es-MX', targetIds: ['p4'] },
    ]);
  });
});

describe('translations on a new post', () => {
  const base = { message: 'Product launch', targetIds: ['p1', 'p2', 'p3'], publishMode: 'immediate' as const };

  it('accepts translations for Pages of the post', () => {
    const parsed = createPostSchema.parse({ ...base, translations: [{ targetIds: ['p2', 'p3'], message: 'Lancement' }] });
    expect(parsed.translations).toHaveLength(1);
  });

  it('refuses a Page outside the post, a Page twice, an empty text or a mix with a caption test', () => {
    expect(() => createPostSchema.parse({ ...base, translations: [{ targetIds: ['p9'], message: 'x' }] })).toThrow();
    expect(() =>
      createPostSchema.parse({ ...base, translations: [{ targetIds: ['p2'], message: 'x' }, { targetIds: ['p2'], message: 'y' }] }),
    ).toThrow();
    expect(() => createPostSchema.parse({ ...base, translations: [{ targetIds: ['p2'], message: ' ' }] })).toThrow();
    expect(() =>
      createPostSchema.parse({ ...base, captionVariants: ['B'], translations: [{ targetIds: ['p2'], message: 'x' }] }),
    ).toThrow();
  });
});

describe('interface languages', () => {
  it('names each language in itself and gives its direction', async () => {
    const { languageName, textDirection } = await import('../src/lib/languages');
    expect(languageName('en')).toBe('English');
    expect(languageName('fr')).toBe('Français');
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('fr')).toBe('ltr');
  });
});
