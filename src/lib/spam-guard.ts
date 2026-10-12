import { PostStatus, type TargetType } from '@prisma/client';

import { prisma } from './prisma';

/**
 * Spam-risk guard (NEXT_PHASES G6).
 *
 * Facebook treats the same link or the same words landing on many Pages at
 * once as coordinated spam, and the Pages pay for it in reach. This finds that
 * case before a post is scheduled — this post's own Pages plus whatever is
 * already planned with the same link or text close to the same time — so the
 * composer can warn and offer to stagger. It never blocks.
 */

/** Pages of one network carrying the same content before it counts as "many". */
export const SPAM_PAGES_THRESHOLD = 3;
/** Word overlap above which two captions count as the same text. */
const SIMILAR_TEXT = 0.8;
/** Below this many words, captions are too short to compare fairly. */
const MIN_WORDS = 5;

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

/** A link without its query, fragment or trailing slash: UTM tags do not make it different. */
export function linkKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Every link a post carries: its link field and any URL written in the text. */
export function linksOf(message: string, link: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const url of [link ?? '', ...(message.match(URL_PATTERN) ?? [])]) {
    const key = url ? linkKey(url) : null;
    if (key) keys.add(key);
  }
  return keys;
}

/** The words of a caption, links and punctuation left out. */
export function wordsOf(message: string): Set<string> {
  return new Set(
    message
      .replace(URL_PATTERN, ' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}#]+/u)
      .filter((word) => word.length > 1),
  );
}

/** Near-identical text: most words shared (Jaccard), both long enough to judge. */
export function similarText(a: Set<string>, b: Set<string>): boolean {
  if (a.size < MIN_WORDS || b.size < MIN_WORDS) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared) >= SIMILAR_TEXT;
}

export interface SpamRisk {
  /** Distinct Pages of the busiest network that would carry the content. */
  pages: number;
  network: TargetType;
  /** Of those, how many this post is sending to. */
  ownPages: number;
  /** Posts already planned with the same link or text within the window. */
  otherPosts: number;
  gapMinutes: number;
}

/**
 * Whether this post, with what is already planned around it, sends the same
 * content to too many Pages of one network within the workspace's gap.
 * Null when it does not, or when the workspace turned the guard off.
 */
export async function spamRisk(
  workspaceId: string,
  input: { message: string; link?: string | null; targetIds: string[]; at: Date; excludePostId?: string },
): Promise<SpamRisk | null> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { spamGapMinutes: true } });
  const gapMinutes = workspace?.spamGapMinutes ?? 0;
  if (gapMinutes <= 0 || input.targetIds.length === 0) return null;

  const links = linksOf(input.message, input.link);
  const words = wordsOf(input.message);
  if (links.size === 0 && words.size < MIN_WORDS) return null;

  const gap = gapMinutes * 60_000;
  const from = new Date(input.at.getTime() - gap);
  const to = new Date(input.at.getTime() + gap);

  const [own, nearby] = await Promise.all([
    prisma.target.findMany({ where: { workspaceId, id: { in: input.targetIds } }, select: { id: true, type: true } }),
    prisma.post.findMany({
      where: {
        workspaceId,
        ...(input.excludePostId ? { id: { not: input.excludePostId } } : {}),
        status: { in: [PostStatus.pending_approval, PostStatus.scheduled, PostStatus.publishing, PostStatus.published] },
        OR: [{ scheduledAt: { gte: from, lte: to } }, { scheduledAt: null, createdAt: { gte: from, lte: to } }],
      },
      select: { message: true, link: true, targets: { select: { target: { select: { id: true, type: true } } } } },
      take: 500,
    }),
  ]);

  const matching = nearby.filter((post) => {
    for (const key of linksOf(post.message, post.link)) if (links.has(key)) return true;
    return similarText(words, wordsOf(post.message));
  });

  const byNetwork = new Map<TargetType, { all: Set<string>; own: Set<string> }>();
  const add = (target: { id: string; type: TargetType }, mine: boolean) => {
    const entry = byNetwork.get(target.type) ?? { all: new Set<string>(), own: new Set<string>() };
    entry.all.add(target.id);
    if (mine) entry.own.add(target.id);
    byNetwork.set(target.type, entry);
  };
  for (const target of own) add(target, true);
  for (const post of matching) for (const row of post.targets) add(row.target, false);

  let busiest: [TargetType, { all: Set<string>; own: Set<string> }] | null = null;
  for (const entry of byNetwork) if (!busiest || entry[1].all.size > busiest[1].all.size) busiest = entry;
  if (!busiest || busiest[1].all.size < SPAM_PAGES_THRESHOLD) return null;

  return {
    pages: busiest[1].all.size,
    network: busiest[0],
    ownPages: busiest[1].own.size,
    otherPosts: matching.length,
    gapMinutes,
  };
}

/** A typed wall-clock time (`yyyy-MM-ddTHH:mm`) moved by whole minutes, calendar-correct. */
export function shiftLocalInput(localInput: string, minutes: number): string {
  const [date, time = '00:00'] = localInput.split('T') as [string, string?];
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, day, hour, minute + minutes)).toISOString().slice(0, 16);
}
