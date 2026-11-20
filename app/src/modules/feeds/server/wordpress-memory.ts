import { prisma } from '@/server/data';
import { absorb, formatOf, type LearnedPost, type PageMemory } from '../wordpress/memory';
import type { SourceRow } from './wordpress-store';

/**
 * Storage of the autopilot's memory of each Page (2026-11-18, see ../wordpress/memory.ts). On every planning run, each
 * Page's memory is rebuilt from its recipe posts whose figures have settled (published at least SETTLE_HOURS ago), and
 * stored. Read by the planner, the cockpit and captions.
 */
export const SETTLE_HOURS = 48;
/** Posts learned per Page in one run; a long history is learned over a few runs. */
const PER_RUN = 2000;

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
/** Reach, reactions, comments and shares from stored post figures (Graph API names or the app's own). */
export function figures(insights: unknown): { reach: number; reactions: number; comments: number; shares: number } | null {
  if (!insights || typeof insights !== 'object') return null;
  const i = insights as Record<string, unknown>;
  const reach = num(i.post_total_media_view_unique) || num(i.reach) || num(i.post_media_view) || num(i.impressions);
  const byType = i.post_reactions_by_type_total;
  const reactions = byType && typeof byType === 'object' ? Object.values(byType as Record<string, unknown>).reduce<number>((sum, v) => sum + num(v), 0) : num(i.reactions) || num(i.likes);
  const comments = num(i.comments) || num(i.commentsCount);
  const shares = num(i.shares) || num(i.sharesCount);
  if (!reach && !reactions && !comments && !shares) return null;
  return { reach, reactions, comments, shares };
}

export async function readPageMemories(sourceId: string): Promise<Map<string, PageMemory>> {
  const rows = await prisma.$queryRaw<Array<{ targetId: string; memory: PageMemory }>>`SELECT "targetId", memory FROM autopilot_memory WHERE "sourceId" = ${sourceId}`;
  return new Map(rows.filter(row => row.memory && row.memory.v === 1).map(row => [row.targetId, row.memory]));
}

/**
 * Rebuild each Page's memory from all its settled posts of the last year, with what was seen in their photos, and
 * store it (2026-11-18). Rebuilt rather than added to, so a photo read later and corrected figures still count.
 * Returns how many posts the memories learned from.
 */
