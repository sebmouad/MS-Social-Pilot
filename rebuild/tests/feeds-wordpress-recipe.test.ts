import { describe, expect, it } from 'vitest';
import { WORDPRESS_CONFIG, WORDPRESS_DEFAULTS } from '../src/modules/feeds/wordpress/config';
import {
  allocateRecipes, buildImageUrl, buildPermalink, configPatch, normalizeSlots, parseRecipe, renderComment, resolveConfig, slotInstants, type PlanConfig, type Recipe,
} from '../src/modules/feeds/wordpress/recipe';

const SITE = 'https://recettes.newsgeet.com';
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  title: 'Potée auvergnate', description: 'Fondante et dorée', servings: '6', prep: '30 min', cook: '180 min', total: '210 min',
  ingredients: [{ text: '1 kg de lard', heading: false }, { text: '2 carottes', heading: false }], steps: [{ text: 'Mettre le lard à cuire.', heading: false }, { text: 'Ajouter les légumes.', heading: false }], ...over,
});
const TEMPLATE = WORDPRESS_DEFAULTS.firstCommentTemplate;
const render = (r: Recipe, max = 8000, link = `${SITE}/potee/`) => renderComment(TEMPLATE, r, link, { max, mark: '…' });

describe('recipe parsing', () => {
  it('reads strings and objects defensively, keeping group headings', () => {
    const parsed = parseRecipe(JSON.stringify({
      title: 'Gratin', description: ' Très  bon ', servings: 4, prep_minutes: 15, cook_minutes: '40', total_minutes: 55,
      ingredients: ['  200 g de farine ', { name: 'beurre', quantity: 50, unit: 'g', note: 'froid' }, { section: 'Sauce', items: [{ text: '1 oignon' }, { ingredient: 'sel' }] }],
      steps: [{ step: 1, text: 'Mélanger.' }, { instruction: 'Cuire.' }, 'Servir.', { title: 'Finition', items: ['Saupoudrer.'] }],
    }), 'Fallback', ' min');
    expect(parsed).not.toBeNull();
    expect(parsed!.ingredients).toEqual([
      { text: '200 g de farine', heading: false }, { text: '50 g beurre (froid)', heading: false }, { text: 'Sauce', heading: true }, { text: '1 oignon', heading: false }, { text: 'sel', heading: false },
    ]);
    expect(parsed!.steps.map(s => s.text)).toEqual(['Mélanger.', 'Cuire.', 'Servir.', 'Finition', 'Saupoudrer.']);
    expect(parsed).toMatchObject({ title: 'Gratin', description: 'Très bon', servings: '4', prep: '15 min', cook: '40 min', total: '55 min' });
  });

  it('falls back to the post title and rejects unreadable or empty recipes', () => {
    expect(parseRecipe({ ingredients: ['a'], steps: [] }, 'Titre WP', ' min')?.title).toBe('Titre WP');
    expect(parseRecipe('not json', 'x', ' min')).toBeNull();
    expect(parseRecipe('[]', 'x', ' min')).toBeNull();
    expect(parseRecipe({ title: 'Vide', ingredients: [], steps: [] }, 'x', ' min')).toBeNull();
    expect(parseRecipe({ ingredients: [{ section: 'Seulement un titre', items: [] }] }, 'x', ' min')).toBeNull();
  });

  it('drops zero or missing durations', () => {
    const parsed = parseRecipe({ ingredients: ['a'], prep_minutes: 0, cook_minutes: null }, 't', ' min')!;
    expect([parsed.prep, parsed.cook, parsed.total]).toEqual(['', '', '']);
  });
});

