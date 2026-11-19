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
export const LOW_APPEAL = 5;
/** Most photos generated in 24 hours, for all Pages of the workspace. */
export const GENERATED_PER_DAY = 6;
/** A title the AI rated this strong (0–10) is worth a new photo when its own is weak. */
export const STRONG_HOOK = 7;
const TRAIT_WORDS: Record<string, string> = {
  close_up: 'close-up shot', overhead: 'shot from above', side_angle: 'side view', cheese_pull: 'melted cheese stretching', melting: 'melting texture', golden_crust: 'golden crust',
  glossy_sauce: 'glossy sauce', steam: 'gentle steam', cut_open: 'one portion cut open to show the inside', generous_portion: 'generous portion', single_serving: 'single serving',
  rustic: 'rustic cookware on a wooden table', elegant_plating: 'elegant plating', bright: 'bright natural light', colorful: 'colourful', hands: 'a hand serving', ingredients_around: 'a few fresh ingredients around',
  plain_background: 'plain background',
};

export function photoPrompt(title: string, ingredients: readonly string[], traits: readonly string[]): string {
  const look = traits.map(trait => TRAIT_WORDS[trait]).filter(Boolean);
  return [
    `Appetising, realistic food photograph for a French home-cooking Facebook page: ${title}.`,
    ingredients.length ? `It contains ${ingredients.slice(0, 8).join(', ').slice(0, 300)}.` : '',
    `${(look.length ? look : ['close-up shot', 'generous portion', 'warm natural light']).join(', ')}.`,
    'Vertical photo, the dish fills the frame, looks home-made and delicious. No text, no logo, no watermark, no faces.',
  ].filter(Boolean).join(' ');
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

export async function generateRecipePhoto(actor: { userId: string; workspaceId: string }, input: { title: string; ingredients: readonly string[]; traits: readonly string[]; fileName: string; settings: ImageSettings; wpPostId: string }, ports: ImagePorts): Promise<{ mediaId: string }> {
  const { generateImage } = await import('@/modules/studio/content-tools/server/media');
  const made = await generateImage(actor, { prompt: photoPrompt(input.title, input.ingredients, input.traits), size: 'portrait', confirmation: 'GENERATE IMAGE' }) as { id?: string };
  if (!made?.id) throw new Error('No picture was made.');
  const { readWorkspaceImage } = await import('@/modules/publishing/server/media/storage');
  const { fsMediaStore } = await import('@/modules/media/server/store');
  try {
    const png = Buffer.from((await readWorkspaceImage(actor.workspaceId, made.id)).bytes);
    const jpeg = await convertToJpeg(png, input.settings);
    const stored = await ports.store(actor, jpeg, input.fileName);
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'autopilot.photo_generated', ${JSON.stringify({ wpPostId: input.wpPostId, mediaId: stored.id })}::jsonb, NOW())`;
    return { mediaId: stored.id };
  } finally {
    await fsMediaStore.removeImage(actor.workspaceId, made.id, true).catch(() => undefined);
  }
}

type Queued = { id: string; postId: string; targetId: string; wpPostId: string; title: string; message: string; firstComment: string | null; firstCommentDelayMinutes: number | null; media: unknown; scheduledAt: Date; photo: number };

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
    SELECT l.id, l."postId", l."targetId", l."wpPostId", l.title, p.message, p."firstComment", p."firstCommentDelayMinutes", p.media, p."scheduledAt", r.photo
    FROM wordpress_recipe_plans l JOIN posts p ON p.id = l."postId" JOIN recipe_ratings r ON r."sourceId" = l."sourceId" AND r."wpPostId" = l."wpPostId"
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."imageSource" IS DISTINCT FROM 'generated' AND p.status::text = 'scheduled'
      AND p."scheduledAt" > ${new Date(now.getTime() + 3 * 3_600_000)} AND p."scheduledAt" < ${new Date(now.getTime() + 3 * 86_400_000)}
      AND r.photo <= ${LOW_APPEAL} AND r.hook >= ${STRONG_HOOK}
    ORDER BY r.hook DESC, p."scheduledAt" ASC LIMIT 20`;
  const { cancelScheduledPost, updatePost, schedulePost } = await import('@/modules/publishing/server/lifecycle');
  const made: Array<{ targetId: string; title: string; appeal: number }> = [];
  for (const row of rows) {
    if (left <= 0) break;
    if (!pageOk(row.targetId)) continue;
    left -= 1;
    const image = await generateRecipePhoto(actor, { title: row.title, ingredients: [], traits: [], fileName: `${row.wpPostId}-new.jpg`, settings, wpPostId: row.wpPostId }, ports);
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
