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

export async function markPostMissing(targetId: string, remotePostId: string, at = new Date()): Promise<number> {
  const own = await prisma.$executeRaw`UPDATE post_targets SET "remoteMissingAt" = ${at} WHERE "targetId" = ${targetId} AND "remotePostId" = ${remotePostId} AND "remoteMissingAt" IS NULL`;
  const feed = await prisma.$executeRaw`UPDATE external_posts SET "remoteMissingAt" = ${at} WHERE "targetId" = ${targetId} AND "remoteId" = ${remotePostId} AND "remoteMissingAt" IS NULL`;
  return own + feed;
}