describe('first-comment template', () => {
  it('renders bullets, numbered steps and every placeholder', () => {
    const text = render(recipe());
    expect(text).toBe('🍽️ Potée auvergnate\n\n🧂 Ingrédients :\n• 1 kg de lard\n• 2 carottes\n\n👩‍🍳 Préparation :\n1. Mettre le lard à cuire.\n2. Ajouter les légumes.\n\n📖 Recette complète : https://recettes.newsgeet.com/potee/');
    const all = renderComment('{title}|{description}|{servings}|{prep}|{cook}|{total}|{link}', recipe(), 'https://x.test/', { max: 500, mark: '…' });
    expect(all).toBe('Potée auvergnate|Fondante et dorée|6|30 min|180 min|210 min|https://x.test/');
  });

  it('numbers steps across group headings and inserts values literally', () => {
    const r = recipe({ steps: [{ text: 'Pâte', heading: true }, { text: 'Pétrir.', heading: false }, { text: 'Cuisson', heading: true }, { text: 'Cuire.', heading: false }], title: '{link} {steps}' });
    const text = render(r);
    expect(text).toContain('Pâte :\n1. Pétrir.\nCuisson :\n2. Cuire.');
    expect(text.startsWith('🍽️ {link} {steps}')).toBe(true);
  });

  it('shortens steps first and always keeps the link under the limit', () => {
    const steps = Array.from({ length: 60 }, (_, i) => ({ text: `Étape numéro ${i + 1} avec un texte assez long pour remplir l’espace disponible.`, heading: false }));
    const link = `${SITE}/une-recette-avec-un-lien/`;
    const text = render(recipe({ steps }), 900, link);
    expect(text.length).toBeLessThanOrEqual(900);
    expect(text.endsWith(link)).toBe(true);
    expect(text).toContain('• 1 kg de lard');
    expect(text).toContain('…');
    expect(text).not.toContain('Étape numéro 60');
  });

  it('shortens ingredients when steps alone cannot make it fit, and hard-cuts as a last resort', () => {
    const ingredients = Array.from({ length: 80 }, (_, i) => ({ text: `ingrédient ${i + 1} ${'x'.repeat(40)}`, heading: false }));
    const link = `${SITE}/r/`;
    const medium = render(recipe({ ingredients }), 700, link);
    expect(medium.length).toBeLessThanOrEqual(700);
    expect(medium.endsWith(link)).toBe(true);
    const hard = render(recipe({ title: 'T'.repeat(5000), ingredients }), 400, link);
    expect(hard.length).toBeLessThanOrEqual(400);
    expect(hard.endsWith(link)).toBe(true);
  });
});

describe('addresses', () => {
  it('builds the permalink of the verified example and refuses unsafe slugs', () => {
    expect(buildPermalink('{siteUrl}/{slug}/', `${SITE}/`, 'potee-auvergnate-a-lancienne-fondante-et-doree')).toBe(`${SITE}/potee-auvergnate-a-lancienne-fondante-et-doree/`);
    expect(buildPermalink('{siteUrl}/{slug}/', SITE, 'crème brûlée')).toBe(`${SITE}/cr%C3%A8me%20br%C3%BBl%C3%A9e/`);
    expect(buildPermalink('{siteUrl}/{slug}/', SITE, 'déjà-%C3%A9')).toContain('%C3%A9');
    expect(buildPermalink('{siteUrl}/{slug}/', SITE, '../etc')).toBeNull();
    expect(buildPermalink('{siteUrl}/{slug}/', SITE, '')).toBeNull();
    expect(buildPermalink('http://x.test/{slug}', SITE, 'a')).toBeNull();
  });

  it('builds the uploads image address and refuses escapes', () => {
    const file = '2026/10/potee-auvergnate-a-lancienne-fondante-et-doree-fb-1.webp';
    expect(buildImageUrl(SITE, '/wp-content/uploads', file)).toBe(`${SITE}/wp-content/uploads/${file}`);
    expect(buildImageUrl(`${SITE}/`, '/wp-content/uploads/', file)).toBe(`${SITE}/wp-content/uploads/${file}`);
    for (const bad of ['', '/abs/x.webp', '../x.webp', 'https://evil.test/x.webp', 'a\\b.webp']) expect(buildImageUrl(SITE, '/wp-content/uploads', bad)).toBeNull();
  });
});

