import { instantToWall } from '@/lib/calendar-dates';
import { breaksVariety, guessKind, scoreRecipe, type RecipeKind, type ScoreContext } from '../wordpress/score';
import type { AutopilotSettings } from '../wordpress/autopilot';
import type { SlotNeed } from '../wordpress/recipe';
import type { Rating } from './wordpress-scoring';

/**
 * How the autopilot chooses (2026-11-16): every slot takes the best-scoring recipe for its day and hour, the strongest
 * hours choose first, a channel never shows more than `maxRun` of one kind in a row, and past winners fill at most
 * their share. Pure: the planner supplies ratings, history, weather and the channels' existing posts.
 */
export type PickInput<C extends { wpPostId: string; title: string; publishedAt?: Date | null }> = {
  pilot: AutopilotSettings; timeZone: string;
  ratings: ReadonlyMap<string, Rating>;
  /** How a recipe would do on a channel, learned from that channel's own posts (1 = usual; null when unknown). */
  history: (targetId: string | null, title: string, kind: RecipeKind | null, slotAt: Date | null) => number | null;
  /** What a photo's traits are worth on a channel (2026-11-21); null when nothing is known. */
  photoValue?: (targetId: string | null, traits: readonly string[] | null | undefined) => number | null;
  /** Local date → highest temperature. */
  weather: ReadonlyMap<string, number>;
  /** Posts already on each channel (planned or published), for the variety guard. */
  timeline: ReadonlyMap<string, ReadonlyArray<{ at: number; kind: RecipeKind }>>;
  /** Past winners that may come back, and how many slots they may take. */
  winners: ReadonlySet<string>; winnerQuota: number;
  /** Testing ground (2026-11-21): on these Pages a recipe new to all Pages (novelty 0–1) gets up to EXPLORE_POINTS. */
  explore?: { pages: ReadonlySet<string>; novelty: (title: string) => number };
  /** Recipes in their scan order (newest or oldest first), for the weight of recency. */
  candidates: readonly C[];
  /** A weak photo that will be replaced by a generated one on this channel (2026-11-19): scored as an average photo. */
  replacesPhoto?: (targetId: string | null, rating: Rating) => boolean;
};

/** Most points a recipe new to all Pages gets on a testing-ground Page. */
export const EXPLORE_POINTS = 15;
export function makePicker<C extends { wpPostId: string; title: string; publishedAt?: Date | null }>(input: PickInput<C>) {
  const { pilot, timeZone } = input;
  const rules = new Set(pilot.moments.rules);
  const kindOf = (c: { wpPostId: string; title: string }): RecipeKind => input.ratings.get(c.wpPostId)?.kind ?? guessKind(c.title);
  const position = new Map(input.candidates.map((c, i) => [c.wpPostId, i]));
  const weight = pilot.score.weight === 'strong' ? 1 : pilot.score.weight === 'balanced' ? 0.6 : 0.25;
  const timeline = new Map([...input.timeline].map(([id, items]) => [id, [...items]]));
  const cache = new Map<string, number>();
  let winnersUsed = 0;
  const chosen = new Map<string, { score: number; kind: RecipeKind }>();

  const contextOf = (slotAt: Date): ScoreContext => {
    const wall = instantToWall(slotAt, timeZone);
    const date = new Date(`${wall.date}T12:00:00Z`);
    const maxC = input.weather.get(wall.date);
    return { date, weekday: date.getUTCDay(), hour: Number(wall.time.slice(0, 2)), leadDays: pilot.moments.leadDays, rules, ...(maxC !== undefined ? { weather: { maxC } } : {}) };
  };
  /** A recipe's score at a time on a channel: what works on that channel counts (2026-11-18). */
  const scoreAt = (c: C, slotAt: Date, targetId: string | null = null): number => {
    const key = `${c.wpPostId}|${slotAt.getTime()}|${targetId ?? ''}`;
    const hit = cache.get(key); if (hit !== undefined) return hit;
    const found = input.ratings.get(c.wpPostId);
    const rating = found && input.replacesPhoto?.(targetId, found) ? { ...found, photo: null, traits: null } : found;
    const value = scoreRecipe({ title: c.title, hook: rating?.hook ?? null, photo: rating?.photo ?? null, kind: rating?.kind ?? null, history: input.history(targetId, c.title, rating?.kind ?? null, slotAt),
      photoValue: rating?.traits?.length ? input.photoValue?.(targetId, rating.traits) ?? null : null }, contextOf(slotAt)).score;
    cache.set(key, value); return value;
  };
  const combined = (c: C, slotAt: Date, targetId: string) => {
    const recency = 100 * (1 - (position.get(c.wpPostId) ?? 0) / Math.max(1, input.candidates.length));
    const bonus = input.explore?.pages.has(targetId) ? EXPLORE_POINTS * input.explore.novelty(c.title) : 0;
    return weight * (scoreAt(c, slotAt, targetId) + bonus) + (1 - weight) * recency;
  };

  return {
    kindOf, scoreAt,
    /** The score and kind a slot was filled with, for the plan. */
    chosen: (targetId: string, slotAt: Date) => chosen.get(`${targetId}|${slotAt.getTime()}`),
    /** Strongest hours first (when best recipes go to best hours), then by time. */
    orderNeeds(needs: readonly SlotNeed[]): SlotNeed[] {
      if (pilot.score.prime !== 'best-hours') return [...needs];
      const strength = (need: SlotNeed) => pilot.hourValues?.[need.targetId]?.[String(Number(instantToWall(need.slotAt, timeZone).time.slice(0, 2)))] ?? 1;
      return [...needs].sort((a, b) => strength(b) - strength(a) || a.slotAt.getTime() - b.slotAt.getTime());
    },
    rank(need: SlotNeed, candidates: readonly C[]): C[] {
      const open = winnersUsed < input.winnerQuota;
      return candidates.filter(c => open || !input.winners.has(c.wpPostId)).sort((a, b) => combined(b, need.slotAt, need.targetId) - combined(a, need.slotAt, need.targetId));
    },
    fits(need: SlotNeed, c: C): boolean {
      if (!pilot.variety.enabled) return true;
      const around = (timeline.get(need.targetId) ?? []).filter(item => Math.abs(item.at - need.slotAt.getTime()) < 3 * 86_400_000);
      return !breaksVariety(around, need.slotAt.getTime(), kindOf(c), pilot.variety.maxRun);
    },
    onAssign(need: SlotNeed, c: C) {
      if (input.winners.has(c.wpPostId)) winnersUsed++;
      const kind = kindOf(c);
      timeline.set(need.targetId, [...(timeline.get(need.targetId) ?? []), { at: need.slotAt.getTime(), kind }]);
      chosen.set(`${need.targetId}|${need.slotAt.getTime()}`, { score: scoreAt(c, need.slotAt, need.targetId), kind });
    },
  };
}
