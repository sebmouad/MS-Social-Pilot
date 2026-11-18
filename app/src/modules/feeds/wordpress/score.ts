/**
 * Recipe viral score (2026-11-16, docs/autopilot-plan.md): a 0–100 estimate of how well a recipe will do at a given
 * moment. Pure: the planner supplies the AI ratings (hook, photo, kind) when it has them, the weather and the history.
 */

export type RecipeKind = 'dessert' | 'main' | 'starter' | 'drink' | 'aperitif' | 'bread' | 'side' | 'breakfast' | 'sauce';
export const RECIPE_KINDS: readonly RecipeKind[] = ['dessert', 'main', 'starter', 'drink', 'aperitif', 'bread', 'side', 'breakfast', 'sauce'];

/** Lower case, no accents, single spaces: what every keyword is matched against. */
export const fold = (text: string) => ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const has = (folded: string, words: readonly string[]) => words.some(word => folded.includes(` ${word} `) || (word.endsWith('*') && folded.includes(` ${word.slice(0, -1)}`)));

const KIND_WORDS: Array<[RecipeKind, string[]]> = [
  ['drink', ['punch', 'cocktail', 'smoothie', 'jus', 'limonade', 'sirop', 'chocolat chaud', 'vin chaud', 'milkshake', 'the glace', 'infusion', 'sangria', 'mojito', 'boisson']],
  ['aperitif', ['aperitif', 'apero', 'feuillete*', 'toast*', 'verrine*', 'tapenade', 'houmous', 'gougere*', 'amuse', 'bouchee*', 'chips', 'tartinade']],
  ['breakfast', ['pancake*', 'brioche', 'granola', 'porridge', 'pain perdu', 'petit dejeuner', 'brunch', 'muesli']],
  ['bread', ['pain', 'baguette', 'focaccia', 'fougasse', 'naan', 'pita']],
  ['sauce', ['sauce', 'vinaigrette', 'pesto', 'mayonnaise', 'coulis', 'confiture', 'chutney']],
  ['dessert', ['gateau*', 'cake au chocolat', 'tarte au sucre', 'tarte aux pommes', 'tarte tatin', 'tarte au citron', 'mousse au chocolat', 'creme brulee', 'creme dessert', 'tiramisu', 'cookie*', 'brownie*', 'muffin*', 'cannele*', 'macaron*', 'clafoutis', 'flan', 'fondant', 'crepe*', 'gaufre*', 'beignet*', 'truffe*', 'sable*', 'biscuit*', 'madeleine*', 'financier*', 'pate de fruit*', 'pates de fruit*', 'glace', 'sorbet', 'panna cotta', 'charlotte', 'buche', 'galette des rois', 'riz au lait', 'compote', 'crumble', 'cheesecake', 'entremet*', 'eclair*', 'choux a la creme', 'meringue*', 'nougat', 'caramel', 'praline*', 'dessert']],
  ['starter', ['soupe', 'veloute', 'salade', 'gaspacho', 'terrine', 'entree', 'oeufs mimosa', 'carpaccio', 'tartare']],
  ['side', ['puree', 'gratin dauphinois', 'frites', 'riz pilaf', 'legumes rotis', 'poelee', 'accompagnement', 'ratatouille']],
];

/** Kind from the title alone, for recipes the AI has not rated yet. Main dish when nothing matches. */
export function guessKind(title: string): RecipeKind {
  const folded = fold(title);
  for (const [kind, words] of KIND_WORDS) if (has(folded, words)) return kind;
  return 'main';
}

const COMFORT = ['gratin*', 'raclette', 'tartiflette', 'fondue', 'pot au feu', 'boeuf bourguignon', 'blanquette', 'cassoulet', 'hachis parmentier', 'lasagne*', 'soupe', 'veloute', 'potee', 'choucroute', 'croziflette', 'mijote*', 'ragout', 'chili', 'risotto', 'quiche*', 'parmentier', 'daube', 'carbonade', 'pates', 'coquillettes', 'chocolat chaud', 'vin chaud', 'crumble'];
const FRESH = ['salade*', 'gaspacho', 'carpaccio', 'tartare', 'ceviche', 'glace', 'sorbet', 'smoothie', 'taboule', 'pasteque', 'melon', 'granite', 'barbecue', 'brochette*', 'grillade*', 'citronnade', 'limonade', 'poke', 'wrap*'];
const QUICK = ['rapide', 'express', 'facile', 'minute', '15 min', '20 min', '30 min', 'en 10', 'en 15', 'en 20', 'sans cuisson', 'simple', 'one pot', 'poele*', 'omelette'];
const WEEKEND = ['dimanche', 'brunch', 'roti', 'gigot', 'brioche', 'gateau*', 'tarte*', 'fete', 'week end'];