describe('slots and daylight saving', () => {
  const slots = ['07:00', '11:00', '15:00', '17:00'];
  const paris = (d: Date) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(d);

  it('lists the four daily Paris times inside the horizon, in order', () => {
    const now = new Date('2026-10-21T09:30:00Z'); // 11:30 Paris (CEST)
    const result = slotInstants({ now, slots, timezone: 'Europe/Paris', horizonDays: 2, leadMinutes: 5 });
    expect(result.map(paris)).toEqual(['21/10/2026 15:00', '21/10/2026 17:00', '22/10/2026 07:00', '22/10/2026 11:00', '22/10/2026 15:00', '22/10/2026 17:00', '23/10/2026 07:00', '23/10/2026 11:00']);
    expect(result.every(d => d.getTime() > now.getTime() && d.getTime() <= now.getTime() + 2 * 86_400_000)).toBe(true);
  });

  it('applies the lead and keeps wall-clock times across the autumn change (CEST to CET)', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const result = slotInstants({ now, slots, timezone: 'Europe/Paris', horizonDays: 3, leadMinutes: 5 });
    const utcHours = result.map(d => d.toISOString().slice(5, 13));
    expect(result.map(paris).slice(0, 4)).toEqual(['24/10/2026 15:00', '24/10/2026 17:00', '25/10/2026 07:00', '25/10/2026 11:00']);
    // 25 Oct 2026 clocks go back: 07:00 Paris is 06:00 UTC after the change, 05:00 UTC the day before.
    expect(utcHours).toContain('10-25T06');
    expect(utcHours).toContain('10-26T06');
    // 07:00 Paris on 21 Oct is 05:00 UTC: a five-minute lead includes it at 04:54Z and excludes it at 04:56Z.
    expect(slotInstants({ now: new Date('2026-10-21T04:54:00Z'), slots: ['07:00'], timezone: 'Europe/Paris', horizonDays: 1, leadMinutes: 5 }).map(paris)[0]).toBe('21/10/2026 07:00');
    expect(slotInstants({ now: new Date('2026-10-21T04:56:00Z'), slots: ['07:00'], timezone: 'Europe/Paris', horizonDays: 2, leadMinutes: 5 }).map(paris)[0]).toBe('22/10/2026 07:00');
  });

  it('moves a time inside the spring gap to the first minute that exists, and never duplicates', () => {
    const now = new Date('2027-03-27T12:00:00Z');
    const result = slotInstants({ now, slots: ['02:30', '07:00'], timezone: 'Europe/Paris', horizonDays: 2, leadMinutes: 5 });
    const formatted = result.map(paris);
    expect(formatted).toContain('28/03/2027 03:00');
    expect(formatted).not.toContain('28/03/2027 02:30');
    expect(new Set(result.map(d => d.getTime())).size).toBe(result.length);
  });

  it('uses the first occurrence of an ambiguous autumn time and sorts/dedupes slots', () => {
    const result = slotInstants({ now: new Date('2026-10-24T12:00:00Z'), slots: ['02:30'], timezone: 'Europe/Paris', horizonDays: 2, leadMinutes: 5 });
    expect(result[0]!.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(normalizeSlots(['17:00', '07:00', '07:00'])).toEqual(['07:00', '17:00']);
  });
});

