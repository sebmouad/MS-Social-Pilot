import { prisma } from '@/server/data';
import { recipeTitleKey } from '../wordpress/recipe';
import type { FeedActor } from './access';

/**
 * A recipe the owner posts by hand after the autopilot planned it (2026-11-22: « Roulé au saumon fumé, spirale nette et
 * graines de pavot » posted from the phone at 10:43, already queued for 24 Nov 10:35). The planning guard only sees what
 * was posted before a slot is planned, so each run compares the owner's posts of the last 7 days with the queued
 * autopilot posts (more than 3 hours away) and has a repeated one planned with another recipe, `limit` a run.
 */
export async function replaceOutsideRepeats(actor: FeedActor, sourceId: string, now: Date, limit = 5): Promise<Array<{ title: string; targetId: string }>> {
  const outside = await prisma.$queryRaw<Array<{ title: string }>>`
    SELECT split_part(ep.message, E'\\n', 1) AS title FROM external_posts ep
    JOIN wordpress_recipe_sources s ON s.id = ${sourceId} JOIN targets t ON t.id = ep."targetId" AND t."workspaceId" = s."workspaceId"
    WHERE ep."createdTime" > ${new Date(now.getTime() - 7 * 86_400_000)} AND ep.message IS NOT NULL AND ep."remoteMissingAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId")`;
  const owned = new Set(outside.map(row => recipeTitleKey(row.title)).filter(key => key !== 'title:'));
  if (!owned.size) return [];
  const queued = await prisma.$queryRaw<Array<{ id: string; title: string; targetId: string }>>`
    SELECT l.id, l.title, l."targetId" FROM wordpress_recipe_plans l
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."postId" IS NOT NULL AND l."slotAt" > ${new Date(now.getTime() + 3 * 3_600_000)}
    ORDER BY l."slotAt" ASC`;
  const repeats = queued.filter(row => owned.has(recipeTitleKey(row.title))).slice(0, limit);
  if (!repeats.length) return [];
  const { changeRecipeSlotNow } = await import('./wordpress');
  const { replaceRecipeSlotConfirmation } = await import('../wordpress/recipe');
  const done: Array<{ title: string; targetId: string }> = [];
  for (const row of repeats) {
    try { await changeRecipeSlotNow(actor, { planId: row.id, confirmation: replaceRecipeSlotConfirmation(row.id), action: 'replace' }); done.push({ title: row.title.slice(0, 120), targetId: row.targetId }); }
    catch { /* a slot that cannot change keeps its post */ }
  }
  return done;
}
