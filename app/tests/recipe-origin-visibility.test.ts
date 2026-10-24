import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('origin=recipe'), usePathname: () => '/publishing/calendar' }));

import { loadPostOrigins, originFilterOptions, parseOriginFilter } from '../src/modules/publishing/ui/origins/load';
import { safeOriginUrl, type PostOriginProvider } from '../src/modules/publishing/ui/origins/post-origin';
import { OriginBadge } from '../src/modules/publishing/ui/origins/OriginBadge';
import { recipePostOrigin } from '../src/modules/feeds/ui/post-origin';
import { originText, recipeOriginCopy } from '../src/modules/feeds/ui/origin-copy';
import { RecipeStatusCard } from '../src/modules/feeds/ui/RecipeStatusCard';
import { loadRecipeStatus } from '../src/modules/feeds/ui/recipe-status';
import { feedsCopy, feedsText } from '../src/modules/feeds/copy';
import { FEEDS_CONFIG } from '../src/modules/feeds/config';
import { WORDPRESS_BOUNDS, WORDPRESS_DEFAULTS } from '../src/modules/feeds/wordpress/config';
import type { RecipeStatus } from '../src/modules/feeds/ui/recipe-status';

const provider = (overrides: Partial<PostOriginProvider> = {}): PostOriginProvider => ({
  kind: 'recipe', label: l => (l === 'fr' ? 'Recette' : 'Recipe'), filterLabel: () => 'Recipe automation', linkLabel: () => 'Article',
  available: async () => true, lookup: async () => new Map(), ...overrides,
});

beforeEach(() => { db.$queryRaw.mockReset(); });

describe('post origin port', () => {
  it('keeps only web links', () => {
    expect(safeOriginUrl('https://site.test/a')).toBe('https://site.test/a');
    expect(safeOriginUrl('javascript:alert(1)')).toBeNull();
    expect(safeOriginUrl('not a url')).toBeNull();
    expect(safeOriginUrl(null)).toBeNull();
  });

  it('labels found posts in the viewer language and drops unsafe links', async () => {
    const lookup = vi.fn(async () => new Map([['p1', { sourceName: 'Kitchen', url: 'https://k.test/x' }], ['p2', { sourceName: 'Kitchen', url: 'javascript:1' }]]));
    const found = await loadPostOrigins('w1', ['p1', 'p2', 'p3'], 'fr', [provider({ lookup })]);
    expect(lookup).toHaveBeenCalledWith('w1', ['p1', 'p2', 'p3']);
    expect(found.get('p1')).toMatchObject({ kind: 'recipe', label: 'Recette', sourceName: 'Kitchen', url: 'https://k.test/x' });
    expect(found.get('p2')?.url).toBeNull();
    expect(found.has('p3')).toBe(false);
  });

  it('skips a failing provider instead of failing the page, and does not call with no posts', async () => {
    const lookup = vi.fn(async () => { throw new Error('db down'); });
    expect((await loadPostOrigins('w1', ['p1'], 'en', [provider({ lookup })])).size).toBe(0);
    const never = vi.fn();
    await loadPostOrigins('w1', [], 'en', [provider({ lookup: never })]);
    expect(never).not.toHaveBeenCalled();
  });

  it('offers only origins the workspace can use and ignores unknown filter values', async () => {
    expect(await originFilterOptions('w1', 'en', [provider()])).toEqual([{ kind: 'recipe', label: 'Recipe automation' }]);
    expect(await originFilterOptions('w1', 'en', [provider({ available: async () => false })])).toEqual([]);
    expect(await originFilterOptions('w1', 'en', [provider({ available: async () => { throw new Error('x'); } })])).toEqual([]);
    expect(parseOriginFilter('recipe', [provider()])).toBe('recipe');
    expect(parseOriginFilter('other', [provider()])).toBeUndefined();
    expect(parseOriginFilter(undefined, [provider()])).toBeUndefined();
  });
});

describe('recipe provider', () => {
  it('reads the ledger scoped by workspace and maps post ids to source and article', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ postId: 'p1', sourceId: 's1', sourceName: 'Kitchen', title: 'Soup', permalink: 'https://k.test/soup' }]);
    const found = await recipePostOrigin.lookup('w1', ['p1', 'p2']);
    expect(found.get('p1')).toEqual({ sourceName: 'Kitchen', url: 'https://k.test/soup' });
    const [strings, ...values] = db.$queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('"workspaceId" = ?');
    expect(values).toContain('w1');
  });

  it('does not query for an empty id list', async () => {
    expect((await recipePostOrigin.lookup('w1', [])).size).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('has the same keys in English and French', () => {
    expect(Object.keys(recipeOriginCopy.fr).sort()).toEqual(Object.keys(recipeOriginCopy.en).sort());
    expect(feedsText('fr', 'recipeStatusProblemsDetail', { failed: 2, uncertain: 1 })).toBe('2 en échec, 1 à contrôler');
    expect(originText('fr', 'badge')).toBe('Recette');
  });
});

