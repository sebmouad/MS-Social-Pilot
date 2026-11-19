import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { convertToJpeg, type ImagePorts, type ImageSettings } from '../wordpress/image';

/**
 * New photos for weak recipe photos (2026-11-19, owner: « you can also generate new images if necessary »). When the
 * recipe site's photo of a planned recipe is weak (the AI rated its appeal LOW_APPEAL or less), the autopilot generates
 * a photo of the dish in the style that works on that Page, at most `perDay` a day (they share the AI budget), unless
 * that Page's memory shows generated photos doing worse. Generation goes through the studio's image service (budget,
 * hourly limit, usage); the result is stored as the recipe JPEG would be, with the AI tag, and the PNG copy removed.
 */
/** 7 since 2026-11-19: no recipe photo is rated 5 or less (144 rated: 1 at 6, 14 at 7, 129 at 8–9), so the weakest are tested; each Page’s memory stops it where it does worse. */
export const LOW_APPEAL = 7;
/** The prompt's version: photos from an older one are remade (2 since 2026-11-19: true to the recipe). */
export const PROMPT_VERSION = 2;
/** Most photos generated in 24 hours, for all Pages of the workspace. */
export const GENERATED_PER_DAY = 6;
/** A title the AI rated this strong (0–10) is worth a new photo when its own is weak. */
export const STRONG_HOOK = 7;
/**
 * The owner's approved look (2026-11-19, after judging examples): the format of the Pages' own hits, a step-by-step
 * collage (4 small step photos, then one big photo of the finished dish at its most tempting moment), real home-kitchen
 * phone photos, no text. Kept under the image policy's 1000 characters.
 */
export function photoPrompt(title: string, ingredients: readonly string[], steps: readonly string[]): string {
  const head = [
    'One vertical image made of 5 real home-kitchen phone photos separated by thin white lines: two rows of 2 small square step photos on top, one big photo of the finished dish filling the bottom third.',
    'Realistic, natural daylight, grey stone or wooden worktop, the cook hands visible in some steps, no text, no title, no logo, no faces.',
    `Recipe: ${title.slice(0, 140)}.`,
  ].join(' ');
  // True to the recipe (2026-11-19): a cheese pull was invented on a cold salmon roll and a gratin on a chicken stew.
  const tail = ' Step 1: the listed ingredients in small bowls; steps 2 to 4: the key steps of the method. Big final photo: close-up of the finished dish exactly as this recipe makes it, a generous portion lifted or cut open. Only ingredients from the list; melted cheese stretching only if the dish is served hot with a melting cheese; a cold dish shows a neat slice.';
  const room = 1000 - head.length - tail.length;
  const facts = [ingredients.length ? ` Ingredients: ${ingredients.slice(0, 8).join(', ')}.` : '', steps.length ? ` Method: ${steps.slice(0, 6).join(' ')}` : ''].join('');
  // Cut at the last sentence or word that fits, never mid-word.
  const fit = facts.length <= room ? facts : facts.slice(0, Math.max(0, room)).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '.';
  return head + (room > 0 ? fit : '') + tail;
}

/** Ingredients and method from a post's first comment (bullets, then numbered steps), for a queued post's photo. */
export function recipeFacts(comment: string): { ingredients: string[]; steps: string[] } {
  const lines = comment.split('\n').map(line => line.trim());
  return {
    ingredients: lines.filter(line => /^[•\-–]\s/.test(line)).map(line => line.replace(/^[•\-–]\s*/, '')).slice(0, 12),
    steps: lines.filter(line => /^\d+[.)]\s/.test(line)).map(line => line.replace(/^\d+[.)]\s*/, '')).slice(0, 8),
  };
}

/** How many more photos may be generated now (GENERATED_PER_DAY in the last 24 hours). */
export async function generationsLeft(workspaceId: string, now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'autopilot.photo_generated' AND "createdAt" >= ${new Date(now.getTime() - 86_400_000)}`;
  return Math.max(0, GENERATED_PER_DAY - Number(rows[0]?.count ?? 0));
}

/** The AI's appeal rating (0–10) of a recipe's own photo, or null when it has not been read. */
export async function photoAppeal(sourceId: string, wpPostId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ photo: number | null }>>`SELECT photo FROM recipe_ratings WHERE "sourceId" = ${sourceId} AND "wpPostId" = ${wpPostId}`;
  return typeof rows[0]?.photo === 'number' ? rows[0].photo : null;
}

export async function generateRecipePhoto(actor: { userId: string; workspaceId: string }, input: { title: string; ingredients: readonly string[]; steps: readonly string[]; fileName: string; settings: ImageSettings; wpPostId: string }, ports: ImagePorts): Promise<{ mediaId: string }> {
  const { generateImage } = await import('@/modules/studio/content-tools/server/media');
  const made = await generateImage(actor, { prompt: photoPrompt(input.title, input.ingredients, input.steps), size: 'portrait', confirmation: 'GENERATE IMAGE' }) as { id?: string };
  if (!made?.id) throw new Error('No picture was made.');
  const { readWorkspaceImage } = await import('@/modules/publishing/server/media/storage');
  const { fsMediaStore } = await import('@/modules/media/server/store');
  try {
    const png = Buffer.from((await readWorkspaceImage(actor.workspaceId, made.id)).bytes);
    const jpeg = await convertToJpeg(png, input.settings);
    const stored = await ports.store(actor, jpeg, input.fileName);
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'autopilot.photo_generated', ${JSON.stringify({ wpPostId: input.wpPostId, mediaId: stored.id, prompt: PROMPT_VERSION })}::jsonb, NOW())`;
    return { mediaId: stored.id };
  } finally {
    await fsMediaStore.removeImage(actor.workspaceId, made.id, true).catch(() => undefined);
  }
}

