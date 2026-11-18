import { prisma } from '@/server/data';
import { RECIPE_KINDS, titleWords, type RecipeKind } from '../wordpress/score';
import { postScore } from '../wordpress/autopilot';
import type { FeedActor } from './access';

/** AI ratings of one recipe; a missing rating is null. */
export type Rating = { kind: RecipeKind | null; hook: number | null; photo: number | null; traits?: string[] | null };
/** One published recipe post and how it did relative to its channel's usual (1 = usual). */
export type Outcome = { targetId: string; wpPostId: string; title: string; slotAt: Date; relative: number; style?: string | null };

/** What scoring reads and writes; the planner works without it (tests, AI off). */
export type ScoringPorts = {
  ratings(sourceId: string, ids: readonly string[]): Promise<Map<string, Rating>>;
  /** Rate unrated recipes with AI (title hook and kind) and store the ratings; at most a batch per call. */
  rate(actor: FeedActor, source: { id: string; workspaceId: string }, items: ReadonlyArray<{ id: string; title: string }>): Promise<void>;
  /** Look at photos with AI vision (2026-11-18): how appetising, and which visual traits. Returns how many were read. */
  ratePhotos(actor: FeedActor, source: { id: string; workspaceId: string }, items: ReadonlyArray<{ id: string; imageUrl: string }>): Promise<number | void>;
  outcomes(sourceId: string, since: Date): Promise<Outcome[]>;
  /** Each Page's memory (2026-11-18); absent in tests and before the first run. */
  memories?(sourceId: string): Promise<Map<string, import('../wordpress/memory').PageMemory>>;
  /** Highest temperature by local date (YYYY-MM-DD) for the next days; empty when unknown. */
  weather(latitude: number, longitude: number, timeZone: string): Promise<Map<string, number>>;
};

export const RATE_BATCH = 40;
/** Photos read at once (in parallel) by one call. */
export const PHOTO_BATCH = 12;
/** What the AI may see in a recipe photo; anything else it says is ignored. */
export const PHOTO_TRAITS = ['close_up', 'overhead', 'side_angle', 'collage', 'steps_shown', 'text_overlay', 'cheese_pull', 'melting', 'golden_crust', 'glossy_sauce', 'steam', 'cut_open', 'generous_portion', 'single_serving', 'rustic', 'elegant_plating', 'bright', 'dark', 'colorful', 'hands', 'ingredients_around', 'plain_background'] as const;

const RATE_SYSTEM = `You rate recipe posts for a French Facebook food page. For each recipe give:
- kind: one of ${RECIPE_KINDS.join(', ')}
- hook: 0 to 10, how much the title makes people stop scrolling and want to cook it (10 irresistible, 5 ordinary, 0 dull or confusing).
Answer only with a JSON array, one object per recipe, in the order given: [{"id":"…","kind":"…","hook":7}]`;
const PHOTO_SYSTEM = `You look at the photo of a recipe post for a French Facebook food page.
- appeal: 0 to 10, how much it makes people stop scrolling (light, sharpness, colour, the dish shown close and inviting).
- traits: every one of these that clearly applies: ${PHOTO_TRAITS.join(', ')}.
Answer only with JSON: {"appeal":7,"traits":["close_up","golden_crust"]}`;

/** The AI's answer about a photo; an unreadable answer gives null. */
export function parsePhoto(raw: string): { appeal: number; traits: string[] } | null {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(raw.slice(start, end + 1)) as { appeal?: unknown; traits?: unknown };
      const appeal = Number(value.appeal);
      if (Number.isFinite(appeal)) return { appeal: Math.max(0, Math.min(10, Math.round(appeal))), traits: Array.isArray(value.traits) ? [...new Set(value.traits.filter((t): t is string => typeof t === 'string' && (PHOTO_TRAITS as readonly string[]).includes(t)))] : [] };
    } catch { /* fall through to a bare number */ }
  }
  const bare = Number((raw.match(/\d+(\.\d+)?/) ?? [])[0]);
  return Number.isFinite(bare) ? { appeal: Math.max(0, Math.min(10, Math.round(bare))), traits: [] } : null;
}

