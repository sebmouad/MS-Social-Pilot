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