type Queued = { imageSource: string | null; id: string; postId: string; targetId: string; wpPostId: string; title: string; message: string; firstComment: string | null; firstCommentDelayMinutes: number | null; media: unknown; scheduledAt: Date; photo: number; hook: number | null };

/**
 * New photos for posts already queued (2026-11-19): a queued recipe post with a strong title (STRONG_HOOK) and a weak
 * photo (LOW_APPEAL), going out between 3 hours and 3 days from now, gets a generated photo. The photo is made first;
 * the post then goes back to draft, takes the new photo and is scheduled again at the same time. If the change fails,
 * the post is scheduled again as it was. Within the same daily cap as new posts; not on Pages where they do worse.
 */
export async function upgradeQueuedPhotos(actor: { userId: string; workspaceId: string }, sourceId: string, settings: ImageSettings, ports: ImagePorts, now: Date, pageOk: (targetId: string) => boolean): Promise<Array<{ targetId: string; title: string; appeal: number }>> {
  let left = await generationsLeft(actor.workspaceId, now);
  if (left <= 0) return [];
  const rows = await prisma.$queryRaw<Queued[]>`
    SELECT l."imageSource", l.id, l."postId", l."targetId", l."wpPostId", l.title, p.message, p."firstComment", p."firstCommentDelayMinutes", p.media, p."scheduledAt", r.photo, r.hook
    FROM wordpress_recipe_plans l JOIN posts p ON p.id = l."postId" JOIN recipe_ratings r ON r."sourceId" = l."sourceId" AND r."wpPostId" = l."wpPostId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND p.status::text = 'scheduled'
      AND p."scheduledAt" > ${new Date(now.getTime() + 3 * 3_600_000)} AND p."scheduledAt" < ${new Date(now.getTime() + 3 * 86_400_000)}
      AND r.photo <= ${LOW_APPEAL}
    ORDER BY r.hook DESC NULLS LAST, p."scheduledAt" ASC LIMIT 60`;
  // A strong title, or a recipe sharing what the Pages' biggest hits share (2026-11-19, owner: favour hit content).
  const { hitPosts } = await import('./wordpress-memory');
  const { hitBoost, hitWords } = await import('../wordpress/memory');
  const hits = hitWords(await hitPosts([...new Set(rows.map(row => row.targetId))], now).catch(() => []));
  const worth = (row: Queued) => (row.hook ?? 0) >= STRONG_HOOK || hitBoost(hits, row.title) > 1;
  const { cancelScheduledPost, updatePost, schedulePost } = await import('@/modules/publishing/server/lifecycle');
  const made: Array<{ targetId: string; title: string; appeal: number }> = [];
  // A post on a generated photo is remade only when that photo came from an older prompt; one put back on its own
  // photo by hand (its plan still says generated) is left alone.
  const generated = new Map((await prisma.$queryRaw<Array<{ mediaId: string | null; prompt: string | null }>>`SELECT detail->>'mediaId' AS "mediaId", detail->>'prompt' AS prompt FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'autopilot.photo_generated'`)
    .flatMap(row => row.mediaId ? [[row.mediaId, Number(row.prompt ?? 1)] as const] : []));
  const current = (row: Queued) => { const first = Array.isArray(row.media) ? (row.media as Array<{ url?: unknown }>)[0]?.url : undefined; return typeof first === 'string' ? first.replace(/^media:/, '') : ''; };
  const eligible = (row: Queued) => row.imageSource !== 'generated' ? !generated.has(current(row)) : (generated.get(current(row)) ?? PROMPT_VERSION) < PROMPT_VERSION;
  for (const row of rows) {
    if (!eligible(row)) continue;
    if (left <= 0) break;
    if (!pageOk(row.targetId) || !worth(row)) continue;
    left -= 1;
    const image = await generateRecipePhoto(actor, { title: row.title, ...recipeFacts(row.firstComment ?? ''), fileName: `${row.wpPostId}-new.jpg`, settings, wpPostId: row.wpPostId }, ports);
    const first = Array.isArray(row.media) ? (row.media as Array<{ altText?: string }>)[0] : undefined;
    await cancelScheduledPost(actor, row.postId);
    try {
      await updatePost(actor, { postId: row.postId, message: row.message, firstComment: row.firstComment ?? '', targetIds: [row.targetId], media: [{ kind: 'image', url: `media:${image.mediaId}`, altText: first?.altText ?? row.title }], ...(row.firstCommentDelayMinutes === null ? {} : { firstCommentDelayMinutes: row.firstCommentDelayMinutes }) });
    } finally {
      await schedulePost(actor, row.postId, row.scheduledAt);
    }
    await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET "imageSource" = 'generated', "updatedAt" = NOW() WHERE id = ${row.id}`;
    made.push({ targetId: row.targetId, title: row.title.slice(0, 120), appeal: row.photo });
  }
  return made;
}