describe('allocation across pages', () => {
  const pages = Array.from({ length: 10 }, (_, i) => `page${i + 1}`);
  const slotTimes = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 9, 22, 5 + i, 0)));
  const candidates = Array.from({ length: 200 }, (_, i) => ({ wpPostId: String(1000 - i) }));
  const needs = slotTimes.flatMap(slotAt => pages.map(targetId => ({ targetId, slotAt })));

  it('gives all 80 slots (10 pages x 8 times) a different recipe when distinct', () => {
    const { assignments, unfilled } = allocateRecipes({ needs, candidates, blocked: new Map(), taken: new Set(), distinct: true });
    expect(unfilled).toBe(0);
    expect(assignments).toHaveLength(80);
    expect(new Set(assignments.map(a => a.candidate.wpPostId)).size).toBe(80);
    expect(assignments[0]!.candidate.wpPostId).toBe('1000');
    expect(assignments[79]!.candidate.wpPostId).toBe('921');
  });

  it('respects recipes already taken, per-page cooldown and per-slot avoid sets', () => {
    const blocked = new Map([['page1', new Set(['1000', '999'])]]);
    const { assignments } = allocateRecipes({
      needs: [{ targetId: 'page1', slotAt: slotTimes[0]! }, { targetId: 'page2', slotAt: slotTimes[0]!, avoid: new Set(['999']) }],
      candidates, blocked, taken: new Set(['1000']), distinct: true,
    });
    expect(assignments.map(a => a.candidate.wpPostId)).toEqual(['998', '997']);
  });

  it('reuses recipes across pages when not distinct, but never twice on one page', () => {
    const { assignments } = allocateRecipes({ needs: needs.filter(n => n.slotAt === slotTimes[0] || n.slotAt === slotTimes[1]), candidates: candidates.slice(0, 3), blocked: new Map(), taken: new Set(), distinct: false });
    const page1 = assignments.filter(a => a.targetId === 'page1').map(a => a.candidate.wpPostId);
    expect(page1).toEqual(['1000', '999']);
    expect(assignments.filter(a => a.slotAt === slotTimes[0]).every(a => a.candidate.wpPostId === '1000')).toBe(true);
  });

  it('reports unfilled slots when the pool runs out', () => {
    const { assignments, unfilled } = allocateRecipes({ needs, candidates: candidates.slice(0, 5), blocked: new Map(), taken: new Set(), distinct: true });
    expect(assignments).toHaveLength(5);
    expect(unfilled).toBe(75);
  });
});

describe('configuration', () => {
  const defaults: PlanConfig = {
    mapping: { captionMetaKey: 'c', imageMetaKey: 'i', recipeMetaKey: 'r', skipMetaKey: 's', attachedFileMetaKey: 'f', postType: 'post', postStatus: 'publish' }, order: 'newest', maxAgeDays: 0, skipShared: true,
    slots: ['07:00', '11:00'], timezone: 'Europe/Paris', horizonDays: 2, distinctAcrossPages: true, cooldownDays: 365, firstCommentTemplate: '{title}', firstCommentDelayMinutes: 0,
  };
  const limits = { template: 1000, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 3650 }, age: { min: 0, max: 36500 }, delay: { min: 0, max: 1440 } };

  it('lets saved values override Root defaults field by field and ignores invalid saved config', () => {
    const resolved = resolveConfig(defaults, { slots: ['17:00', '07:00', '07:00'], mapping: { captionMetaKey: 'custom' }, horizonDays: 3 }, limits);
    expect(resolved).toMatchObject({ slots: ['07:00', '17:00'], horizonDays: 3, cooldownDays: 365, timezone: 'Europe/Paris' });
    expect(resolved.mapping).toEqual({ ...defaults.mapping, captionMetaKey: 'custom' });
    expect(resolveConfig(defaults, { horizonDays: 99 }, limits)).toEqual(defaults);
    expect(resolveConfig(defaults, { unknown: true }, limits)).toEqual(defaults);
    expect(resolveConfig(defaults, null, limits)).toEqual(defaults);
  });

  it('stores only fields that differ from the defaults', () => {
    expect(configPatch(defaults, defaults)).toEqual({});
    expect(configPatch({ ...defaults, horizonDays: 4, mapping: { ...defaults.mapping, postType: 'recipe' } }, defaults)).toEqual({ horizonDays: 4, mapping: { postType: 'recipe' } });
  });

  it('declares every Root key under feeds.wordpress with a default that passes its own schema', () => {
    expect(WORDPRESS_CONFIG.length).toBeGreaterThan(40);
    for (const item of WORDPRESS_CONFIG) {
      expect(item.key.startsWith('feeds.wordpress.')).toBe(true);
      expect(item.schema.safeParse(item.defaultValue).success, item.key).toBe(true);
    }
    const secret = WORDPRESS_CONFIG.find(item => item.key === 'feeds.wordpress.databaseUrl')!;
    expect(secret.kind).toBe('secret');
    expect(secret.schema.safeParse('mysql://u:p@127.0.0.1:3306/newsgeet').success).toBe(true);
    expect(secret.schema.safeParse('postgres://x').success).toBe(false);
    expect(WORDPRESS_CONFIG.find(item => item.key === 'feeds.wordpress.slots')!.defaultValue).toEqual(['07:00', '11:00', '15:00', '17:00']);
  });
});
