/**
 * Posts from a page's structured data.
 *
 * Most sites describe their pages to search engines with schema.org JSON-LD:
 * an article's author, a product's price, an event's date and place, a
 * recipe's steps, a job's salary. This reads those blocks, whatever the
 * niche, and turns the common types into one plain shape, then into captions.
 *
 * Plain module: the parser and the caption builders run in the browser too.
 * Words and dates come from a {@link CaptionFormat} the caller builds from
 * its own messages, so nothing here is tied to one language.
 */

export type StructuredKind = 'article' | 'product' | 'event' | 'recipe' | 'job' | 'course' | 'howto' | 'place';

export type FactKey =
  | 'price'
  | 'availability'
  | 'brand'
  | 'rating'
  | 'starts'
  | 'ends'
  | 'place'
  | 'organizer'
  | 'totalTime'
  | 'servings'
  | 'employer'
  | 'location'
  | 'salary'
  | 'employmentType'
  | 'deadline'
  | 'provider'
  | 'address'
  | 'phone'
  | 'author'
  | 'published';

export interface Money {
  min: number;
  max: number | null;
  currency: string | null;
  /** schema.org unit for a salary: HOUR, DAY, WEEK, MONTH or YEAR. */
  unit: string | null;
}

export type FactValue =
  | { text: string }
  | { date: string }
  | { money: Money }
  | { availability: string }
  | { minutes: number }
  | { rating: number; count: number | null };

export interface Fact {
  key: FactKey;
  value: FactValue;
}

export interface StructuredItem {
  kind: StructuredKind;
  name: string;
  description: string | null;
  url: string | null;
  images: string[];
  facts: Fact[];
  /** Recipe ingredients. */
  ingredients: string[];
  /** Recipe or how-to steps, in order. */
  steps: string[];
  /** When an event starts, for the countdown. */
  startDate: string | null;
}

export type CaptionTemplate = 'facts' | 'offer' | 'countdown' | 'steps';

export interface CaptionFormat {
  label: (key: FactKey) => string;
  date: (iso: string) => string;
  money: (money: Money) => string;
  availability: (code: string) => string;
  minutes: (minutes: number) => string;
  rating: (rating: number, count: number | null) => string;
  countdown: (days: number) => string;
  ingredients: string;
  steps: string;
}

