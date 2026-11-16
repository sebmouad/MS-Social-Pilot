import { prisma } from '@/server/data';
import { RECIPE_KINDS, dishWord, type RecipeKind } from '../wordpress/score';
import { postScore } from '../wordpress/autopilot';
import type { FeedActor } from './access';

/** AI ratings of one recipe; a missing rating is null. */
export type Rating = { kind: RecipeKind | null; hook: number | null; photo: number | null };
/** One published recipe post and how it did relative to its channel's usual (1 = usual). */
export type Outcome = { targetId: string; wpPostId: string; title: string; slotAt: Date; relative: number };

/** What scoring reads and writes; the planner works without it (tests, AI off). */
export type ScoringPorts = {
  ratings(sourceId: string, ids: readonly string[]): Promise<Map<string, Rating>>;
  /** Rate unrated recipes with AI (title hook and kind) and store the ratings; at most a batch per call. */
  rate(actor: FeedActor, source: { id: string; workspaceId: string }, items: ReadonlyArray<{ id: string; title: string }>): Promise<void>;
  /** Rate how appetising a few photos are, with AI vision. */
  ratePhotos(actor: FeedActor, source: { id: string; workspaceId: string }, items: ReadonlyArray<{ id: string; imageUrl: string }>): Promise<void>;
  outcomes(sourceId: string, since: Date): Promise<Outcome[]>;
  /** Highest temperature by local date (YYYY-MM-DD) for the next days; empty when unknown. */
  weather(latitude: number, longitude: number, timeZone: string): Promise<Map<string, number>>;
};

export const RATE_BATCH = 40;
export const PHOTO_BATCH = 2;

const RATE_SYSTEM = `You rate recipe posts for a French Facebook food page. For each recipe give:
- kind: one of ${RECIPE_KINDS.join(', ')}
- hook: 0 to 10, how much the title makes people stop scrolling and want to cook it (10 irresistible, 5 ordinary, 0 dull or confusing).
Answer only with a JSON array, one object per recipe, in the order given: [{"id":"…","kind":"…","hook":7}]`;
const PHOTO_SYSTEM = 'Rate how appetising this food photo is in a Facebook feed, from 0 to 10: light, sharpness, colour, the dish shown close and inviting. Answer only with the number.';

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

/** Each outcome's dish family and its average result: how « gratin » or « quiche » usually does here. */
export function dishHistory(outcomes: readonly Outcome[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const o of outcomes) { const word = dishWord(o.title); if (!word) continue; const s = sums.get(word) ?? { total: 0, count: 0 }; s.total += o.relative; s.count++; sums.set(word, s); }
  // Two posts or more before a family counts, pulled towards usual.
  return new Map([...sums].filter(([, s]) => s.count >= 2).map(([word, s]) => [word, (s.total + 1) / (s.count + 1)]));
}

const weatherCache = new Map<string, { at: number; days: Map<string, number> }>();

export const prismaScoringPorts: ScoringPorts = {
  async ratings(sourceId, ids) {
    if (!ids.length) return new Map();
    const rows = await prisma.$queryRaw<Array<{ wpPostId: string; kind: string | null; hook: number | null; photo: number | null }>>`SELECT "wpPostId", kind, hook, photo FROM recipe_ratings WHERE "sourceId" = ${sourceId} AND "wpPostId" = ANY(${[...ids]}::text[])`;
    return new Map(rows.map(row => [row.wpPostId, { kind: (RECIPE_KINDS as readonly string[]).includes(row.kind ?? '') ? row.kind as RecipeKind : null, hook: row.hook, photo: row.photo }]));
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
    for (const item of items.slice(0, PHOTO_BATCH)) {
      try {
        const bytes = await image.download(item.imageUrl, { timeoutMs: 10_000, maxBytes: 15_000_000, maxRedirects: 3, allowHttp: false, hostAllowlist: [] });
        const small = await convertToJpeg(bytes, { maxPixels: 600_000, quality: 75, minQuality: 50, qualityStep: 10, maxOutputBytes: 400_000 });
        const raw = await autopilotComplete(actor, 'autopilot.photo', PHOTO_SYSTEM, 'Rate this photo.', { image: { mimeType: 'image/jpeg', base64: small.toString('base64') }, maxTokens: 20 });
        const value = Number((raw.match(/\d+(\.\d+)?/) ?? [])[0]);
        if (!Number.isFinite(value)) continue;
        await prisma.$executeRaw`INSERT INTO recipe_ratings ("sourceId", "wpPostId", "workspaceId", photo, "photoAt", "ratedAt") VALUES (${source.id}, ${item.id}, ${source.workspaceId}, ${Math.max(0, Math.min(10, Math.round(value)))}, NOW(), NOW())
          ON CONFLICT ("sourceId", "wpPostId") DO UPDATE SET photo = EXCLUDED.photo, "photoAt" = NOW()`;
      } catch { /* a photo that cannot be read or rated is tried again on a later run */ }
    }
  },
  async outcomes(sourceId, since) {
    const rows = await prisma.$queryRaw<Array<{ targetId: string; wpPostId: string; title: string | null; slotAt: Date; insights: unknown }>>`SELECT l."targetId", l."wpPostId", l.title, l."slotAt", ep.insights
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
    return scored.map(row => ({ targetId: row.targetId, wpPostId: row.wpPostId, title: row.title, slotAt: row.slotAt, relative: row.score / (medians.get(row.targetId) || 1) }));
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
