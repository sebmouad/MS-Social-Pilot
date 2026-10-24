import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecipeSupplyWarning } from '../src/modules/feeds/ui/RecipeSupplyWarning';
import { recipeCopy } from '../src/modules/feeds/copy-recipes';
import type { RecipePool } from '../src/modules/feeds/ui/RecipeSource';
const pool: RecipePool = { asOf: '2026-10-21T00:00:00Z', complete: true, warnDays: 14, low: true, pages: [{ targetId: 't', targetName: 'Channel', eligible: 20, daysLeft: 5, low: true }] };

describe('shared Feeds and Home supply warning', () => {
  it('provides an actionable, announced warning in English and French', () => {
    const render = (locale: 'en' | 'fr') => renderToStaticMarkup(createElement(RecipeSupplyWarning, { pool, locale }));
    expect(render('en')).toContain('fewer than 14 days left');
    expect(render('en')).toContain('Add new recipes or adjust your posting times.');
    expect(render('fr')).toContain('moins de 14 jours restants');
    expect(render('fr')).toContain('Ajoutez des recettes ou adaptez vos horaires.');
    expect(render('fr')).toContain('role="status"');
  });
  it('does not invent an alert for unknown, incomplete or adequate supply', () => {
    for (const value of [null, { ...pool, complete: false }, { ...pool, low: false }]) {
      expect(renderToStaticMarkup(createElement(RecipeSupplyWarning, { pool: value, locale: 'en' }))).toBe('');
    }
  });
  it('uses the Root-editable bilingual catalog', () => {
    const copy = { en: { ...recipeCopy.en, poolLow: '{count} channels need recipes within {days} days.' }, fr: { ...recipeCopy.fr } };
    expect(renderToStaticMarkup(createElement(RecipeSupplyWarning, { pool, locale: 'en', copy }))).toContain('1 channels need recipes within 14 days.');
  });
});
