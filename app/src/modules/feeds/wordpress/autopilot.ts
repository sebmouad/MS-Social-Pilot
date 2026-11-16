import { z } from 'zod';

/**
 * Recipe autopilot (2026-11-16, docs/autopilot-plan.md): settings and the pure learning logic.
 * Best times: each channel's posting times move to the hours its own audience responds to most.
 */
export type AutopilotLogEntry = { at: string; kind: 'times' | 'healing' | 'supply'; channelId?: string; channelName?: string; from?: string[]; to?: string[]; text?: string };
export type AutopilotSettings = {
  bestTimes: { enabled: boolean; apply: 'auto' | 'approve'; gapMinutes: number; window: [number, number]; learnDays: number };
  healing: { replaceFailed: boolean; pauseBroken: boolean; warnDays: number };
  lastLearnedAt?: string;
  log?: AutopilotLogEntry[];
};

/** The owner's approved choices. */
export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  bestTimes: { enabled: true, apply: 'auto', gapMinutes: 60, window: [6, 23], learnDays: 14 },
  healing: { replaceFailed: true, pauseBroken: true, warnDays: 7 },
};
export const AUTOPILOT_LOG_MAX = 60;
/** Times are relearned at most this often. */
export const LEARN_EVERY_DAYS = 7;

const logEntry = z.object({
  at: z.string().max(40), kind: z.enum(['times', 'healing', 'supply']), channelId: z.string().max(100).optional(), channelName: z.string().max(200).optional(),
  from: z.array(z.string().max(5)).max(24).optional(), to: z.array(z.string().max(5)).max(24).optional(), text: z.string().max(500).optional(),
}).strict();
export const autopilotSchema = z.object({
  bestTimes: z.object({
    enabled: z.boolean(), apply: z.enum(['auto', 'approve']), gapMinutes: z.number().int().min(30).max(360),
    window: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).refine(([a, b]) => a < b, 'The window must end after it starts.'),
    learnDays: z.number().int().min(7).max(90),
  }).strict(),
  healing: z.object({ replaceFailed: z.boolean(), pauseBroken: z.boolean(), warnDays: z.number().int().min(1).max(60) }).strict(),
  lastLearnedAt: z.string().max(40).optional(),
  log: z.array(logEntry).max(AUTOPILOT_LOG_MAX).optional(),
}).strict();

export function autopilotOf(value: unknown): AutopilotSettings {
  const parsed = autopilotSchema.safeParse(value);
  return parsed.success ? parsed.data as AutopilotSettings : structuredClone(AUTOPILOT_DEFAULTS);
}

/** One published post: when it went live and how well it did (people reached plus weighted engagement). */
export type Observation = { at: Date; score: number };
export type HourStat = { hour: number; posts: number; value: number };

const hourIn = (at: Date, timeZone: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };

/**
 * How each hour of the window performs for one channel, relative to the channel's own median (1 = usual).
 * Few posts pull an hour towards 1 (prior of `prior` usual posts); an hour never tried gets a small bonus so
 * the autopilot keeps exploring instead of freezing on the hours it happened to post at.
 */
export function hourStats(observations: readonly Observation[], timeZone: string, window: readonly [number, number], prior = 3, explore = 0.12): HourStat[] {
  const valid = observations.filter(o => Number.isFinite(o.score) && o.score >= 0);
  const mid = median(valid.map(o => o.score)) || 1;
  const byHour = new Map<number, number[]>();
  for (const o of valid) { const h = hourIn(o.at, timeZone); byHour.set(h, [...(byHour.get(h) ?? []), o.score / mid]); }
  const stats: HourStat[] = [];
  for (let hour = window[0]; hour < window[1]; hour++) {
    const values = byHour.get(hour) ?? [];
    const value = values.length ? (values.reduce((a, b) => a + b, 0) + prior) / (values.length + prior) : 1 + explore;
    stats.push({ hour, posts: values.length, value });
  }
  return stats;
}

/**
 * New posting times for one channel: as many as it has now, at its strongest hours, at least `gapMinutes` apart,
 * with at most one hour it has never posted at. Minutes follow the channel's position on Facebook's 5-minute marks,
 * so channels do not post in lockstep and the app shows the time Facebook will show. Too little history keeps the
 * current times.
 */
export function learnTimes(input: { observations: readonly Observation[]; current: readonly string[]; timeZone: string; window: readonly [number, number]; gapMinutes: number; channelIndex: number; minObservations?: number }): string[] {
  const count = Math.max(1, input.current.length);
  if (input.observations.length < (input.minObservations ?? 8)) return [...input.current];
  const minute = (input.channelIndex * 5) % 60;
  const ranked = hourStats(input.observations, input.timeZone, input.window).sort((a, b) => b.value - a.value || a.hour - b.hour);
  const picked: HourStat[] = [];
  let explored = 0;
  for (const stat of ranked) {
    if (picked.length >= count) break;
    if (stat.posts === 0 && explored >= 1) continue;
    if (picked.some(p => Math.abs(p.hour - stat.hour) * 60 < input.gapMinutes)) continue;
    picked.push(stat); if (stat.posts === 0) explored++;
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