/** Read the AI's answer to a rating batch; anything malformed is skipped. */
export function parseRatings(raw: string, ids: ReadonlySet<string>): Map<string, { kind: RecipeKind | null; hook: number | null }> {
  const out = new Map<string, { kind: RecipeKind | null; hook: number | null }>();
  const start = raw.indexOf('['); const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return out;
  let list: unknown;
  try { list = JSON.parse(raw.slice(start, end + 1)); } catch { return out; }
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, kind, hook } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !ids.has(id)) continue;
    const k = typeof kind === 'string' && (RECIPE_KINDS as readonly string[]).includes(kind) ? kind as RecipeKind : null;
    const h = typeof hook === 'number' && Number.isFinite(hook) ? Math.max(0, Math.min(10, Math.round(hook))) : null;
    out.set(id, { kind: k, hook: h });
  }
  return out;
}

/**
 * What works on each channel (2026-11-18, owner: « the score must be based on what works on each page »). Every word
 * of a published recipe's title (ingredient, dish, technique) learns how that post did against its channel's usual, on
 * a log scale (one viral post cannot dominate; capped at 20×), recent posts counting more (half-life `halfLifeDays`).
 * A channel with little evidence on a word borrows what the other channels learned, and relies on its own as it grows
 * (`k` posts' worth of pull). A recipe's value on a channel is the mean of its three strongest known words, as a
 * multiplier of usual (1 = usual), or null when none of its words was ever published.
 * Checked on a month of live posts (2026-11-18): as good as or better than the single-word history on every test week.
 */
export function pageLearning(outcomes: readonly Outcome[], now: Date, options: { halfLifeDays?: number; k?: number } = {}): (targetId: string | null, title: string) => number | null {
  const half = options.halfLifeDays ?? 30; const k = options.k ?? 3; const cap = Math.log(20);
  const all = new Map<string, { sum: number; weight: number }>();
  const own = new Map<string, { sum: number; weight: number }>();
  const add = (map: Map<string, { sum: number; weight: number }>, key: string, value: number, weight: number) => { const s = map.get(key) ?? { sum: 0, weight: 0 }; s.sum += weight * value; s.weight += weight; map.set(key, s); };
  for (const o of outcomes) {
    if (!(o.relative > 0) || !Number.isFinite(o.relative)) continue;
    const value = Math.max(-cap, Math.min(cap, Math.log(o.relative)));
    const weight = 0.5 ** (Math.max(0, now.getTime() - o.slotAt.getTime()) / 86_400_000 / half);
    for (const word of titleWords(o.title)) { add(all, word, value, weight); add(own, `${o.targetId}|${word}`, value, weight); }
  }
  const lift = (targetId: string | null, word: string): number | null => {
    const shared = all.get(word);
    if (!shared) return null;
    const general = shared.sum / (shared.weight + k);
    if (!targetId) return general;
    const mine = own.get(`${targetId}|${word}`) ?? { sum: 0, weight: 0 };
    return (mine.sum + k * general) / (mine.weight + k);
  };
  return (targetId, title) => {
    const known = titleWords(title).flatMap(word => { const value = lift(targetId, word); return value === null ? [] : [value]; }).sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 3);
    return known.length ? Math.exp(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
  };
}

const weatherCache = new Map<string, { at: number; days: Map<string, number> }>();

