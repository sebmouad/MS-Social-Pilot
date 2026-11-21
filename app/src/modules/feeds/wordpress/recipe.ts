import { z } from 'zod';
import { addDaysToKey, instantToWall, wallTimeToInstant } from '@/lib/calendar-dates';
import { META_KEY, SLOT_TIME, SLOTS_MAX } from './config';
import { decodeWordpressText } from './text';
import { AUTOPILOT_LEARNED_KEYS, autopilotOf, autopilotSchema, salvageAutopilot } from './autopilot';

/** Pure logic of the WordPress recipe source: field mapping, recipe parsing, comment rendering, slots and allocation. */
export type Mapping = { captionMetaKey: string; imageMetaKey: string; recipeMetaKey: string; skipMetaKey: string; attachedFileMetaKey: string; postType: string; postStatus: string };
export type PlanConfig = {
  mapping: Mapping; order: 'newest' | 'oldest'; maxAgeDays: number; skipShared: boolean;
  slots: string[]; timezone: string; horizonDays: number; distinctAcrossPages: boolean; cooldownDays: number;
  firstCommentTemplate: string; firstCommentDelayMinutes: number;
  /** Days posts go out, 0 = Sunday … 6 = Saturday (2026-11-15); every day when absent. */
  weekdays?: number[];
  /** Channels with their own posting times instead of `slots` (2026-11-15), keyed by channel id. */
  channelSlots?: Record<string, string[]>;
  /** Recipes never to post (2026-11-15): WordPress post id and the title shown in the list. */
  excluded?: Array<{ id: string; title: string }>;
  /** Channels with their own settings (2026-11-15), keyed by channel id: each field set replaces the shared one for that channel. */
  channels?: Record<string, ChannelSettings>;
  /** Autopilot settings and its activity log (2026-11-16). */
  autopilot?: unknown;
};
/** What one channel can set for itself; `paused` stops planning on it without touching the others. */
export type ChannelSettings = { slots?: string[]; weekdays?: number[]; order?: 'newest' | 'oldest'; firstCommentTemplate?: string; firstCommentDelayMinutes?: number; paused?: boolean; pausedReason?: string;
  /** The times were set by the autopilot's learning, which may move them again; a member's own times are kept. */
  autoTimes?: boolean;
  /** The caption is only the recipe's title, with no written hook (2026-11-21, owner's test on 3 Pages). */
  captionTitle?: boolean };

/** The settings one channel posts with: its own where it has them, the shared ones otherwise. */
export function channelConfig(config: PlanConfig, channelId: string): PlanConfig & { paused: boolean; captionTitle: boolean } {
  const own = config.channels?.[channelId] ?? {};
  // A member's own times win; then times the autopilot learned (while best times are on); then the shared times.
  const pilot = autopilotOf(config.autopilot);
  const learned = pilot.bestTimes.enabled ? pilot.learnedTimes?.[channelId] : undefined;
  const slots = own.slots?.length ? own.slots : config.channelSlots?.[channelId]?.length ? config.channelSlots[channelId]! : learned?.length ? learned : config.slots;
  return {
    ...config, slots: normalizeSlots(slots), order: own.order ?? config.order,
    firstCommentTemplate: own.firstCommentTemplate ?? config.firstCommentTemplate, firstCommentDelayMinutes: own.firstCommentDelayMinutes ?? config.firstCommentDelayMinutes,
    ...(own.weekdays?.length ? { weekdays: own.weekdays } : {}), paused: own.paused === true, captionTitle: own.captionTitle === true,
  };
}

const key = z.string().regex(META_KEY);
const token = z.string().regex(/^[A-Za-z0-9_-]{1,20}$/);
const zone = z.string().min(1).max(64).refine(v => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; } }, 'Use an IANA time zone.');
/** A saved config may omit any field: Root supplies the default at read time. */
export const planConfigPatchSchema = (limits: { template: number; horizon: { min: number; max: number }; cooldown: { min: number; max: number }; age: { min: number; max: number }; delay: { min: number; max: number } }) => z.object({
  mapping: z.object({
    // An empty caption, image or recipe field means "use the post itself": its excerpt, featured image and the recipe written in the article.
    captionMetaKey: z.union([key, z.literal('')]), imageMetaKey: z.union([key, z.literal('')]), recipeMetaKey: z.union([key, z.literal('')]), skipMetaKey: z.union([key, z.literal('')]), attachedFileMetaKey: key, postType: token, postStatus: token,
  }).partial().strict(),
  order: z.enum(['newest', 'oldest']), maxAgeDays: z.number().int().min(limits.age.min).max(limits.age.max), skipShared: z.boolean(),
  slots: z.array(z.string().regex(SLOT_TIME)).min(1).max(SLOTS_MAX), timezone: zone,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(days => [...new Set(days)].sort()),
  channelSlots: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), z.array(z.string().regex(SLOT_TIME)).min(1).max(SLOTS_MAX).transform(normalizeSlotsList))
    .refine(map => Object.keys(map).length <= 500, 'Too many channels.'),
  excluded: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), title: z.string().max(300) }).strict()).max(2000)
    .transform(list => [...new Map(list.map(item => [item.id, item])).values()]),
  autopilot: autopilotSchema,
  channels: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), z.object({
    slots: z.array(z.string().regex(SLOT_TIME)).min(1).max(SLOTS_MAX).transform(normalizeSlotsList),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(days => [...new Set(days)].sort()),
    order: z.enum(['newest', 'oldest']), firstCommentTemplate: z.string().min(1).max(limits.template),
    firstCommentDelayMinutes: z.number().int().min(limits.delay.min).max(limits.delay.max), paused: z.boolean(), pausedReason: z.string().max(300), autoTimes: z.boolean(), captionTitle: z.boolean(),
  }).partial().strict()).refine(map => Object.keys(map).length <= 500, 'Too many channels.'),
  horizonDays: z.number().int().min(limits.horizon.min).max(limits.horizon.max), distinctAcrossPages: z.boolean(),
  cooldownDays: z.number().int().min(limits.cooldown.min).max(limits.cooldown.max),
  firstCommentTemplate: z.string().min(1).max(limits.template), firstCommentDelayMinutes: z.number().int().min(limits.delay.min).max(limits.delay.max),
}).partial().strict();
export type PlanConfigPatch = z.infer<ReturnType<typeof planConfigPatchSchema>>;

