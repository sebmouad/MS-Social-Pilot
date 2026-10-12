import { describe, expect, it } from 'vitest';

import { fillPlaceholders, normaliseHashtags, placeholdersOf, templateText } from '@/lib/post-templates';
import { byCategory } from '@/components/TemplatePicker';

describe('post templates', () => {
  it('finds each placeholder once, in order, and leaves other braces alone', () => {
    expect(placeholdersOf('New: {product} from {price}. Only {product}! {} { spaced} {a very long name that goes on and on}')).toEqual([
      'product',
      'price',
    ]);
    expect(placeholdersOf('Rendez-vous {date de début} — {prix_€}')).toEqual(['date de début']);
  });

  it('fills what was given and keeps a blank left empty as written', () => {
    expect(fillPlaceholders('New: {product} from {price}', { product: ' Lemon tart ', price: '' })).toBe('New: Lemon tart from {price}');
  });

  it('turns typed hashtags into tags, each once', () => {
    expect(normaliseHashtags('sale, #Summer  ##deals; summer #new-in')).toBe('#sale #Summer #deals #newin');
    expect(normaliseHashtags('  ')).toBe('');
  });

  it('puts hashtags on their own line after the text', () => {
    expect(templateText({ body: 'Tip: {tip}\n', hashtags: '#tips' }, { tip: 'water daily' })).toBe('Tip: water daily\n\n#tips');
    expect(templateText({ body: 'Hello', hashtags: '' }, {})).toBe('Hello');
  });

  it('groups by category, uncategorised last', () => {
    const groups = byCategory([
      { category: '', name: 'a' },
      { category: 'Promo', name: 'b' },
      { category: 'Announcement', name: 'c' },
      { category: 'Promo', name: 'd' },
    ]);
    expect(groups.map(([category, entries]) => [category, entries.map((entry) => entry.name)])).toEqual([
      ['Announcement', ['c']],
      ['Promo', ['b', 'd']],
      ['', ['a']],
    ]);
  });
});
