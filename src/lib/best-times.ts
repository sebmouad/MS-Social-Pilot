import { prisma } from './prisma';
import { loadPagePosts } from './page-analysis-data';
import { suggestSlots, type QueueSlotLike } from './queue-suggestions';
import { logActivity } from './scheduler/runner';

/**
 * Best time per Page, automatically.
 *
 * Once a week, for workspaces that chose "apply", each Page's own posts are
 * read again and its strongest new times are added to the queue as that Page's
 * own times. The same rules as the queue screen's suggestions: a time needs
 * posts behind it and a lift over the Page's typical post, and times the queue
 * already covers are left out. A few at a time, with a ceiling, so the queue
 * grows with the evidence rather than all at once. Database only: the posts
 * and their insights are what the analytics sync stored.
 */

export const BEST_TIME_MODES = ['suggest', 'apply'] as const;
export type BestTimeMode = (typeof BEST_TIME_MODES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** The window the queue screen reads too. */
const LOOKBACK_DAYS = 90;
/** New times per Page per week. */
const ADD_PER_WEEK = 2;
/** A Page's own times this job stops adding at. */
const MAX_OWN_SLOTS = 14;

export interface AddedSlots {
  targetId: string;
  page: string;
  slots: Array<QueueSlotLike & { lift: number; posts: number }>;
}

export async function applyBestTimes(now: Date = new Date()): Promise<AddedSlots[]> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      bestTimeMode: 'apply',
      suspendedAt: null,
      OR: [{ bestTimesRunAt: null }, { bestTimesRunAt: { lte: new Date(now.getTime() - WEEK_MS) } }],
    },
    select: { id: true, timezone: true },
  });

  const added: AddedSlots[] = [];
  for (const workspace of workspaces) {
    // Claimed first, so two workers do not both add the same week's times.
    const claimed = await prisma.workspace.updateMany({
      where: {
        id: workspace.id,
        OR: [{ bestTimesRunAt: null }, { bestTimesRunAt: { lte: new Date(now.getTime() - WEEK_MS) } }],
      },
      data: { bestTimesRunAt: now },
    });
    if (claimed.count === 0) continue;

    const [pages, slots] = await Promise.all([
      prisma.target.findMany({ where: { workspaceId: workspace.id, type: 'page', enabled: true }, select: { id: true, name: true } }),
      prisma.queueSlot.findMany({ where: { workspaceId: workspace.id }, select: { targetId: true, dayOfWeek: true, hour: true, minute: true } }),
    ]);

    for (const page of pages) {
      const existing = slots.filter((slot) => slot.targetId === null || slot.targetId === page.id);
      const own = existing.filter((slot) => slot.targetId === page.id).length;
      const room = Math.min(ADD_PER_WEEK, MAX_OWN_SLOTS - own);
      if (room <= 0) continue;

      const posts = await loadPagePosts(page.id, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), now);
      const suggestions = suggestSlots({ pages: [{ pageName: page.name, posts }], timeZone: workspace.timezone, existing, limit: room });
      if (suggestions.length === 0) continue;

      await prisma.queueSlot.createMany({
        data: suggestions.map((slot) => ({
          workspaceId: workspace.id,
          targetId: page.id,
          dayOfWeek: slot.dayOfWeek,
          hour: slot.hour,
          minute: slot.minute,
        })),
        skipDuplicates: true,
      });
      const entry: AddedSlots = {
        targetId: page.id,
        page: page.name,
        slots: suggestions.map(({ dayOfWeek, hour, minute, lift, posts: count }) => ({ dayOfWeek, hour, minute, lift, posts: count })),
      };
      await logActivity(workspace.id, 'queue.bestTimesAdded', entry);
      added.push(entry);
    }
  }
  return added;
}