/**
 * The saved patch, field by field (2026-11-16): a field that no longer validates falls back to its default alone.
 * A single bad value (a new limit, an old shape) never discards the rest: times, channels, exclusions, autopilot.
 */
export function salvagePatch(patch: unknown, limits: Parameters<typeof planConfigPatchSchema>[0]): PlanConfigPatch {
  const schema = planConfigPatchSchema(limits);
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch as Record<string, unknown> : {};
  const whole = schema.safeParse(source);
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    if (!(key in source)) continue;
    const one = (field as import('zod').ZodTypeAny).safeParse(source[key]);
    if (one.success && one.data !== undefined) out[key] = one.data;
    else if (key === 'autopilot') out[key] = salvageAutopilot(source[key]);
  }
  return out as PlanConfigPatch;
}

/** Defaults come from Root; the saved patch overrides field by field. */
export function resolveConfig(defaults: PlanConfig, patch: unknown, limits: Parameters<typeof planConfigPatchSchema>[0]): PlanConfig {
  const p = salvagePatch(patch, limits);
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
    } else if (key === 'autopilot') {
      // What the autopilot learned is never sent back by a form (2026-11-21): the server keeps its own copy, and full
      // saves carrying it were refused on the live site.
      const own = Object.fromEntries(Object.entries((config.autopilot ?? {}) as Record<string, unknown>).filter(([k]) => !(AUTOPILOT_LEARNED_KEYS as readonly string[]).includes(k)));
      const base = Object.fromEntries(Object.entries((defaults.autopilot ?? {}) as Record<string, unknown>).filter(([k]) => !(AUTOPILOT_LEARNED_KEYS as readonly string[]).includes(k)));
      if (!same(own, base)) patch[key] = own;
    } else if (!same(config[key], defaults[key])) patch[key] = config[key];
  }
  return patch;
}
export const normalizeSlots =(slots: readonly string[]): string[] => [...new Set(slots)].sort();
function normalizeSlotsList(slots: string[]): string[] { return [...new Set(slots)].sort(); }

/* ----- recipe parsing ----- */

export type Line = { text: string; heading: boolean };
export type Recipe = { title: string; description: string; servings: string; prep: string; cook: string; total: string; ingredients: Line[]; steps: Line[] };
const INGREDIENT_KEYS = ['text', 'name', 'ingredient', 'item', 'label', 'title', 'description'] as const;
const STEP_KEYS = ['text', 'instruction', 'description', 'step', 'content', 'name', 'title', 'label'] as const;
const GROUP_KEYS = ['items', 'ingredients', 'steps', 'list'] as const;
const HEADING_KEYS = ['title', 'name', 'section', 'group', 'heading', 'label'] as const;
const QUANTITY_KEYS = ['quantity', 'qty', 'amount'] as const;
const NOTE_KEYS = ['note', 'notes', 'preparation', 'comment'] as const;
const clean = (value: string) => decodeWordpressText(value).replace(/[^\S\u00a0\u202f]+/g, ' ').trim();
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
    title: asText(r['title']) || asText(fallbackTitle), description: asText(r['description']), servings: asText(r['servings']),
    prep: duration(r['prep_minutes'], minutesSuffix), cook: duration(r['cook_minutes'], minutesSuffix), total: duration(r['total_minutes'], minutesSuffix),
    ingredients, steps,
  };
}

/* ----- first comment ----- */

export type CommentOptions = { max: number; mark: string };
const PLACEHOLDER = /\{(title|description|ingredients|steps|servings|prep|cook|total|link)\}/g;

