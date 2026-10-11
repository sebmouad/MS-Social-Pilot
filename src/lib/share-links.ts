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
