import { prisma } from '@/server/data';

/**
 * Title-only captions reach queued posts too (2026-11-21, owner: « RF title-only now »): when a channel is switched to
 * `captionTitle`, its queued recipe posts (more than 30 minutes away) take the recipe's title as caption, keeping their
 * photo, first comment and time. A post goes back to draft for the change and is always scheduled again at its time.
 */
/** The post's media as the publishing update takes it (kind, url, alt text). */
export function mediaOf(media: unknown, title: string): Array<{ kind: 'image'; url: string; altText: string }> {
  return (Array.isArray(media) ? media : []).flatMap(item => {
    const m = item as { url?: unknown; altText?: unknown };
    return typeof m.url === 'string' ? [{ kind: 'image' as const, url: m.url, altText: typeof m.altText === 'string' ? m.altText : title }] : [];
  });
}

export async function retitleQueued(actor: { userId: string; workspaceId: string }, sourceId: string, channelIds: readonly string[], now: Date, limit = 20): Promise<number> {
  if (!channelIds.length) return 0;
  const rows = await prisma.$queryRaw<Array<{ postId: string; targetId: string; title: string; message: string; firstComment: string | null; firstCommentDelayMinutes: number | null; media: unknown; scheduledAt: Date }>>`
    SELECT l."postId", l."targetId", l.title, p.message, p."firstComment", p."firstCommentDelayMinutes", p.media, p."scheduledAt"
    FROM wordpress_recipe_plans l JOIN posts p ON p.id = l."postId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."targetId" = ANY(${[...channelIds]}::text[]) AND p.status::text = 'scheduled'
      AND p."scheduledAt" > ${new Date(now.getTime() + 30 * 60_000)} AND btrim(p.message) IS DISTINCT FROM btrim(l.title) AND btrim(l.title) <> ''
    ORDER BY p."scheduledAt" ASC LIMIT ${limit}`;
  const { cancelScheduledPost, updatePost, schedulePost } = await import('@/modules/publishing/server/lifecycle');
  let done = 0;
  for (const row of rows) {
    try { await cancelScheduledPost(actor, row.postId); } catch { continue; }
    try {
      await updatePost(actor, { postId: row.postId, message: row.title.trim(), firstComment: row.firstComment ?? '', targetIds: [row.targetId], media: mediaOf(row.media, row.title),
        ...(row.firstCommentDelayMinutes === null ? {} : { firstCommentDelayMinutes: row.firstCommentDelayMinutes }) });
      done += 1;
    } catch { /* the post keeps its caption */ } finally {
      await schedulePost(actor, row.postId, row.scheduledAt);
    }
  }
  return done;
}
