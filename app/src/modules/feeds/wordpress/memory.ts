import { instantToWall } from '@/lib/calendar-dates';
import { guessKind, titleWords, type RecipeKind } from './score';
import { HOOK_STYLES, type HookStyle } from './caption';

/**
 * The autopilot's memory of each Page (2026-11-18, owner: « continuous learning per page, from reach, engagement,
 * posting time, content… learn from all data, store memory and update it, and use it from now »).
 *
 * Every published recipe post, once its figures have settled, teaches its Page's memory: how it did against that
 * Page's usual (reach and engagement), and what it was: title words, dish kind, hour, weekday, dish × time of day,
 * caption traits and hook style. Lessons fade with time (half-life MEMORY_HALF_LIFE_DAYS), so the memory follows the
 * audience. A Page with little evidence on something borrows what the other Pages learned. Pure: the server stores it.
 */
export type FeatureStat = { s: number; w: number; n: number };
export type PageMemory = {
  v: 1;
  /** When the stats were last brought to « now » (decayed). */
  at: string;
  /** Posts learned from, all time. */
  posts: number;
  /** The Page's usual, as running means of log(1 + value). */
  usual: Usual | null;
  /** Feature → weighted sum of results (s), weight (w) and posts (n). */
  f: Record<string, FeatureStat>;
  /** How a title word was written, for people (« gratinées » for « gratinee »). */
  names?: Record<string, string>;
};
export type LearnedPost = { at: Date; title: string; kind: string | null; style: string | null; caption: string; reach: number; reactions: number; comments: number; shares: number;
  /** What the AI saw in the photo (2026-11-18): visual traits and appeal 0–10, when read. */
  traits?: readonly string[] | null; appeal?: number | null;
  /** Posted by the autopilot, or outside it (by hand, another tool) (2026-11-18); and its format. */
  origin?: 'app' | 'external'; format?: PostFormat | null };
export type PostFormat = 'photo' | 'video' | 'link' | 'text';
/** Facebook's post type as a format. */
export const formatOf = (statusType: string | null | undefined, hasPicture = false): PostFormat => {
  const t = (statusType ?? '').toLowerCase();
  return t.includes('video') ? 'video' : t.includes('photo') ? 'photo' : t === 'shared_story' ? 'link' : hasPicture ? 'photo' : 'text';
};
type Usual = { reach: number; reactions: number; comments: number; shares: number };
/** How a post's result is made (2026-11-18, owner: learn from comments, shares, any data): shares spread a post furthest. */
const SIGNALS: ReadonlyArray<[keyof Usual, number]> = [['reach', 0.45], ['reactions', 0.2], ['comments', 0.15], ['shares', 0.2]];

export const MEMORY_HALF_LIFE_DAYS = 30;
/** Posts' worth of pull towards what the other Pages learned. */
const K = 3;
/** A single post moves a lesson by at most 20× (one viral post cannot dominate). */
const CAP = Math.log(20);
/** How much the Page's usual follows each new post. */
const USUAL_RATE = 0.03;
const DAY = 86_400_000;

export const daypart = (hour: number) => hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
const EMOJI = /\p{Extended_Pictographic}/gu;

/** What a post was: its content, time and caption, as features. */
export const appealBand = (appeal: number) => appeal >= 8 ? 'high' : appeal >= 6 ? 'mid' : 'low';
export function postFeatures(post: Pick<LearnedPost, 'at' | 'title' | 'kind' | 'style' | 'caption' | 'traits' | 'appeal' | 'origin' | 'format'>, timeZone: string): string[] {
  const kind = (post.kind as RecipeKind | null) ?? guessKind(post.title);
  const wall = instantToWall(post.at, timeZone);
  const hour = Number(wall.time.slice(0, 2));
  const weekday = new Date(`${wall.date}T12:00:00Z`).getUTCDay();
  const text = post.caption.trim();
  const out = [...titleWords(post.title).map(word => `w:${word}`), `k:${kind}`, `h:${hour}`, `d:${weekday}`, `kd:${kind}@${daypart(hour)}`, `kw:${kind}@${weekday === 0 || weekday === 6 ? 'weekend' : 'week'}`];
  // Promises in the title (« rapide », « facile », « en 20 minutes »), which title words leave out as filler.
  const folded = ` ${post.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()} `;
  if (/\b(rapide|express|minute|minutes|\d+\s?min)\b/.test(folded)) out.push('t:quick');
  if (/\b(facile|simple|inratable)\b/.test(folded)) out.push('t:easy');
  if (text) {
    const firstSentence = text.split(/(?<=[.!?…])\s|\n/)[0] ?? '';
    const emoji = (text.match(EMOJI) ?? []).length;
    out.push(firstSentence.trim().endsWith('?') ? 'c:qstart' : 'c:noqstart', text.endsWith('?') ? 'c:qend' : 'c:noqend',
      emoji === 0 ? 'c:emoji0' : emoji <= 2 ? 'c:emoji1' : 'c:emoji3', text.length < 150 ? 'c:short' : text.length < 300 ? 'c:medium' : 'c:long', text.includes('#') ? 'c:hash' : 'c:nohash');
  }
  if (post.style && (HOOK_STYLES as readonly string[]).includes(post.style)) out.push(`s:${post.style}`);
  for (const trait of post.traits ?? []) out.push(`i:${trait}`);
  if (typeof post.appeal === 'number') out.push(`p:${appealBand(post.appeal)}`);
  if (post.origin) out.push(`o:${post.origin}`);
  if (post.format) out.push(`f:${post.format}`);
  return out;
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };

