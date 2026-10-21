import { z } from 'zod';
import { addDaysToKey, instantToWall, wallTimeToInstant } from '@/lib/calendar-dates';
import { META_KEY, SLOT_TIME, SLOTS_MAX } from './config';

/** Pure logic of the WordPress recipe source: field mapping, recipe parsing, comment rendering, slots and allocation. */
export type Mapping = { captionMetaKey: string; imageMetaKey: string; recipeMetaKey: string; skipMetaKey: string; attachedFileMetaKey: string; postType: string; postStatus: string };
export type PlanConfig = {
  mapping: Mapping; order: 'newest' | 'oldest'; maxAgeDays: number; skipShared: boolean;
  slots: string[]; timezone: string; horizonDays: number; distinctAcrossPages: boolean; cooldownDays: number;
  firstCommentTemplate: string; firstCommentDelayMinutes: number;
};

const key = z.string().regex(META_KEY);
const token = z.string().regex(/^[A-Za-z0-9_-]{1,20}$/);
const zone = z.string().min(1).max(64).refine(v => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; } }, 'Use an IANA time zone.');
/** A saved config may omit any field: Root supplies the default at read time. */
export const planConfigPatchSchema = (limits: { template: number; horizon: { min: number; max: number }; cooldown: { min: number; max: number }; age: { min: number; max: number }; delay: { min: number; max: number } }) => z.object({
  mapping: z.object({
    captionMetaKey: key, imageMetaKey: key, recipeMetaKey: key, skipMetaKey: z.union([key, z.literal('')]), attachedFileMetaKey: key, postType: token, postStatus: token,
  }).partial().strict(),
  order: z.enum(['newest', 'oldest']), maxAgeDays: z.number().int().min(limits.age.min).max(limits.age.max), skipShared: z.boolean(),
  slots: z.array(z.string().regex(SLOT_TIME)).min(1).max(SLOTS_MAX), timezone: zone,
  horizonDays: z.number().int().min(limits.horizon.min).max(limits.horizon.max), distinctAcrossPages: z.boolean(),
  cooldownDays: z.number().int().min(limits.cooldown.min).max(limits.cooldown.max),
  firstCommentTemplate: z.string().min(1).max(limits.template), firstCommentDelayMinutes: z.number().int().min(limits.delay.min).max(limits.delay.max),
}).partial().strict();
export type PlanConfigPatch = z.infer<ReturnType<typeof planConfigPatchSchema>>;

/** Defaults come from Root; the saved patch overrides field by field. */
export function resolveConfig(defaults: PlanConfig, patch: unknown, limits: Parameters<typeof planConfigPatchSchema>[0]): PlanConfig {
  const parsed = planConfigPatchSchema(limits).safeParse(patch && typeof patch === 'object' ? patch : {});
  const p: PlanConfigPatch = parsed.success ? parsed.data : {};
  return {
    ...defaults, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== undefined && k !== 'mapping')),
    mapping: { ...defaults.mapping, ...Object.fromEntries(Object.entries(p.mapping ?? {}).filter(([, v]) => v !== undefined)) },
    slots: normalizeSlots(p.slots ?? defaults.slots),
  } as PlanConfig;
}
/** Only fields that differ from the Root defaults are stored, so later default changes still apply. */
export function configPatch(config: PlanConfig, defaults: PlanConfig): Record<string, unknown> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(config) as Array<keyof PlanConfig>) {
    if (key === 'mapping') {
      const mapping = Object.fromEntries((Object.keys(config.mapping) as Array<keyof Mapping>).filter(k => config.mapping[k] !== defaults.mapping[k]).map(k => [k, config.mapping[k]]));
      if (Object.keys(mapping).length) patch['mapping'] = mapping;
    } else if (!same(config[key], defaults[key])) patch[key] = config[key];
  }
  return patch;
}
export const normalizeSlots =(slots: readonly string[]): string[] => [...new Set(slots)].sort();

/* ----- recipe parsing ----- */

export type Line = { text: string; heading: boolean };
export type Recipe = { title: string; description: string; servings: string; prep: string; cook: string; total: string; ingredients: Line[]; steps: Line[] };
const INGREDIENT_KEYS = ['text', 'name', 'ingredient', 'item', 'label', 'title', 'description'] as const;
const STEP_KEYS = ['text', 'instruction', 'description', 'step', 'content', 'name', 'title', 'label'] as const;
const GROUP_KEYS = ['items', 'ingredients', 'steps', 'list'] as const;
const HEADING_KEYS = ['title', 'name', 'section', 'group', 'heading', 'label'] as const;
const QUANTITY_KEYS = ['quantity', 'qty', 'amount'] as const;
const NOTE_KEYS = ['note', 'notes', 'preparation', 'comment'] as const;
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const asText = (value: unknown): string => typeof value === 'string' ? clean(value) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