export const prismaScoringPorts: ScoringPorts = {
  async memories(sourceId) { const { readPageMemories } = await import('./wordpress-memory'); return readPageMemories(sourceId); },
  async ratings(sourceId, ids) {
    if (!ids.length) return new Map();
    const rows = await prisma.$queryRaw<Array<{ wpPostId: string; kind: string | null; hook: number | null; photo: number | null; photoTraits: string[] | null }>>`SELECT "wpPostId", kind, hook, photo, "photoTraits" FROM recipe_ratings WHERE "sourceId" = ${sourceId} AND "wpPostId" = ANY(${[...ids]}::text[])`;
    return new Map(rows.map(row => [row.wpPostId, { kind: (RECIPE_KINDS as readonly string[]).includes(row.kind ?? '') ? row.kind as RecipeKind : null, hook: row.hook, photo: row.photo, traits: row.photoTraits }]));
  },
  async rate(actor, source, items) {
    const batch = items.slice(0, RATE_BATCH);
    if (!batch.length) return;
    const { autopilotComplete } = await import('@/modules/studio/server/ai');
    const prompt = batch.map(item => `${item.id} | ${item.title.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
    const raw = await autopilotComplete(actor, 'autopilot.rate', RATE_SYSTEM, prompt, { maxTokens: 2500 });
    const parsed = parseRatings(raw, new Set(batch.map(item => item.id)));
    for (const [id, rating] of parsed) {
      await prisma.$executeRaw`INSERT INTO recipe_ratings ("sourceId", "wpPostId", "workspaceId", kind, hook, "ratedAt") VALUES (${source.id}, ${id}, ${source.workspaceId}, ${rating.kind}, ${rating.hook}, NOW())
        ON CONFLICT ("sourceId", "wpPostId") DO UPDATE SET kind = EXCLUDED.kind, hook = EXCLUDED.hook, "ratedAt" = NOW()`;
    }
  },
  async ratePhotos(actor, source, items) {
    const { autopilotComplete } = await import('@/modules/studio/server/ai');
    const { defaultImagePorts, convertToJpeg } = await import('../wordpress/image');
    const { defaultFetchDeps } = await import('@/modules/publishing/server/media/network/net-guard');
    const image = defaultImagePorts(defaultFetchDeps());
    let read = 0;
    const one = async (item: { id: string; imageUrl: string }) => {
      const bytes = await image.download(item.imageUrl, { timeoutMs: 10_000, maxBytes: 15_000_000, maxRedirects: 3, allowHttp: false, hostAllowlist: [] });
      const small = await convertToJpeg(bytes, { maxPixels: 600_000, quality: 75, minQuality: 50, qualityStep: 10, maxOutputBytes: 400_000 });
      const seen = parsePhoto(await autopilotComplete(actor, 'autopilot.photo', PHOTO_SYSTEM, 'The photo.', { image: { mimeType: 'image/jpeg', base64: small.toString('base64') }, maxTokens: 300 }));
      if (!seen) return;
      await prisma.$executeRaw`INSERT INTO recipe_ratings ("sourceId", "wpPostId", "workspaceId", photo, "photoTraits", "photoAt", "ratedAt") VALUES (${source.id}, ${item.id}, ${source.workspaceId}, ${seen.appeal}, ${seen.traits}::text[], NOW(), NOW())
        ON CONFLICT ("sourceId", "wpPostId") DO UPDATE SET photo = EXCLUDED.photo, "photoTraits" = EXCLUDED."photoTraits", "photoAt" = NOW()`;
      read++;
    };
    // Four at a time. A photo that cannot be read is tried again on a later run; the AI over its limit stops the batch.
    const queue = items.slice(0, PHOTO_BATCH);
    for (let index = 0; index < queue.length; index += 4) {
      const outcomes = await Promise.allSettled(queue.slice(index, index + 4).map(one));
      const { OperationError } = await import('@/lib/operation-error');
      if (outcomes.some(o => o.status === 'rejected' && o.reason instanceof OperationError && (o.reason.code === 'conflict' || o.reason.code === 'unavailable'))) break;
    }
    return read;
  },
  async outcomes(sourceId, since) {
    const rows = await prisma.$queryRaw<Array<{ targetId: string; wpPostId: string; title: string | null; slotAt: Date; insights: unknown; style: string | null }>>`SELECT l."targetId", l."wpPostId", l.title, l."slotAt", l.style, ep.insights
      FROM wordpress_recipe_plans l
      JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
      JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
      WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."slotAt" >= ${since} AND ep.insights IS NOT NULL`;
    const scored = rows.flatMap(row => { const score = postScore(row.insights); return score === null ? [] : [{ ...row, title: row.title ?? '', score }]; });
    const medians = new Map<string, number>();
    for (const targetId of new Set(scored.map(row => row.targetId))) {
      const values = scored.filter(row => row.targetId === targetId).map(row => row.score).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      medians.set(targetId, values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2);
    }
    return scored.map(row => ({ targetId: row.targetId, wpPostId: row.wpPostId, title: row.title, slotAt: row.slotAt, style: row.style, relative: row.score / (medians.get(row.targetId) || 1) }));
  },
  async weather(latitude, longitude, timeZone) {
    const key = `${latitude.toFixed(2)}|${longitude.toFixed(2)}|${timeZone}`;
    const hit = weatherCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.days;
    const days = new Map<string, number>();
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max&forecast_days=7&timezone=${encodeURIComponent(timeZone)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await response.json() as { daily?: { time?: unknown; temperature_2m_max?: unknown } };
      const times = Array.isArray(body.daily?.time) ? body.daily!.time as unknown[] : [];
      const temps = Array.isArray(body.daily?.temperature_2m_max) ? body.daily!.temperature_2m_max as unknown[] : [];
      times.forEach((date, i) => { if (typeof date === 'string' && typeof temps[i] === 'number') days.set(date, temps[i] as number); });
    } catch { /* weather is a bonus: without it, recipes are scored without it */ }
    weatherCache.set(key, { at: Date.now(), days });
    return days;
  },
};

