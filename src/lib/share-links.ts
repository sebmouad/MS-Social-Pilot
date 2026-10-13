import { z } from 'zod';

import { hashToken, randomToken } from './crypto';
import { env } from './env';
import { parseTargetIds } from './json';
import { prisma } from './prisma';

/**
 * Links for people outside the workspace — a client, a manager — that open
 * without an account.
 *
 * `review` shows the posts waiting for a decision and lets the visitor
 * approve one, ask for changes or comment. `calendar` shows what is planned
 * and what went out, read-only. Either is limited to the Pages it was made
 * for and can be revoked at any time. Only a hash of the token is stored:
 * the link itself is shown once, when it is made.
 */

export const SHARE_KINDS = ['review', 'calendar', 'portal'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const shareLinkSchema = z.object({
  kind: z.enum(SHARE_KINDS),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  targetIds: z.array(z.string().min(1)).max(500).default([]),
  daysBack: z.number().int().min(0).max(90).default(7),
  daysAhead: z.number().int().min(1).max(120).default(30),
  allowComments: z.boolean().default(true),
  decides: z.boolean().default(false),
  publishAnywayHours: z.number().int().min(1).max(168).nullish(),
});

export const decisionSchema = z.object({
  postId: z.string().min(1),
  decision: z.enum(['approved', 'rejected', 'comment']),
  comment: z.string().trim().max(2000).nullish(),
  authorName: z.string().trim().min(1).max(80),
});

export function shareUrl(token: string): string {
  return `${env.appUrl.replace(/\/$/, '')}/share/${token}`;
}

export async function createShareLink(
  workspaceId: string,
  userId: string,
  input: z.infer<typeof shareLinkSchema>,
): Promise<{ id: string; url: string }> {
  const owned = input.targetIds.length
    ? (await prisma.target.findMany({ where: { workspaceId, id: { in: input.targetIds } }, select: { id: true } })).map((row) => row.id)
    : [];
  const token = randomToken(24);
  const link = await prisma.shareLink.create({
    data: {
      workspaceId,
      createdById: userId,
      kind: input.kind,
      tokenHash: hashToken(token),
      title: input.title,
      description: input.description ?? null,
      targetIds: owned,
      daysBack: input.daysBack,
      daysAhead: input.daysAhead,
      allowComments: input.allowComments,
      decides: input.decides,
      publishAnywayHours: input.decides ? (input.publishAnywayHours ?? null) : null,
    },
  });
  return { id: link.id, url: shareUrl(token) };
}

/** The live link behind a token, or null for one that is wrong or revoked. */
export async function openShareLink(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { select: { name: true, logoUrl: true, timezone: true } } },
  });
  if (!link || link.revokedAt) return null;
  return { ...link, pageIds: parseTargetIds(link.targetIds) };
}

/** Posts a link may show: its workspace, and its Pages when it names some. */
export function sharedPostWhere(link: { workspaceId: string; pageIds: string[] }) {
  return {
    workspaceId: link.workspaceId,
    ...(link.pageIds.length ? { targets: { some: { targetId: { in: link.pageIds } } } } : {}),
  };
}

/** A link that decides may only settle posts that go to its Pages alone. */
export function coversEveryTarget(link: { pageIds: string[] }, targetIds: string[]): boolean {
  return link.pageIds.length === 0 || targetIds.every((id) => link.pageIds.includes(id));
}

/**
 * "Publish anyway": posts a deciding link still holds this
 * many hours before their time are approved, as the agency chose for that
 * client. Database only; the publish job sends them on time.
 */
export async function approveUnanswered(now: Date): Promise<number> {
  const { approvePost, IN_APPROVAL_QUEUE } = await import('./approvals');
  const links = await prisma.shareLink.findMany({ where: { decides: true, publishAnywayHours: { not: null }, revokedAt: null } });
  let approved = 0;
  for (const row of links) {
    const link = { ...row, pageIds: parseTargetIds(row.targetIds) };
    const posts = await prisma.post.findMany({
      where: { ...sharedPostWhere(link), ...IN_APPROVAL_QUEUE, scheduledAt: { not: null, lte: new Date(now.getTime() + row.publishAnywayHours! * 3_600_000) } },
      select: { id: true, targets: { select: { targetId: true } } },
    });
    for (const post of posts) {
      if (!coversEveryTarget(link, post.targets.map((target) => target.targetId))) continue;
      await approvePost({ workspaceId: row.workspaceId, postId: post.id, reviewerId: row.createdById, reviewerRole: 'owner', viaLink: { title: row.title, authorName: 'no answer' } }).catch(() => null);
      approved++;
    }
  }
  return approved;
}