export async function updatePageMemories(source: SourceRow, pages: ReadonlyArray<{ id: string }>, timeZone: string, now: Date): Promise<number> {
  if (!pages.length) return 0;
  const settled = new Date(now.getTime() - SETTLE_HOURS * 3_600_000);
  const rows = await prisma.$queryRaw<Array<{ targetId: string; at: Date; title: string; kind: string | null; style: string | null; caption: string | null; insights: unknown; photo: number | null; photoTraits: string[] | null; imageSource: string | null; media: unknown }>>`
    SELECT l."targetId", COALESCE(pt."publishedAt", l."slotAt") AS at, l.title, l.kind, l.style, l."imageSource", p.media, p.message AS caption, ep.insights, r.photo, r."photoTraits"
    FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
    JOIN posts p ON p.id = l."postId"
    JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
    LEFT JOIN recipe_ratings r ON r."sourceId" = l."sourceId" AND r."wpPostId" = l."wpPostId"
    WHERE l."sourceId" = ${source.id} AND l."targetId" = ANY(${pages.map(page => page.id)}::text[]) AND l.state = 'planned' AND ep.insights IS NOT NULL
      AND COALESCE(pt."publishedAt", l."slotAt") > ${new Date(now.getTime() - 365 * 86_400_000)} AND COALESCE(pt."publishedAt", l."slotAt") <= ${settled}
    ORDER BY 2 ASC LIMIT ${PER_RUN * 10}`;
  // Posts made outside the autopilot (by hand, another tool, videos, shared links) teach the memory too (2026-11-18):
  // their text stands for the title, Facebook's post type gives the format, their photo is read like the others.
  const outside = await prisma.$queryRaw<Array<{ id: string; targetId: string; at: Date; message: string | null; statusType: string | null; pictureUrl: string | null; insights: unknown; photo: number | null; photoTraits: string[] | null }>>`
    SELECT ep.id, ep."targetId", ep."createdTime" AS at, ep.message, ep."statusType", ep."pictureUrl", ep.insights, r.photo, r."photoTraits"
    FROM external_posts ep
    LEFT JOIN recipe_ratings r ON r."sourceId" = ${source.id} AND r."wpPostId" = ('ext:' || ep.id)
    WHERE ep."targetId" = ANY(${pages.map(page => page.id)}::text[]) AND ep.insights IS NOT NULL
      AND ep."createdTime" > ${new Date(now.getTime() - 365 * 86_400_000)} AND ep."createdTime" <= ${settled}
      AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId")
    ORDER BY 3 ASC LIMIT ${PER_RUN * 10}`;
  // Generated only when the photo actually posted is one the autopilot generated (2026-11-19: three posts were put
  // back on their original collage by hand after the owner judged the first generated photos).
  const made = new Set((await prisma.$queryRaw<Array<{ mediaId: string | null }>>`SELECT detail->>'mediaId' AS "mediaId" FROM activity_logs WHERE "workspaceId" = ${source.workspaceId} AND action = 'autopilot.photo_generated'`).flatMap(row => row.mediaId ? [row.mediaId] : []));
  const sourceOf = (imageSource: string | null, media: unknown): 'site' | 'generated' | null => {
    if (imageSource !== 'generated') return imageSource === 'site' ? 'site' : null;
    const first = Array.isArray(media) ? (media as Array<{ url?: unknown }>)[0]?.url : undefined;
    return typeof first === 'string' && made.has(first.replace(/^media:/, '')) ? 'generated' : 'site';
  };
  let learned = 0;
  for (const page of pages) {
    const posts: LearnedPost[] = [
      ...rows.filter(row => row.targetId === page.id).flatMap(row => { const f = figures(row.insights); return f ? [{ at: row.at, title: row.title, kind: row.kind, style: row.style, caption: row.caption ?? '', ...f, traits: row.photoTraits, appeal: row.photo, origin: 'app' as const, format: 'photo' as const, imageSource: sourceOf(row.imageSource, row.media) }] : []; }),
      ...outside.filter(row => row.targetId === page.id).flatMap(row => {
        const f = figures(row.insights); const text = (row.message ?? '').trim();
        return f ? [{ at: row.at, title: (text.split(/\n|(?<=[.!?…])\s/)[0] ?? '').slice(0, 140), kind: null, style: null, caption: text, ...f, traits: row.photoTraits, appeal: row.photo, origin: 'external' as const, format: formatOf(row.statusType, Boolean(row.pictureUrl)) }] : [];
      }),
    ].sort((x, y) => x.at.getTime() - y.at.getTime());
    if (!posts.length) continue;
    const memory = absorb(null, posts, now, timeZone);
    await prisma.$executeRaw`INSERT INTO autopilot_memory ("sourceId", "targetId", "workspaceId", memory, "learnedThrough", "updatedAt")
      VALUES (${source.id}, ${page.id}, ${source.workspaceId}, ${JSON.stringify(memory)}::jsonb, ${posts[posts.length - 1]!.at}, NOW())
      ON CONFLICT ("sourceId", "targetId") DO UPDATE SET memory = EXCLUDED.memory, "learnedThrough" = EXCLUDED."learnedThrough", "updatedAt" = NOW()`;
    learned += posts.length;
  }
  return learned;
}