/**
 * Fill the template. Ingredients get bullets and steps numbers. A text over the limit loses steps first, then
 * ingredients (marked), and keeps the link when the template uses {link}; values are inserted literally in one pass.
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
  // Last resort: keep the link only when the template asks for it.
  const usesLink = /\{link\}/.test(template);
  const tail = usesLink ? `${options.mark}\n${link}` : options.mark;
  const keep = options.max - tail.length;
  return keep > 0 ? `${minimal.slice(0, keep).trimEnd()}${tail}` : (usesLink ? link : minimal).slice(0, options.max);
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
/** The permalink WordPress reported for the post, kept only when it is https on the blog's own host. */
export function reportedPermalink(siteUrl: string, link: string | undefined): string | null {
  if (!link) return null;
  try {
    const parsed = new URL(link), site = new URL(trimSite(siteUrl));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.hostname === site.hostname ? parsed.toString() : null;
  } catch { return null; }
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
export function slotInstants(input: { now: Date; slots: readonly string[]; timezone: string; horizonDays: number; leadMinutes: number; weekdays?: readonly number[] }): Date[] {
  const earliest = input.now.getTime() + input.leadMinutes * 60_000;
  const latest = input.now.getTime() + input.horizonDays * MS_DAY;
  const today = instantToWall(input.now, input.timezone).date;
  const found = new Set<number>();
  for (let day = 0; day <= input.horizonDays + 1; day += 1) {
    const date = addDaysToKey(today, day);
    // Days left out of the posting days get no slot (the weekday of a local date does not depend on the zone).
    if (input.weekdays && input.weekdays.length < 7 && !input.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
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
/** Same dish under another WordPress post (the site publishes near-identical variants): compared by recipe title. */
export const recipeTitleKey = (title: string) => `title:${title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;

export function allocateRecipes<C extends { wpPostId: string; title?: string }>(input: {
  needs: readonly SlotNeed[]; candidates: readonly C[]; blocked: ReadonlyMap<string, ReadonlySet<string>>; taken: ReadonlySet<string>; distinct: boolean; allowReuse?: boolean; reused?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Autopilot (2026-11-16): the order candidates are tried in for one slot (best score first). */
  rank?: (need: SlotNeed, candidates: readonly C[]) => readonly C[];
  /** Autopilot: a further condition (variety, winners' share), told about each assignment made. */
  fits?: (need: SlotNeed, candidate: C) => boolean;
  onAssign?: (need: SlotNeed, candidate: C) => void;
}): { assignments: Array<Allocation<C>>; unfilled: number } {
  const used = new Set(input.taken);
  const perPage = new Map<string, Set<string>>();
  const ranked = new Map<string, readonly C[]>();
  const assignments: Array<Allocation<C>> = [];
  let unfilled = 0;
  for (const need of input.needs) {
    const page = perPage.get(need.targetId) ?? new Set(input.blocked.get(need.targetId) ?? []);
    perPage.set(need.targetId, page);
    const dates = input.reused?.get(need.targetId);
    const candidates = ranked.get(need.targetId) ?? (dates?.size ? [...input.candidates].sort((a, b) => (dates.get(a.wpPostId) ?? -Infinity) - (dates.get(b.wpPostId) ?? -Infinity)) : input.candidates);
    ranked.set(need.targetId, candidates);
    const titleKey = (c: C) => c.title ? recipeTitleKey(c.title) : null;
    const usable = (c: C) => { const key = titleKey(c);
      return !(input.allowReuse === false && dates?.has(c.wpPostId)) && !page.has(c.wpPostId) && !(key && page.has(key)) && !(input.distinct && (used.has(c.wpPostId) || (key && used.has(key)))) && !need.avoid?.has(c.wpPostId); };
    const order = input.rank ? input.rank(need, candidates) : candidates;
    const pick = order.find(c => usable(c) && (!input.fits || input.fits(need, c))) ?? (input.fits ? order.find(usable) : undefined);
    if (!pick) { unfilled += 1; continue; }
    const pickedTitle = titleKey(pick);
    page.add(pick.wpPostId); used.add(pick.wpPostId);
    if (pickedTitle) { page.add(pickedTitle); used.add(pickedTitle); }
    assignments.push({ targetId: need.targetId, slotAt: need.slotAt, candidate: pick });
    input.onAssign?.(need, pick);
  }
  return { assignments, unfilled };
}

/* ----- confirmations ----- */

export const saveRecipeSourceConfirmation = (name: string) => `SAVE RECIPE SOURCE ${name}`;
export const runRecipePlannerConfirmation = 'RUN RECIPE PLANNER';
export const pauseRecipeSourceConfirmation = 'PAUSE RECIPE SOURCE';
export const resumeRecipeSourceConfirmation = 'RESUME RECIPE SOURCE';
export const retryRecipeSlotsConfirmation = 'RETRY RECIPE SLOTS';
/** Confirmation for giving one planned slot a different recipe. */
export const replaceRecipeSlotConfirmation = (planId: string) => `REPLACE RECIPE ${planId}`;
export const pauseAndCancelRecipeSourceConfirmation = 'PAUSE RECIPE SOURCE AND CANCEL SCHEDULED POSTS';