/**
 * Learn from new posts: the memory is first brought to `now` (older lessons fade), then each post adds its result to
 * its features. A post's result weighs reach 45 %, shares 20 %, reactions 20 % and comments 15 %, each against the Page's usual.
 */
export function absorb(memory: PageMemory | null, posts: readonly LearnedPost[], now: Date, timeZone: string): PageMemory {
  const next: PageMemory = memory ? { ...memory, f: { ...memory.f }, names: { ...(memory.names ?? {}) } } : { v: 1, at: now.toISOString(), posts: 0, usual: null, f: {}, names: {} };
  const fade = 0.5 ** (Math.max(0, now.getTime() - Date.parse(next.at)) / DAY / MEMORY_HALF_LIFE_DAYS);
  if (fade < 1) for (const [key, stat] of Object.entries(next.f)) next.f[key] = { s: stat.s * fade, w: stat.w * fade, n: stat.n };
  const usable = posts.filter(post => SIGNALS.every(([key]) => Number.isFinite(post[key]) && post[key] >= 0)).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!next.usual && usable.length) next.usual = Object.fromEntries(SIGNALS.map(([key]) => [key, median(usable.map(post => Math.log1p(post[key])))])) as Usual;
  for (const post of usable) {
    const usual = next.usual!;
    const y = SIGNALS.reduce((sum, [key, share]) => sum + share * Math.max(-CAP, Math.min(CAP, Math.log1p(post[key]) - usual[key])), 0);
    const weight = 0.5 ** (Math.max(0, now.getTime() - post.at.getTime()) / DAY / MEMORY_HALF_LIFE_DAYS);
    for (const feature of postFeatures(post, timeZone)) {
      const stat = next.f[feature] ?? { s: 0, w: 0, n: 0 };
      next.f[feature] = { s: stat.s + weight * y, w: stat.w + weight, n: stat.n + 1 };
    }
    for (const token of post.title.toLocaleLowerCase('fr').split(/[^\p{L}]+/u)) { const [word] = titleWords(token); if (word) next.names![word] = token; }
    next.usual = Object.fromEntries(SIGNALS.map(([key]) => [key, usual[key] + USUAL_RATE * (Math.log1p(post[key]) - usual[key])])) as Usual;
  }
  next.at = now.toISOString();
  next.posts += usable.length;
  return next;
}

export type CaptionTip = { code: 'qstart' | 'noqstart' | 'qend' | 'noqend' | 'emoji0' | 'emoji1' | 'emoji3' | 'short' | 'medium' | 'long' | 'hash' | 'nohash'; times: number };
export type Highlights = { formats: Array<{ format: string; times: number; posts: number }>; origins: Array<{ origin: string; times: number; posts: number }>; photos: Array<{ trait: string; times: number }>; posts: number; best: Array<{ word: string; times: number }>; worst: Array<{ word: string; times: number }>; hours: Array<{ hour: number; times: number }>; kinds: Array<{ kind: string; times: number }>; tips: CaptionTip[]; style: HookStyle | null };