/** Produce in season by month (1–12) in France, and produce clearly out of season (a summer fruit in December). */
const SEASON: Array<{ months: number[]; words: string[] }> = [
  { months: [9, 10, 11, 12, 1, 2], words: ['courge*', 'potiron', 'butternut', 'potimarron', 'chataigne*', 'marron*', 'poireau*', 'chou*', 'endive*', 'celeri', 'panais', 'topinambour*', 'betterave*', 'champignon*', 'cepe*', 'girolle*', 'poire*', 'pomme*', 'coing*', 'clementine*', 'mandarine*', 'orange*', 'kiwi*', 'agrume*', 'citron*', 'noix', 'noisette*', 'raisin*', 'figue*'] },
  { months: [3, 4, 5, 6], words: ['asperge*', 'petits pois', 'radis', 'feve*', 'rhubarbe', 'fraise*', 'artichaut*', 'epinard*', 'carottes nouvelles', 'agneau'] },
  { months: [6, 7, 8, 9], words: ['tomate*', 'courgette*', 'aubergine*', 'poivron*', 'concombre*', 'melon', 'pasteque', 'peche*', 'abricot*', 'cerise*', 'framboise*', 'myrtille*', 'mure*', 'nectarine*', 'prune*', 'mirabelle*', 'mais', 'basilic', 'haricots verts'] },
];

/** Easter Sunday (Gregorian), as a UTC date. */
export function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const lastSunday = (year: number, month: number) => { const d = new Date(Date.UTC(year, month, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
const nthSunday = (year: number, month: number, n: number) => { const d = new Date(Date.UTC(year, month - 1, 1)); d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1)); return d; };

export type Moment = { id: string; name: string; date: Date; words: string[] };
/** French food moments of a year, each with the dishes people look for. */
export function moments(year: number): Moment[] {
  const e = easter(year); const day = (d: Date, offset: number) => new Date(d.getTime() + offset * 86_400_000);
  const utc = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d));
  // Mother's day: last Sunday of May, a week later when it falls on Pentecost.
  const pentecost = day(e, 49); const mothers = lastSunday(year, 5); const mothersDay = mothers.getTime() === pentecost.getTime() ? day(mothers, 7) : mothers;
  return [
    { id: 'epiphany', name: 'Épiphanie', date: utc(1, 6), words: ['galette des rois', 'frangipane', 'brioche des rois', 'couronne'] },
    { id: 'chandeleur', name: 'Chandeleur', date: utc(2, 2), words: ['crepe*', 'pancake*', 'galette*'] },
    { id: 'mardi-gras', name: 'Mardi gras', date: day(e, -47), words: ['beignet*', 'bugne*', 'merveille*', 'oreillette*', 'crepe*', 'gaufre*'] },
    { id: 'valentine', name: 'Saint-Valentin', date: utc(2, 14), words: ['coeur', 'fondant', 'chocolat', 'framboise*', 'romantique', 'saint valentin', 'fraise*'] },
    { id: 'easter', name: 'Pâques', date: e, words: ['paques', 'agneau', 'gigot', 'chocolat', 'nid*', 'oeuf*', 'lapin', 'brioche'] },
    { id: 'mothers', name: 'Fête des mères', date: mothersDay, words: ['fraisier', 'gateau*', 'charlotte', 'brunch', 'tarte*', 'fete des meres'] },
    { id: 'fathers', name: 'Fête des pères', date: nthSunday(year, 6, 3), words: ['barbecue', 'cote de boeuf', 'grillade*', 'burger*', 'fete des peres'] },
    { id: 'summer-bbq', name: 'Barbecue', date: utc(7, 14), words: ['barbecue', 'brochette*', 'grillade*', 'marinade', 'plancha', 'salade*'] },
    { id: 'back-to-school', name: 'Rentrée', date: utc(9, 2), words: ['lunch box', 'gouter', 'rapide', 'facile', 'cake*', 'gateau au yaourt', 'muffin*'] },
    { id: 'halloween', name: 'Halloween', date: utc(10, 31), words: ['citrouille', 'potiron', 'halloween', 'courge*', 'sorciere', 'monstre*'] },
    { id: 'christmas', name: 'Noël', date: utc(12, 25), words: ['noel', 'buche', 'foie gras', 'dinde', 'chapon', 'pain d epice*', 'sable*', 'marron*', 'saumon fume', 'huitre*', 'truffe*', 'bredele*', 'vin chaud', 'fete*', 'reveillon'] },
    { id: 'new-year', name: 'Nouvel an', date: utc(12, 31), words: ['reveillon', 'champagne', 'aperitif', 'verrine*', 'saumon fume', 'foie gras', 'bouchee*', 'toast*'] },
  ];
}