function lines(value: unknown, keys: readonly string[], depth = 0): Line[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') { const text = asText(value); return text ? [{ text, heading: false }] : []; }
  if (Array.isArray(value)) return value.flatMap(item => lines(item, keys, depth + 1));
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const group = GROUP_KEYS.map(k => record[k]).find(Array.isArray) as unknown[] | undefined;
  if (group) {
    const heading = HEADING_KEYS.map(k => asText(record[k])).find(Boolean);
    return [...(heading ? [{ text: heading, heading: true }] : []), ...lines(group, keys, depth + 1)];
  }
  const main = keys.map(k => typeof record[k] === 'string' ? asText(record[k]) : '').find(Boolean);
  if (!main) return [];
  const quantity = QUANTITY_KEYS.map(k => asText(record[k])).find(Boolean) ?? '';
  const unit = typeof record['unit'] === 'string' ? asText(record['unit']) : '';
  const note = NOTE_KEYS.map(k => asText(record[k])).find(Boolean) ?? '';
  const text = [quantity, unit, main].filter(Boolean).join(' ') + (note ? ` (${note})` : '');
  return [{ text, heading: false }];
}
const duration = (value: unknown, suffix: string): string => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${Math.round(value)}${suffix}`;
  const text = asText(value);
  return /^\d+(\.\d+)?$/.test(text) && Number(text) > 0 ? `${Math.round(Number(text))}${suffix}` : text && !/^0+(\.0+)?$/.test(text) ? text : '';
};

/** The plugin stores JSON; a decoded object is accepted too. Anything unreadable yields null. */
export function parseRecipe(raw: unknown, fallbackTitle: string, minutesSuffix: string): Recipe | null {
  let data: unknown = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch { return null; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const ingredients = lines(r['ingredients'], INGREDIENT_KEYS);
  const steps = lines(r['steps'], STEP_KEYS);
  if (!ingredients.some(l => !l.heading) && !steps.some(l => !l.heading)) return null;
  return {
    title: asText(r['title']) || fallbackTitle, description: asText(r['description']), servings: asText(r['servings']),
    prep: duration(r['prep_minutes'], minutesSuffix), cook: duration(r['cook_minutes'], minutesSuffix), total: duration(r['total_minutes'], minutesSuffix),
    ingredients, steps,
  };
}

/* ----- first comment ----- */

export type CommentOptions = { max: number; mark: string };
const PLACEHOLDER = /\{(title|description|ingredients|steps|servings|prep|cook|total|link)\}/g;

/**
 * Fill the template. Ingredients get bullets and steps numbers. A text over the limit loses steps first, then
 * ingredients (marked), and always keeps the link; values are inserted literally in one pass.
 */
export function renderComment(template: string, recipe: Recipe, link: string, options: CommentOptions): string {
  const bullets = (items: Line[], count: number, cut: boolean) => {
    const out = items.slice(0, count).map(l => l.heading ? `${l.text} :` : `• ${l.text}`);
    if (cut) out.push(options.mark);
    return out.join('\n');
  };
  const numbered = (items: Line[], count: number, cut: boolean) => {
    let n = 0;
    const out = items.slice(0, count).map(l => l.heading ? `${l.text} :` : `${++n}. ${l.text}`);
    if (cut) out.push(options.mark);
    return out.join('\n');
  };
  const build = (ingredientCount: number, stepCount: number): string => {
    const values: Record<string, string> = {
      title: recipe.title, description: recipe.description, servings: recipe.servings, prep: recipe.prep, cook: recipe.cook, total: recipe.total, link,
      ingredients: bullets(recipe.ingredients, ingredientCount, ingredientCount < recipe.ingredients.length), steps: numbered(recipe.steps, stepCount, stepCount < recipe.steps.length),
    };
    return template.replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? '').replace(/\n{3,}/g, '\n\n').trim();
  };
  const fits = (text: string) => text.length <= options.max;
  const full = build(recipe.ingredients.length, recipe.steps.length);
  if (fits(full)) return full;
  for (let steps = recipe.steps.length - 1; steps >= 0; steps -= 1) { const text = build(recipe.ingredients.length, steps); if (fits(text)) return text; }
  for (let ingredients = recipe.ingredients.length - 1; ingredients >= 0; ingredients -= 1) { const text = build(ingredients, 0); if (fits(text)) return text; }
  const minimal = build(0, 0);
  if (fits(minimal)) return minimal;
  const tail = `${options.mark}\n${link}`;
  const keep = options.max - tail.length;
  return keep > 0 ? `${minimal.slice(0, keep).trimEnd()}${tail}` : link.slice(0, options.max);
}

/* ----- addresses ----- */

const encodeSegment = (segment: string) => /%[0-9A-Fa-f]{2}/.test(segment) ? segment : encodeURIComponent(segment);
export const trimSite = (siteUrl: string) => siteUrl.replace(/\/+$/, '');
export function buildPermalink(template: string, siteUrl: string, slug: string): string | null {
  const clean = slug.trim();
  if (!clean || clean.includes('/') || clean.includes('..')) return null;
  const link = template.replace('{siteUrl}', trimSite(siteUrl)).replace('{slug}', encodeSegment(clean));
  try { const parsed = new URL(link); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
}
export function buildImageUrl(siteUrl: string, uploadsPath: string, file: string): string | null {
  const path = file.trim();
  if (!path || path.startsWith('/') || path.includes('..') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.includes('\\')) return null;
  const url = `${trimSite(siteUrl)}${uploadsPath.replace(/\/+$/, '')}/${path.split('/').map(encodeSegment).join('/')}`;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
}

/* ----- slots ----- */

const MS_DAY = 86_400_000;
const MAX_GAP_SHIFT_MINUTES = 180;
function shiftTime(time: string, minutes: number): string | null {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  return total >= 24 * 60 ? null : `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
/**
 * Instants of the configured local times within (now + lead, now + horizon]. Daylight saving is handled by the
 * zone rules: a time inside a spring-forward gap moves to the first minute that exists; an ambiguous autumn
 * time uses its first occurrence.
 */