/** What all Pages' memories teach, and each Page's own lessons on top. */
export function memoryModel(memories: ReadonlyMap<string, PageMemory>) {
  const global = new Map<string, { s: number; w: number }>();
  for (const memory of memories.values()) for (const [key, stat] of Object.entries(memory.f)) { const g = global.get(key) ?? { s: 0, w: 0 }; g.s += stat.s; g.w += stat.w; global.set(key, g); }
  /** A feature's value on a Page, as log of the usual (0 = usual); null when no Page ever had it. */
  const lift = (targetId: string | null, feature: string): number | null => {
    const g = global.get(feature);
    if (!g) return null;
    const general = g.s / (g.w + K);
    const own = targetId ? memories.get(targetId)?.f[feature] : undefined;
    return own ? (own.s + K * general) / (own.w + K) : general;
  };
  const ownPosts = (targetId: string, feature: string) => memories.get(targetId)?.f[feature]?.n ?? 0;
  /** Among choices, the one this Page's own posts favour, when each has at least `min` of them. */
  const better = <C extends CaptionTip['code']>(targetId: string, choices: readonly C[], min: number): { choice: C; times: number } | null => {
    const known = choices.filter(choice => ownPosts(targetId, `c:${choice}`) >= min).map(choice => ({ choice, value: lift(targetId, `c:${choice}`)! }));
    if (known.length < 2) return null;
    known.sort((a, b) => b.value - a.value);
    return known[0]!.value - known[known.length - 1]!.value >= 0.15 ? { choice: known[0]!.choice, times: Math.exp(known[0]!.value - known[known.length - 1]!.value) } : null;
  };
  return {
    lift,
    /**
     * How a recipe would do on a Page at a time, from that Page's memory (1 = usual; null when nothing is known):
     * its three strongest title words (2), its dish kind (1), the kind at that time of day (1) and that day of week (½),
     * and the « quick » or « easy » promise of its title (½ each).
     */
    contentValue(targetId: string | null, title: string, kind: string | null, slotAt: Date | null, timeZone: string, photo?: { traits?: readonly string[] | null; appeal?: number | null } | null): number | null {
      const words = titleWords(title).flatMap(word => { const value = lift(targetId, `w:${word}`); return value === null ? [] : [value]; }).sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 3);
      const k = (kind as RecipeKind | null) ?? guessKind(title);
      const wall = slotAt ? instantToWall(slotAt, timeZone) : null;
      const weekday = wall ? new Date(`${wall.date}T12:00:00Z`).getUTCDay() : null;
      const folded = ` ${title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()} `;
      const parts: Array<[number | null, number]> = [[words.length ? words.reduce((sum, value) => sum + value, 0) / words.length : null, 2], [lift(targetId, `k:${k}`), 1],
        [wall ? lift(targetId, `kd:${k}@${daypart(Number(wall.time.slice(0, 2)))}`) : null, 1],
        [weekday !== null ? lift(targetId, `kw:${k}@${weekday === 0 || weekday === 6 ? 'weekend' : 'week'}`) : null, 0.5],
        [/\b(rapide|express|minute|minutes|\d+\s?min)\b/.test(folded) ? lift(targetId, 't:quick') : null, 0.5],
        [/\b(facile|simple|inratable)\b/.test(folded) ? lift(targetId, 't:easy') : null, 0.5],
        // What the photo shows and how appetising it is (2026-11-18): the three strongest known traits, and the appeal band.
        [(() => { const known = (photo?.traits ?? []).flatMap(trait => { const v = lift(targetId, `i:${trait}`); return v === null ? [] : [v]; }).sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 3); return known.length ? known.reduce((s, v) => s + v, 0) / known.length : null; })(), 1.5],
        [typeof photo?.appeal === 'number' ? lift(targetId, `p:${appealBand(photo.appeal)}`) : null, 1]];
      const known = parts.filter((part): part is [number, number] => part[0] !== null);
      if (!known.length) return null;
      return Math.exp(known.reduce((sum, [value, weight]) => sum + value * weight, 0) / known.reduce((sum, [, weight]) => sum + weight, 0));
    },
    /**
     * A Page's posting times from its memory (2026-11-18, owner: « posts at 7 h do better, use it »): its `count` best
     * hours inside the window, at least `gapMinutes` apart, only hours some Page has evidence for; `minute` past the hour.
     * Null when too few hours are known to fill `count`.
     */
    bestTimes(targetId: string, count: number, window: readonly [number, number], gapMinutes: number, minute = 0): string[] | null {
      const ranked = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => hour >= window[0] && hour < window[1])
        .flatMap(hour => { const value = lift(targetId, `h:${hour}`); return value === null ? [] : [{ hour, value }]; }).sort((a, b) => b.value - a.value || a.hour - b.hour);
      const picked: number[] = [];
      for (const { hour } of ranked) if (picked.length < count && !picked.some(other => Math.abs(other - hour) * 60 < gapMinutes)) picked.push(hour);
      return picked.length === count ? picked.sort((a, b) => a - b).map(hour => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`) : null;
    },
    /** The hook style this Page's own posts favour (at least three posts each), or null. */
    bestStyle(targetId: string): HookStyle | null {
      const known = HOOK_STYLES.filter(style => ownPosts(targetId, `s:${style}`) >= 3).map(style => ({ style, value: lift(targetId, `s:${style}`)! })).sort((a, b) => b.value - a.value);
      return known.length >= 2 ? known[0]!.style : null;
    },
    /** Caption traits this Page's own posts clearly favour (at least five posts on each side, 15 % apart or more). */
    captionTips(targetId: string): CaptionTip[] {
      return ([['qstart', 'noqstart'], ['qend', 'noqend'], ['emoji0', 'emoji1', 'emoji3'], ['short', 'medium', 'long'], ['hash', 'nohash']] as const)
        .flatMap(group => { const found = better(targetId, group, 5); return found ? [{ code: found.choice, times: found.times }] : []; });
    },
    /** What a Page has learned, for people: words, hours and kinds it favours or not (own evidence only). */
    highlights(targetId: string, count = 3): Highlights {
      const memory = memories.get(targetId);
      const own = Object.entries(memory?.f ?? {}).filter(([, stat]) => stat.n >= 3).map(([key]) => ({ key, times: Math.exp(lift(targetId, key) ?? 0) }));
      const of = (prefix: string) => own.filter(item => item.key.startsWith(prefix)).map(item => ({ ...item, name: item.key.slice(prefix.length) }));
      const words = of('w:');
      return {
        posts: memory?.posts ?? 0,
        best: words.filter(w => w.times >= 1.15).sort((a, b) => b.times - a.times).slice(0, count).map(w => ({ word: memory?.names?.[w.name] ?? w.name, times: w.times })),
        worst: words.filter(w => w.times <= 0.85).sort((a, b) => a.times - b.times).slice(0, count).map(w => ({ word: memory?.names?.[w.name] ?? w.name, times: w.times })),
        hours: of('h:').filter(h => h.times >= 1.1).sort((a, b) => b.times - a.times).slice(0, count).map(h => ({ hour: Number(h.name), times: h.times })),
        kinds: of('k:').filter(k => k.times >= 1.1).sort((a, b) => b.times - a.times).slice(0, 2).map(k => ({ kind: k.name, times: k.times })),
        formats: of('f:').map(f => ({ format: f.name, times: f.times, posts: memory?.f[f.key]?.n ?? 0 })).sort((a, b) => b.times - a.times),
        origins: of('o:').map(o => ({ origin: o.name, times: o.times, posts: memory?.f[o.key]?.n ?? 0 })).sort((a, b) => b.times - a.times),
        photos: of('i:').filter(p => p.times >= 1.1).sort((a, b) => b.times - a.times).slice(0, count).map(p => ({ trait: p.name, times: p.times })),
        tips: this.captionTips(targetId), style: this.bestStyle(targetId),
      };
    },
  };
}
export type MemoryModel = ReturnType<typeof memoryModel>;

/** Caption instructions for the AI writer from a Page's tips (English, for the prompt). */
export function captionGuidance(tips: readonly CaptionTip[]): string[] {
  const text: Record<CaptionTip['code'], string> = {
    qstart: 'On this page, opening with a question works best.', noqstart: 'On this page, do not open with a question.',
    qend: 'On this page, ending with a short question works best.', noqend: 'On this page, do not end with a question.',
    emoji0: 'On this page, use no emoji.', emoji1: 'On this page, use one or two emojis only.', emoji3: 'On this page, several emojis work well.',
    short: 'On this page, short captions (under 150 characters) work best.', medium: 'On this page, captions of 150 to 300 characters work best.', long: 'On this page, fuller captions (over 300 characters) work best.',
    hash: 'On this page, end with one or two fitting hashtags.', nohash: 'On this page, use no hashtag.',
  };
  return tips.map(tip => text[tip.code]);
}