export type StructuredLimits = { images: number; steps: number; items: number; descriptionCharacters: number };
/** Set at the start of each (synchronous) parse from the Root policy; no operational literal lives in the parser. */
let limits: StructuredLimits = { images: 1, steps: 1, items: 1, descriptionCharacters: 1 };

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LD_TYPE = /type\s*=\s*["']?application\/ld\+json/i;

const ARTICLE = new Set(['Article', 'NewsArticle', 'BlogPosting', 'Report', 'TechArticle', 'ScholarlyArticle', 'AnalysisNewsArticle', 'OpinionNewsArticle', 'ReviewNewsArticle', 'LiveBlogPosting']);
const PRODUCT = new Set(['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel', 'Vehicle', 'Car']);
const PLACE = new Set(['LocalBusiness', 'Restaurant', 'Store', 'Hotel', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub', 'FoodEstablishment', 'LodgingBusiness', 'HealthAndBeautyBusiness', 'ProfessionalService', 'AutomotiveBusiness', 'SportsActivityLocation', 'MedicalBusiness', 'Dentist', 'HomeAndConstructionBusiness', 'EntertainmentBusiness', 'TouristAttraction']);

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(node: Node): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  // Types may come as full IRIs ("https://schema.org/Product").
  return list.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/^https?:\/\/schema\.org\//, ''));
}

function kindOf(node: Node): StructuredKind | null {
  const types = typesOf(node);
  const has = (test: (type: string) => boolean) => types.some(test);
  if (has((type) => type === 'Recipe')) return 'recipe';
  if (has((type) => type === 'JobPosting')) return 'job';
  if (has((type) => type === 'Course')) return 'course';
  if (has((type) => type === 'HowTo')) return 'howto';
  if (has((type) => type === 'Event' || type.endsWith('Event'))) return 'event';
  if (has((type) => PRODUCT.has(type))) return 'product';
  if (has((type) => ARTICLE.has(type))) return 'article';
  if (has((type) => PLACE.has(type) || type.endsWith('Business') || type.endsWith('Store'))) return 'place';
  return null;
}

/** Every node worth looking at: top level, `@graph` members and a page's `mainEntity`. */
function collect(value: unknown, out: Node[], depth = 0): void {
  if (depth > 3) return;
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, out, depth + 1);
    return;
  }
  if (!isNode(value)) return;
  out.push(value);
  if (value['@graph']) collect(value['@graph'], out, depth + 1);
  if (value.mainEntity) collect(value.mainEntity, out, depth + 1);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : key.startsWith('#') ? Number.parseInt(key.slice(1), 10) : Number.NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Text as a person reads it: no tags, entities decoded, spaces tidied. */
function clean(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text || null;
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function nameOf(value: unknown): string | null {
  const entry = first(value as unknown[]);
  if (isNode(entry)) return clean(entry.name);
  return clean(entry);
}

function absolute(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function imagesOf(value: unknown, base: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : isNode(entry) ? (entry.contentUrl ?? entry.url) : null;
    if (typeof raw !== 'string') continue;
    const url = absolute(raw.trim(), base);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.replace(/,/g, '')) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : value.trim();
}

/** ISO 8601 duration ("PT1H30M", "P1DT2H") in minutes. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => (part ? Number.parseFloat(part) : 0));
  const total = Math.round((days ?? 0) * 1440 + (hours ?? 0) * 60 + (minutes ?? 0) + (seconds ?? 0) / 60);
  return total > 0 ? total : null;
}

function addressOf(value: unknown): string | null {
  const entry = first(value as unknown[]);
  if (typeof entry === 'string') return clean(entry);
  if (!isNode(entry)) return null;
  const parts = [entry.streetAddress, entry.postalCode, entry.addressLocality, entry.addressRegion, nameOf(entry.addressCountry)]
    .map(clean)
    .filter((part): part is string => Boolean(part));
  return parts.length ? [...new Set(parts)].join(', ') : clean(entry.name);
}

function placeOf(value: unknown): string | null {
  const entry = first(value as unknown[]);
  if (typeof entry === 'string') return clean(entry);
  if (!isNode(entry)) return null;
  // An online event names its URL as the place; say nothing rather than a link.
  if (typesOf(entry).includes('VirtualLocation')) return null;
  const name = clean(entry.name);
  const address = addressOf(entry.address);
  if (name && address && !address.includes(name)) return `${name}, ${address}`;
  return name ?? address;
}

function offerOf(value: unknown): { money: Money | null; availability: string | null } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isNode(offer)) continue;
    const spec = isNode(offer.priceSpecification) ? offer.priceSpecification : first(offer.priceSpecification as unknown[]);
    const low = number(offer.lowPrice ?? offer.price ?? (isNode(spec) ? spec.price : undefined));
    const high = number(offer.highPrice);
    const currency = clean(offer.priceCurrency ?? (isNode(spec) ? spec.priceCurrency : undefined));
    const availability = typeof offer.availability === 'string' ? offer.availability.replace(/^https?:\/\/schema\.org\//, '') : null;
    if (low !== null) {
      return { money: { min: low, max: high !== null && high !== low ? high : null, currency, unit: null }, availability };
    }
    if (availability) return { money: null, availability };
  }
  return { money: null, availability: null };
}

function salaryOf(value: unknown): Money | null {
  const salary = first(value as unknown[]);
  if (!isNode(salary)) {
    const amount = number(salary);
    return amount === null ? null : { min: amount, max: null, currency: null, unit: null };
  }
  const inner = isNode(salary.value) ? salary.value : null;
  const min = number(inner?.minValue ?? inner?.value ?? salary.value);
  if (min === null) return null;
  const max = number(inner?.maxValue);
  return {
    min,
    max: max !== null && max !== min ? max : null,
    currency: clean(salary.currency),
    unit: clean(inner?.unitText ?? salary.unitText)?.toUpperCase() ?? null,
  };
}

/** Recipe and how-to instructions: strings, HowToStep, or sections of steps. */
function stepsOf(value: unknown, base: string, images: string[]): string[] {
  const out: string[] = [];
  const walk = (entry: unknown, depth: number) => {
    if (depth > 3 || out.length >= limits.steps) return;
    if (Array.isArray(entry)) {
      for (const child of entry) walk(child, depth + 1);
      return;
    }
    if (typeof entry === 'string') {
      // Some sites put every step in one string, one per line.
      for (const line of entry.split(/\n+/)) {
        const text = clean(line);
        if (text && out.length < limits.steps) out.push(text);
      }
      return;
    }
    if (!isNode(entry)) return;
    if (entry.itemListElement) {
      walk(entry.itemListElement, depth + 1);
      return;
    }
    const text = clean(entry.text) ?? clean(entry.name);
    if (text) out.push(text);
    for (const image of imagesOf(entry.image, base)) if (!images.includes(image)) images.push(image);
  };
  walk(value, 0);
  return out;
}

function toItem(node: Node, kind: StructuredKind, base: string): StructuredItem | null {
  const name = clean(node.name) ?? clean(node.headline) ?? clean(node.title);
  if (!name) return null;
  const description = clean(node.description);
  const images = imagesOf(node.image ?? node.thumbnailUrl, base);
  const facts: Fact[] = [];
  const text = (key: FactKey, value: string | null) => value && facts.push({ key, value: { text: value } });
  const date = (key: FactKey, value: string | null) => value && facts.push({ key, value: { date: value } });
  let steps: string[] = [];
  let ingredients: string[] = [];
  let startDate: string | null = null;

  const rating = isNode(node.aggregateRating) ? node.aggregateRating : null;
  const ratingValue = number(rating?.ratingValue);
  const addRating = () =>
    ratingValue !== null && facts.push({ key: 'rating', value: { rating: ratingValue, count: number(rating?.reviewCount ?? rating?.ratingCount) } });

  switch (kind) {
    case 'product': {
      const { money, availability } = offerOf(node.offers);
      if (money) facts.push({ key: 'price', value: { money } });
      if (availability) facts.push({ key: 'availability', value: { availability } });
      text('brand', nameOf(node.brand));
      addRating();
      break;
    }
    case 'event': {
      startDate = isoDate(node.startDate);
      date('starts', startDate);
      date('ends', isoDate(node.endDate));
      text('place', placeOf(node.location));
      text('organizer', nameOf(node.organizer));
      const { money } = offerOf(node.offers);
      if (money) facts.push({ key: 'price', value: { money } });
      break;
    }
    case 'recipe': {
      const minutes = durationMinutes(node.totalTime) ?? durationMinutes(node.cookTime);
      if (minutes) facts.push({ key: 'totalTime', value: { minutes } });
      text('servings', clean(first(node.recipeYield as unknown[])));
      addRating();
      ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
        .map(clean)
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limits.steps);
      steps = stepsOf(node.recipeInstructions, base, images);
      break;
    }
    case 'howto': {
      const minutes = durationMinutes(node.totalTime);
      if (minutes) facts.push({ key: 'totalTime', value: { minutes } });
      steps = stepsOf(node.step, base, images);
      break;
    }
    case 'job': {
      text('employer', nameOf(node.hiringOrganization));
      const location = first(node.jobLocation as unknown[]);
      text('location', isNode(location) ? addressOf(location.address) ?? clean(location.name) : clean(location));
      const salary = salaryOf(node.baseSalary);
      if (salary) facts.push({ key: 'salary', value: { money: salary } });
      text('employmentType', clean(first(node.employmentType as unknown[]))?.replace(/_/g, ' ').toLowerCase() ?? null);
      date('deadline', isoDate(node.validThrough));
      break;
    }
    case 'course': {
      text('provider', nameOf(node.provider));
      const { money } = offerOf(node.offers);
      if (money) facts.push({ key: 'price', value: { money } });
      addRating();
      break;
    }
    case 'place': {
      text('address', addressOf(node.address));
      text('phone', clean(node.telephone));
      addRating();
      break;
    }
    case 'article': {
      text('author', nameOf(node.author));
      date('published', isoDate(node.datePublished));
      break;
    }
  }

  const url = typeof node.url === 'string' ? absolute(node.url, base) : null;
  return {
    kind,
    name,
    description: description && description.length > limits.descriptionCharacters ? `${description.slice(0, limits.descriptionCharacters - 1).trimEnd()}…` : description,
    url,
    images: images.slice(0, limits.images),
    facts,
    ingredients,
    steps,
    startDate,
  };
}

/**
 * The schema.org items a page describes, most specific first. Blocks that do
 * not parse are skipped: one broken script must not hide the others.
 */
export function parseStructuredData(html: string, pageUrl: string, policy: StructuredLimits): StructuredItem[] {
  limits = policy;
  const nodes: Node[] = [];
  for (const match of html.matchAll(SCRIPT)) {
    if (!LD_TYPE.test(match[1] ?? '')) continue;
    // Some sites wrap the JSON in a CDATA or HTML comment.
    const raw = (match[2] ?? '').trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^<!--|-->$/g, '');
    try {
      collect(JSON.parse(raw), nodes);
    } catch {
      continue;
    }
  }
  const order: StructuredKind[] = ['event', 'product', 'recipe', 'job', 'course', 'howto', 'place', 'article'];
  const items: StructuredItem[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const kind = kindOf(node);
    if (!kind) continue;
    const item = toItem(node, kind, pageUrl);
    if (!item) continue;
    const key = `${kind}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, limits.items);
}

/** Whole days from `now` to an event's start, by calendar date in UTC; null once it has begun. */
export function daysUntil(iso: string, now: Date): number | null {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return null;
  const day = (time: number) => Math.floor(time / 86_400_000);
  const days = day(start) - day(now.getTime());
  return days >= 0 ? days : null;
}

/** The templates that make sense for an item. `facts` always does. */
export function templatesFor(item: StructuredItem, now: Date): CaptionTemplate[] {
  const out: CaptionTemplate[] = ['facts'];
  if (item.facts.some((fact) => fact.key === 'price')) out.push('offer');
  if (item.kind === 'event' && item.startDate && daysUntil(item.startDate, now) !== null) out.push('countdown');
  if (item.steps.length > 0) out.push('steps');
  return out;
}

function formatFact(fact: Fact, format: CaptionFormat): string {
  const value = fact.value;
  if ('text' in value) return value.text;
  if ('date' in value) return format.date(value.date);
  if ('money' in value) return format.money(value.money);
  if ('availability' in value) return format.availability(value.availability);
  if ('minutes' in value) return format.minutes(value.minutes);
  return format.rating(value.rating, value.count);
}

function factLine(fact: Fact, format: CaptionFormat): string {
  return `${format.label(fact.key)}: ${formatFact(fact, format)}`;
}

/**
 * A caption for one item in one template. `link` goes last, as a card does;
 * pass null when the post already carries the link as its card.
 */
export function buildCaption(item: StructuredItem, template: CaptionTemplate, format: CaptionFormat, now: Date, link: string | null): string {
  const blocks: string[] = [];
  const find = (key: FactKey) => item.facts.find((fact) => fact.key === key);

  switch (template) {
    case 'offer': {
      const price = find('price');
      const availability = find('availability');
      blocks.push(item.name);
      blocks.push([price && factLine(price, format), availability && formatFact(availability, format)].filter(Boolean).join(' · '));
      if (item.description) blocks.push(item.description);
      break;
    }
    case 'countdown': {
      const days = item.startDate ? daysUntil(item.startDate, now) : null;
      blocks.push(days === null ? item.name : `${format.countdown(days)}: ${item.name}`);
      const when = find('starts');
      const place = find('place');
      blocks.push([when && formatFact(when, format), place && formatFact(place, format)].filter(Boolean).join(' · '));
      if (item.description) blocks.push(item.description);
      break;
    }
    case 'steps': {
      blocks.push(item.name);
      if (item.ingredients.length) blocks.push(`${format.ingredients}\n${item.ingredients.map((entry) => `• ${entry}`).join('\n')}`);
      blocks.push(`${format.steps}\n${item.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
      break;
    }
    default: {
      blocks.push(item.name);
      if (item.description) blocks.push(item.description);
      if (item.facts.length) blocks.push(item.facts.map((fact) => `• ${factLine(fact, format)}`).join('\n'));
    }
  }

  if (link) blocks.push(link);
  return blocks.filter((block) => block.trim()).join('\n\n');
}
