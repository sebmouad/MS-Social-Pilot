import { z } from 'zod';

/**
 * Recipe autopilot (2026-11-16, docs/autopilot-plan.md): settings and the pure learning logic.
 * Best times: each channel's posting times move to the hours its own audience responds to most.
 */
export type AutopilotLogEntry = { at: string; kind: 'times' | 'healing' | 'supply' | 'radar'; channelId?: string; channelName?: string; from?: string[]; to?: string[]; text?: string };
export type AutopilotSettings = {
  bestTimes: { enabled: boolean; apply: 'auto' | 'approve'; gapMinutes: number; window: [number, number]; learnDays: number };
  healing: { replaceFailed: boolean; pauseBroken: boolean; warnDays: number };
  /** Phase 2 (2026-11-16). */
  score: { enabled: boolean; weight: 'light' | 'balanced' | 'strong'; prime: 'best-hours' | 'any'; show: boolean };
  moments: { rules: Array<'holidays' | 'season' | 'weekday' | 'weather'>; leadDays: number; latitude: number; longitude: number };
  variety: { enabled: boolean; maxRun: number };
  evergreen: { enabled: boolean; cooldownDays: number; share: number };
  radar: { enabled: boolean; factor: number; pages: number; mode: 'auto' | 'approve'; boost: boolean };
  breathe: { enabled: boolean; factor: number; maxDelayMinutes: number };
  /** Phase 3 (2026-11-16). */
  captions: { enabled: boolean; voice: 'per-page' | 'warm' | 'short' | 'chef'; question: boolean; emoji: 'none' | 'few' | 'more' };
  hooks: { enabled: boolean; share: number };
  comment: { enabled: boolean; cta: 'rotate' | 'save' | 'tag' | 'none'; delayMinutes: number };
  /** Phase 4 (2026-11-16). */
  review: { enabled: boolean; hour: number; notify: boolean };
  digest: { enabled: boolean; day: 'mon' | 'fri' | 'sun' };
  replies: { enabled: boolean; tone: 'friendly' | 'short' | 'expert' };
  /** Days whose plan a member approved on the board (YYYY-MM-DD), newest first. */
  approvedDays?: string[];
  /** Each channel's hours as last learned (hour → value, 1 = usual): best recipes go to the strongest. */
  hourValues?: Record<string, Record<string, number>>;
  /** Times the autopilot learned per channel (planner-owned; a settings form never overwrites them). */
  learnedTimes?: Record<string, string[]>;
  /** Recipe slots the radar already acted on. */
  radarHandled?: string[];
  lastLearnedAt?: string;
  /** The learning method the times were last chosen with; a newer method relearns at once. */
  learnVersion?: number;
  log?: AutopilotLogEntry[];
};

/** The owner's approved choices. */
export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  bestTimes: { enabled: true, apply: 'auto', gapMinutes: 60, window: [6, 23], learnDays: 14 },
  healing: { replaceFailed: true, pauseBroken: true, warnDays: 7 },
  score: { enabled: true, weight: 'strong', prime: 'best-hours', show: true },
  moments: { rules: ['holidays', 'season', 'weekday', 'weather'], leadDays: 14, latitude: 48.8566, longitude: 2.3522 },
  variety: { enabled: true, maxRun: 2 },
  evergreen: { enabled: true, cooldownDays: 60, share: 20 },
  radar: { enabled: true, factor: 3, pages: 5, mode: 'auto', boost: false },
  breathe: { enabled: true, factor: 3, maxDelayMinutes: 60 },
  captions: { enabled: true, voice: 'per-page', question: true, emoji: 'more' },
  hooks: { enabled: true, share: 20 },
  comment: { enabled: true, cta: 'rotate', delayMinutes: 2 },
  review: { enabled: true, hour: 20, notify: true },
  digest: { enabled: true, day: 'mon' },
  replies: { enabled: true, tone: 'friendly' },
};
export const AUTOPILOT_LOG_MAX = 60;
/** Times are relearned at most this often. */
export const LEARN_EVERY_DAYS = 7;
/** Raised when the learning method improves: times chosen by an older method are relearned at the next run. */
export const LEARN_VERSION = 4;