/** Moments whose dishes are wanted on `date`: from `leadDays` before until the day itself. */
export function activeMoments(date: Date, leadDays: number): Moment[] {
  const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return [...moments(date.getUTCFullYear()), ...moments(date.getUTCFullYear() + 1)].filter(m => at <= m.date.getTime() && at >= m.date.getTime() - leadDays * 86_400_000);
}

export type Weather = { maxC: number };
export type ScoreInput = {
  title: string;
  /** AI ratings 0–10 when known: how strong the title is as a hook, how appetising the photo is. */
  hook?: number | null; photo?: number | null; kind?: RecipeKind | null;
  /** How recipes like this one did on the channel it is planned for, relative to that channel's usual (1 = usual). */
  history?: number | null;
};
export type ScoreContext = { date: Date; weekday: number; hour: number; leadDays: number; rules: ReadonlySet<'holidays' | 'season' | 'weekday' | 'weather'>; weather?: Weather | null };
export type ScorePart = { label: string; points: number };

/** 0–100, with the reasons. 50 is an ordinary recipe at an ordinary moment. */
export function scoreRecipe(recipe: ScoreInput, at: ScoreContext): { score: number; parts: ScorePart[] } {
  const parts: ScorePart[] = [];
  const add = (label: string, points: number) => { if (points) parts.push({ label, points: Math.round(points) }); };
  const folded = fold(recipe.title);
  const kind = recipe.kind ?? guessKind(recipe.title);
  if (typeof recipe.hook === 'number') add('hook', (recipe.hook - 5) * 3);
  if (typeof recipe.photo === 'number') add('photo', (recipe.photo - 5) * 3);
  // What works on this channel, learned from its own recent posts (2026-11-18): 1.3× usual ≈ +7, 2× ≈ +17, at most ±20.
  if (typeof recipe.history === 'number' && Number.isFinite(recipe.history)) add('history', Math.max(-20, Math.min(20, Math.log(Math.max(recipe.history, 0.05)) * 25)));
  const month = at.date.getUTCMonth() + 1;
  if (at.rules.has('season')) {
    // « Pommes de terre » are potatoes, not apples: they never count as seasonal fruit (2026-11-16).
    const produce = folded.replace(/ pommes? de terre /g, ' ');
    const inSeason = SEASON.some(s => s.months.includes(month) && has(produce, s.words));
    const outOfSeason = !inSeason && SEASON.some(s => !s.months.includes(month) && has(produce, s.words));
    if (inSeason) add('season', 8); else if (outOfSeason) add('season', -12);
  }
  if (at.rules.has('holidays')) {
    const moment = activeMoments(at.date, at.leadDays).find(m => has(folded, m.words));
    if (moment) add(`moment:${moment.id}`, 15);
  }
  if (at.rules.has('weekday')) {
    const weekend = at.weekday === 0 || at.weekday === 6;
    if (!weekend && at.hour >= 16 && (has(folded, QUICK) || kind === 'main')) add('weekday', has(folded, QUICK) ? 6 : 2);
    if (weekend && (kind === 'dessert' || kind === 'breakfast' || has(folded, WEEKEND))) add('weekend', 6);
    if (!weekend && at.hour < 11 && kind === 'breakfast') add('morning', 4);
  }
  if (at.rules.has('weather') && at.weather) {
    const cold = at.weather.maxC <= 10, warm = at.weather.maxC >= 24;
    if (cold && has(folded, COMFORT)) add('weather', 6);
    if (warm && has(folded, FRESH)) add('weather', 6);
    if (cold && has(folded, FRESH)) add('weather', -4);
    if (warm && has(folded, COMFORT)) add('weather', -4);
  }
  const score = Math.max(1, Math.min(99, 50 + parts.reduce((sum, part) => sum + part.points, 0)));
  return { score, parts };
}