export function slotInstants(input: { now: Date; slots: readonly string[]; timezone: string; horizonDays: number; leadMinutes: number }): Date[] {
  const earliest = input.now.getTime() + input.leadMinutes * 60_000;
  const latest = input.now.getTime() + input.horizonDays * MS_DAY;
  const today = instantToWall(input.now, input.timezone).date;
  const found = new Set<number>();
  for (let day = 0; day <= input.horizonDays + 1; day += 1) {
    const date = addDaysToKey(today, day);
    for (const slot of normalizeSlots(input.slots)) {
      let result = wallTimeToInstant(date, slot, input.timezone);
      for (let shift = 1; !result.ok && result.reason === 'skipped' && shift <= MAX_GAP_SHIFT_MINUTES; shift += 1) {
        const moved = shiftTime(slot, shift);
        if (!moved) break;
        result = wallTimeToInstant(date, moved, input.timezone);
      }
      if (result.ok && result.instant.getTime() > earliest && result.instant.getTime() <= latest) found.add(result.instant.getTime());
    }
  }
  return [...found].sort((a, b) => a - b).map(t => new Date(t));
}

/* ----- allocation ----- */

export type SlotNeed = { targetId: string; slotAt: Date; avoid?: ReadonlySet<string> };
export type Allocation<C> = { targetId: string; slotAt: Date; candidate: C };
/**
 * Give each slot (in the order supplied) the first candidate that its page has not had within the cooldown,
 * that no other page received in the horizon (when distinct), and that the slot has not already failed with.
 */
export function allocateRecipes<C extends { wpPostId: string }>(input: {
  needs: readonly SlotNeed[]; candidates: readonly C[]; blocked: ReadonlyMap<string, ReadonlySet<string>>; taken: ReadonlySet<string>; distinct: boolean;
}): { assignments: Array<Allocation<C>>; unfilled: number } {
  const used = new Set(input.taken);
  const perPage = new Map<string, Set<string>>();
  const assignments: Array<Allocation<C>> = [];
  let unfilled = 0;
  for (const need of input.needs) {
    const page = perPage.get(need.targetId) ?? new Set(input.blocked.get(need.targetId) ?? []);
    perPage.set(need.targetId, page);
    const pick = input.candidates.find(c => !page.has(c.wpPostId) && !(input.distinct && used.has(c.wpPostId)) && !need.avoid?.has(c.wpPostId));
    if (!pick) { unfilled += 1; continue; }
    page.add(pick.wpPostId); used.add(pick.wpPostId);
    assignments.push({ targetId: need.targetId, slotAt: need.slotAt, candidate: pick });
  }
  return { assignments, unfilled };
}

/* ----- confirmations ----- */

export const saveRecipeSourceConfirmation = (name: string) => `SAVE RECIPE SOURCE ${name}`;
export const runRecipePlannerConfirmation = 'RUN RECIPE PLANNER';
export const pauseRecipeSourceConfirmation = 'PAUSE RECIPE SOURCE';
export const resumeRecipeSourceConfirmation = 'RESUME RECIPE SOURCE';