const logEntry = z.object({
  at: z.string().max(40), kind: z.enum(['times', 'healing', 'supply', 'radar']), channelId: z.string().max(100).optional(), channelName: z.string().max(200).optional(),
  from: z.array(z.string().max(5)).max(24).optional(), to: z.array(z.string().max(5)).max(24).optional(), text: z.string().max(500).optional(),
}).strict();
export const autopilotSchema = z.object({
  bestTimes: z.object({
    enabled: z.boolean(), apply: z.enum(['auto', 'approve']), gapMinutes: z.number().int().min(30).max(360),
    window: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).refine(([a, b]) => a < b, 'The window must end after it starts.'),
    learnDays: z.number().int().min(7).max(90),
  }).strict(),
  healing: z.object({ replaceFailed: z.boolean(), pauseBroken: z.boolean(), warnDays: z.number().int().min(1).max(60) }).strict(),
  score: z.object({ enabled: z.boolean(), weight: z.enum(['light', 'balanced', 'strong']), prime: z.enum(['best-hours', 'any']), show: z.boolean() }).strict().optional(),
  moments: z.object({ rules: z.array(z.enum(['holidays', 'season', 'weekday', 'weather'])).max(4), leadDays: z.number().int().min(1).max(60), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict().optional(),
  variety: z.object({ enabled: z.boolean(), maxRun: z.number().int().min(1).max(5) }).strict().optional(),
  evergreen: z.object({ enabled: z.boolean(), cooldownDays: z.number().int().min(7).max(730), share: z.number().int().min(0).max(50) }).strict().optional(),
  radar: z.object({ enabled: z.boolean(), factor: z.number().min(1.5).max(20), pages: z.number().int().min(1).max(50), mode: z.enum(['auto', 'approve']), boost: z.boolean() }).strict().optional(),
  breathe: z.object({ enabled: z.boolean(), factor: z.number().min(1.5).max(20), maxDelayMinutes: z.number().int().min(10).max(240) }).strict().optional(),
  learnedTimes: z.record(z.string().max(100), z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24)).optional(),
  radarHandled: z.array(z.string().max(100)).max(300).optional(),
  captions: z.object({ enabled: z.boolean(), voice: z.enum(['per-page', 'warm', 'short', 'chef']), question: z.boolean(), emoji: z.enum(['none', 'few', 'more']) }).strict().optional(),
  hooks: z.object({ enabled: z.boolean(), share: z.number().int().min(0).max(50) }).strict().optional(),
  comment: z.object({ enabled: z.boolean(), cta: z.enum(['rotate', 'save', 'tag', 'none']), delayMinutes: z.number().int().min(0).max(60) }).strict().optional(),
  review: z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23), notify: z.boolean() }).strict().optional(),
  digest: z.object({ enabled: z.boolean(), day: z.enum(['mon', 'fri', 'sun']) }).strict().optional(),
  replies: z.object({ enabled: z.boolean(), tone: z.enum(['friendly', 'short', 'expert']) }).strict().optional(),
  approvedDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
  hourValues: z.record(z.string().max(100), z.record(z.string().max(2), z.number().min(0).max(1_000_000))).optional()
    .refine(map => !map || Object.keys(map).length <= 500, 'Too many channels.'),
  lastLearnedAt: z.string().max(40).optional(), learnVersion: z.number().int().min(0).max(1000).optional(),
  log: z.array(logEntry).max(AUTOPILOT_LOG_MAX).optional(),
}).strict();

/** Stored settings over the approved defaults: a section saved before it existed takes its default. */
/** The stored autopilot, section by section: a section that no longer validates takes its default alone. */
export function salvageAutopilot(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(autopilotSchema.shape)) {
    if (!(key in source)) continue;
    const one = (field as z.ZodTypeAny).safeParse(source[key]);
    if (one.success && one.data !== undefined) out[key] = one.data;
    else if (key === 'log' && Array.isArray(source.log)) out.log = source.log.filter(entry => logEntry.safeParse(entry).success).slice(0, AUTOPILOT_LOG_MAX);
  }
  return out;
}

