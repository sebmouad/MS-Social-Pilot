import { formatInTimeZone } from 'date-fns-tz';

import { BLOCK_HOURS, MIN_POSTS_PER_SLOT, median, type AnalysedPost } from './page-analysis';

/**
 * Posting times worth adding to the queue, from what has actually worked.
 *
 * The queue is one weekly schedule shared by every Page in the workspace, so
 * the question is not "when does *this* Page do best" but "when do this
 * workspace's Pages do best" — and that has to be asked fairly. Raw
 * interactions would let the biggest Page decide everything: its average post
 * outscores a small Page's best. So every post is first scored against its own
 * Page's typical post (1.0 is typical), and only then are the scores pooled by
 * weekday and time of day.
 *
 * A suggestion is a concrete time, not a three-hour block: the middle of when
 * the good posts in that block actually went out, rounded to a quarter hour.
 * Blocks the queue already covers are left out — the point is what to add.
 *
 * Pure: posts in, suggestions out. Same floors as the analysis — a block needs
 * posts behind it before it is called a good time rather than a lucky one.
 */

export interface PagePosts {
  pageName: string;
  posts: AnalysedPost[];
}

export interface QueueSlotLike {
  dayOfWeek: number;
  hour: number;
  minute: number;
}

export interface SlotSuggestion extends QueueSlotLike {
  /** Average score against each Page's typical post: 1 is typical. */
  lift: number;
  /** Posts behind the suggestion, across every Page. */
  posts: number;
  /** Which Pages contributed, so the reader knows whose results these are. */
  pages: string[];
}

/** Lift a block needs before it is worth suggesting. */
export const MIN_SUGGESTION_LIFT = 1.15;

const round15 = (minuteOfDay: number) => Math.round(minuteOfDay / 15) * 15;

/** Whether an existing slot already falls inside a suggestion's block. */
function covered(slots: QueueSlotLike[], weekday: number, blockStart: number): boolean {
  return slots.some(
    (slot) => slot.dayOfWeek === weekday && slot.hour >= blockStart && slot.hour < blockStart + BLOCK_HOURS,
  );
}

export function suggestSlots(options: {
  pages: PagePosts[];
  timeZone: string;
  existing: QueueSlotLike[];
  limit?: number;
}): SlotSuggestion[] {
  const cells = new Map<string, { scores: number[]; minutes: number[]; pages: Set<string> }>();

  for (const page of options.pages) {
    const typical = median(page.posts.map((post) => post.interactions));
    // A Page with no interactions at all has nothing to say about timing.
    if (!typical || typical <= 0) continue;

    for (const post of page.posts) {
      const weekday = Number(formatInTimeZone(post.publishedAt, options.timeZone, 'i')) % 7;
      const hour = Number(formatInTimeZone(post.publishedAt, options.timeZone, 'H'));
      const minute = Number(formatInTimeZone(post.publishedAt, options.timeZone, 'm'));
      const block = Math.floor(hour / BLOCK_HOURS) * BLOCK_HOURS;
      const key = `${weekday}:${block}`;

      const cell = cells.get(key) ?? { scores: [], minutes: [], pages: new Set<string>() };
      cell.scores.push(post.interactions / typical);
      cell.minutes.push(hour * 60 + minute);
      cell.pages.add(page.pageName);
      cells.set(key, cell);
    }
  }

  const suggestions: SlotSuggestion[] = [];
  for (const [key, cell] of cells) {
    if (cell.scores.length < MIN_POSTS_PER_SLOT) continue;

    const lift = cell.scores.reduce((sum, score) => sum + score, 0) / cell.scores.length;
    if (lift < MIN_SUGGESTION_LIFT) continue;

    const [weekday, block] = key.split(':').map(Number) as [number, number];
    if (covered(options.existing, weekday, block)) continue;

    // Where in the block the posts went out, weighted towards the ones that
    // did well: the times of the above-typical posts if there are any.
    const good = cell.minutes.filter((_, index) => cell.scores[index]! >= 1);
    const at = round15(median(good.length > 0 ? good : cell.minutes)!);
    // Rounding can push 20:53 to 21:00, into the next block; keep it inside.
    const clamped = Math.min(Math.max(at, block * 60), (block + BLOCK_HOURS) * 60 - 15);

    suggestions.push({
      dayOfWeek: weekday,
      hour: Math.floor(clamped / 60),
      minute: clamped % 60,
      lift: Math.round(lift * 10) / 10,
      posts: cell.scores.length,
      pages: [...cell.pages].sort(),
    });
  }

  return suggestions
    .sort((a, b) => b.lift - a.lift || b.posts - a.posts)
    .slice(0, options.limit ?? 5);
}

/**
 * The next occurrences of the queue's slots, in the workspace's time zone.
 *
 * For the "coming up" list: each weekly slot as a real instant over the next
 * `days`, earliest first.
 */
export function upcomingOccurrences(options: {
  slots: QueueSlotLike[];
  timeZone: string;
  from: Date;
  days: number;
  toUtc: (localInput: string, timeZone: string) => Date;
}): Array<{ at: Date; slot: QueueSlotLike }> {
  const out: Array<{ at: Date; slot: QueueSlotLike }> = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (let offset = 0; offset <= options.days; offset += 1) {
    const day = new Date(options.from.getTime() + offset * dayMs);
    const date = formatInTimeZone(day, options.timeZone, 'yyyy-MM-dd');
    const weekday = Number(formatInTimeZone(day, options.timeZone, 'i')) % 7;

    for (const slot of options.slots.filter((entry) => entry.dayOfWeek === weekday)) {
      const local = `${date}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
      const at = options.toUtc(local, options.timeZone);
      if (at.getTime() > options.from.getTime()) out.push({ at, slot });
    }
  }

  // Two calendar days can map to the same instant only across a clock change;
  // keep one of each.
  const seen = new Set<number>();
  return out
    .filter((entry) => (seen.has(entry.at.getTime()) ? false : (seen.add(entry.at.getTime()), true)))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The next time each suggestion comes round, for the composer's "good times"
 * chips: one instant per suggestion, soonest first.
 *
 * `earliest` keeps out a time too close to be useful — a chip for four
 * minutes from now would be gone before the post is written, and would fall
 * under Facebook's ten-minute floor for posts it holds itself.
 */
export function nextGoodTimes(options: {
  suggestions: SlotSuggestion[];
  timeZone: string;
  earliest: Date;
  days: number;
  toUtc: (localInput: string, timeZone: string) => Date;
  limit?: number;
}): Array<{ at: Date; suggestion: SlotSuggestion }> {
  const limit = options.limit ?? 3;
  return options.suggestions
    .map((suggestion) => {
      const [next] = upcomingOccurrences({
        slots: [suggestion],
        timeZone: options.timeZone,
        from: options.earliest,
        days: options.days,
        toUtc: options.toUtc,
      });
      return next ? { at: next.at, suggestion } : null;
    })
    .filter((entry): entry is { at: Date; suggestion: SlotSuggestion } => entry !== null)
    .slice(0, limit)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