describe('OriginBadge', () => {
  it('shows the label, source and an external article link', () => {
    const html = renderToStaticMarkup(h(OriginBadge, { origin: { kind: 'recipe', label: 'Recipe', sourceName: 'Kitchen', url: 'https://k.test/soup', linkLabel: 'Article' } }));
    expect(html).toContain('Recipe');
    expect(html).toContain('Kitchen');
    expect(html).toContain('href="https://k.test/soup"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-module="publishing"');
  });

  it('omits the link without a URL and the source when compact', () => {
    const html = renderToStaticMarkup(h(OriginBadge, { compact: true, origin: { kind: 'recipe', label: 'Recette', sourceName: 'Cuisine', url: null, linkLabel: 'Article' } }));
    expect(html).toContain('Recette');
    expect(html).not.toContain('Cuisine');
    expect(html).not.toContain('<a ');
  });
});

describe('recipe status', () => {
  const base: RecipeStatus = {
    state: 'active', lastRunAt: '2026-10-21T08:00:00.000Z', timeZone: 'UTC',
    upcoming: [{ slotAt: '2026-10-21T18:00:00.000Z', targetName: 'Page One', title: 'Soup' }], publishedToday: 2, failed: 1, uncertain: 1,
    pool: { low: true, complete: true, pages: [{ targetId: 't1', targetName: 'Page One', eligible: 12, daysLeft: 4, low: true }] },
  };

  it('renders slots, today, problems and supply in English and French', () => {
    const en = renderToStaticMarkup(h(RecipeStatusCard, { status: base, locale: 'en' }));
    expect(en).toContain('Recipe automation');
    expect(en).toContain('Page One');
    expect(en).toContain('Published today');
    expect(en).toContain('1 failed, 1 to check');
    expect(en).toContain('Running low');
    expect(en).toContain('4 days left');
    const fr = renderToStaticMarkup(h(RecipeStatusCard, { status: base, locale: 'fr' }));
    expect(fr).toContain('Automatisation des recettes');
    expect(fr).toContain('1 en échec, 1 à contrôler');
    expect(fr).toContain('4 jours restants');
  });

  it('states empty and unknown cases plainly instead of showing zeros for unknown supply', () => {
    const html = renderToStaticMarkup(h(RecipeStatusCard, { locale: 'en', status: { ...base, state: 'paused', upcoming: [], failed: 0, uncertain: 0, pool: null, lastRunAt: null } }));
    expect(html).toContain('Paused');
    expect(html).toContain('Nothing scheduled yet.');
    expect(html).toContain('None');
    expect(html).toContain('Not available right now');
    expect(html).toContain('Not yet');
  });

  it('builds the snapshot for the source timezone and the viewer\'s channels', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ slotAt: new Date('2026-10-21T18:00:00Z'), targetName: 'Page One', title: 'Soup' }])
      .mockResolvedValueOnce([{ count: BigInt(3) }])
      .mockResolvedValueOnce([{ state: 'failed', count: BigInt(2) }, { state: 'uncertain', count: BigInt(1) }]);
    const now = new Date('2026-10-21T10:00:00Z');
    const status = await loadRecipeStatus({
      workspaceId: 'w1', source: { id: 's1', enabled: true, lastRunAt: null, config: { timezone: 'UTC', horizonDays: 7 } }, available: true, pool: null, upcomingLimit: 5, failureWindowDays: 3, allowedTargetIds: ['t1'], now,
    });
    expect(status).toMatchObject({ state: 'active', publishedToday: 3, failed: 2, uncertain: 1, pool: null });
    expect(status.upcoming).toEqual([{ slotAt: '2026-10-21T18:00:00.000Z', targetName: 'Page One', title: 'Soup' }]);
    const published = db.$queryRaw.mock.calls[1]!.slice(1);
    expect(published).toContainEqual(new Date('2026-10-21T00:00:00.000Z'));
    expect(published).toContainEqual(new Date('2026-10-22T00:00:00.000Z'));
    expect(db.$queryRaw.mock.calls[2]!.slice(1)).toContainEqual(new Date('2026-10-18T10:00:00.000Z'));
    expect(db.$queryRaw.mock.calls[0]!.slice(1)).toContain(5);
  });

  it('reads its text from the Root feeds.copy catalog and keeps both languages in step', () => {
    const catalog = { en: { ...feedsCopy.en, recipeStatusTitle: 'Custom title' }, fr: { ...feedsCopy.fr, recipeStatusTitle: 'Titre perso' } };
    expect(renderToStaticMarkup(h(RecipeStatusCard, { status: base, locale: 'en', copy: catalog }))).toContain('Custom title');
    expect(renderToStaticMarkup(h(RecipeStatusCard, { status: base, locale: 'fr', copy: catalog }))).toContain('Titre perso');
    const keys = (lang: 'en' | 'fr') => Object.keys(feedsCopy[lang]).filter(key => key.startsWith('recipeStatus')).sort();
    expect(keys('fr')).toEqual(keys('en'));
    expect(keys('en').length).toBeGreaterThan(10);
  });

  it('declares dedicated Root settings for the slot count and the problem window', () => {
    const keys = FEEDS_CONFIG.map(item => item.key);
    expect(keys).toContain('feeds.wordpress.statusUpcomingCount');
    expect(keys).toContain('feeds.wordpress.statusFailureWindowDays');
    expect(WORDPRESS_DEFAULTS.statusUpcomingCount).toBeGreaterThanOrEqual(WORDPRESS_BOUNDS.statusUpcomingCount.min);
    expect(WORDPRESS_DEFAULTS.statusFailureWindowDays).toBeLessThanOrEqual(WORDPRESS_BOUNDS.statusFailureWindowDays.max);
  });
});