export function autopilotOf(value: unknown): AutopilotSettings {
  const whole = autopilotSchema.safeParse(value);
  const parsed = whole.success ? whole : autopilotSchema.safeParse(salvageAutopilot(value));
  if (!parsed.success) return structuredClone(AUTOPILOT_DEFAULTS);
  const d = structuredClone(AUTOPILOT_DEFAULTS);
  const p = parsed.data;
  return { ...d, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as AutopilotSettings;
}

/** One published post: when it went live and how well it did (people reached plus weighted engagement). */
export type Observation = { at: Date; score: number };
export type HourStat = { hour: number; posts: number; value: number };

const hourIn = (at: Date, timeZone: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };

/**
 * What a recipe audience usually does by hour before any data says otherwise (1 = usual): lunch and evening are
 * strong, early morning and late night weak. Only used for hours no channel has tried yet.
 */
export function foodPrior(hour: number): number {
  if (hour >= 11 && hour <= 13) return 1.0;
  if (hour >= 17 && hour <= 21) return 1.05;
  if (hour >= 14 && hour <= 16) return 0.95;
  if (hour >= 9 && hour <= 10) return 0.9;
  if (hour <= 8) return 0.7;
  return 0.8;
}

/** Each post's score relative to its channel's median, by local hour. */
export function relativeByHour(observations: readonly Observation[], timeZone: string): Map<number, number[]> {
  const valid = observations.filter(o => Number.isFinite(o.score) && o.score >= 0);
  const mid = median(valid.map(o => o.score)) || 1;
  const byHour = new Map<number, number[]>();
  for (const o of valid) { const h = hourIn(o.at, timeZone); byHour.set(h, [...(byHour.get(h) ?? []), o.score / mid]); }
  return byHour;
}

/**
 * How each hour of the window performs for one channel (1 = its usual). An hour's own posts are pulled towards what
 * all channels saw at that hour (`pooled`), and an hour nobody tried towards the recipe-audience prior, so a few posts
 * never decide alone and an untried hour is judged on evidence from the other Pages.
 */
export function hourStats(observations: readonly Observation[], timeZone: string, window: readonly [number, number], pooled: ReadonlyMap<number, number[]> = new Map(), prior = 3): HourStat[] {
  const byHour = relativeByHour(observations, timeZone);
  const stats: HourStat[] = [];
  for (let hour = window[0]; hour < window[1]; hour++) {
    const all = pooled.get(hour) ?? [];
    const base = (all.reduce((a, b) => a + b, 0) + prior * foodPrior(hour)) / (all.length + prior);
    const values = byHour.get(hour) ?? [];
    stats.push({ hour, posts: values.length, value: (values.reduce((a, b) => a + b, 0) + prior * base) / (values.length + prior) });
  }
  return stats;
}

/**
 * New posting times for one channel: as many as it has now, at its strongest hours, at least `gapMinutes` apart.
 * At most one hour it never posted at, and only in place of a proven hour that does worse than the channel's usual.
 * Minutes follow the channel's position on Facebook's 5-minute marks, so channels do not post in lockstep and the app
 * shows the time Facebook will show. Too little history keeps the current times.
 */
export function learnTimes(input: { observations: readonly Observation[]; current: readonly string[]; timeZone: string; window: readonly [number, number]; gapMinutes: number; channelIndex: number; pooled?: ReadonlyMap<number, number[]>; minObservations?: number }): string[] {
  const count = Math.max(1, input.current.length);
  if (input.observations.length < (input.minObservations ?? 8)) return [...input.current];
  const minute = (input.channelIndex * 5) % 60;
  const stats = hourStats(input.observations, input.timeZone, input.window, input.pooled);
  const spaced = (list: HourStat[], stat: HourStat) => !list.some(p => Math.abs(p.hour - stat.hour) * 60 < input.gapMinutes);
  const proven: HourStat[] = [];
  for (const stat of stats.filter(s => s.posts > 0).sort((a, b) => b.value - a.value || a.hour - b.hour)) if (proven.length < count && spaced(proven, stat)) proven.push(stat);
  let picked = [...proven];
  const untried = stats.filter(s => s.posts === 0).sort((a, b) => b.value - a.value || a.hour - b.hour);
  if (picked.length < count) {
    for (const stat of untried) if (picked.length < count && spaced(picked, stat)) picked.push(stat);
  } else {
    const weakest = [...picked].sort((a, b) => a.value - b.value)[0]!;
    const rest = picked.filter(p => p !== weakest);
    // Only a clearly weak hour (5% under usual) gives way, and only to an hour expected to do clearly better.
    const trial = weakest.value < 0.95 ? untried.find(stat => stat.value > weakest.value + 0.1 && spaced(rest, stat)) : undefined;
    if (trial) picked = [...rest, trial];
  }
  if (picked.length < count) return [...input.current];
  return picked.map(p => `${String(p.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).sort();
}

/** Score of one post from stored insights: people reached plus engagement weighted (a reaction is worth ten views). */
export function postScore(insights: unknown): number | null {
  if (!insights || typeof insights !== 'object') return null;
  const i = insights as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const reach = num(i.post_total_media_view_unique) || num(i.reach) || num(i.post_media_view) || num(i.impressions);
  const reactions = typeof i.post_reactions_by_type_total === 'object' && i.post_reactions_by_type_total
    ? Object.values(i.post_reactions_by_type_total as Record<string, unknown>).reduce<number>((sum, v) => sum + num(v), 0) : num(i.reactions);
  const engagement = reactions + num(i.comments) + num(i.shares) + num(i.post_clicks);
  if (!reach && !engagement) return null;
  return reach + engagement * 10;
}