/** Published posts of the last 30 days whose photo the AI has not read yet, newest first: the autopilot's with the photo as posted, and posts made outside it. */
export async function photosToLearn(sourceId: string, now: Date, limit: number): Promise<Array<{ id: string; mediaId?: string; imageUrl?: string }>> {
  const rows = await prisma.$queryRaw<Array<{ wpPostId: string; media: unknown }>>`SELECT DISTINCT ON (l."wpPostId") l."wpPostId", p.media FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
    JOIN posts p ON p.id = l."postId"
    LEFT JOIN recipe_ratings r ON r."sourceId" = l."sourceId" AND r."wpPostId" = l."wpPostId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND (r."photoTraits" IS NULL OR COALESCE(r."photoVersion", 1) < 2) AND l."slotAt" >= ${new Date(now.getTime() - 30 * 86_400_000)} AND l."slotAt" <= ${now}
    ORDER BY l."wpPostId", l."slotAt" DESC`;
  const withMedia = rows.flatMap(row => {
    const first = Array.isArray(row.media) ? (row.media as Array<{ kind?: unknown; url?: unknown }>).find(item => item?.kind === 'image' && typeof item.url === 'string' && item.url.startsWith('media:')) : undefined;
    return first ? [{ id: row.wpPostId, mediaId: String(first.url).slice('media:'.length) }] : [];
  });
  // Half the batch for posts made outside the autopilot, read from Facebook's picture (2026-11-18).
  const outside = await prisma.$queryRaw<Array<{ id: string; pictureUrl: string }>>`SELECT ep.id, ep."pictureUrl" FROM external_posts ep
    JOIN wordpress_recipe_sources s ON s.id = ${sourceId}
    JOIN targets t ON t.id = ep."targetId" AND t."workspaceId" = s."workspaceId"
    LEFT JOIN recipe_ratings r ON r."sourceId" = ${sourceId} AND r."wpPostId" = ('ext:' || ep.id)
    WHERE ep."pictureUrl" IS NOT NULL AND (r."photoTraits" IS NULL OR COALESCE(r."photoVersion", 1) < 2) AND ep."createdTime" >= ${new Date(now.getTime() - 30 * 86_400_000)}
      AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId")
    ORDER BY ep."createdTime" DESC LIMIT ${Math.ceil(limit / 2)}`;
  const external = outside.map(row => ({ id: `ext:${row.id}`, imageUrl: row.pictureUrl }));
  return [...withMedia.slice(0, limit - external.length), ...external];
}

/** Recipes that were a hit on any Page in the last `days` days (at least `minReach` people on one post), 2026-11-20. */
export async function provenHitRecipes(sourceId: string, now: Date, minReach = 20_000, days = 30): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ wpPostId: string }>>`SELECT DISTINCT l."wpPostId" FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
    JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND pt."publishedAt" > ${new Date(now.getTime() - days * 86_400_000)}
      AND COALESCE(ep.insights->>'post_total_media_view_unique', ep.insights->>'reach') ~ '^[0-9.]+$'
      AND COALESCE((ep.insights->>'post_total_media_view_unique')::numeric, (ep.insights->>'reach')::numeric) >= ${minReach}`;
  return new Set(rows.map(row => row.wpPostId));
}

/** The biggest posts of the last 60 days on these Pages (app and outside posts), with their reach: what hits share (2026-11-19). */
export async function hitPosts(pageIds: readonly string[], now: Date, limit = 30): Promise<Array<{ title: string; reach: number }>> {
  if (!pageIds.length) return [];
  const rows = await prisma.$queryRaw<Array<{ message: string | null; insights: unknown }>>`SELECT ep.message, ep.insights FROM external_posts ep
    WHERE ep."targetId" = ANY(${[...pageIds]}::text[]) AND ep.insights IS NOT NULL AND ep."createdTime" > ${new Date(now.getTime() - 60 * 86_400_000)}`;
  return rows.flatMap(row => { const f = figures(row.insights); const text = (row.message ?? '').trim(); return f && text ? [{ title: (text.split(/\n|(?<=[.!?…])\s/)[0] ?? '').slice(0, 140), reach: f.reach }] : []; })
    .sort((a, b) => b.reach - a.reach).slice(0, limit);
}
