import { prisma } from '@/server/data';
import { FacebookApiError } from './publishing';

/**
 * Posts deleted on Facebook (2026-11-21, owner: « deleted posts from Facebook must be handled in the app »). Facebook
 * answers code 100 / subcode 33 for an object that no longer exists, and sends a feed webhook with verb « remove ».
 * The post is then recorded as missing on both copies (the app's own post target and the Page feed copy), so jobs stop
 * calling Facebook for it, its comments leave the Inbox and the autopilot no longer learns from it. A post that shows
 * up again in the Page feed is cleared (see the feed sync).
 */
export const isMissingPostError = (error: unknown) => error instanceof FacebookApiError && error.code === 100 && error.subcode === 33;

/** The post's own part of a Graph post id (« pageOrProfileId_postId »): the same post can come with two prefixes. */
export const postPart = (remoteId: string) => remoteId.includes('_') ? remoteId.slice(remoteId.indexOf('_') + 1) : remoteId;

export async function markPostMissing(targetId: string, remotePostId: string, at = new Date()): Promise<number> {
  const part = postPart(remotePostId);
  const own = await prisma.$executeRaw`UPDATE post_targets SET "remoteMissingAt" = ${at} WHERE "targetId" = ${targetId} AND ("remotePostId" = ${remotePostId} OR (${part} <> '' AND split_part("remotePostId", '_', 2) = ${part})) AND "remoteMissingAt" IS NULL`;
  const feed = await prisma.$executeRaw`UPDATE external_posts SET "remoteMissingAt" = ${at} WHERE "targetId" = ${targetId} AND ("remoteId" = ${remotePostId} OR (${part} <> '' AND split_part("remoteId", '_', 2) = ${part})) AND "remoteMissingAt" IS NULL`;
  return own + feed;
}

/**
 * A post's reach as a reading at a fixed age (2026-11-22): `reach3h` when it is 2 to 5 hours old, `reach24h` when 22 to
 * 30 hours old, otherwise null (the stored value is kept). Reach is Facebook's « media viewed by unique people », else reach.
 */
export function reachAtAge(insights: unknown, createdTime: Date, now: Date): { reach3h: number | null; reach24h: number | null } {
  const i = (insights ?? {}) as Record<string, unknown>;
  const raw = typeof i.post_total_media_view_unique === 'number' ? i.post_total_media_view_unique : typeof i.reach === 'number' ? i.reach : null;
  const reach = raw !== null && Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const hours = (now.getTime() - createdTime.getTime()) / 3_600_000;
  return { reach3h: reach !== null && hours >= 2 && hours <= 5 ? reach : null, reach24h: reach !== null && hours >= 22 && hours <= 30 ? reach : null };
}
