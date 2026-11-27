import { prisma } from '@/server/data';
import { renderComment } from '../wordpress/recipe';

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

/**
 * A channel switched to a plain first comment (2026-11-23, owner's RF test: « 👉 {link} », no recipe text, no call to
 * action): its queued recipe posts (more than 30 minutes away) take that comment, with the same safe cancel → update →
 * schedule as the title. Only templates without the recipe's lists or description can be rebuilt from a queued post.
 */
export async function recommentQueued(actor: { userId: string; workspaceId: string }, sourceId: string, templates: ReadonlyMap<string, string>, options: { max: number; mark: string }, now: Date, limit = 20): Promise<number> {
  const usable = [...templates].filter(([, template]) => !/\{(ingredients|steps|description|servings|prep|cook|total)\}/.test(template));
  if (!usable.length) return 0;
  const rows = await prisma.$queryRaw<Array<{ postId: string; targetId: string; title: string; permalink: string | null; message: string; firstComment: string | null; firstCommentDelayMinutes: number | null; media: unknown; scheduledAt: Date }>>`
    SELECT l."postId", l."targetId", l.title, l.permalink, p.message, p."firstComment", p."firstCommentDelayMinutes", p.media, p."scheduledAt"
    FROM wordpress_recipe_plans l JOIN posts p ON p.id = l."postId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."targetId" = ANY(${usable.map(([id]) => id)}::text[]) AND p.status::text = 'scheduled'
      AND p."scheduledAt" > ${new Date(now.getTime() + 30 * 60_000)} AND l.permalink IS NOT NULL
    ORDER BY p."scheduledAt" ASC LIMIT 1000`;
  // Every queued post is read, then the first `limit` still to change are taken (2026-11-27): reading only the 60 earliest
  // left 37 of 122 posts unchanged once those 60 were done.
  const wanted = (row: (typeof rows)[number]) => renderComment(templates.get(row.targetId) ?? '', { title: row.title, description: '', servings: '', prep: '', cook: '', total: '', ingredients: [], steps: [] }, row.permalink ?? '', options);
  const todo = rows.filter(row => (row.firstComment ?? '').trim() !== wanted(row).trim()).slice(0, limit);
  const { cancelScheduledPost, updatePost, schedulePost } = await import('@/modules/publishing/server/lifecycle');
  let done = 0;
  for (const row of todo) {
    try { await cancelScheduledPost(actor, row.postId); } catch { continue; }
    try {
      await updatePost(actor, { postId: row.postId, message: row.message, firstComment: wanted(row), targetIds: [row.targetId], media: mediaOf(row.media, row.title),
        ...(row.firstCommentDelayMinutes === null ? {} : { firstCommentDelayMinutes: row.firstCommentDelayMinutes }) });
      done += 1;
    } catch { /* the post keeps its comment */ } finally {
      await schedulePost(actor, row.postId, row.scheduledAt);
    }
  }
  return done;
}