const TITLE_STOP = new Set('la le les de des du au aux a et en d l un une recette facile rapide maison express pour avec sans sur pret prete minutes min ma mon mes tres ultra vraie vrai meilleur meilleure ces ce cette tout toute tous leger legere super petit petite petits petites mini dans comme plus bien servi servie'.split(' '));
/** The words of a title that say what the dish is (ingredients, dish, technique), singular, for learning what works. */
/**
 * French dish and ingredient names written in several words, learned as one (2026-11-18): « pommes de terre » is not
 * « terre », « Saint-Jacques » is not « saint » and « jacques ». Folded form → token → how people read it.
 */
const COMPOUNDS: ReadonlyArray<[string, string, string]> = [
  ['pommes? de terre', 'pommedeterre', 'pommes de terre'], ['saint jacques', 'saintjacques', 'Saint-Jacques'], ['fruits? de mer', 'fruitsdemer', 'fruits de mer'],
  ['noix de coco', 'noixdecoco', 'noix de coco'], ['pain perdu', 'painperdu', 'pain perdu'], ['croques? monsieur', 'croquemonsieur', 'croque-monsieur'],
  ['pot au feu', 'potaufeu', 'pot-au-feu'], ['choux? fleurs?', 'choufleur', 'chou-fleur'], ['petits pois', 'petitspois', 'petits pois'],
  ['creme fraiche', 'cremefraiche', 'crème fraîche'], ['foie gras', 'foiegras', 'foie gras'], ['creme brulee', 'cremebrulee', 'crème brûlée'],
  ['pate feuilletee', 'patefeuilletee', 'pâte feuilletée'], ['pate brisee', 'patebrisee', 'pâte brisée'], ['chocolat chaud', 'chocolatchaud', 'chocolat chaud'],
  ['vin chaud', 'vinchaud', 'vin chaud'], ['galettes? des rois', 'galettedesrois', 'galette des rois'], ['oeufs? mimosa', 'oeufmimosa', 'œufs mimosa'],
  ['hachis parmentier', 'hachisparmentier', 'hachis parmentier'], ['boeuf bourguignon', 'boeufbourguignon', 'bœuf bourguignon'], ['pain d epices?', 'paindepice', 'pain d’épices'],
  ['bain marie', 'bainmarie', 'au bain-marie'], ['saumon fume', 'saumonfume', 'saumon fumé'], ['poulet roti', 'pouletroti', 'poulet rôti'],
];
/** How a compound token reads for people. */
export const COMPOUND_NAMES: Readonly<Record<string, string>> = Object.fromEntries(COMPOUNDS.map(([, token, name]) => [token, name]));

export function titleWords(title: string): string[] {
  let folded = fold(title);
  for (const [phrase, token] of COMPOUNDS) folded = folded.replace(new RegExp(` ${phrase} `, 'g'), ` ${token} `);
  return [...new Set(folded.trim().split(' ').filter(word => word.length > 3 && !TITLE_STOP.has(word) && !/^\d+$/.test(word)).map(word => word.length > 4 && word.endsWith('s') && !(word in COMPOUND_NAMES) ? word.slice(0, -1) : word))].sort();
}

/**
 * Variety guard: would putting `kind` at `at` on a channel make more than `maxRun` of the same kind in a row?
 * `timeline` is the channel's posts around that time (planned and new), in any order.
 */
export function breaksVariety(timeline: ReadonlyArray<{ at: number; kind: RecipeKind }>, at: number, kind: RecipeKind, maxRun: number): boolean {
  const sorted = [...timeline, { at, kind }].sort((a, b) => a.at - b.at);
  const index = sorted.findIndex(item => item.at === at && item.kind === kind);
  let run = 1;
  for (let i = index - 1; i >= 0 && sorted[i]!.kind === kind; i--) run++;
  for (let i = index + 1; i < sorted.length && sorted[i]!.kind === kind; i++) run++;
  return run > maxRun;
}
